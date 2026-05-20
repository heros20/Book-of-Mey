alter table public.chapters
add column if not exists ambiance_track_id text not null default '';

notify pgrst, 'reload schema';
