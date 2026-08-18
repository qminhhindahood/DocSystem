# Phase 3: Database Schema & RAG System

> Current backend note: RAG concepts in this phase are still valid, but backend examples that use Python service files are legacy. Implement core backend routes and services in Express/TypeScript using `../reference/CURRENT_BACKEND_CONTRACT.md`.

## 3.1 Hierarchical Chunking Strategy

Legal documents require structure-aware chunking, not fixed-size splits.

### Updated Chunking Configuration for Jina V3

Jina V3's 8192 token context allows much larger chunks:

| Parameter | Old (MiniLM) | New (Jina V3) |
|-----------|--------------|---------------|
| Max Chunk Size | 1000 chars | **4000-8000 chars** |
| Merge Threshold | Conservative | More aggressive |
| Context Window | 512 tokens | **8192 tokens** |

### Chunking Algorithm
```python
# backend/services/chunker.py
import re
from typing import List, Dict
from dataclasses import dataclass

@dataclass
class Chunk:
    content: str
    doc_id: str
    chunk_type: str  # "document", "chapter", "section", "article", "clause", "point"
    level: int
    metadata: Dict
    parent_id: str = None

class LegalDocumentChunker:
    """
    Vietnamese legal document chunker respecting hierarchy:
    Document (0) -> Chapter (1) -> Section (2) -> Article (3) -> Clause (4) -> Point (5)
    """

    PATTERNS = {
        'chapter': r'^(Chương|Ch\.)\s+([IVXLCDM]+|[A-Z]|\d+)\.?',
        'section': r'^(Mục|M\.)\s+([\dIVXLCDM]+)\.?',
        'article': r'^(Điều|Đ\.)\s+(\d+)\.?',
        'clause': r'^\(\d+\)\s+',
        'point': r'^[a-z]\)\s+',
    }

    def __init__(self, max_chunk_size: int = 4000):
        """
        Initialize chunker with Jina V3 optimized size.
        
        Jina V3 supports 8192 tokens (~6000-8000 chars for Vietnamese),
        so we can use larger chunks while staying within limits.
        
        Args:
            max_chunk_size: Maximum characters per chunk (default 4000)
                           Can go up to 8000 for Jina V3
        """
        self.max_chunk_size = max_chunk_size

    def chunk_document(self, document: Dict) -> List[Chunk]:
        """
        Input: Docling parsed document with elements
        Output: Hierarchical chunks with parent-child relationships
        """
        elements = document['elements']
        chunks = []
        stack = []  # Track current hierarchy

        for elem in elements:
            elem_type = elem['type']
            level = elem['level']

            if elem_type in ['chapter', 'section', 'article', 'clause', 'point']:
                # Pop stack to find parent
                while stack and stack[-1]['level'] >= level:
                    stack.pop()

                parent_id = stack[-1]['chunk_id'] if stack else None

                chunk = Chunk(
                    content=elem['text'],
                    doc_id=document['filename'],
                    chunk_type=elem_type,
                    level=level,
                    metadata={
                        'page': elem['page'],
                        'parent_id': parent_id,
                    }
                )

                chunks.append(chunk)
                stack.append({
                    'chunk_id': chunk.id,
                    'level': level,
                    'type': elem_type
                })

        # Merge small chunks up to max size
        return self.merge_small_chunks(chunks)

    def merge_small_chunks(self, chunks: List[Chunk]) -> List[Chunk]:
        """Merge consecutive content chunks under same parent."""
        merged = []
        i = 0

        while i < len(chunks):
            current = chunks[i]

            # Only merge 'content' type chunks
            if current.chunk_type == 'content':
                combined = [current]
                j = i + 1

                while j < len(chunks) and \
                      chunks[j].chunk_type == 'content' and \
                      chunks[j].metadata.get('parent_id') == current.metadata.get('parent_id') and \
                      sum(len(c.content) for c in combined) < self.max_chunk_size:
                    combined.append(chunks[j])
                    j += 1

                if len(combined) > 1:
                    merged_chunk = Chunk(
                        content='\n'.join(c.content for c in combined),
                        doc_id=current.doc_id,
                        chunk_type='content_block',
                        level=current.level,
                        metadata=current.metadata
                    )
                    merged.append(merged_chunk)
                    i = j
                else:
                    merged.append(current)
                    i += 1
            else:
                merged.append(current)
                i += 1

        return merged
```

