create extension if not exists "pgcrypto";

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  summary text,
  cover text,
  font_size integer not null default 18 check (font_size between 12 and 32),
  density text not null default 'classic' check (density in ('comfortable', 'classic', 'dense')),
  bookmark_page integer not null default 0 check (bookmark_page >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  position integer not null,
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, position)
);

create index if not exists chapters_book_id_position_idx on public.chapters (book_id, position);
create index if not exists books_updated_at_idx on public.books (updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_books_updated_at on public.books;
create trigger set_books_updated_at
before update on public.books
for each row execute function public.set_updated_at();

drop trigger if exists set_chapters_updated_at on public.chapters;
create trigger set_chapters_updated_at
before update on public.chapters
for each row execute function public.set_updated_at();

alter table public.books enable row level security;
alter table public.chapters enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.books to anon, authenticated;
grant select, insert, update, delete on public.chapters to anon, authenticated;

drop policy if exists "Public books read" on public.books;
create policy "Public books read"
on public.books for select
to anon, authenticated
using (true);

drop policy if exists "Public chapters read" on public.chapters;
create policy "Public chapters read"
on public.chapters for select
to anon, authenticated
using (true);

drop policy if exists "Public books write" on public.books;
create policy "Public books write"
on public.books for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Public chapters write" on public.chapters;
create policy "Public chapters write"
on public.chapters for all
to anon, authenticated
using (true)
with check (true);
