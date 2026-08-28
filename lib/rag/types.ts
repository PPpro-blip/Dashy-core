export type EmbeddingTask =
  | "retrieval.query"
  | "retrieval.passage";

export interface ChunkerConfig {
  targetTokens: number;
  overlapTokens: number;
  minTokens: number;
  maxTokens: number;
}

export interface ChunkInput {
  text: string;
  sourceType: string;
  sourceId?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChunkMetadata {
  chunkIndex: number;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  sourceType: string;
  sourceId?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Chunk {
  content: string;
  metadata: ChunkMetadata;
}

export interface ChunkedDocument {
  normalizedText: string;
  chunks: Chunk[];
}