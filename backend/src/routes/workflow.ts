import express from 'express';
import { validate, GenerateDocumentSchema, ValidateDocumentSchema, StructuredOutputRequestSchema, ParseSchema, FormatSchema } from '../middleware/validation';
import { generationTimeout } from '../middleware/timeout';
import { commandParser, planner, researcher, writer, formatter } from '../services/orchestrator';
import { structuredOutputService } from '../services/structured_output_service';
import {
  getTemplate,
  getTemplateContent,
  getTemplateFields,
  validateDecreeCompliance,
  getSupportedDocumentTypes,
  getDocumentTypeName,
} from '../services/template_service';

import { getLLMConfig, callLLM } from '../services/llm_config_service';
import { accessFromRequest } from '../utils/document_access';
import { userAuthMiddleware, requireAuth } from '../middleware/user_auth';
import { withAbortTimeout } from '../utils/abort';
import { generateTemplateDocument } from '../services/template_generation_service';

const router = express.Router();
router.use(userAuthMiddleware, requireAuth);

/**
 * Get supported document types
 * GET /api/workflow/types
 */
router.get('/types', (req, res) => {
  const types = getSupportedDocumentTypes();
  res.json({
    types: types.map((type) => ({
      id: type,
      name: getDocumentTypeName(type),
    })),
  });
});

/**
 * Get template for a document type
 * GET /api/workflow/template/:documentType
 */
