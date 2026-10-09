-- v2.93.0, a pedido del club: Rankings -- una clasificación acumulada ENTRE torneos (ej. la Liga
-- de Desarrollo Open: una jornada = un torneo, y los puntos de cada jugador se suman jornada tras
-- jornada sin importar con quién jugó). Cada torneo elige en Generalidades a qué ranking suma
-- (`tournaments.ranking_id`).
--
-- NO se guardan puntos: la tabla se calcula leyendo los partidos ya jugados de los torneos
-- vinculados (ver computeRankingTable en App.jsx), así corregir un marcador o vincular un torneo
-- ya jugado actualiza el ranking solo, sin números que se puedan desfasar.
--
-- `method`: 'partidos' = puntos por partido jugado (asistencia, `points_played`) + extra por
-- victoria (`points_win`) -- el de la Liga: asistir suma 1 y ganar suma 2 más (ganar = 3 en
-- total, perder = 1). 'posicion' (puntos según el puesto final del torneo, para un Tour) todavía
-- no está implementado en la app; el valor ya se acepta para no tener que migrar después.
-- `group_phase_only`: solo cuentan los partidos de fase de grupos/liga (los cuartos de final no
-- suman, son justo lo que este ranking define). `qualify_count`: cuántos clasifican (se resaltan
-- en la tabla), null = sin línea de corte.
create table public.rankings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  method text not null default 'partidos' check (method in ('partidos', 'posicion')),
  points_played integer not null default 1,
  points_win integer not null default 2,
  group_phase_only boolean not null default true,
  qualify_count integer,
  created_at timestamptz not null default now()
);
alter table public.rankings enable row level security;

-- Lectura pública: los jugadores ven la clasificación en su vista (mismo criterio que
-- tournaments/coupons). Solo el admin crea/edita/borra rankings.
create policy "public read rankings" on public.rankings for select using (true);
create policy "admin write rankings" on public.rankings for all
  using (public.is_admin()) with check (public.is_admin());

-- Borrar un ranking NO borra ni toca ningún torneo -- solo los desvincula.
alter table public.tournaments add column if not exists ranking_id uuid references public.rankings(id) on delete set null;
