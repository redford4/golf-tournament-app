-- ============================================================================
-- Golf Tournament Scoring App — Supabase Storage setup (images)
-- ----------------------------------------------------------------------------
-- Run this once in the Supabase SQL Editor (same place you ran the schema).
-- It creates a public "images" bucket AND the policies that let the app upload
-- (a public bucket alone only allows downloads, not uploads).
-- Suitable for a friendly tournament; mirrors the open policies on the data
-- tables. See SETUP-CLOUD.md for how to tighten later.
-- ============================================================================

-- 1) Create the public bucket (idempotent).
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do update set public = true;

-- 2) Allow read + write on objects in the 'images' bucket via the app's key.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='images_read') then
    create policy images_read on storage.objects for select using (bucket_id = 'images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='images_insert') then
    create policy images_insert on storage.objects for insert with check (bucket_id = 'images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='images_update') then
    create policy images_update on storage.objects for update using (bucket_id = 'images') with check (bucket_id = 'images');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='images_delete') then
    create policy images_delete on storage.objects for delete using (bucket_id = 'images');
  end if;
end $$;

-- Done. The app can now upload tournament photos, course maps and hole photos.
