-- Borrador/publicado para torneos (v2.16.0): un torneo recién creado (solo con nombre) no
-- debe aparecer en Actividades ni en la lista de Torneos para clientes hasta que el admin lo
-- publique explícitamente. 'draft' es el default -- todo torneo nuevo nace oculto para
-- clientes; el admin sigue viéndolo siempre (con badge "Borrador") para poder completarlo y
-- publicarlo cuando esté listo.
alter table public.tournaments
  add column if not exists status text not null default 'draft' check (status in ('draft', 'published'));

-- Los torneos que ya existían antes de este concepto (creados con fechas ya cargadas, por
-- ejemplo el sembrado inicial del club) se consideran publicados de entrada -- no tiene
-- sentido esconder algo que ya estaba visible para todos. Uno sin fechas cargadas (como el
-- caso real que motivó este cambio, un torneo creado solo con nombre) se queda en 'draft'.
update public.tournaments set status = 'published' where start_date is not null and end_date is not null;
