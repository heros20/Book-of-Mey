create table if not exists public.artbook_items (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  position integer not null,
  title text,
  description text not null default '',
  image text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, position)
);

create index if not exists artbook_items_book_id_position_idx on public.artbook_items (book_id, position);

drop trigger if exists set_artbook_items_updated_at on public.artbook_items;
create trigger set_artbook_items_updated_at
before update on public.artbook_items
for each row execute function public.set_updated_at();

alter table public.artbook_items enable row level security;

grant select, insert, update, delete on public.artbook_items to anon, authenticated;

drop policy if exists "Public artbook items read" on public.artbook_items;
create policy "Public artbook items read"
on public.artbook_items for select
to anon, authenticated
using (true);

drop policy if exists "Public artbook items write" on public.artbook_items;
create policy "Public artbook items write"
on public.artbook_items for all
to anon, authenticated
using (true)
with check (true);

notify pgrst, 'reload schema';
