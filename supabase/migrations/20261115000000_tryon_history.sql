-- StyleMirror AI: user-scoped try-on history + private result storage.
-- Apply with `supabase db push` or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.tryon_history (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  job_id              uuid not null unique,
  category            text not null check (category in ('upper_body', 'lower_body', 'dresses')),
  provider            text not null,
  result_path         text not null,
  garment_description text check (char_length(garment_description) <= 200),
  created_at          timestamptz not null default now(),
  expires_at          timestamptz,
  -- result objects must live in the owner's folder: <user_id>/<job_id>.<ext>
  constraint result_path_in_user_folder check (split_part(result_path, '/', 1) = user_id::text)
);

create index if not exists tryon_history_user_created_idx
  on public.tryon_history (user_id, created_at desc);
create index if not exists tryon_history_expires_idx
  on public.tryon_history (expires_at) where expires_at is not null;

alter table public.tryon_history enable row level security;

-- Users may read and delete only their own rows. There is intentionally no
-- INSERT/UPDATE policy: rows are written by the backend with the service role
-- after a real provider result exists, so clients cannot forge history.
drop policy if exists "history_select_own" on public.tryon_history;
create policy "history_select_own" on public.tryon_history
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "history_delete_own" on public.tryon_history;
create policy "history_delete_own" on public.tryon_history
  for delete to authenticated using ((select auth.uid()) = user_id);

revoke insert, update on public.tryon_history from anon, authenticated;

-- Private bucket for generated results (10 MB per object, images only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tryon-results', 'tryon-results', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Owners may read/delete objects in their own folder. Uploads are done by the
-- backend (service role), so there is no insert policy for end users.
drop policy if exists "tryon_results_select_own" on storage.objects;
create policy "tryon_results_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'tryon-results' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "tryon_results_delete_own" on storage.objects;
create policy "tryon_results_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tryon-results' and (storage.foldername(name))[1] = (select auth.uid())::text);
