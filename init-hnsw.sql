-- HNSW index for vector similarity search (pgvector)
-- Runs AFTER init.sql completes (not inside a transaction).
-- Name matches the index auto-created by backend/src/index.ts (idx_chunks_embedding_hnsw).
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON "Chunk" USING hnsw (embedding vector_cosine_ops);
