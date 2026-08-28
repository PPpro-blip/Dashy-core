-- Forward-only reconciliation migration
-- Upgrades an EXISTING database that already ran the old migration chain
-- (0000 with TEXT user_id, old v1 RPC, old RLS, local trigger) to the
-- verified production-compatible schema.
--
-- This migration is:
--   - forward-only
--   - defensive
--   - idempotent where practical
--   - non-destructive wherever possible
--   - safe against unknown production indexes/triggers
--
-- Production is the source of truth (LIVE-DATABSE-BASELINE.md).
-- This migration does NOT touch production; it is for local/staging databases.

-- ============================================================
-- 1. SAFE USER_ID TYPE CONVERSION (TEXT -> uuid)
-- ============================================================
-- Handles both:
--   - old databases where user_id is TEXT
--   - fresh/reconciled databases where user_id is already UUID
--
-- TEXT values are validated before conversion.
-- UUID columns are left unchanged.

DO $$
DECLARE
  documents_type text;
  chunks_type text;
  invalid_documents BIGINT;
  invalid_chunks BIGINT;
BEGIN
  -- Determine the current column types.
  SELECT data_type
    INTO documents_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'documents'
    AND column_name = 'user_id';

  SELECT data_type
    INTO chunks_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'document_chunks'
    AND column_name = 'user_id';

  -- Validate TEXT user_id values before conversion.
  IF documents_type = 'text' THEN
    SELECT count(*) INTO invalid_documents
    FROM public.documents
    WHERE user_id IS NOT NULL
      AND user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

    IF invalid_documents > 0 THEN
      RAISE EXCEPTION
        'Cannot convert documents.user_id to uuid: % invalid value(s). Fix invalid rows before re-running.',
        invalid_documents;
    END IF;
  END IF;

  IF chunks_type = 'text' THEN
    SELECT count(*) INTO invalid_chunks
    FROM public.document_chunks
    WHERE user_id IS NOT NULL
      AND user_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

    IF invalid_chunks > 0 THEN
      RAISE EXCEPTION
        'Cannot convert document_chunks.user_id to uuid: % invalid value(s). Fix invalid rows before re-running.',
        invalid_chunks;
    END IF;
  END IF;

  -- Convert only when the old schema actually has TEXT columns.
  IF documents_type = 'text' THEN
    ALTER TABLE public.documents
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
  END IF;

  IF chunks_type = 'text' THEN
    ALTER TABLE public.document_chunks
      ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
  END IF;
END $$;

-- ============================================================
-- 2. ADD MISSING COLUMNS (idempotent)
-- ============================================================

-- documents.content — production requires NOT NULL.
-- If existing rows would be NULL after adding, we add as nullable first,
-- then report that a backfill decision is required rather than inventing data.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS content text;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS source_id text;

-- source_type: set default and NOT NULL (existing rows get the default)
ALTER TABLE public.documents
  ALTER COLUMN source_type SET DEFAULT 'unknown';
UPDATE public.documents SET source_type = 'unknown' WHERE source_type IS NULL;
ALTER TABLE public.documents
  ALTER COLUMN source_type SET NOT NULL;

-- document_chunks missing columns
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS token_count integer;

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS embedding_model text NOT NULL DEFAULT 'jina-embeddings-v4';

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS embedding_task text NOT NULL DEFAULT 'retrieval.passage';

-- ============================================================
-- 3. REPLACE V1 RPC (match_document_chunks)
-- ============================================================
-- Drop the old local v1 overloads (TEXT filter_user_id variant).
-- No application code calls v1 (verified by repository search).
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, integer, text, double precision);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, integer, text, real);

-- Create the production-signature v1 (no user filter).
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

-- ============================================================
-- 4. REPLACE RLS POLICIES
-- ============================================================
-- Drop old local policies (service_role + deny_public)
DROP POLICY IF EXISTS "service_role_full_access_documents" ON public.documents;
DROP POLICY IF EXISTS "deny_public_documents" ON public.documents;
DROP POLICY IF EXISTS "service_role_full_access_document_chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "deny_public_document_chunks" ON public.document_chunks;

-- Drop any previously-created reconciliation policies (idempotent re-run)
DROP POLICY IF EXISTS "documents_insert_policy" ON public.documents;
DROP POLICY IF EXISTS "documents_select_policy" ON public.documents;
DROP POLICY IF EXISTS "documents_update_policy" ON public.documents;
DROP POLICY IF EXISTS "documents_delete_policy" ON public.documents;
DROP POLICY IF EXISTS "document_chunks_insert_policy" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_select_policy" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_update_policy" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_delete_policy" ON public.document_chunks;

-- Ensure RLS is enabled (idempotent)
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- Create production-style PERMISSIVE policies on public using auth.uid() = user_id
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

-- ============================================================
-- 5. REMOVE LOCAL TRIGGER (not part of verified production baseline)
-- ============================================================
-- Only remove the local migration-created trigger and its function.
-- Do not remove unrelated functions.
DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;
DROP FUNCTION IF EXISTS public.update_documents_updated_at();

-- ============================================================
-- 6. VERIFIED INDEXES
-- ============================================================
-- Ensure the verified production index exists (idempotent).
CREATE INDEX IF NOT EXISTS document_chunks_user_id_idx ON public.document_chunks(user_id);

-- NOTE: The HNSW vector index on document_chunks.embedding is intentionally
-- NOT created or dropped here. Its production state is UNKNOWN.
-- Do not assume the local definition is production truth.

-- ============================================================
-- 7. FINAL SAFETY CHECK — documents.content NOT NULL
-- ============================================================
-- Production requires documents.content NOT NULL.
-- If any existing rows have NULL content, STOP and report that a backfill
-- decision is required rather than silently inventing data.
DO $$
DECLARE
  null_content BIGINT;
BEGIN
  SELECT count(*) INTO null_content
  FROM public.documents
  WHERE content IS NULL;

  IF null_content > 0 THEN
    RAISE EXCEPTION
      'Cannot set documents.content NOT NULL: % row(s) have NULL content. A backfill decision is required before re-running.',
      null_content;
  END IF;
END $$;

ALTER TABLE public.documents
  ALTER COLUMN content SET NOT NULL;