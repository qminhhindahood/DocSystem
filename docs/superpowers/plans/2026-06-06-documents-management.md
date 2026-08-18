# Plan C: Documents Management Page & Navigation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Documents page where users can browse, search, filter, view details, and export generated documents as DOCX. Also add persistent navigation and connect the remaining dots from Plans A and B (DOCX export, Q&A page, nav links).

**Architecture:** Documents page at `/documents` with full CRUD-read UI, server-side pagination, search, and type filters. Backend routes serve document listing and detail endpoints (shared with the DOCX export from Plan A). Nav bar links everything together.

**Tech Stack:** Existing Express backend, Next.js frontend, Prisma, `docx` library (Plan A), existing SSE streaming patterns.

---

## Prerequisites

- [ ] Plan A partially implemented: `docx` library installed, `generateDocumentDocx` service exists
- [ ] Plan B partially implemented: Q&A route and page exist (or will be created inline here)

---

## File Structure

```
backend/
  src/
    routes/
      documents.ts          # NEW — document CRUD + DOCX export
      qa.ts                 # NEW (if Plan B not done) — Q&A endpoint
    index.ts                # MODIFY — register new routes

frontend/
  app/
    layout.tsx              # MODIFY — add nav bar
    documents/
      page.tsx              # NEW — document list/grid page
    qa/
      page.tsx              # NEW (if Plan B not done) — chat page
  lib/
    api.ts                  # MODIFY — add document APIs + download helper
  components/
    DocumentCard.tsx        # NEW — document preview card
    DocumentDetailModal.tsx # NEW — full document viewer with export
```

---

## Task 1: Add navigation bar

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Add nav bar to root layout**

Edit `frontend/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'AI Document System',
  description: 'Generate Vietnamese government documents with AI',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="vi">
      <body className={inter.className}>
        <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 flex items-center h-14 gap-6">
            <Link href="/" className="text-base font-bold text-gray-900 tracking-tight">
              AI Document System
            </Link>
            <div className="flex items-center gap-5 ml-4">
              <Link
                href="/generate"
                className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
              >
                Tạo văn bản
              </Link>
              <Link
                href="/documents"
                className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
              >
                Tài liệu
              </Link>
              <Link
                href="/qa"
                className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
              >
                Tra cứu
              </Link>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Verify build**
```bash
cd C:/Users/PC/Documents/LLM/frontend && npm run build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**
```bash
git add frontend/app/layout.tsx
git commit -m "feat: add navigation bar with links to Generate, Documents, Q&A"
```

---

## Task 2: Create backend document routes (CRUD + DOCX export)

**Files:**
- Create: `backend/src/routes/documents.ts`
- Modify: `backend/src/index.ts` (register route)
- Test: `backend/src/routes/documents.contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

Create `backend/src/routes/documents.contract.test.ts`:

```typescript
import request from 'supertest';
import { app } from '../index';

