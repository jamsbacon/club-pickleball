-- v2.84.0 -- a pedido del club: cada categoría (y, dentro de ella, cada fase/ronda -- grupos,
-- 8vos, 4tos, semis, final) puede fijar su propio formato de puntuación: cuántos sets (ya
-- existía como `best_of`), a cuántos puntos (11 o 15) y con qué tipo de conteo (estándar o
-- rally). Es puramente informativo -- no toca `buildSchedule` ni la duración de los partidos en
-- el calendario (eso queda para después del torneo, ver conversación).
--
-- `points_target`/`scoring_type` son el DEFAULT de la categoría; `round_formats` (JSONB, vacío
-- por default) guarda overrides puntuales por fase -- la llave coincide con `roundKeyOf()` en
-- App.jsx ("group", "bracket:0", "bracket:1", ...), y una fase sin entrada ahí simplemente usa
-- el default de la categoría.
alter table public.categories add column if not exists points_target integer not null default 11;
alter table public.categories add column if not exists scoring_type text not null default 'estandar';
alter table public.categories add constraint categories_scoring_type_check check (scoring_type in ('estandar', 'rally'));
alter table public.categories add column if not exists round_formats jsonb not null default '{}'::jsonb;
