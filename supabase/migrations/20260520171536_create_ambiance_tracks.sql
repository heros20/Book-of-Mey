create table if not exists public.ambiance_tracks (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  src text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ambiance_tracks_position_idx on public.ambiance_tracks (position, created_at);

drop trigger if exists set_ambiance_tracks_updated_at on public.ambiance_tracks;
create trigger set_ambiance_tracks_updated_at
before update on public.ambiance_tracks
for each row execute function public.set_updated_at();

alter table public.ambiance_tracks enable row level security;

grant select, insert, update, delete on public.ambiance_tracks to anon, authenticated;

drop policy if exists "Public ambiance tracks read" on public.ambiance_tracks;
create policy "Public ambiance tracks read"
on public.ambiance_tracks for select
to anon, authenticated
using (true);

drop policy if exists "Public ambiance tracks write" on public.ambiance_tracks;
create policy "Public ambiance tracks write"
on public.ambiance_tracks for all
to anon, authenticated
using (true)
with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ambiance-sounds',
  'ambiance-sounds',
  true,
  20971520,
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/flac']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public ambiance sounds read" on storage.objects;
create policy "Public ambiance sounds read"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'ambiance-sounds');

drop policy if exists "Public ambiance sounds insert" on storage.objects;
create policy "Public ambiance sounds insert"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'ambiance-sounds');

drop policy if exists "Public ambiance sounds update" on storage.objects;
create policy "Public ambiance sounds update"
on storage.objects for update
to anon, authenticated
using (bucket_id = 'ambiance-sounds')
with check (bucket_id = 'ambiance-sounds');

drop policy if exists "Public ambiance sounds delete" on storage.objects;
create policy "Public ambiance sounds delete"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'ambiance-sounds');

notify pgrst, 'reload schema';
