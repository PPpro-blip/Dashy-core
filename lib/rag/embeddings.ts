/**
 * RAG Embedding Layer — Jina Embeddings v4
 *
 * Server-side only. Uses Jina AI HTTP API with the official endpoint.
 * API key MUST be provided via the environment.
 */

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
  task: "retrieval.query" | "retrieval.passage";
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

function getApiKey(env?: { JINA_API_KEY?: string }): string {
  const apiKey = env?.JINA_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new EmbeddingError("JINA_API_KEY is not set", 500);
  }
  return apiKey;
}

async function callJina(
  text: string,
  task: "retrieval.query" | "retrieval.passage",
  env?: { JINA_API_KEY?: string }
): Promise<EmbeddingResult> {
  const apiKey = getApiKey(env);

  const response = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: "jina-embeddings-v4",
      task,
      dimensions: 1024,
    }),
  });

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      body = "";
    }
    throw new EmbeddingError(
      `Jina API responded with status ${response.status}: ${body || response.statusText}`,
      response.status
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (err) {
    throw new EmbeddingError("Malformed JSON response from Jina", 502, err);
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !("data" in data) ||
    !Array.isArray((data as { data: unknown }).data) ||
    (data as { data: unknown[] }).data.length === 0
  ) {
    throw new EmbeddingError("Missing or invalid 'data' in Jina response", 502);
  }

  const firstItem = (data as { data: unknown[] }).data[0];
  if (
    typeof firstItem !== "object" ||
    firstItem === null ||
    !("embedding" in firstItem) ||
    !Array.isArray((firstItem as { embedding: unknown }).embedding)
  ) {
    throw new EmbeddingError("Missing or invalid 'embedding' in Jina response", 502);
  }

  const embedding = (firstItem as { embedding: unknown[] }).embedding;
  if (embedding.length !== 1024) {
    throw new EmbeddingError(
      `Invalid embedding dimensions: expected 1024, received ${embedding.length}`,
      502
    );
  }

  if (!embedding.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new EmbeddingError("Embedding contains non-numeric values", 502);
  }

  const model = typeof (data as Record<string, unknown>).model === "string"
    ? (data as Record<string, unknown>).model as string
    : "jina-embeddings-v4";

  return {
    embedding: embedding as number[],
    model,
    dimensions: 1024,
    task,
  };
}

export async function embedDocument(
  text: string,
  env?: { JINA_API_KEY?: string }
): Promise<EmbeddingResult> {
  return callJina(text, "retrieval.passage", env);
}

export async function embedQuery(
  text: string,
  env?: { JINA_API_KEY?: string }
): Promise<EmbeddingResult> {
  return callJina(text, "retrieval.query", env);
}