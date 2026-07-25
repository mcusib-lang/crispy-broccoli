-- ══════════════════════════════════════════════════════════
--  AMRAP · Esquema social (amigos, ligas y retos)
--  Ejecuta este bloque en Supabase → SQL Editor → New query → Run.
--  Es seguro re-ejecutarlo (usa IF NOT EXISTS / OR REPLACE).
-- ══════════════════════════════════════════════════════════

-- 1) Ficha pública del jugador (lo que otros pueden ver de ti).
--    Solo datos no sensibles: nombre, código, rachas y nº de sesiones por semana.
create table if not exists public.jugadores (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  code        text unique not null,
  name        text not null default 'Atleta',
  weeks       jsonb not null default '{}'::jsonb,   -- { "2026-W30": 3, ... }
  total       int  not null default 0,
  streak      int  not null default 0,
  rpe         numeric not null default 0,
  plan        text default '',
  updated_at  timestamptz not null default now()
);

alter table public.jugadores enable row level security;

drop policy if exists "jugadores lectura" on public.jugadores;
create policy "jugadores lectura" on public.jugadores
  for select to authenticated using (true);
drop policy if exists "jugadores inserta propio" on public.jugadores;
create policy "jugadores inserta propio" on public.jugadores
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "jugadores actualiza propio" on public.jugadores;
create policy "jugadores actualiza propio" on public.jugadores
  for update to authenticated using (auth.uid() = user_id);

-- 2) Ligas / retos.
create table if not exists public.ligas (
  id        uuid primary key default gen_random_uuid(),
  code      text unique not null,                  -- código para unirse
  nombre    text not null,
  modo      text not null default 'liga',          -- coop | competi | liga
  formato   text not null default 'single',        -- single | double (ida y vuelta)
  inicio    date not null,
  fin       date not null,
  meta      int  default 40,                        -- objetivo (modo coop)
  plan      text default '',
  owner     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ligas enable row level security;

drop policy if exists "ligas lectura" on public.ligas;
create policy "ligas lectura" on public.ligas
  for select to authenticated using (true);
drop policy if exists "ligas crea propia" on public.ligas;
create policy "ligas crea propia" on public.ligas
  for insert to authenticated with check (auth.uid() = owner);
drop policy if exists "ligas edita owner" on public.ligas;
create policy "ligas edita owner" on public.ligas
  for update to authenticated using (auth.uid() = owner);
drop policy if exists "ligas borra owner" on public.ligas;
create policy "ligas borra owner" on public.ligas
  for delete to authenticated using (auth.uid() = owner);

-- 3) Miembros de cada liga.
create table if not exists public.liga_miembros (
  liga_id   uuid references public.ligas(id) on delete cascade,
  user_id   uuid references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (liga_id, user_id)
);

alter table public.liga_miembros enable row level security;

drop policy if exists "miembros lectura" on public.liga_miembros;
create policy "miembros lectura" on public.liga_miembros
  for select to authenticated using (true);
drop policy if exists "miembros se une" on public.liga_miembros;
create policy "miembros se une" on public.liga_miembros
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "miembros se sale" on public.liga_miembros;
create policy "miembros se sale" on public.liga_miembros
  for delete to authenticated using (auth.uid() = user_id);

-- 4) Ánimos (los 🔥 que se mandan entre usuarios).
create table if not exists public.animos (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'fire',
  created_at timestamptz not null default now()
);

alter table public.animos enable row level security;

drop policy if exists "animos lectura propia" on public.animos;
create policy "animos lectura propia" on public.animos
  for select to authenticated using (auth.uid() = to_user or auth.uid() = from_user);
drop policy if exists "animos envia propio" on public.animos;
create policy "animos envia propio" on public.animos
  for insert to authenticated with check (auth.uid() = from_user);
