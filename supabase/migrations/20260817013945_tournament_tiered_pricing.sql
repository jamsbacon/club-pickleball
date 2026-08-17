-- Precio escalonado por cantidad de categorías (v2.17.0): reemplaza el precio único
-- (presale_price / regular_price) por tres niveles cada uno -- 1 categoría, 2 categorías,
-- 3 o más categorías -- para que inscribirse en varias de una salga más barato por
-- categoría que hacerlo una por una. El nivel "3" aplica también a 4+, no hay un cuarto
-- nivel (tope superior a propósito, para no pedir un precio por cada cantidad posible).
alter table public.tournaments
  add column if not exists presale_price_1 numeric,
  add column if not exists presale_price_2 numeric,
  add column if not exists presale_price_3 numeric,
  add column if not exists regular_price_1 numeric,
  add column if not exists regular_price_2 numeric,
  add column if not exists regular_price_3 numeric;

-- Backfill: los torneos que ya tenían un precio único quedan con el mismo comportamiento
-- de antes (precio × cantidad) hasta que el admin cargue precios de bundle de verdad --
-- nadie paga distinto de un día para el otro solo por este cambio de esquema.
update public.tournaments set
  presale_price_1 = presale_price, presale_price_2 = presale_price * 2, presale_price_3 = presale_price * 3
  where presale_price is not null;
update public.tournaments set
  regular_price_1 = regular_price, regular_price_2 = regular_price * 2, regular_price_3 = regular_price * 3
  where regular_price is not null;

alter table public.tournaments drop column if exists presale_price;
alter table public.tournaments drop column if exists regular_price;
