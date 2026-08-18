/**
 * Template Compiler — orchestrates the fusion of structural analysis (from the
 * document-renderer) with semantic field detection to produce a generation
 * schema stored on the Template model.
 *
 * Flow:
 *   1. RendererClient.analyzeTemplate → StructuralAnalysis + baseline pages
 *   2. autoDetectMappings → initial SemanticMap (can be edited by user)
 *   3. compileGenerationSchema → GenerationSchema (stored as JSON)
 */

import { prisma } from '../utils/prisma';
import { analyzeTemplate } from './template_service_client';
import { autoDetectMappings, compileGenerationSchema } from './template_semantics';
import type { SemanticMap, FieldMapping } from './template_semantics';
import type { AnalyzeTemplateInput, TypographyViolation } from '../types/templates';
import type { StructuralAnalysis } from '../types/templates';
import { getTemplateFields } from './template_service';
import { mapTemplateWithVision } from './template_vision_service';
import axios from 'axios';
import { validateTemplateTypography } from './template_typography_rules';

export interface FusionResult {
  generationSchema: Record<string, unknown>;
  semanticMap: Record<string, unknown>;
  baselinePages: string[];
  labeledPages: string[];
}

/**
 * Run the full fusion pipeline for a template.
 * Called after upload or when the user requests re-analysis.
 */
