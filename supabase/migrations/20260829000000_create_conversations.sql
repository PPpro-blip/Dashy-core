-- =====================================================================
-- DashyCore v7 — Cloud conversations & messages (Supabase, RLS-scoped)
--
-- Upgrades chat history from localStorage-only to per-user cloud rows.
-- The browser client generates UUIDs (crypto.randomUUID) which match the
-- uuid primary keys, so local-first flows upsert seamlessly.
--
-- Tables:
--   conversations  one row per chat, owned by an auth.users id
--   messages       ordered turns (user / assistant / system), cascaded
--
-- RLS: every policy requires ownership via conversations.user_id =
--      auth.uid(); cascading deletes bypass RLS by design in Postgres.
-- =====================================================================

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  model text null,
  created_at timestamptz not null default now()
);

-- Sidebar list query: own conversations, newest first.
create index if not exists conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

-- Thread load query: messages of one conversation in send order.
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- conversations: owner-only CRUD
create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);

-- messages: owner-only CRUD, resolved through the parent conversation
create policy "messages_select_own"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "messages_insert_own"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "messages_update_own"
  on public.messages for update
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

create policy "messages_delete_own"
  on public.messages for delete
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = auth.uid()
    )
  );
