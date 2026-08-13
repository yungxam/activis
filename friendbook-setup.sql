-- FRIENDBOOK setup — run this once in the Supabase SQL Editor.
-- (Dashboard -> SQL Editor -> New query -> paste everything -> Run)

-- 1) the entries table
create table public.friendbook (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 40),
  color text check (color is null or char_length(color) <= 40),
  learn text check (learn is null or char_length(learn) <= 80),
  note text check (note is null or char_length(note) <= 1600),
  photo_url text check (
    photo_url is null or
    photo_url like 'https://waodcyzcofiwydaylxse.supabase.co/storage/v1/object/public/friendbook-photos/%'
  ),
  approved boolean not null default false
);

-- 2) row security: anyone may read APPROVED entries and add PENDING ones;
--    nobody (except you, via the dashboard) can edit or delete
alter table public.friendbook enable row level security;

create policy "read approved entries"
  on public.friendbook for select
  using (approved = true);

create policy "sign the book (pending)"
  on public.friendbook for insert
  with check (approved = false);

-- 3) photo storage bucket (public read, 500 KB max per file, images only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('friendbook-photos', 'friendbook-photos', true, 512000, array['image/jpeg', 'image/png', 'image/webp']);

create policy "public read friendbook photos"
  on storage.objects for select
  using (bucket_id = 'friendbook-photos');

create policy "upload friendbook photos"
  on storage.objects for insert
  with check (bucket_id = 'friendbook-photos');

-- 4) Sam signs his own book first
insert into public.friendbook (name, color, learn, note, approved)
values ('Sam', 'beer gold', 'do a proper kickflip', 'my room, my rules. sign here and maybe I''ll like you.', true);