export async function fuseTemplate(
  templateId: string,
  ownerId: string,
  input: AnalyzeTemplateInput,
): Promise<FusionResult> {
  const template = await prisma.template.findFirst({
    where: { id: templateId, ownerId },
    select: { id: true, docType: true, status: true },
  });
  if (!template) {
    throw Object.assign(new Error('Template not found'), { statusCode: 404 });
  }

  const claimed = await prisma.template.updateMany({
    where: { id: templateId, ownerId, status: { in: ['UPLOADED', 'NEEDS_REVIEW', 'FAILED'] } },
    data: { status: 'ANALYZING' },
  });
  if (claimed.count !== 1) {
    throw Object.assign(new Error('Template is already being analyzed or is immutable'), { statusCode: 409 });
  }

  let analysis;
  try {
    analysis = await analyzeTemplate(input);
  } catch (error) {
    const rejected = axios.isAxiosError(error) && error.response?.status === 422;
    await prisma.template.updateMany({
      where: { id: templateId, ownerId },
      data: {
        status: rejected ? 'REJECTED' : 'FAILED',
        rejectionCode: rejected
          ? String((error.response?.data as { code?: string } | undefined)?.code ?? 'UNSAFE_DOCX')
          : 'RENDERER_UNAVAILABLE',
      },
    });
    throw error;
  }

  if (!analysis.success) {
    await prisma.template.updateMany({
      where: { id: templateId, ownerId },
      data: { status: 'FAILED', rejectionCode: 'ANALYSIS_FAILED' },
    });
    throw new Error('Template analysis failed');
  }


  if ((analysis.compatibility?.length ?? 0) > 0) {
    await prisma.template.updateMany({
      where: { id: templateId, ownerId },
      data: {
        status: 'REJECTED',
        rejectionCode: 'UNSUPPORTED_DOCX_STRUCTURE',
        rejectionReason: 'Mẫu có cấu trúc DOCX chưa được hỗ trợ và không thể bảo toàn an toàn.',
        analysisConfidence: 0,
        compatibilityReport: { passed: false, errors: analysis.compatibility },
        previewMetadata: JSON.parse(JSON.stringify({
          baselinePages: analysis.baselinePages ?? [],
          labeledPages: analysis.labeledPages ?? [],
          candidates: analysis.candidates ?? [],
          compatibility: analysis.compatibility,
          documentFingerprint: analysis.documentFingerprint,
        })),
      },
    });
    throw Object.assign(new Error('Template contains unsupported DOCX structures'), {
      statusCode: 422,
      code: 'UNSUPPORTED_DOCX_STRUCTURE',
    });
  }

  const candidates = analysis.candidates ?? [];
  const universalTypographyViolations = validateTemplateTypography(
    template.docType ?? null,
    candidates,
    [],
  );
  if (universalTypographyViolations.length > 0) {
    await prisma.template.updateMany({
      where: { id: templateId, ownerId },
      data: {
        status: 'REJECTED',
        rejectionCode: 'FONT_RULE_VIOLATION',
        rejectionReason: formatTypographyReason(universalTypographyViolations),
        analysisConfidence: 0,
        compatibilityReport: { passed: true, errors: [] },
        previewMetadata: JSON.parse(JSON.stringify({
          baselinePages: analysis.baselinePages ?? [],
          labeledPages: analysis.labeledPages ?? [],
          candidates,
          compatibility: analysis.compatibility ?? [],
          typographyViolations: universalTypographyViolations,
          documentFingerprint: analysis.documentFingerprint,
        })),
      },
    });
    throw Object.assign(new Error('Template typography violates document rules'), {
      statusCode: 422,
      code: 'FONT_RULE_VIOLATION',
    });
  }

  // Auto-detect field mappings from structural analysis
  const mappings: FieldMapping[] = autoDetectMappings(
    template?.docType ?? null,
    {
      documentFingerprint: analysis.documentFingerprint!,
      candidates,
      compatibility: analysis.compatibility ?? [],
    },
  );

  let semanticMap: SemanticMap = {
    version: 1,
    documentFingerprint: analysis.documentFingerprint!,
    mappings,
    ignoredLocators: [],
  };

  let generationSchema = compileGenerationSchema(
    semanticMap,
    {
      documentFingerprint: analysis.documentFingerprint!,
      candidates,
      compatibility: analysis.compatibility ?? [],
    },
    template?.docType ?? null,
  );

  let status: 'READY' | 'NEEDS_REVIEW' | 'FAILED' | 'REJECTED' = 'NEEDS_REVIEW';
  let rejectionCode: string | null = 'CONFIDENCE_GATE_FAILED';
  let typographyViolations: TypographyViolation[] = [];
  try {
    const vision = await mapTemplateWithVision({
      templateId,
      ownerId,
      analysis: {
        documentFingerprint: analysis.documentFingerprint!,
        candidates,
        compatibility: analysis.compatibility ?? [],
      },
      baselinePages: analysis.baselinePages ?? [],
      labeledPages: analysis.labeledPages ?? [],
      structuralMappings: mappings,
    });
    semanticMap = { ...semanticMap, mappings: vision.mappings };
    generationSchema = compileGenerationSchema(semanticMap, {
      documentFingerprint: analysis.documentFingerprint!,
      candidates,
      compatibility: analysis.compatibility ?? [],
    }, template.docType ?? null);
    const required = template.docType ? getTemplateFields(template.docType).filter(field => field.required) : [];
    const byField = new Map(vision.mappings.map(mapping => [mapping.fieldName, mapping]));
    const mappedLocators = vision.mappings
      .map(mapping => mapping.locator)
      .filter((locator): locator is string => Boolean(locator));
    const locatorsAreUnique = new Set(mappedLocators).size === mappedLocators.length;
    const requiredPass = required.every(field => (byField.get(field.name)?.confidence ?? 0) >= 0.85);
    const mappingConfidence = vision.mappings.length
      ? vision.mappings.reduce((sum, mapping) => sum + mapping.confidence, 0) / vision.mappings.length
      : 0;
    typographyViolations = validateTemplateTypography(template.docType ?? null, candidates, vision.mappings);
    if (typographyViolations.length > 0) {
      status = 'REJECTED';
      rejectionCode = 'FONT_RULE_VIOLATION';
    } else if (vision.overallConfidence >= 0.92 && mappingConfidence >= 0.92 && requiredPass && locatorsAreUnique) {
      status = 'READY';
      rejectionCode = null;
    }
  } catch {
    status = 'FAILED';
    rejectionCode = 'VISION_MODEL_REQUIRED';
  }

  // Persist
  await prisma.template.updateMany({
    where: { id: templateId, ownerId },
    data: {
      status,
      semanticMap: JSON.parse(JSON.stringify(semanticMap)),
      generationSchema: JSON.parse(JSON.stringify(generationSchema)),
      analysisConfidence: semanticMap.mappings.length > 0
        ? semanticMap.mappings.reduce((s, m) => s + m.confidence, 0) / semanticMap.mappings.length
        : 0,
      compatibilityReport: { passed: true, errors: [] },
      previewMetadata: JSON.parse(JSON.stringify({
        baselinePages: analysis.baselinePages,
        labeledPages: analysis.labeledPages,
        candidates,
        compatibility: analysis.compatibility ?? [],
        typographyViolations,
        documentFingerprint: analysis.documentFingerprint,
        pageCount: generationSchema.metadata.pageCountEstimate,
      })),
      rejectionCode,
      rejectionReason: typographyViolations.length > 0
        ? formatTypographyReason(typographyViolations)
        : null,
    },
  });

  return {
    generationSchema: generationSchema as unknown as Record<string, unknown>,
    semanticMap: semanticMap as unknown as Record<string, unknown>,
    baselinePages: analysis.baselinePages ?? [],
    labeledPages: analysis.labeledPages ?? [],
  };
}

/**
 * Re-compile the generation schema after the user edits the semantic map.
 */
