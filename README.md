# DashyCore v7

Premium AI workspace — chat, RAG memory, and (soon) D-Code + Agent Mode.

## Stack

- Next.js 15 (App Router)
- React 19
- TypeScript (strict)
- Tailwind CSS v4
- Supabase (Postgres + Auth + pgvector RAG)
- Cloudflare Workers (`dashy-flow-state`, `dashy-digest`)
- Jina Embeddings v4

## Status

🚧 Frontend rebuild in progress. RAG pipeline and Workers are live and verified.

## Development

```bash
npm install
npm run dev
```

## Structure

- `lib/rag/` — real RAG pipeline (chunking, embeddings, retrieval)
- `worker/` — Cloudflare Worker source (ingest)
- `supabase/migrations/` — database schema
- `_reference/` — preserved wire contracts from prior iteration (DO NOT IMPORT)