router.get('/template/:documentType', (req, res) => {
  try {
    const { documentType } = req.params;
    const template = getTemplate(documentType);
    const content = getTemplateContent(documentType);

    res.json({
      success: true,
      template: {
        ...template,
        content,
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Get fields schema for a document type
 * GET /api/workflow/fields/:documentType
 */
router.get('/fields/:documentType', (req, res) => {
  try {
    const { documentType } = req.params;
    const fields = getTemplateFields(documentType);
    res.json({
      success: true,
      documentType,
      fields,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Extract structured fields from a natural-language prompt via LLM.
 * POST /api/workflow/extract-fields
 * Body: { prompt: string, docType: string }
 */
router.post('/extract-fields', generationTimeout, validate(GenerateDocumentSchema), async (req, res) => {
  try {
    const { prompt, docType } = req.body;
    const userId = accessFromRequest(req).userId;
    if (!docType) {
      return res.status(400).json({ error: 'docType is required for field extraction' });
    }
    let fields: Array<{ name: string; description?: string; defaultValue?: string }>;
    try {
      fields = getTemplateFields(docType);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }

    const fieldNames = fields.map((f) => f.name);
    const extractionSystem = `Bạn là chuyên gia cho văn bản hành chính Việt Nam.
Nhiệm vụ: đọc yêu cầu người dùng và trích xuất chính xác các trường sau: ${fieldNames.join(', ')}.
QUY TẮC:
- Chỉ trả về JSON thuần, không có giải thích.
- Mỗi trường là chuỗi; nếu không có thông tin, trả về chuỗi rỗng "".
- Trường kiểu ngày: trả về dd/mm/yyyy nếu tìm được, ngược lại "".
- Giữ nguyên văn phong tiếng Việt.
Định dạng output: {"field_name": "value", ...}`;

    let raw: string;
    try {
      const llmConfig = await getLLMConfig(userId);
      raw = await callLLM(
        llmConfig,
        [
          { role: 'system', content: extractionSystem },
          { role: 'user', content: `Yêu cầu: "${prompt}"` },
        ],
        {
          temperature: 0.1,
          max_tokens: 1024,
        }
      );
    } catch (err: any) {
      throw new Error(`LLM extraction failed: ${err.message}`);
    }
    let extracted: Record<string, string> = {};
    try {
      const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      extracted = JSON.parse(cleaned);
    } catch {
      console.warn('[extract-fields] Failed to parse LLM JSON');
      extracted = {};
    }

    const result: Record<string, string> = {};
    for (const f of fields) {
      const v = extracted[f.name];
      result[f.name] = typeof v === 'string' ? v : (f.defaultValue || '');
    }

    res.json({ success: true, docType, fields: result });
  } catch (error: any) {
    console.error('Extract-fields error:', error);
    res.status(500).json({ error: 'Field extraction failed' });
  }
});

/**
 * Validate document against Decree 30/2020
 * POST /api/workflow/validate
 */
router.post('/validate', validate(ValidateDocumentSchema), (req, res) => {
  try {
    const { content, docType } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    if (!docType) {
      return res.status(400).json({ error: 'Document type is required' });
    }

    const results = validateDecreeCompliance(content, docType);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: 'Document validation failed' });
  }
});

/**
 * Start document generation workflow
 * POST /api/workflow/generate
 * Body: { prompt: string, docType?: string, referencePdf?: string }
 */
router.post('/generate', generationTimeout, validate(GenerateDocumentSchema), async (req, res) => {
  try {
    const { prompt, docType, templateId } = req.body;
    const access = accessFromRequest(req);
    const userId = access.userId;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Step 1: Parse — extract intent + entities from user prompt
    console.log('Parser: Extracting intent and entities...');
    const parsed = await commandParser.parse(prompt, userId, req.abortSignal);

    // Step 3: Resolve docType — user-supplied wins, fall back to cmd_parser detection
    const resolvedDocType = docType || parsed.docType;
    if (!resolvedDocType && !templateId) {
      return res.status(400).json({ error: 'Either docType or templateId is required' });
    }
    if (resolvedDocType) {
      try { getTemplate(resolvedDocType); } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    }

    const cancelCtl = new AbortController();
    const abortFromRequest = () => cancelCtl.abort(req.abortSignal.reason);
    if (req.abortSignal.aborted) abortFromRequest();
    else req.abortSignal.addEventListener('abort', abortFromRequest, { once: true });
    res.on('close', () => {
      if (!res.writableEnded) {
        cancelCtl.abort(new Error('Client disconnected'));
        console.log('[workflow] Client disconnected, aborting pipeline');
      }
    });

    // Step 4: Planner — Create outline (120s timeout)
    console.log('Planner: Creating outline...');
    let outline = '';
    let plannerWarning: string | undefined;
    try {
      await withAbortTimeout(async (signal) => {
        for await (const event of planner.createOutline(prompt, resolvedDocType, userId, { entities: parsed.entities }, signal)) {
          if (event.stage === 'error') {
            console.warn('[workflow] Planner failed, continuing with empty outline:', event.message);
            plannerWarning = `Planner failed: ${event.message}. Generating without outline.`;
            break;
          }
          if (event.outline) outline = event.outline;
        }
      }, 120_000, cancelCtl.signal);
    } catch (err: any) {
      console.warn('[workflow] Planner step error:', err.message);
      plannerWarning = `Planner failed: ${err.message}. Generating without outline.`;
    }

    if (cancelCtl.signal.aborted) { console.log('[workflow] Aborted after planning'); return res.end(); }

    // Step 4: Researcher — Gather context (180s timeout)
    console.log('Researcher: Gathering context...');
    const researchResults: any[] = [];
    let researcherWarning: string | undefined;
    try {
      await withAbortTimeout(async () => {
        for await (const event of researcher.research(outline, resolvedDocType, userId, access)) {
          if (event.stage === 'error') {
            console.warn('[workflow] Researcher failed, continuing without RAG context:', event.message);
            researcherWarning = `Researcher failed: ${event.message}. Generating without reference documents.`;
            break;
          }
          if (event.results) researchResults.push(...event.results);
        }
      }, 180_000, cancelCtl.signal);
    } catch (err: any) {
      console.warn('[workflow] Researcher step error:', err.message);
      researcherWarning = `Researcher failed: ${err.message}. Generating without reference documents.`;
    }

    if (cancelCtl.signal.aborted) { console.log('[workflow] Aborted after research'); return res.end(); }

    // Step 5-6: Writer — Generate document (600s timeout)
    console.log('Writer: Generating document...');
    const document = await withAbortTimeout(
      (signal) => writer.write(outline, researchResults, prompt, resolvedDocType, userId, { entities: parsed.entities }, signal),
      600_000,
      cancelCtl.signal,
    );

    // Step 7: Validate — regenerate once if Decree 30/2020 compliance fails
    let finalDocument = document;
    let validation = resolvedDocType ? validateDecreeCompliance(document, resolvedDocType) : { valid: true, missing: [] as string[], warnings: [] as string[] };
    if (!validation.valid && !cancelCtl.signal.aborted) {
      console.warn('[workflow] Document failed validation, regenerating...');
      const retryDoc = await withAbortTimeout(
        (signal) => writer.write(outline, researchResults,
          `${prompt} (MUST include these required elements: ${validation.missing.join(', ')})`, resolvedDocType, userId, { entities: parsed.entities }, signal),
        600_000,
        cancelCtl.signal,
      );
      const retryValidation = validateDecreeCompliance(retryDoc, resolvedDocType);
      finalDocument = retryValidation.valid || retryValidation.missing.length < validation.missing.length ? retryDoc : document;
      validation = retryValidation;
    }

    // Step 8: Format — generate .docx from validated content.
    // When templateId is provided, attempt template rendering first; fall back to
    // programmatic generation if the renderer is unavailable.
    let docxBase64: string | undefined;
    let docxName: string | undefined;
    const formatDocType = resolvedDocType || 'cong-van';
    try {
      const docxBuffer = await withAbortTimeout(
        () => formatter.format(finalDocument, formatDocType, {
          title: parsed.entities?.subject || undefined,
          templateId,
          userId,
        }),
        60_000,
        cancelCtl.signal,
      );
      docxBase64 = docxBuffer.toString('base64');
      docxName = `${(parsed.intent || 'document').replace(/\s+/g, '_')}_${Date.now()}.docx`;
      console.log(`[workflow] Formatted .docx (${docxBuffer.length} bytes) ready: ${docxName}`);
    } catch (formatError: any) {
      console.warn('[workflow] Format step failed, returning text only:', formatError.message);
    }

    const warnings = [
      plannerWarning,
      researcherWarning,
      ...(validation.missing.length > 0 ? [`Missing elements: ${validation.missing.join(', ')}`] : []),
      ...validation.warnings,
    ].filter(Boolean);

    res.json({
      success: true,
      intent: parsed.intent,
      entities: parsed.entities,
      outline,
      document: finalDocument,
      researchCount: researchResults.length,
      validation: { valid: validation.valid, missing: validation.missing, warnings: validation.warnings },
      ...(docxBase64 ? { formatResult: docxBase64, formatResultName: docxName } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  } catch (error: any) {
    console.error('Workflow error:', error);
    res.status(500).json({ error: 'Workflow generation failed' });
  }
});

/**
 * Stream document generation
 * POST /api/workflow/stream
 * Body: { prompt: string, docType?: string }
 */
router.post('/stream', generationTimeout, validate(GenerateDocumentSchema), async (req, res) => {
  try {
    const { prompt, docType, templateId, referenceDocumentIds, referenceDocumentId } = req.body;
    const access = accessFromRequest(req);
    const userId = access.userId;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Template generation returns only a structurally verified persisted document;
    // visual fidelity differences remain visible as non-blocking warnings.
    if (templateId) {
      try {
        const result = await generateTemplateDocument({
          ownerId: userId,
          templateId,
          prompt,
          referenceDocumentIds: referenceDocumentIds
            ?? (referenceDocumentId ? [referenceDocumentId] : undefined),
          signal: req.abortSignal,
        });
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.write(`data: ${JSON.stringify({
          stage: 'complete', done: true, documentId: result.documentId,
          fidelity: {
            validationStatus: result.fidelityReport.validationStatus,
            warnings: result.fidelityReport.warnings,
          },
        })}\n\n`);
        return res.end();
      } catch (error: any) {
        if (error.statusCode) {
          return res.status(error.statusCode).json({ error: error.message });
        }
        throw error;
      }
    }

    // Parse for entity passthrough + docType fallback
    const parsed = await commandParser.parse(prompt, userId, req.abortSignal);
    const resolvedDocType = docType || parsed.docType;
    if (resolvedDocType) {
      try { getTemplate(resolvedDocType); } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    }

    const cancelCtl = new AbortController();
    const abortFromRequest = () => cancelCtl.abort(req.abortSignal.reason);
    if (req.abortSignal.aborted) abortFromRequest();
    else req.abortSignal.addEventListener('abort', abortFromRequest, { once: true });
    res.on('close', () => {
      if (!res.writableEnded) {
        cancelCtl.abort(new Error('Client disconnected'));
        console.log('[workflow] Client disconnected, aborting pipeline');
      }
    });

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Step 1-2 (stream): Planner (120s timeout)
    let outline = '';
    try {
      await withAbortTimeout(async (signal) => {
        for await (const event of planner.createOutline(prompt, resolvedDocType, userId, { entities: parsed.entities }, signal)) {
          if (event.stage === 'error') {
            console.warn('[workflow] Planner failed, continuing with empty outline:', event.message);
            res.write(`data: ${JSON.stringify({ stage: 'warning', message: `Planner failed: ${event.message}. Continuing without outline.` })}\n\n`);
            break;
          }
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.outline) outline = event.outline;
        }
      }, 120_000, cancelCtl.signal);
    } catch (err: any) {
      console.warn('[workflow/stream] Planner step error:', err.message);
      res.write(`data: ${JSON.stringify({ stage: 'warning', message: `Planner failed: ${err.message}. Continuing without outline.` })}\n\n`);
    }

    if (cancelCtl.signal.aborted) { console.log('[workflow] Aborted after planning'); return res.end(); }

    // Phase 2: Researcher (180s timeout)
    const researchResults: any[] = [];
    try {
      await withAbortTimeout(async () => {
        for await (const event of researcher.research(outline, resolvedDocType, userId, access)) {
          if (event.stage === 'error') {
            console.warn('[workflow] Researcher failed, continuing without RAG context:', event.message);
            res.write(`data: ${JSON.stringify({ stage: 'warning', message: `Research failed: ${event.message}. Continuing without reference documents.` })}\n\n`);
            break;
          }
          if (event.results) researchResults.push(...event.results);
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      }, 180_000, cancelCtl.signal);
    } catch (err: any) {
      console.warn('[workflow/stream] Researcher step error:', err.message);
      res.write(`data: ${JSON.stringify({ stage: 'warning', message: `Research failed: ${err.message}. Continuing without reference documents.` })}\n\n`);
    }

    if (cancelCtl.signal.aborted) { console.log('[workflow] Aborted after research'); return res.end(); }

    // Phase 3: Writer (streaming) — collect full document for validation
    res.write(`data: ${JSON.stringify({ stage: 'writing', message: 'Generating document...' })}\n\n`);

    const allChunks: string[] = [];
    for await (const chunk of writer.streamWrite(outline, researchResults, prompt, resolvedDocType, userId, { entities: parsed.entities }, cancelCtl.signal)) {
      allChunks.push(chunk);
      res.write(`data: ${JSON.stringify({ stage: 'writing', chunk })}\n\n`);
    }
    const rawDocument = allChunks.join('');

    // Phase 4: Validate — regenerate once if Decree 30/2020 compliance fails
    let finalDocument = rawDocument;
    if (resolvedDocType && !cancelCtl.signal.aborted) {
      const validation = validateDecreeCompliance(rawDocument, resolvedDocType);
      if (!validation.valid && !cancelCtl.signal.aborted) {
        res.write(`data: ${JSON.stringify({ stage: 'warning', message: `Validation failed, missing: ${validation.missing.join(', ')}. Regenerating...` })}\n\n`);
        const retryChunks: string[] = [];
        for await (const chunk of writer.streamWrite(outline, researchResults,
          `${prompt} (MUST include these required elements: ${validation.missing.join(', ')})`, resolvedDocType, userId, { entities: parsed.entities }, cancelCtl.signal)) {
          retryChunks.push(chunk);
          res.write(`data: ${JSON.stringify({ stage: 'writing', chunk })}\n\n`);
        }
        const retryDoc = retryChunks.join('');
        const retryValidation = validateDecreeCompliance(retryDoc, resolvedDocType);
        finalDocument = retryValidation.valid || retryValidation.missing.length < validation.missing.length ? retryDoc : rawDocument;
        res.write(`data: ${JSON.stringify({ stage: 'validation', valid: retryValidation.valid, missing: retryValidation.missing, warnings: retryValidation.warnings })}\n\n`);
      }
    }

    // Phase 5: Format — generate .docx for download
    let docxBase64: string | undefined;
    let docxName: string | undefined;
    if (resolvedDocType && !cancelCtl.signal.aborted) {
      try {
        const docxBuffer = await withAbortTimeout(
          () => formatter.format(finalDocument, resolvedDocType),
          60_000,
          cancelCtl.signal,
        );
        docxBase64 = docxBuffer.toString('base64');
        docxName = `${(parsed.intent || 'document').replace(/\s+/g, '_')}_${Date.now()}.docx`;
      } catch (formatError: any) {
        console.warn('[workflow:stream] Format step failed, returning text only:', formatError.message);
        res.write(`data: ${JSON.stringify({ stage: 'warning', message: `Formatting failed: ${formatError.message}` })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({
      stage: 'complete', done: true,
      ...(docxBase64 ? { formatResult: docxBase64, formatResultName: docxName } : {}),
    })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error('Streaming workflow error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Workflow streaming failed' });
    }
    res.write(`data: ${JSON.stringify({ error: 'Workflow streaming failed' })}\n\n`);
    return res.end();
  }
});

/**
 * Generate structured output with JSON Schema enforcement
 * POST /api/workflow/structured-output
 * Works with any model in LM Studio that supports OpenAI response_format
 */
router.post('/structured-output', generationTimeout, validate(StructuredOutputRequestSchema), async (req, res) => {
  try {
    const { prompt, docType, schema, model, systemPrompt, temperature, maxTokens, strict } = req.body;
    const userId = accessFromRequest(req).userId;

    // Call structured output service
    const result = await structuredOutputService.generate({
      prompt,
      docType,
      schema,
      model,
      systemPrompt,
      temperature,
      maxTokens,
      strict,
      userId,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Structured output error:', error);
    // Return 500 for LM Studio errors, 400 for client errors?
    res.status(500).json({ error: 'Structured output generation failed' });
  }
});

/**
 * Parse a natural-language prompt into intent and entities.
 * POST /api/workflow/parse
 * Body: { prompt: string }
 */
router.post('/parse', generationTimeout, validate(ParseSchema), async (req, res) => {
  try {
    const { prompt } = req.body;
    const userId = accessFromRequest(req).userId;
    const parsed = await commandParser.parse(prompt, userId);
    res.json({ success: true, intent: parsed.intent, entities: parsed.entities, docType: parsed.docType });
  } catch (error: any) {
    res.status(500).json({ error: 'Prompt parsing failed' });
  }
});

/**
 * Format a generated document into .docx.
 * POST /api/workflow/format
 * Body: { content: string, docType: string, title?: string }
 */
router.post('/format', generationTimeout, validate(FormatSchema), async (req, res) => {
  try {
    const { content, docType, title } = req.body;
    const buffer = await formatter.format(content, docType, { title });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const safeName = (title || 'document').replace(/[^\x00-\x7F]/g, '').trim().replace(/\s+/g, '_') || 'document';
    res.set('Content-Disposition', `attachment; filename="${safeName}.docx"; filename*=UTF-8''${encodeURIComponent(title || 'document')}.docx`);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: 'Document formatting failed' });
  }
});

export default router;
