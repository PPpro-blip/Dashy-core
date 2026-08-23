/**
 * RAG Ingestion Service
 *
 * Pipeline:
 * raw document → normalize → chunk → embed chunks with Jina → insert document → insert chunks + embeddings into Supabase
 */

import { chunkText, DEFAULT_CONFIG } from "./chunker";
import { embedDocument, EmbeddingResult } from "./embeddings";
import { getSupabaseClientFromEnv } from "./supabase";

export interface DocumentInput {
  text: string;
  sourceType: string;
  sourceId?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown>;
  userId: string;
}

export interface IngestedChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[];
}

export interface RAGIngestResult {
  documentId: string;
  chunkCount: number;
  embeddingDimensions: number;
  chunks: IngestedChunk[];
}

export class IngestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export async function ingestDocument(
  input: DocumentInput,
  env?: {
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    JINA_API_KEY?: string;
  }
): Promise<RAGIngestResult> {
  const supabase = getSupabaseClientFromEnv(env || {});

  // Normalize and chunk
  const chunked = chunkText({
    text: input.text,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    metadata: input.metadata,
  });

  // Insert document
  const { data: document, error: docError } = await supabase
    .from("documents")
    .insert({
      user_id: input.userId,
      title: input.title,
      content: input.text,
      source: input.sourceId,
      source_type: input.sourceType,
      metadata: input.metadata || {},
    })
    .select()
    .single();

  if (docError || !document) {
    throw new IngestError(`Failed to insert document: ${docError?.message || "unknown error"}`, docError);
  }

  const documentId = document.id;

  try {
    // Embed all chunks
    const embeddings: EmbeddingResult[] = [];
    for (const chunk of chunked.chunks) {
      const embedding = await embedDocument(chunk.content, env);
      embeddings.push(embedding);
    }

    // Prepare chunk records
    const chunkRecords = chunked.chunks.map((chunk, idx) => ({
      document_id: documentId,
      user_id: input.userId,
      content: chunk.content,
      embedding: embeddings[idx].embedding,
      chunk_index: idx,
      metadata: {
        ...chunk.metadata,
        model: embeddings[idx].model,
        dimensions: embeddings[idx].dimensions,
        task: embeddings[idx].task,
      },
    }));

    // Insert chunks
    const { error: chunksError } = await supabase
      .from("document_chunks")
      .insert(chunkRecords);

    if (chunksError) {
      // Attempt to clean up document on failure
      await supabase.from("documents").delete().eq("id", documentId);
      throw new IngestError(`Failed to insert chunks: ${chunksError.message}`, chunksError);
    }

    return {
      documentId,
      chunkCount: chunked.chunks.length,
      embeddingDimensions: embeddings[0]?.dimensions || 1024,
      chunks: chunked.chunks.map((chunk, idx) => ({
        chunkIndex: idx,
        content: chunk.content,
        tokenCount: chunk.metadata.tokenCount,
        embedding: embeddings[idx].embedding,
      })),
    };
  } catch (error) {
    // Clean up document on any error after insertion
    await supabase.from("documents").delete().eq("id", documentId);
    throw error;
  }
}