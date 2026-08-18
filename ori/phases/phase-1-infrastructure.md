# Phase 1: Infrastructure Setup

## 1.1 Hardware Configuration

### GPU Setup (RTX 5060 8GB VRAM)
```bash
# Install NVIDIA drivers (Ubuntu 22.04)
sudo apt update
sudo ubuntu-drivers autoinstall

# Verify installation
nvidia-smi
```

### Install Ollama with GPU Support
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull Qwen3.6-14B with GPU offloading
ollama pull qwen3.6:14b

# Test GPU offloading (Ollama auto-detects CUDA)
ollama run qwen3.6:14b "Test GPU acceleration"

# Configure for optimal memory usage
# Edit ~/.ollama/ollama.service or set environment:
OLLAMA_GPU_LAYERS=35  # Layers to offload to GPU (adjust based on VRAM)
```

### Optimize for 8GB VRAM
Create `ollama.service` override:
```ini
[Service]
Environment="OLLAMA_GPU_LAYERS=32"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
```

## 1.2 Backend Stack (Express.js + TypeScript)

```bash
# Create project structure
mkdir ai-doc-system
cd ai-doc-system

# Initialize backend
mkdir backend
cd backend
npm init -y
npm install express cors helmet morgan dotenv pg @prisma/client
npm install -D typescript @types/node @types/express ts-node nodemon prisma

# Initialize TypeScript
npx tsc --init

# Prisma setup
npx prisma init
```

### `backend/prisma/schema.prisma`
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Document {
  id          String   @id @default(cuid())
  filename    String
  originalPath String
  docType     String   // "thuoc", "quyetdinh", "nghi dinh", etc.
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  chunks      Chunk[]
  templates   Template[]
}

model Chunk {
  id          String   @id @default(cuid())
  documentId  String
  content     String
  embedding   Float[]? // pgvector
  metadata    Json?    // {article, clause, level, pageNum}
  chunkType   String   // "article", "clause", "point", "content"
  chunkIndex Int
  createdAt   DateTime @default(now())

  document    Document @relation(fields: [documentId], references: [id])
  vectorSearchResult VectorSearchResult[]

  @@index([embedding], type: ivfflat, ops: vector_cosine_ops)
  @@index([documentId])
  @@index([chunkType])
}

model VectorSearchResult {
  id        String   @id @default(cuid())
  query     String
  chunkId   String
  rank      Int
  score     Float
  usedInGeneration Boolean @default(false)
  createdAt DateTime @default(now())

  chunk     Chunk    @relation(fields: [chunkId], references: [id])
}

model Template {
  id          String   @id @default(cuid())
  name        String
  docType     String
  content     String   // JSON structure or Word XML
  structure   Json?    // Template schema definition
  version     Int      @default(1)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  generations Generation[]
}

model Generation {
  id           String   @id @default(cuid())
  prompt       String
  generatedDoc String   // Generated content
  templateId   String?
  userId       String?
  feedback     Json?    // User edits and corrections
  qualityScore Float?
  createdAt    DateTime @default(now())

  template     Template? @relation(fields: [templateId], references: [id])
}

model FineTuneExample {
  id        String   @id @default(cuid())
  prompt    String
  response  String   // State document style response
  tone      String   // "authoritative", "precise", "legal"
  structure Json?    // Expected JSON structure
  createdAt DateTime @default(now())
}
```

Enable pgvector:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 1.3 Frontend Stack (Next.js + TypeScript)

```bash
# From project root
cd ..
npx create-next-app@latest frontend --typescript --tailwind --app
cd frontend
npm install axios @tanstack/react-query react-dropzone
npm install -D @types/node
```

### Frontend structure:
```
frontend/
├── app/
│   ├── api/           # Next.js API routes (proxy to backend)
│   ├── documents/     # Document management page
│   ├── generator/     # Document generation UI
│   └── page.tsx       # Dashboard
├── components/
│   ├── DocumentUpload.tsx
│   ├── TemplateSelector.tsx
│   ├── GenerationPanel.tsx
│   └── Editor.tsx      # Monaco editor for Word-like editing
├── lib/
│   └── api.ts         # Axios instance
└── styles/
    └── globals.css
```