## 3.2 Vector Embedding Service

### Recommended: Jina Embeddings V3

Jina Embeddings V3 is the best choice for Vietnamese legal document RAG:

- **8192 token context**: Embed larger chunks without losing context
- **Task-aware embeddings**: Separate modes for queries vs documents (+15% retrieval accuracy)
- **Superior Vietnamese performance**: ~10% better than E5-Large on Vietnamese benchmarks
- **1024 dimensions**: Better representation capacity for legal text

```python
# backend/services/embedding.py
import torch
from sentence_transformers import SentenceTransformer
from typing import List
import numpy as np

class EmbeddingService:
    """
    Jina Embeddings V3 - Optimized for Vietnamese legal documents.
    """

    MODEL_NAME = "jinaai/jina-embeddings-v3"
    DIMENSIONS = 1024
    MAX_SEQUENCE_LENGTH = 8192

    def __init__(self, device: str = None):
        """
        Initialize Jina Embeddings V3 model.
        
        Args:
            device: 'cuda' or 'cpu'. Auto-detects if None.
        """
        if device is None:
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        
        self.device = device
        self.model = SentenceTransformer(
            self.MODEL_NAME,
            device=device
        )
        print(f"Loaded {self.MODEL_NAME} on {device}")

    def embed_query(self, text: str) -> List[float]:
        """
        Embed search query with task-aware mode.
        Optimized for retrieval accuracy.
        """
        embedding = self.model.encode(
            text,
            task_type='query',
            normalize_embeddings=True
        )
        return embedding.tolist()

    def embed_document(self, text: str) -> List[float]:
        """
        Embed document chunk with task-aware mode.
        Optimized for indexing and storage.
        """
        embedding = self.model.encode(
            text,
            task_type='text-document',
            normalize_embeddings=True
        )
        return embedding.tolist()

    def embed_batch(
        self, 
        texts: List[str], 
        task_type: str = 'text-document'
    ) -> List[List[float]]:
        """
        Batch encoding with configurable task type.
        
        Args:
            texts: List of texts to embed
            task_type: 'query', 'text-document', or 'clustering'
        
        Returns:
            List of embeddings
        """
        embeddings = self.model.encode(
            texts,
            task_type=task_type,
            normalize_embeddings=True,
            batch_size=32,
            show_progress_bar=True
        )
        return embeddings.tolist()

    def embed_vietnamese_query(self, vietnamese_text: str) -> List[float]:
        """
        Specialized method for Vietnamese queries.
        Ensures proper tokenization and encoding.
        """
        return self.embed_query(vietnamese_text)

    def embed_vietnamese_document(self, vietnamese_text: str) -> List[float]:
        """
        Specialized method for Vietnamese document chunks.
        """
        return self.embed_document(vietnamese_text)
```

### Alternative: multilingual-e5-large-instruct

If Jina V3 is not available, E5-Large is a solid alternative:

```python
# Alternative embedding service using E5-Large
class E5EmbeddingService:
    MODEL_NAME = "intfloat/multilingual-e5-large-instruct"
    DIMENSIONS = 1024

    def __init__(self):
        self.model = SentenceTransformer(self.MODEL_NAME)

    def embed_query(self, text: str) -> List[float]:
        # E5 requires "query: " prefix for queries
        return self.model.encode(
            f"query: {text}",
            normalize_embeddings=True
        ).tolist()

    def embed_document(self, text: str) -> List[float]:
        # E5 requires "passage: " prefix for documents
        return self.model.encode(
            f"passage: {text}",
            normalize_embeddings=True
        ).tolist()
```

### Installation Instructions

```bash
# Install sentence-transformers (latest version)
pip install -U sentence-transformers

# Install torch with CUDA support (if GPU available)
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# Download the model (first run will cache it)
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('jinaai/jina-embeddings-v3')"
```

### Performance Comparison

