-- v2.94.0, a pedido del club: método de ranking "posicion" (Tour de torneos) -- los puntos salen
-- del PUESTO FINAL de cada equipo en cada torneo (campeón, subcampeón, semifinalista...) en vez
-- de partido por partido. Sigue sin guardarse ningún punto: se calcula de los resultados.
--   rankings.position_points: puntos por puesto, {champion, runnerUp, semifinal, quarterfinal,
--     round16, round32, participation}.
--   rankings.best_n: de cada jugador solo cuentan sus N mejores torneos (null = todos).
--   rankings.category_level: el ranking solo cuenta categorías de ESE nivel (null = todas) --
--     sirve para los dos métodos.
--   tournaments.ranking_multiplier: peso del torneo dentro de su ranking (×1 normal, ×2 doble).
-- No toca ninguna fila existente (los rankings y torneos que ya hay quedan con los defaults).
alter table public.rankings add column if not exists position_points jsonb not null default '{}'::jsonb;
alter table public.rankings add column if not exists best_n integer;
alter table public.rankings add column if not exists category_level text;
alter table public.tournaments add column if not exists ranking_multiplier numeric(6,2) not null default 1;