describe('GET /api/documents', () => {
  it('returns 200 with empty or populated list', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('data');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('supports pagination query params', async () => {
    const res = await request(app).get('/api/documents?limit=5&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
  });

  it('supports docType filter', async () => {
    const res = await request(app).get('/api/documents?docType=quyet-dinh');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/documents/:id/export-docx', () => {
  it('returns 404 for nonexistent document', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app).get(`/api/documents/${fakeId}/export-docx`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/PC/Documents/LLM/backend && npx jest src/routes/documents.contract.test.ts --no-coverage
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Write the route implementation**

Create `backend/src/routes/documents.ts`:

```typescript
import express from 'express';
import { prisma } from '../utils/prisma';
import { generateDocumentDocx, getSupportedDocxTypes } from '../services/docx_service';

const router = express.Router();

/**
 * GET /api/documents
 * List documents with optional filtering and pagination.
 * Query: ?docType=quyet-dinh&status=draft&limit=20&offset=0&q=search
 */
router.get('/', async (req, res) => {
  try {
    const { docType, status, limit = '20', offset = '0', q } = req.query;

    const where: Record<string, unknown> = {};
    if (docType) where.docType = docType as string;
    if (status) where.status = status as string;
    if (q) {
      where.OR = [
        { title: { contains: q as string, mode: 'insensitive' } },
        { content: { contains: q as string, mode: 'insensitive' } },
      ];
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: {
          id: true,
          docType: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { chunks: true, feedback: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(parseInt(limit as string, 10), 100),
        skip: parseInt(offset as string, 10),
      }),
      prisma.document.count({ where }),
    ]);

    res.json({
      success: true,
      data: documents,
      meta: {
        total,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        pages: Math.ceil(total / parseInt(limit as string, 10)),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/documents/:id
 * Get a single document with its chunks.
 */
router.get('/:id', async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
      include: {
        chunks: { orderBy: { level: 'asc' }, take: 50 },
        feedback: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!document) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true, data: document });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/documents/:id/export-docx
 * Export a document as DOCX with Vietnamese government formatting.
 * Query: ?title=Custom+Title (optional, overrides stored title)
 */
router.get('/:id/export-docx', async (req, res) => {
  try {
    const document = await prisma.document.findUnique({
      where: { id: req.params.id },
      select: { id: true, docType: true, content: true, title: true },
    });
    if (!document) return res.status(404).json({ error: 'Document not found' });

    const title = (req.query.title as string) || document.title || 'document';
    const buffer = await generateDocumentDocx({
      content: document.content,
      docType: document.docType,
      title,
    });

    const filename = sanitizeFilename(title) + '.docx';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/documents/types
 * List all supported document types.
 */
router.get('/types', (_req, res) => {
  res.json({ success: true, types: getSupportedDocxTypes() });
});

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_À-ỹ\-]/g, '_').substring(0, 60);
}

export default router;
```

- [ ] **Step 4: Register the route**

Edit `backend/src/index.ts` — add after the other route imports:
```typescript
import documentsRoutes from './routes/documents';
```

And add after the other `app.use(...)` calls:
```typescript
app.use('/api/documents', documentsRoutes);
```

- [ ] **Step 5: Run tests**

```bash
cd C:/Users/PC/Documents/LLM/backend && npx jest src/routes/documents.contract.test.ts --no-coverage
```

Expected: All pass.

- [ ] **Step 6: Commit**
```bash
git add backend/src/routes/documents.ts backend/src/routes/documents.contract.test.ts backend/src/index.ts
git commit -m "feat: add document CRUD and DOCX export endpoints"
```

---

## Task 3: Create Q&A backend route (if Plan B not yet done)

**Files:**
- Create: `backend/src/routes/qa.ts`
- Modify: `backend/src/index.ts` (register route)
- Test: `backend/src/routes/qa.contract.test.ts`

Skip this task if Plan B's Q&A route is already implemented.

- [ ] **Step 1: Write the failing contract test**

Create `backend/src/routes/qa.contract.test.ts`:

```typescript
import request from 'supertest';
import { app } from '../index';

describe('POST /api/qa/ask', () => {
  it('returns 400 for empty question', async () => {
    const res = await request(app).post('/api/qa/ask').send({ question: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 for missing question', async () => {
    const res = await request(app).post('/api/qa/ask').send({});
    expect(res.status).toBe(400);
  });

  it('returns a stream for a valid question', async () => {
    const res = await request(app)
      .post('/api/qa/ask')
      .send({ question: 'Điều 1 quy định gì?' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:/Users/PC/Documents/LLM/backend && npx jest src/routes/qa.contract.test.ts --no-coverage
```

- [ ] **Step 3: Write the route implementation**

Create `backend/src/routes/qa.ts`:

```typescript
import express from 'express';
import { z } from 'zod';
import axios from 'axios';
import { ragService } from '../services/rag_service';
import { generationTimeout } from '../middleware/timeout';

const router = express.Router();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.6:14b';

const AskSchema = z.object({
  question: z.string().min(1, 'Question is required').max(2000),
  docType: z.string().optional(),
  topK: z.coerce.number().int().min(1).max(20).default(5),
});

/**
 * POST /api/qa/ask
 * Body: { question: string, docType?: string, topK?: number }
 * Returns SSE stream of: { stage, message?, answerChunk?, done?, sources?, error? }
 *
 * Flow:
 * 1. "researching" — retrieve top-k relevant chunks via RAG
 * 2. "answering" — stream LLM answer grounded in retrieved context
 * 3. "complete" — done, includes source citations
 */
router.post('/ask', generationTimeout, async (req, res) => {
  try {
    const { question, docType, topK } = AskSchema.parse(req.body);
    const sources: { id: string; content: string; article?: string; clause?: string }[] = [];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (payload: Record<string, unknown>) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // client likely disconnected
      }
    };

    // Phase 1: RAG retrieval
    send({ stage: 'researching', message: 'Đang tìm tài liệu liên quan...' });
    try {
      const chunks = await ragService.search(question, topK, docType);
      sources.push(
        ...chunks.map((c) => ({
          id: c.id,
          content: c.content,
          article: c.article,
          clause: c.clause,
        }))
      );
    } catch (err) {
      console.warn('RAG search failed, answering without context:', err);
    }

    send({
      stage: 'researching',
      message: `Đã tìm thấy ${sources.length} đoạn văn bản liên quan`,
      sources,
    });

    // Phase 2: Stream LLM answer
    send({ stage: 'answering', message: 'Đang soạn câu trả lời...' });

    const contextBlock =
      sources.length > 0
        ? `Dưới đây là các đoạn văn bản liên quan được trích xuất từ cơ sở dữ liệu:\n\n${sources
            .map(
              (s, i) =>
                `[Nguồn ${i + 1}] (${s.article || 'N/A'}${s.clause ? ', ' + s.clause : ''})\n${s.content}`
            )
            .join('\n\n---\n\n')}`
        : 'Không tìm thấy tài liệu liên quan trong cơ sở dữ liệu. Trả lời dựa trên kiến thức chung.';

    const systemPrompt = `Bạn là trợ lý pháp lý chuyên về văn bản hành chính Việt Nam.

QUY TẮC:
1. Trả lời CHỈ dựa trên các đoạn văn bản được cung cấp bên dưới. Nếu thông tin không có trong các đoạn trên, hãy nói rõ "Thông tin này không có trong tài liệu đã cung cấp".
2. Trích dẫn rõ nguồn (ví dụ: "theo Điều 1 Khoản 1...") khi sử dụng thông tin.
3. Trả lời bằng tiếng Việt, ngắn gọn, chính xác.
4. Nếu có nhiều nguồn liên quan, tổng hợp chúng một cách nhất quán.
5. Không bịa đặt thông tin pháp lý.

${contextBlock}

--- Câu hỏi ---
${question}`;

    let fullAnswer = '';
    try {
      const response = await axios.post(
        `${OLLAMA_URL}/api/generate`,
        {
          model: OLLAMA_MODEL,
          prompt: systemPrompt,
          stream: true,
          options: { num_ctx: 8192, temperature: 0.3 },
        },
        { responseType: 'stream', timeout: 120_000 }
      );

      for await (const chunk of response.data) {
        let buffer = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.response) {
              fullAnswer += data.response;
              send({ stage: 'answering', answerChunk: data.response });
            }
            if (data.done) break;
          } catch {
            // skip malformed
          }
        }
      }
    } catch (llmErr) {
      send({
        stage: 'error',
        error: `LLM error: ${llmErr instanceof Error ? llmErr.message : 'Unknown'}`,
      });
      return res.end();
    }

    send({
      stage: 'complete',
      done: true,
      answer: fullAnswer,
      sourceCount: sources.length,
    });
    res.end();
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(400).json({ error: err.message || 'Invalid request' });
    }
  }
});

export default router;
```

- [ ] **Step 4: Register the route**

In `backend/src/index.ts`:
- Add `import qaRoutes from './routes/qa';` with the other route imports
- Add `app.use('/api/qa', qaRoutes);` with the other `app.use(...)` calls

- [ ] **Step 5: Run tests**

```bash
cd C:/Users/PC/Documents/LLM/backend && npx jest src/routes/qa.contract.test.ts --no-coverage
```

Expected: 3/3 PASS (streaming test may be flaky — the 400 cases are the critical ones).

- [ ] **Step 6: Commit**
```bash
git add backend/src/routes/qa.ts backend/src/routes/qa.contract.test.ts backend/src/index.ts
git commit -m "feat: add Q&A endpoint with RAG-grounded answers"
```

---

## Task 4: Add frontend API helpers

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add document list/detail/export helpers**

Add these exports to `frontend/lib/api.ts` (after the `healthCheck` function):

```typescript
// ============================================================================
// API Functions — Documents
// ============================================================================

export interface DocumentListItem {
  id: string;
  docType: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: { chunks: number; feedback: number };
}

export interface DocumentsListResponse {
  success: boolean;
  data: DocumentListItem[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    pages: number;
  };
}

/**
 * List documents with optional filters.
 */
export async function listDocuments(filters: {
  docType?: string;
  status?: string;
  limit?: number;
  offset?: number;
  q?: string;
} = {}): Promise<DocumentsListResponse> {
  const params = new URLSearchParams();
  if (filters.docType) params.set('docType', filters.docType);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit.toString());
  if (filters.offset) params.set('offset', filters.offset.toString());
  if (filters.q) params.set('q', filters.q);

  const response = await fetch(`${API_BASE}/documents?${params}`);
  if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
  return response.json();
}

/**
 * Get a single document by ID.
 */
export async function getDocument(id: string): Promise<{ success: boolean; data: any }> {
  const response = await fetch(`${API_BASE}/documents/${id}`);
  if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
  return response.json();
}

/**
 * Download a document as DOCX.
 */
export async function downloadDocumentAsDocx(
  documentId: string,
  title?: string
): Promise<void> {
  const url = new URL(`${API_BASE}/documents/${documentId}/export-docx`);
  if (title) url.searchParams.set('title', title);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = title ? `${title}.docx` : `document_${documentId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

// ============================================================================
// API Functions — Q&A
// ============================================================================

export interface QAMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: Array<{ id: string; content: string; article?: string; clause?: string }>;
}

/**
 * Ask a question against the RAG document store. Returns an async generator
 * yielding { stage, message?, answerChunk?, sources?, done?, answer?, error? }.
 */
export async function* askQuestion(
  question: string,
  docType?: string,
  topK = 5
): AsyncGenerator<Record<string, unknown>> {
  const response = await fetch(`${API_BASE}/qa/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, docType, topK }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `QA error: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream');
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { yield JSON.parse(line.slice(6)); } catch { /* skip */ }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**
```bash
git add frontend/lib/api.ts
git commit -m "feat: add document list/export and Q&A API helpers"
```

---

## Task 5: Create the Documents page

**Files:**
- Create: `frontend/app/documents/page.tsx`
- Create: `frontend/components/DocumentCard.tsx`
- Create: `frontend/components/DocumentDetailModal.tsx`

- [ ] **Step 1: Create DocumentCard component**

Create `frontend/components/DocumentCard.tsx`:

```tsx
"use client";

import React from "react";
import { FileText, Calendar, ChevronRight } from "lucide-react";
import { DocumentListItem } from "../lib/api";

const DOC_TYPE_LABELS: Record<string, string> = {
  "quyet-dinh": "Quyết định",
  "chi-thi": "Chỉ thị",
  "bao-cao": "Báo cáo",
  "cong-van": "Công văn",
  "thong-bao": "Thông báo",
};

interface DocumentCardProps {
  document: DocumentListItem;
  onClick: () => void;
}

export default function DocumentCard({ document, onClick }: DocumentCardProps) {
  const date = new Date(document.updatedAt).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl border border-gray-200 p-5
        hover:border-blue-300 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {DOC_TYPE_LABELS[document.docType] || document.docType}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 truncate group-hover:text-blue-700">
            {document.title || "Văn bản chưa đặt tên"}
          </h3>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {date}
            </span>
            <span>{document._count.chunks} đoạn</span>
            <span>{document._count.feedback} phản hồi</span>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 shrink-0 mt-1" />
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create DocumentDetailModal component**

Create `frontend/components/DocumentDetailModal.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import { X, Download, FileText, Calendar } from "lucide-react";
import { downloadDocumentAsDocx } from "../lib/api";

interface DocumentDetailModalProps {
  document: {
    id: string;
    docType: string;
    title: string;
    content: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    chunks: { id: string; content: string; level: number }[];
    feedback: any[];
  };
  onClose: () => void;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  "quyet-dinh": "Quyết định",
  "chi-thi": "Chỉ thị",
  "bao-cao": "Báo cáo",
  "cong-van": "Công văn",
  "thong-bao": "Thông báo",
};

export default function DocumentDetailModal({
  document,
  onClose,
}: DocumentDetailModalProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadDocumentAsDocx(document.id, document.title);
    } catch (err) {
      console.error("Export error:", err);
      alert(`Xuất DOCX thất bại: ${err instanceof Error ? err.message : "Lỗi"}`);
    } finally {
      setExporting(false);
    }
  };

  const date = new Date(document.createdAt).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-blue-500" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {document.title || "Văn bản chưa đặt tên"}
              </h2>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                <span className="text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-medium">
                  {DOC_TYPE_LABELS[document.docType] || document.docType}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {date}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium
                text-white bg-gradient-to-r from-purple-600 to-indigo-600 rounded-lg
                hover:from-purple-700 hover:to-indigo-700 disabled:opacity-50 transition-all"
            >
              <Download className="w-4 h-4" />
              {exporting ? "Đang xuất..." : "Xuất DOCX"}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="prose prose-sm max-w-none">
            <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
              {document.content}
            </pre>
          </div>

          {document.chunks.length > 0 && (
            <div className="mt-8">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                Đoạn văn bản đã phân tích ({document.chunks.length})
              </h3>
              <div className="space-y-2">
                {document.chunks.map((chunk) => (
                  <div
                    key={chunk.id}
                    className="text-xs bg-gray-50 rounded-lg p-3 border border-gray-100"
                  >
                    <span className="text-gray-400">Đoạn {chunk.level}</span>
                    <p className="mt-1 text-gray-600 line-clamp-3">
                      {chunk.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the Documents page**

Create `frontend/app/documents/page.tsx`:

```tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { listDocuments, DocumentListItem } from "../../lib/api";
import DocumentCard from "../../components/DocumentCard";
import DocumentDetailModal from "../../components/DocumentDetailModal";
import { Search, FileText, Plus, Loader2 } from "lucide-react";

const DOC_TYPES = [
  { value: "", label: "Tất cả loại" },
  { value: "quyet-dinh", label: "Quyết định" },
  { value: "chi-thi", label: "Chỉ thị" },
  { value: "bao-cao", label: "Báo cáo" },
  { value: "cong-van", label: "Công văn" },
  { value: "thong-bao", label: "Thông báo" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "draft", label: "Bản nháp" },
  { value: "final", label: "Hoàn chỉnh" },
];

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [meta, setMeta] = useState({ total: 0, pages: 1, offset: 0 });

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listDocuments({
        docType: docTypeFilter || undefined,
        status: statusFilter || undefined,
        limit: 20,
        offset: 0,
        q: searchQuery || undefined,
      });
      setDocuments(result.data);
      setMeta(result.meta);
    } catch (err) {
      console.error("Failed to load documents:", err);
    } finally {
      setLoading(false);
    }
  }, [docTypeFilter, statusFilter, searchQuery]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Tài liệu</h1>
              <p className="text-xs text-gray-500">
                {meta.total} văn bản đã tạo
              </p>
            </div>
          </div>
          <a
            href="/generate"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium
              text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Tạo mới
          </a>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm văn bản..."
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <select
              value={docTypeFilter}
              onChange={(e) => setDocTypeFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Document Grid */}
      <main className="max-w-5xl mx-auto px-4 pb-12">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="mx-auto h-16 w-16 text-gray-300 mb-4" />
            <h2 className="text-lg font-semibold text-gray-700">
              {searchQuery || docTypeFilter || statusFilter
                ? "Không tìm thấy văn bản phù hợp"
                : "Chưa có văn bản nào"}
            </h2>
            <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
              {searchQuery || docTypeFilter || statusFilter
                ? "Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm."
                : "Bắt đầu tạo văn bản hành chính đầu tiên của bạn."}
            </p>
            {!searchQuery && !docTypeFilter && !statusFilter && (
              <a
                href="/generate"
                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-sm font-medium
                  text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-4 h-4" />
                Tạo văn bản
              </a>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onClick={async () => {
                  const { data } = await import("../../lib/api").then(
                    (m) => m.getDocument(doc.id)
                  );
                  setSelectedDoc(data);
                }}
              />
            ))}
          </div>
        )}
      </main>

      {/* Detail Modal */}
      {selectedDoc && (
        <DocumentDetailModal
          document={selectedDoc}
          onClose={() => setSelectedDoc(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run a build sanity check**

```bash
cd C:/Users/PC/Documents/LLM/frontend && npm run build 2>&1 | tail -30
```

Expected: build succeeds (fix any type errors that surface).

- [ ] **Step 5: Commit**
```bash
git add frontend/app/documents/page.tsx frontend/components/DocumentCard.tsx frontend/components/DocumentDetailModal.tsx frontend/lib/api.ts
git commit -m "feat: add documents management page with search, filter, and DOCX export"
```

---

## Task 6: Create the Q&A chat page (if Plan B not yet done)

**Files:**
- Create: `frontend/app/qa/page.tsx`

Skip this task if Plan B's Q&A page is already implemented.

- [ ] **Step 1: Create the chat page**

Create `frontend/app/qa/page.tsx`:

```tsx
"use client";

import React, { useState, useRef, useEffect } from "react";
import { askQuestion, QAMessage } from "../../lib/api";
import { Send, MessageSquare, FileText, ChevronDown, RotateCcw, BookOpen } from "lucide-react";

export default function QAPage() {
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [docType, setDocType] = useState<string>("");
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [currentSources, setCurrentSources] = useState<any[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingAnswer]);

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed || isAsking) return;

    abortRef.current = false;
    const userMsg: QAMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion("");
    setIsAsking(true);
    setStreamingAnswer("");
    setCurrentSources([]);

    const assistantMsg: QAMessage = {
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      for await (const evt of askQuestion(trimmed, docType || undefined)) {
        if (abortRef.current) break;
        if (evt.error) {
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { ...prev[prev.length - 1], content: `Lỗi: ${evt.error}` },
          ]);
          break;
        }
        if (evt.stage === "researching" && Array.isArray(evt.sources)) {
          setCurrentSources(evt.sources as any[]);
        }
        if (evt.answerChunk) {
          setStreamingAnswer((prev) => prev + evt.answerChunk);
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { ...prev[prev.length - 1], content: prev[prev.length - 1].content + evt.answerChunk },
          ]);
        }
        if (evt.done && evt.answer) {
          setMessages((prev) => [
            ...prev.slice(0, -1),
            {
              ...prev[prev.length - 1],
              content: evt.answer as string,
              sources: (evt.sources as any[]) || currentSources,
            },
          ]);
          setStreamingAnswer("");
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          ...prev[prev.length - 1],
          content: `Lỗi: ${err instanceof Error ? err.message : "Không xác định"}`,
        },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setCurrentSources([]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="w-6 h-6 text-blue-600" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Tra cứu văn bản</h1>
              <p className="text-xs text-gray-500">
                Đặt câu hỏi về tài liệu đã tải lên
              </p>
            </div>
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
            >
              <RotateCcw className="w-4 h-4" />
              Xóa hội thoại
            </button>
          )}
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <BookOpen className="mx-auto h-16 w-16 text-gray-300 mb-4" />
              <h2 className="text-lg font-semibold text-gray-700">
                Bắt đầu đặt câu hỏi
              </h2>
              <p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
                Nhập câu hỏi về nội dung văn bản hành chính. Hệ thống sẽ tìm các
                đoạn liên quan trong tài liệu đã tải lên và trả lời dựa trên văn
                bản pháp lý.
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs cursor-pointer flex items-center gap-1 opacity-70 hover:opacity-100">
                      <FileText className="w-3 h-3" />
                      Nguồn ({msg.sources.length} đoạn)
                    </summary>
                    <div className="mt-2 space-y-2">
                      {msg.sources.map((s, i) => (
                        <div
                          key={s.id || i}
                          className="text-xs bg-gray-50 rounded p-2 border border-gray-100"
                        >
                          <span className="font-medium">
                            Nguồn {i + 1}
                            {s.article ? ` — ${s.article}` : ""}
                          </span>
                          <p className="mt-1 text-gray-600 whitespace-pre-wrap line-clamp-3">
                            {s.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>
          ))}

          {isAsking && streamingAnswer && (
            <div className="flex justify-start">
              <div
                className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-3
                  bg-white border border-gray-200 shadow-sm"
              >
                <p className="text-sm whitespace-pre-wrap">{streamingAnswer}</p>
                <span className="inline-block w-2 h-4 ml-1 bg-blue-500 animate-pulse" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center gap-3 mb-2">
            <label className="text-xs text-gray-500">Lọc theo loại văn bản:</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1"
            >
              <option value="">Tất cả loại văn bản</option>
              <option value="quyet-dinh">Quyết định</option>
              <option value="chi-thi">Chỉ thị</option>
              <option value="bao-cao">Báo cáo</option>
              <option value="cong-van">Công văn</option>
              <option value="thong-bao">Thông báo</option>
            </select>
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Nhập câu hỏi về văn bản hành chính..."
              rows={1}
              disabled={isAsking}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-xl
                focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                resize-none disabled:opacity-50"
              style={{ minHeight: "44px", maxHeight: "120px" }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
            />
            <button
              onClick={handleAsk}
              disabled={isAsking || !question.trim()}
              className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add frontend/app/qa/page.tsx
git commit -m "feat: add Q&A chat page with RAG-grounded answers"
```

---

## Task 7: Frontend hardening for the documents page

**Files:**
- Modify: `frontend/app/documents/page.tsx`
- Modify: `frontend/components/DocumentCard.tsx`
- Modify: `frontend/components/DocumentDetailModal.tsx`
- Modify: `frontend/lib/api.ts`
- Create: `frontend/app/documents/error.tsx`
- Create: `frontend/hooks/useDebounce.ts` (optional)

> **Note:** Cross-cutting frontend hardening (`lucide-react` install, `<a>`→`<Link>`, global error boundary, auth persistence) is in **Plan A → Task 7**. Apply that first — this task assumes those fixes are in place.

### Task 7a: Convert list to React Query

**Problem:** The current `useEffect`+`useState` for `documents` re-fetches on every mount, has no cache, no retry, no background refresh.

**Files:** `frontend/lib/api.ts`, `frontend/app/documents/page.tsx`

- [ ] **Step 1: Add query hooks**

In `frontend/lib/api.ts`:

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';

export function useListDocuments(params: { search?: string; docType?: string; status?: string }) {
  return useQuery({
    queryKey: ['documents', params],
    queryFn: ({ signal }) => listDocuments(params, signal),
    staleTime: 30_000,
    keepPreviousData: true,
  });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: ['document', id],
    queryFn: ({ signal }) => getDocument(id!, signal),
    enabled: !!id,
  });
}
```

Update `listDocuments` and `getDocument` to accept an `AbortSignal`:

```typescript
export async function listDocuments(params: any, signal?: AbortSignal) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/api/documents?${qs}`, { signal, headers });
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Use in `documents/page.tsx`**

```typescript
const [search, setSearch] = useState('');
const [docType, setDocType] = useState('');
const debouncedSearch = useDebounce(search, 300);
const { data, isLoading, isError, error, refetch } = useListDocuments({ search: debouncedSearch, docType });
```

### Task 7b: Debounced search input

**Files:** Create `frontend/hooks/useDebounce.ts`

```typescript
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
```

### Task 7c: Empty state, error state, and retry

**Files:** `frontend/app/documents/page.tsx`

- [ ] **Step 1: Add an empty state**

```tsx
{!isLoading && data?.documents.length === 0 && (
  <div className="text-center py-20">
    <FileText className="mx-auto h-12 w-12 text-gray-300" />
    <h3 className="mt-3 text-lg font-semibold text-gray-700">Chưa có tài liệu nào</h3>
    <p className="mt-1 text-sm text-gray-500">Tải lên PDF hoặc tạo văn bản mới để bắt đầu.</p>
    <Link href="/generate" className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg">
      Tạo văn bản mới
    </Link>
  </div>
)}
```

- [ ] **Step 2: Add error state with retry**

```tsx
{isError && (
  <div className="text-center py-12">
    <p className="text-red-600">Lỗi tải danh sách: {String(error)}</p>
    <button onClick={() => refetch()} className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg">
      Thử lại
    </button>
  </div>
)}
```

### Task 7d: Loading skeletons (matches Plan A Task 7i)

**Files:** `frontend/app/documents/page.tsx`

```tsx
{isLoading && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {[1,2,3,4].map(i => (
      <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="h-4 bg-gray-200 rounded w-2/3 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-1/4" />
      </div>
    ))}
  </div>
)}
```

### Task 7e: Error boundary for /documents

**Files:** Create `frontend/app/documents/error.tsx`

```tsx
'use client';
export default function DocumentsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md p-6 bg-white rounded-xl shadow text-center">
        <FileText className="w-12 h-12 text-red-500 mx-auto" />
        <h2 className="mt-3 text-xl font-bold">Không tải được danh sách tài liệu</h2>
        <p className="mt-2 text-sm text-gray-600">{error.message}</p>
        <button onClick={reset} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg">
          Thử lại
        </button>
      </div>
    </div>
  );
}
```

### Task 7f: Robust DOCX export with retry + toast feedback

**Problem:** `downloadDocumentAsDocx` returns a `Blob` and the call site uses `URL.createObjectURL` + `<a download>`. If the server returns 500, the user just gets an empty file. No feedback, no retry.

**Files:** `frontend/lib/api.ts`, `frontend/components/DocumentCard.tsx`, `frontend/components/DocumentDetailModal.tsx`

- [ ] **Step 1: Throw on non-2xx in the helper**

```typescript
export async function downloadDocumentAsDocx(id: string, signal?: AbortSignal) {
  const res = await fetch(`${API_BASE}/api/documents/${id}/export-docx`, { signal, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Export failed (${res.status}): ${text || res.statusText}`);
  }
  return res.blob();
}
```

- [ ] **Step 2: Wrap in `useMutation` with retry + toast**

```typescript
export function useDownloadDocument() {
  return useMutation({
    mutationFn: ({ id, filename }: { id: string; filename: string }) =>
      downloadDocumentAsDocx(id).then(blob => ({ blob, filename })),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    retry: 1,
    retryDelay: 1000,
  });
}
```

- [ ] **Step 3: Wire up the buttons**

In `DocumentCard.tsx` and `DocumentDetailModal.tsx`:

```tsx
const download = useDownloadDocument();
// disabled={download.isLoading}
// onError: show "Tải lại" toast with the error message
```

### Task 7g: Status filter persistence (URL query string)

**Files:** `frontend/app/documents/page.tsx`

Sync `search`, `docType`, and `status` to URL params using `useSearchParams` + `useRouter`. Refresh and back-button restore the filters.

```typescript
const router = useRouter();
const searchParams = useSearchParams();

useEffect(() => {
  const next = new URLSearchParams();
  if (search) next.set('q', search);
  if (docType) next.set('type', docType);
  router.replace(`/documents?${next.toString()}`);
}, [search, docType]);
```

### Task 7h: "Chat with this document" CTA on detail modal

**Files:** `frontend/components/DocumentDetailModal.tsx`

Add a button that closes the modal and navigates to `/qa?documentId=<id>`. The Q&A page reads `documentId` from the query string and pre-filters `docType` or pre-fills the question.

```tsx
<button
  onClick={() => router.push(`/qa?documentId=${doc.id}`)}
  className="px-4 py-2 bg-blue-600 text-white rounded-lg"
>
  <MessageSquare className="inline w-4 h-4 mr-1" /> Hỏi về tài liệu này
</button>
```

### Task 7i: Commit

```bash
git add frontend/app/documents/page.tsx frontend/app/documents/error.tsx \
  frontend/components/DocumentCard.tsx frontend/components/DocumentDetailModal.tsx \
  frontend/lib/api.ts frontend/hooks/useDebounce.ts
git commit -m "feat(documents): react query, debounce, empty/error states, robust export, filter persistence"
```

---

## Task 8: Self-review checklist

- [ ] **Nav bar** — links to Home (`/`), Generate (`/generate`), Documents (`/documents`), Q&A (`/qa`). Sticky, responsive.
- [ ] **Documents page** — lists documents with search + docType + status filters. Detail modal shows full content + chunks. Export button downloads DOCX.
- [ ] **Q&A page** — chat UI with streaming SSE answers, RAG source citations, docType filter.
- [ ] **Backend routes** — `GET /api/documents`, `GET /api/documents/:id`, `GET /api/documents/:id/export-docx`, `GET /api/documents/types`, `POST /api/qa/ask`.
- [ ] **API helpers** — `listDocuments`, `getDocument`, `downloadDocumentAsDocx`, `askQuestion` in `frontend/lib/api.ts`. All accept `AbortSignal`.
- [ ] **React Query** wraps list/get/download; `useListDocuments`, `useDocument`, `useDownloadDocument`.
- [ ] **Debounced search** (300ms) via `useDebounce` hook.
- [ ] **Empty state + error state + retry** on documents page.
- [ ] **Loading skeletons** (matches Plan A 7i).
- [ ] **Error boundary** at `frontend/app/documents/error.tsx`.
- [ ] **Robust DOCX export** — non-2xx throws, mutation retries once, toast feedback on success/failure.
- [ ] **Filter persistence** — `search`/`docType` synced to URL query string.
- [ ] **"Chat with this document"** CTA on detail modal → `/qa?documentId=<id>`.
- [ ] **No TBD/TODO placeholders** — all code is complete and functional.
- [ ] **Type consistency** — TypeScript types align across frontend and backend. `docType` strings match existing schema.

---

## Summary

This plan completes the user-facing triad:
- **Plan A** — DOCX generation (backend service + export endpoint) + global backend bug fixes (RAG regex, SSE, Redis, timeout, batch) + backend hardening (helmet, rate-limit, pino, error handler, env validation) + cross-cutting frontend hardening (lucide-react, Link, error boundary, auth persistence, Monaco completer, confidence bug fix, AbortController, diff counter, loading skeletons).
- **Plan B** — Q&A chat interface (RAG-backed SSE streaming) + Q&A-specific frontend hardening (real AbortController cancel, React Query mutation, error boundary, sessionStorage history, loading skeleton).
- **Plan C** (this plan) — Documents management page + navigation + documents-specific frontend hardening (React Query, debounce, empty/error states, robust export with retry, filter persistence, "Chat with this document" CTA).

After all three plans, the system supports: upload PDFs → generate documents → chat with them → export as formatted DOCX → browse all documents in one place, with production-grade reliability and UX.
