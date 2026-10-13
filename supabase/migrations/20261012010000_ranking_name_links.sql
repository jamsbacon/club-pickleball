-- v2.95.0, a pedido del club: unir a mano jugadores SIN cuenta que quedaron escritos distinto en
-- dos torneos ("Pedro Gomez" / "Pedro Gómez R.") para que sumen en una sola fila del ranking.
--   rankings.name_links: { "<nombre normalizado>": { "userId": "<uuid>" } | { "name": "<nombre destino>" } }
-- Solo cambia cómo se CALCULA la tabla del ranking (ver resolveLinkedPlayer en App.jsx): no toca
-- inscripciones, equipos ni resultados, y deshacer una unión es borrar su entrada.
-- No modifica ninguna fila existente (queda en '{}').
alter table public.rankings add column if not exists name_links jsonb not null default '{}'::jsonb;
