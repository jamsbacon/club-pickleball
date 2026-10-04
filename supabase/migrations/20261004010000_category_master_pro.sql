-- v2.92.0, a pedido del club: categoría "Master-Pro" (cada dupla = 1 Master + 1 Pro). Los roles
-- por jugador viven dentro del JSONB de `categories.teams` (sin columna). Lo único nuevo en la
-- tabla es el DUPR mínimo para anotarse como Pro (null = sin requisito). El nivel "Master-Pro"
-- es texto libre en `categories.level`, no hay CHECK que ampliar. No toca ninguna fila existente.
alter table public.categories add column if not exists pro_min_dupr numeric(4,2);
