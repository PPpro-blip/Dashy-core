import type { ChunkInput, ChunkedDocument, Chunk, ChunkMetadata, ChunkerConfig } from "./types";

/**
 * Default chunking configuration.
 */
export const DEFAULT_CONFIG: ChunkerConfig = {
  targetTokens: 800,
  overlapTokens: 120,
  minTokens: 100,
  maxTokens: 1000,
};

/**
 * Approximate token counter.
 *
 * For this initial implementation, tokens are estimated using a simple heuristic:
 * average characters per token. This is NOT exact, and should be replaced with
 * a real tokenizer (e.g., Jina's tokenizer) later.
 */
export function estimateTokenCount(text: string): number {
  const chars = text.length;
  // Heuristic: ~4 chars per token for mixed text.
  const tokens = Math.ceil(chars / 4);
  return Math.max(0, tokens);
}

/**
 * Normalizes text for chunking:
 * - Normalizes CRLF/CR to LF
 * - Collapses excessive whitespace
 * - Preserves paragraph boundaries
 *
 * @param text Raw text
 * @returns Normalized text
 */
export function normalizeText(text: string): string {
  let result = text;

  // Normalize line endings to LF
  result = result.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Collapse multiple blank lines into at most one blank line
  result = result.replace(/\n{3,}/g, "\n\n");

  // Trim whitespace at start/end of each line to avoid excess indentation tokens
  const lines = result.split("\n");
  const trimmed = lines.map((line) => line.trimEnd());
  result = trimmed.join("\n");

  // Collapse multiple spaces within lines
  result = result.replace(/[^\S\n]{2,}/g, " ");

  // Ensure leading/trailing whitespace is stripped overall
  result = result.trim();

  return result;
}

/**
 * Splits text into paragraphs. Paragraphs are separated by blank lines.
 */
function splitIntoParagraphs(text: string): string[] {
  // Split on two or more newlines (blank line)
  return text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

/**
 * Splits a paragraph into sentences using common sentence-ending punctuation.
 * Does not intentionally split words.
 */
function splitParagraphIntoSentences(paragraph: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end of string.
  // We keep the punctuation attached to the previous sentence.
  const sentences: string[] = [];
  const parts = paragraph.match(/[^.!?]+[.!?]+(\s+|$)/g) || [paragraph];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }

  // If nothing matched (e.g., no punctuation), treat whole paragraph as one sentence
  if (sentences.length === 0 && paragraph.trim().length > 0) {
    sentences.push(paragraph.trim());
  }

  return sentences;
}

/**
 * Splits text into an ordered list of sentences.
 */
export function splitIntoSentences(text: string): string[] {
  const paragraphs = splitIntoParagraphs(text);
  const sentences: string[] = [];

  for (const para of paragraphs) {
    const paraSentences = splitParagraphIntoSentences(para);
    sentences.push(...paraSentences);
  }

  return sentences;
}

/**
 * Chunks text into pieces that roughly meet the target token count,
 * while respecting minimum/maximum bounds and overlap.
 */
export function chunkText(input: ChunkInput, config: ChunkerConfig = DEFAULT_CONFIG): ChunkedDocument {
  const normalizedText = normalizeText(input.text);

  const sentences = splitIntoSentences(normalizedText);

  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  let currentChunkSentences: string[] = [];
  let currentChunkText = "";
  let currentTokens = 0;
  let startOffset = 0;

  const flushChunk = (endOffset: number) => {
    if (currentChunkText.trim().length === 0) return;

    const content = currentChunkText.trim();
    const tokenCount = estimateTokenCount(content);

    const metadata: ChunkMetadata = {
      chunkIndex,
      tokenCount,
      startOffset,
      endOffset,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      title: input.title ?? null,
      metadata: input.metadata ? { ...input.metadata } : undefined,
    };

    chunks.push({ content, metadata });

    chunkIndex += 1;
    currentChunkSentences = [];
    currentChunkText = "";
    currentTokens = 0;
    startOffset = endOffset;
  };

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceTokens = estimateTokenCount(sentence);

    // If a single sentence exceeds maxTokens, force-split it at word boundaries
    if (sentenceTokens > config.maxTokens) {
      // Flush any current accumulation first
      if (currentChunkText.trim().length > 0) {
        const endOffset = startOffset + currentChunkText.length;
        flushChunk(endOffset);
      }

      const words = sentence.split(/(\s+)/);
      let longChunkText = "";
      let longChunkTokens = 0;

      for (const word of words) {
        const wordTokens = estimateTokenCount(word);
        if (longChunkTokens + wordTokens > config.maxTokens && longChunkText.trim().length > 0) {
          const endOffset = startOffset + longChunkText.length;
          flushChunk(endOffset);
          longChunkText = "";
          longChunkTokens = 0;
        }
        longChunkText += word;
        longChunkTokens += wordTokens;
      }

      if (longChunkText.trim().length > 0) {
        const endOffset = startOffset + longChunkText.length;
        flushChunk(endOffset);
      }
      continue;
    }

    // If adding this sentence would exceed maxTokens, flush and start a new chunk
    if (currentChunkText.trim().length > 0 && currentTokens + sentenceTokens > config.maxTokens) {
      const endOffset = startOffset + currentChunkText.length;
      flushChunk(endOffset);
    }

    currentChunkSentences.push(sentence);
    currentChunkText += (currentChunkText ? " " : "") + sentence;
    currentTokens += sentenceTokens;

    // If we have reached or exceeded targetTokens, flush this chunk
    if (currentTokens >= config.targetTokens) {
      const endOffset = startOffset + currentChunkText.length;
      flushChunk(endOffset);

      // Apply overlap: reuse the last N tokens from the previous chunk as a preamble
      if (config.overlapTokens > 0 && currentChunkSentences.length > 0) {
        // Gather overlap sentences from the last flushed chunk by re-reading chunks
        const lastChunk = chunks[chunks.length - 1];
        if (lastChunk) {
          const overlapSentences = splitIntoSentences(lastChunk.content);
          const sentencesToKeep: string[] = [];
          let overlapTokenCount = 0;

          // Walk backwards to keep as many sentences as fit within overlapTokens
          for (let j = overlapSentences.length - 1; j >= 0; j--) {
            const sTokens = estimateTokenCount(overlapSentences[j]);
            if (overlapTokenCount + sTokens > config.overlapTokens) break;
            sentencesToKeep.unshift(overlapSentences[j]);
            overlapTokenCount += sTokens;
          }

          if (sentencesToKeep.length > 0) {
            currentChunkSentences = sentencesToKeep;
            currentChunkText = sentencesToKeep.join(" ");
            currentTokens = estimateTokenCount(currentChunkText);
            startOffset = lastChunk.metadata.startOffset;
          }
        }
      }
    }
  }

  // Flush remaining content
  if (currentChunkText.trim().length > 0) {
    const endOffset = startOffset + currentChunkText.length;
    flushChunk(endOffset);
  }

  return {
    normalizedText,
    chunks,
  };
}