-- RAG Foundation: documents and document_chunks
-- Uses pgvector with 1024 dimensions for Jina Embeddings v4
-- Reconciled to match the verified production schema (LIVE-DATABSE-BASELINE.md)

-- Documents table
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  source TEXT,
  source_type TEXT NOT NULL DEFAULT 'unknown',
  source_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document chunks table
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER,
  embedding vector(1024),
  embedding_model TEXT NOT NULL DEFAULT 'jina-embeddings-v4',
  embedding_task TEXT NOT NULL DEFAULT 'retrieval.passage',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
-- Verified production index: document_chunks_user_id_idx
CREATE INDEX IF NOT EXISTS document_chunks_user_id_idx ON public.document_chunks(user_id);

-- Additional indexes for query performance (production state UNKNOWN; kept non-destructive)
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON public.documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON public.document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_created_at ON public.document_chunks(created_at DESC);

-- NOTE: The HNSW vector index on document_chunks.embedding is intentionally NOT created here.
-- Its production state is UNKNOWN. Do not assume the local definition is production truth.

-- Enable RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Production-style PERMISSIVE policies on public using auth.uid() = user_id
CREATE POLICY "documents_insert_policy"
  ON public.documents
  FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_select_policy"
  ON public.documents
  FOR SELECT
  TO public
  USING (auth.uid() = user_id);

CREATE POLICY "documents_update_policy"
  ON public.documents
  FOR UPDATE
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "documents_delete_policy"
  ON public.documents
  FOR DELETE
  TO public
  USING (auth.uid() = user_id);

CREATE POLICY "document_chunks_insert_policy"
  ON public.document_chunks
  FOR INSERT
  TO public
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "document_chunks_select_policy"
  ON public.document_chunks
  FOR SELECT
  TO public
  USING (auth.uid() = user_id);

CREATE POLICY "document_chunks_update_policy"
  ON public.document_chunks
  FOR UPDATE
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "document_chunks_delete_policy"
  ON public.document_chunks
  FOR DELETE
  TO public
  USING (auth.uid() = user_id);

-- NOTE: The update_documents_updated_at trigger is intentionally NOT created here.
-- Its production state is UNKNOWN. Do not invent a production object.

-- Vector search RPC function (v1) — production signature, no user filter
-- NOTE: The production v1 function body is UNKNOWN. This is the minimum safe
-- implementation matching the verified production signature.
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector,
  match_count integer,
  match_threshold real
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  user_id UUID,
  content TEXT,
  embedding vector,
  chunk_index INTEGER,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.user_id,
    dc.content,
    dc.embedding,
    dc.chunk_index,
    dc.metadata,
    dc.created_at,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql STABLE;