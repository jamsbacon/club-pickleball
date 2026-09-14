-- v2.62.0: hasta ahora `max_teams` se fijaba UNA sola vez al crear la categoría (NewCategoryForm)
-- y no había forma de editarlo después ni de poner un cupo MÍNIMO -- el club lo pidió para poder
-- ajustar ambos números sobre la marcha, ya con el torneo en curso, sin tener que borrar y
-- recrear la categoría (lo que hubiera perdido a todos los ya inscritos). `min_teams` usa la
-- MISMA unidad que `max_teams` (duplas en dobles, jugadores en individual -- ver categoryMaxPlayers
-- en App.jsx) para que ambos se editen juntos con el mismo criterio; es solo informativo por ahora
-- (no bloquea nada), lo lee la UI para mostrar "necesita al menos N para jugarse".
alter table public.categories add column if not exists min_teams integer;
