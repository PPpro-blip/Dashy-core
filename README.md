# DashyCore v7

Premium AI workspace — chat, RAG memory, D-Code and Agent Mode.

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

Configure Supabase Auth (email OTP, Google and GitHub) and apply the D-Code
migration in `supabase/migrations/20260829100000_create_dcode_projects.sql`.
Email sign-in accepts a one-time code or the email link; include `{{ .Token }}`
in the Supabase email template to display the code, and allow `/auth/callback`
in your Supabase redirect URLs.

## Sharing

Open **Share** in an owned D-Code project to create a stable `/s/<slug>` link.
The Share Hub controls `is_public` in Supabase. With Public Access off, the
owner can still preview the link; anonymous and other users get HTTP 403.
Public links are readable without a session. Previous
`/d-code/share/<slug>` links redirect to the same viewer after the access
check. RLS remains the final data-access boundary.

```bash
npm run test:share          # X / WhatsApp / LinkedIn URL builders
npm run test:share:access   # local mock: public, private, owner, legacy URLs
npm run typecheck
npm run build
```

## Structure

- `lib/rag/` — real RAG pipeline (chunking, embeddings, retrieval)
- `worker/` — Cloudflare Worker source (ingest)
- `supabase/migrations/` — database schema
- `_reference/` — preserved wire contracts from prior iteration (DO NOT IMPORT)