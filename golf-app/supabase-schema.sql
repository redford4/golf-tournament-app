-- ============================================================================
-- Golf Tournament Scoring App — Supabase database schema
-- ----------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL Editor and click "Run".
-- It creates the four tables the app uses, turns on row-level security with
-- open policies (suitable for a friendly tournament — see the security note in
-- SETUP-CLOUD.md), and enables realtime so leaderboards update live.
--
-- Each row stores one app object as JSON in a `data` column, which mirrors the
-- structure the app already uses on-device. Scores are one row per
-- player-per-round, so two golfers entering scores at the same time never
-- overwrite each other.
-- ============================================================================

-- 1) The tournament (a single row, id = 'main') ------------------------------
create table if not exists public.tournaments (
  id         text primary key default 'main',
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) Rounds ------------------------------------------------------------------
create table if not exists public.rounds (
  id         text primary key,
  idx        int  not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 3) Players -----------------------------------------------------------------
create table if not exists public.players (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 4) Scores (one row per round + player) -------------------------------------
create table if not exists public.scores (
  id         text primary key,            -- "<roundId>:<playerId>"
  round_id   text not null,
  player_id  text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row-level security. The app talks to Supabase with the public "anon" key,
-- so we enable RLS and add permissive policies. This is fine for a low-stakes
-- golf tournament; see SETUP-CLOUD.md for how to lock it down further later.
-- ---------------------------------------------------------------------------
alter table public.tournaments enable row level security;
alter table public.rounds      enable row level security;
alter table public.players     enable row level security;
alter table public.scores      enable row level security;

do $$
begin
  -- tournaments
  if not exists (select 1 from pg_policies where tablename = 'tournaments' and policyname = 'anon_all') then
    create policy anon_all on public.tournaments for all using (true) with check (true);
  end if;
  -- rounds
  if not exists (select 1 from pg_policies where tablename = 'rounds' and policyname = 'anon_all') then
    create policy anon_all on public.rounds for all using (true) with check (true);
  end if;
  -- players
  if not exists (select 1 from pg_policies where tablename = 'players' and policyname = 'anon_all') then
    create policy anon_all on public.players for all using (true) with check (true);
  end if;
  -- scores
  if not exists (select 1 from pg_policies where tablename = 'scores' and policyname = 'anon_all') then
    create policy anon_all on public.scores for all using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime: let the app subscribe to changes so leaderboards refresh live.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tournaments') then
    alter publication supabase_realtime add table public.tournaments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'rounds') then
    alter publication supabase_realtime add table public.rounds;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'scores') then
    alter publication supabase_realtime add table public.scores;
  end if;
end $$;

-- Done. Your database is ready — now paste your project URL + anon key into
-- golf-app/js/config.js (see SETUP-CLOUD.md).