export async function recompileSchema(
  templateId: string,
  ownerId: string,
  updatedMap: SemanticMap,
): Promise<Record<string, unknown>> {
  const template = await prisma.template.findFirst({
    where: { id: templateId, ownerId },
    select: { id: true, docType: true, previewMetadata: true },
  });
  if (!template) throw Object.assign(new Error('Template not found'), { statusCode: 404 });

  const preview = template.previewMetadata as {
    candidates?: StructuralAnalysis['candidates'];
    compatibility?: string[];
    baselinePages?: string[];
    documentFingerprint?: string;
    typographyViolations?: TypographyViolation[];
  } | null;
  const candidates = preview?.candidates ?? [];
  const candidateLocators = new Set(candidates.map(candidate => candidate.locator));
  const submittedLocators = [
    ...updatedMap.mappings.map(mapping => mapping.locator).filter((locator): locator is string => Boolean(locator)),
    ...updatedMap.ignoredLocators,
  ];
  const unknownLocator = submittedLocators.find(locator => !candidateLocators.has(locator));
  if (unknownLocator) {
    throw Object.assign(new Error('Mapping contains an unknown structural locator'), {
      statusCode: 422,
      code: 'UNKNOWN_TEMPLATE_LOCATOR',
    });
  }
  const mappedLocators = updatedMap.mappings
    .map(mapping => mapping.locator)
    .filter((locator): locator is string => Boolean(locator));
  if (new Set(mappedLocators).size !== mappedLocators.length) {
    throw Object.assign(new Error('Each structural locator can map to only one semantic field'), {
      statusCode: 422,
      code: 'DUPLICATE_TEMPLATE_LOCATOR',
    });
  }
  if (preview?.documentFingerprint && updatedMap.documentFingerprint !== preview.documentFingerprint) {
    throw Object.assign(new Error('Template fingerprint has changed'), {
      statusCode: 409,
      code: 'TEMPLATE_FINGERPRINT_MISMATCH',
    });
  }

  const generationSchema = compileGenerationSchema(
    updatedMap,
    {
      documentFingerprint: updatedMap.documentFingerprint,
      candidates,
      compatibility: preview?.compatibility ?? [],
    },
    template.docType ?? null,
  );

  const mapped = updatedMap.mappings.filter(mapping => mapping.locator !== null);
  const confidence = mapped.length > 0
    ? mapped.reduce((sum, mapping) => sum + mapping.confidence, 0) / mapped.length
    : 0;
  const requiredFields = template.docType
    ? getTemplateFields(template.docType).filter(field => field.required)
    : [];
  const mappingByField = new Map(updatedMap.mappings.map(mapping => [mapping.fieldName, mapping]));
  const requiredFieldsPass = requiredFields.every(field => {
    const mapping = mappingByField.get(field.name);
    return Boolean(mapping?.locator) && (mapping?.confidence ?? 0) >= 0.85;
  });
  const hasBaseline = (preview?.baselinePages?.length ?? 0) > 0;
  const hasNoCompatibilityErrors = (preview?.compatibility?.length ?? 0) === 0;
  const typographyViolations = validateTemplateTypography(
    template.docType ?? null,
    candidates,
    updatedMap.mappings,
  );
  const hasNoTypographyErrors = typographyViolations.length === 0;
  const ready = confidence >= 0.92 && requiredFieldsPass && hasBaseline &&
    hasNoCompatibilityErrors && hasNoTypographyErrors;

  await prisma.template.updateMany({
    where: { id: templateId, ownerId },
    data: {
      semanticMap: JSON.parse(JSON.stringify(updatedMap)),
      generationSchema: JSON.parse(JSON.stringify(generationSchema)),
      analysisConfidence: confidence,
      previewMetadata: JSON.parse(JSON.stringify({
        ...(preview ?? {}),
        typographyViolations,
      })),
      status: !hasNoCompatibilityErrors || !hasNoTypographyErrors ? 'REJECTED' : ready ? 'READY' : 'NEEDS_REVIEW',
      rejectionCode: !hasNoCompatibilityErrors
        ? 'UNSUPPORTED_DOCX_STRUCTURE'
        : !hasNoTypographyErrors
          ? 'FONT_RULE_VIOLATION'
        : ready ? null : 'CONFIDENCE_GATE_FAILED',
      rejectionReason: !hasNoTypographyErrors
        ? formatTypographyReason(typographyViolations)
        : null,
    },
  });

  return generationSchema as unknown as Record<string, unknown>;
}

function formatTypographyReason(violations: TypographyViolation[]): string {
  return violations
    .map(item => `${item.field ?? item.locator}: yêu cầu ${item.expected}; hiện tại ${item.actual}.`)
    .join(' ')
    .slice(0, 500);
}
