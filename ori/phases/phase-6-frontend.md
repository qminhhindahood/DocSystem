# Phase 6: Frontend Application

> Current API note: Use `docType`, JWT bearer auth, `/api/workflow/stream`, `/api/rag/index`, and `/api/feedback/submit`. See `../reference/CURRENT_BACKEND_CONTRACT.md` before copying older API client snippets.

## 6.1 Next.js Setup with Real-time Streaming

### API Configuration
```typescript
// frontend/lib/api.ts
import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 300000, // 5 minutes for generation
  headers: { 'Content-Type': 'application/json' },
});

// Streaming helper
export async function streamGeneration(
  request: GenerationRequest,
  onUpdate: (update: any) => void
): Promise<GenerationResult> {
  const response = await fetch(`${API_BASE}/workflow/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result: GenerationResult | null = null;

  if (!reader) throw new Error('No reader available');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));

    for (const line of lines) {
      try {
        const data = JSON.parse(line.replace('data: ', '').trim());
        onUpdate(data);

        if (data.phase === 'complete' && data.status === 'success') {
          result = { sessionId: data.session_id, status: 'success' };
        }
      } catch (e) {
        console.error('Failed to parse SSE:', e);
      }
    }
  }

  return result!;
}
```

## 6.2 React Query for State Management

```typescript
// frontend/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});
```

## 6.3 Document Generation Page

```tsx
// frontend/app/generator/page.tsx
'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import DocumentUpload from '@/components/DocumentUpload';
import TemplateSelector from '@/components/TemplateSelector';
import GenerationPanel from '@/components/GenerationPanel';
import Editor from '@/components/Editor';

type Phase = 'planning' | 'research' | 'writing' | 'complete' | 'error';

interface GenerationState {
  phase: Phase;
  status: 'starting' | 'in_progress' | 'completed' | 'error';
  result?: any;
  error?: string;
  tokens?: string[];
}

