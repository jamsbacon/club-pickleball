-- v2.30.0: mueve el descuento de miembro de "un monto fijo por ítem" (courts.member_price,
-- open_plays.member_price -- cada cancha/Open Play cargado a mano, sin ninguna conexión con
-- lo que promete el plan) a un PORCENTAJE que vive en el propio plan y se aplica en el momento
-- del cobro. Así, cambiar el plan se refleja en toda la app al instante -- exactamente el
-- problema que causó el descuento de 29% de la migración anterior (nadie mantenía
-- sincronizados los memberPrice de cada ítem con lo que el plan de verdad promete).
--
-- Alcance: solo canchas (Reservas) y Open Plays, las dos categorías que SÍ tienen un
-- porcentaje real y sin ambigüedad en la tabla de beneficios del club ("Precio de reserva de
-- cancha", "Precio Open Play"). Clases se queda con su member_price de siempre -- el club
-- nunca definió un descuento de plan para Clases, así que no hay nada real que migrar ahí.
-- "Precio Liga Propia" y "Precio Sesión Drills" tampoco tienen una función reservable propia
-- todavía -- se quedan como texto libre en el rate card, sin cambios.
alter table public.membership_plans
  add column if not exists court_discount_pct integer not null default 0,
  add column if not exists open_play_discount_pct integer not null default 0,
  add column if not exists free_blocks_per_month integer not null default 0;

-- Valores reales del club: Sin plan no tiene descuento ni bloques gratis. Plan PRO/VIP dan
-- 67% off canchas ($15 base -> $5, el precio que el club ya venía publicando) y 100% off Open
-- Play (gratis). Bloques gratis por mes: PRO=2, VIP=6 (ajuste pedido en esta misma conversación
-- -- antes el rate card decía 4/12, nunca se había hecho cumplir).
update public.membership_plans set court_discount_pct = 0, open_play_discount_pct = 0, free_blocks_per_month = 0
  where name = 'Sin plan';
update public.membership_plans set court_discount_pct = 67, open_play_discount_pct = 100, free_blocks_per_month = 2
  where name = 'Plan PRO';
update public.membership_plans set court_discount_pct = 67, open_play_discount_pct = 100, free_blocks_per_month = 6
  where name = 'Plan VIP';

-- Esas tres filas del rate card quedan reemplazadas por columnas reales -- se quitan para que
-- no puedan volver a desincronizarse (mismo criterio que "Ventana de reserva" en la migración
-- de v2.27.0). "Precio Liga Propia" y "Precio Sesión Drills" se conservan tal cual.
update public.membership_plans
  set rate_card = (
    select coalesce(jsonb_agg(item), '[]'::jsonb) from jsonb_array_elements(rate_card) item
    where item->>'label' not in ('Bloque de reserva gratis*', 'Precio de reserva de cancha*', 'Precio Open Play')
  );

-- Cada reserva de cancha registra si consumió uno de los bloques gratis del mes -- así
-- cancelarla libera el cupo automáticamente (se cuenta en caliente por mes calendario, no hay
-- contador que resetear a mano).
alter table public.bookings add column if not exists free_block boolean not null default false;
