-- Drop any existing overloaded versions of match_document_chunks_v2
DROP FUNCTION IF EXISTS public.match_document_chunks_v2(vector, integer, text, double precision);
DROP FUNCTION IF EXISTS public.match_document_chunks_v2(vector, integer, uuid, double precision);

-- Create v2 of match_document_chunks with correct signature
CREATE OR REPLACE FUNCTION public.match_document_chunks_v2(
  query_embedding vector(1024),
  match_count INTEGER,
  filter_user_id UUID,
  similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  user_id UUID,
  content TEXT,
  embedding vector(1024),
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
  WHERE dc.user_id = filter_user_id
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql STABLE;