export default function GeneratorPage() {
  const [generationState, setGenerationState] = useState<GenerationState>({
    phase: 'planning',
    status: 'idle',
  });
  const [generatedDoc, setGeneratedDoc] = useState<any>(null);

  const handleGenerate = useCallback(async (request: {
    query: string;
    docType: string;
    templateId?: string;
  }) => {
    setGenerationState({ phase: 'planning', status: 'starting' });

    await streamGeneration(request, (update) => {
      setGenerationState((prev) => ({
        ...prev,
        phase: update.phase as Phase,
        status: update.status,
        result: update.result,
        tokens: [...(prev.tokens || []), update.chunk].filter(Boolean),
        error: update.error,
      }));

      if (update.phase === 'complete' && update.status === 'success') {
        setGeneratedDoc(update.result);
      }
    });
  }, []);

  return (
    <div className="container mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Panel - Input */}
      <div className="lg:col-span-1 space-y-6">
        <DocumentUpload />
        <TemplateSelector onSelect={(t) => console.log(t)} />
        <GenerationPanel onGenerate={handleGenerate} disabled={generationState.status === 'in_progress'} />
      </div>

      {/* Right Panel - Output */}
      <div className="lg:col-span-2 space-y-6">
        {/* Phase Progress */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">Tiến độ</h2>
          <div className="space-y-2">
            {['planning', 'research', 'writing'].map((phase) => (
              <div key={phase} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  generationState.phase === phase && generationState.status === 'in_progress' ? 'bg-yellow-500 animate-pulse' :
                  generationState.phase === phase ? 'bg-green-500' : 'bg-gray-300'
                }`} />
                <span className="capitalize">{phase}: </span>
                <span className="text-sm text-gray-600">
                  {generationState.phase === phase && generationState.status === 'starting' && 'Đang bắt đầu...'}
                  {generationState.phase === phase && generationState.status === 'in_progress' && 'Đang xử lý...'}
                  {generationState.phase === phase && generationState.status === 'completed' && 'Hoàn thành'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Live Preview */}
        {(generationState.tokens?.length || 0) > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm max-h-96 overflow-auto">
            <h3 className="font-semibold mb-2">Preview</h3>
            <pre>{generationState.tokens?.join('')}</pre>
          </div>
        )}

        {/* Final Editor */}
        {generatedDoc && (
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-4">Văn bản đã soạn thảo</h2>
            <Editor
              initialValue={JSON.stringify(generatedDoc, null, 2)}
              onChange={(content) => {
                // Track edits for self-learning
                trackEdits(generatedDoc, JSON.parse(content));
              }}
            />
            <div className="mt-4 flex gap-2">
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Xuất Word
              </button>
              <button className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
                Lưu và Phản hồi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

## 6.4 Monaco Editor Integration

```tsx
// frontend/components/Editor.tsx
'use client';

import Editor from '@monaco-editor/react';
import { useCallback } from 'react';

interface EditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  language?: 'json' | 'markdown';
  readOnly?: boolean;
}

export default function DocEditor({
  initialValue,
  onChange,
  language = 'json',
  readOnly = false,
}: EditorProps) {
  const handleChange = useCallback((value: string | undefined) => {
    onChange(value || '');
  }, [onChange]);

  return (
    <Editor
      height="500px"
      defaultLanguage={language}
      value={initialValue}
      onChange={handleChange}
      theme="vs-light"
      options={{
        readOnly,
        minimap: { enabled: false },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        fontSize: 14,
        lineNumbers: 'on',
        automaticLayout: true,
      }}
    />
  );
}
```

## 6.5 Document Upload with Docling

```tsx
// frontend/components/DocumentUpload.tsx
'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { api } from '@/lib/api';

export default function DocumentUpload() {
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await api.post('/rag/index', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        console.log('Uploaded:', response.data);
      } catch (error) {
        console.error('Upload failed:', error);
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    multiple: true,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
        isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
      }`}
    >
      <input {...getInputProps()} />
      <div className="text-4xl mb-2">📄</div>
      <p className="text-gray-600">
        {isDragActive
          ? 'Thả các file PDF vào đây'
          : 'Kéo thả file PDF, hoặc click để chọn'}
      </p>
      <p className="text-sm text-gray-400 mt-2">Tối đa 10 file mỗi lần</p>
    </div>
  );
}
```

## 6.6 Tailwind Configuration

```javascript
// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

## 6.7 TypeScript Types

```typescript
// frontend/types/index.ts
export interface Document {
  id: string;
  filename: string;
  docType: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface Chunk {
  id: string;
  content: string;
  chunkType: 'article' | 'clause' | 'point' | 'content';
  metadata: {
    page: number;
    article?: string;
    clause?: string;
  };
}

export interface GenerationRequest {
  query: string;
  docType: string;
  templateId?: string;
  useRag: boolean;
}

export interface GenerationResult {
  sessionId: string;
  status: 'success' | 'error';
  document?: {
    number: string;
    title: string;
    content: string;
    signatureBlock: SignatureBlock;
  };
}

export interface SignatureBlock {
  place: string;
  signer: string;
  position: string;
}
```

## 6.8 CSS for Decree 30/2020 Compliance

```css
/* frontend/styles/decree30.css */
.decree-document {
  font-family: 'Times New Roman', serif;
  line-height: 1.8;
  max-width: 210mm; /* A4 width */
  margin: 0 auto;
  padding: 20mm;
}

.decree-header {
  text-align: center;
  text-transform: uppercase;
  font-weight: bold;
  margin-bottom: 2em;
}

.decree-number {
  font-size: 1.2em;
  margin-bottom: 0.5em;
}

.decree-content {
  text-align: justify;
  text-justify: inter-word;
}

.decree-signature {
  margin-top: 3em;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2em;
}

.decree-signature-item {
  text-align: center;
}

.decree-stamp {
  width: 80mm;
  height: 40mm;
  border: 2px dashed red;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 1em auto;
}
```
