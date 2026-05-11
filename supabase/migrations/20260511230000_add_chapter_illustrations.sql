alter table public.chapters
add column if not exists illustration text not null default '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'covers',
  'covers',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public covers read" on storage.objects;
create policy "Public covers read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'covers');

drop policy if exists "Public covers insert" on storage.objects;
create policy "Public covers insert"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'covers');

drop policy if exists "Public covers update" on storage.objects;
create policy "Public covers update"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'covers')
with check (bucket_id = 'covers');

drop policy if exists "Public covers delete" on storage.objects;
create policy "Public covers delete"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'covers');

notify pgrst, 'reload schema';