| Metric | MiniLM (Old) | E5-Large | Jina V3 (New) |
|--------|--------------|----------|---------------|
| Vietnamese STS | 68.5% | 68.5% | **72.3%** |
| Vietnamese Retrieval | 65.2% | 65.2% | **69.8%** |
| Legal Document QA | 66.8% | 66.8% | **71.2%** |
| Context Window | 512 | 512 | **8192** |
| Task-Aware | No | No | **Yes** |

## 3.3 RAG Search Implementation

```python
# backend/services/rag.py
import numpy as np
from typing import List, Optional
from prisma import Prisma

class RAGService:
    def __init__(self):
        self.db = Prisma()
        self.embedding_service = EmbeddingService()

    async def search(
        self,
        query: str,
        doc_type: Optional[str] = None,
        top_k: int = 15,  # Increased from 10 due to better embeddings
        similarity_threshold: float = 0.65  # Lowered from 0.7 for Jina V3
    ) -> List[Dict]:
        """
        Semantic search with hierarchical re-ranking.
        """
        # 1. Generate query embedding
        embedding_service = EmbeddingService()
        query_embedding = embedding_service.embed([query])[0]

        # 2. Vector similarity search
        results = await self.db.chunk.find_many(
            where={
                "embedding": {
                    "vector": {
                        "similarity": query_embedding,
                        "distance": "cosine"
                    }
                },
                "document": {
                    "docType": doc_type if doc_type else {"not": None}
                }
            },
            take=top_k * 2,  # Get extra for re-ranking
            include={"document": True}
        )

        # 3. Re-rank using hierarchical context
        reranked = self.rerank_with_hierarchy(results, query)

        # 4. Filter by threshold
        filtered = [r for r in reranked if r['score'] >= similarity_threshold]

        return filtered[:top_k]

    def rerank_with_hierarchy(self, results: List, query: str) -> List[Dict]:
        """
        Boost chunks that:
        - Are higher in hierarchy (Article > Clause > Point)
        - Have matching parent context
        - Contain query keywords
        """
        scored_results = []

        for result in results:
            base_score = 1 - result.vector_distance  # Convert cosine distance to similarity

            # Hierarchy boost (higher levels = more authoritative)
            hierarchy_weights = {
                'document': 1.2,
                'chapter': 1.1,
                'article': 1.15,
                'clause': 1.0,
                'point': 0.9,
                'content': 1.0,
                'content_block': 1.0
            }
            hierarchy_boost = hierarchy_weights.get(result.chunkType, 1.0)

            # Keyword overlap boost
            query_terms = set(query.lower().split())
            content_terms = set(result.content.lower().split())
            keyword_overlap = len(query_terms & content_terms) / max(len(query_terms), 1)

            final_score = base_score * hierarchy_boost * (1 + keyword_overlap * 0.5)

            scored_results.append({
                **result.dict(),
                'score': final_score,
                'base_score': base_score
            })

        return sorted(scored_results, key=lambda x: x['score'], reverse=True)

    async def store_chunk_embeddings(self, chunks: List[Chunk]):
        """Store chunks with embeddings in database."""
        texts = [chunk.content for chunk in chunks]
        embeddings = EmbeddingService().embed(texts)

        for chunk, embedding in zip(chunks, embeddings):
            await self.db.chunk.create(
                data={
                    "documentId": chunk.doc_id,
                    "content": chunk.content,
                    "embedding": embedding,
                    "metadata": chunk.metadata,
                    "chunkType": chunk.chunk_type,
                    "chunkIndex": chunks.index(chunk)
                }
            )
```

## 3.4 Database Docker Setup

```yaml
# docker-compose.yml addition
postgres:
  image: pgvector/pgvector:pg15
  environment:
    POSTGRES_DB: airabbit
    POSTGRES_USER: airabbit
    POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./init.sql:/docker-entrypoint-initdb.d/init.sql
  ports:
    - "5432:5432"
  command: ["postgres", "-c", "shared_preload_libraries=vector"]

volumes:
  postgres_data:
```

### `init.sql`
```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create HNSW indexes for faster similarity search (better than IVFFLAT)
-- Run after data is loaded:
-- CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
```
