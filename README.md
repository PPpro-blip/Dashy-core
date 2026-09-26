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
migrations in `supabase/migrations/` (including the public-share SELECT policy).
Email sign-in accepts a one-time code or the email link; include `{{ .Token }}`
in the Supabase email template to display the code, and allow `/auth/callback`
in your Supabase redirect URLs.

## Sharing

Open **Share** in an owned D-Code project for a modal Share Hub. Publishing
assigns a stable `/s/<slug>` link; copying happens inside the Hub. The short
link redirects to the canonical `/d-code/share/<slug>` viewer. Public links
work without signing in. For a private project, only the owner can preview
its link; other visitors receive HTTP 403 (not a login redirect). Revoking or
regenerating a link remains available from the Hub. RLS is the primary access
boundary. If a deployment lacks the public SELECT policy, the optional
server-side service-role recovery lane reads **only** `is_public = true` rows;
never expose its key to the browser.

```bash
npm run test:share          # X / WhatsApp / LinkedIn URL builders
npm run test:share:access   # local mock: public, private, owner, short URLs
npm run typecheck
npm run build
```

## Structure

- `lib/rag/` — real RAG pipeline (chunking, embeddings, retrieval)
- `worker/` — Cloudflare Worker source (ingest)
- `supabase/migrations/` — database schema
- `_reference/` — preserved wire contracts from prior iteration (DO NOT IMPORT)