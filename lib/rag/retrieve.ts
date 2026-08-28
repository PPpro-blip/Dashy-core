/**
 * RAG Retrieval Service
 *
 * Pipeline:
 * query → Jina query embedding → pgvector similarity search → ranked chunks → return relevant context
 */

import { embedQuery, EmbeddingResult } from "./embeddings";
import { getSupabaseClientFromEnv } from "./supabase";

export interface RAGSearchOptions {
  userId: string;
  query: string;
  topK?: number;
  similarityThreshold?: number;
}

export interface RAGSearchResult {
  content: string;
  metadata: {
    documentId: string;
    chunkIndex: number;
    similarity: number;
    sourceType?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };
}

export class RetrieveError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "RetrieveError";
  }
}

export async function retrieveContext(
  options: RAGSearchOptions,
  env?: {
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    JINA_API_KEY?: string;
  }
): Promise<RAGSearchResult[]> {
  const supabase = getSupabaseClientFromEnv(env || {});

  const topK = options.topK || 5;
  const similarityThreshold = options.similarityThreshold ?? 0.5;

  // Generate query embedding
  const embeddingResult = await embedQuery(options.query, env);

  // Call the RPC function
  const { data: chunks, error: rpcError } = await supabase.rpc("match_document_chunks_v2", {
    query_embedding: embeddingResult.embedding,
    match_count: topK,
    filter_user_id: options.userId,
    similarity_threshold: similarityThreshold,
  });

  if (rpcError) {
    throw new RetrieveError(`Failed to retrieve chunks: ${rpcError.message}`, rpcError);
  }

  if (!chunks || chunks.length === 0) {
    return [];
  }

  return chunks.map((chunk: {
    content: string;
    document_id: string;
    user_id: string;
    chunk_index: number;
    similarity: number;
    metadata: Record<string, unknown>;
  }) => ({
    content: chunk.content,
    metadata: {
      documentId: chunk.document_id,
      userId: chunk.user_id,
      chunkIndex: chunk.chunk_index,
      similarity: chunk.similarity,
      sourceType: (chunk.metadata as any)?.sourceType as string | undefined,
      title: (chunk.metadata as any)?.title as string | undefined,
      metadata: chunk.metadata,
    },
  }));
}
