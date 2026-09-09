-- v2.38.0: cada ítem del tarifario ("Precio Liga Propia", "Precio Sesión Drills"...) era un
-- valor tipeado a mano por plan, sin ninguna conexión entre ellos -- si el club subía el
-- precio base en "Sin plan", los planes pagos se quedaban con el número viejo hasta que
-- alguien los editara uno por uno (el mismo problema que courtDiscountPct/openPlayDiscountPct
-- ya resolvieron para canchas/Open Play en v2.30.0). Ahora "Sin plan" guarda el precio real
-- (priceUsd) de cada concepto, y cualquier plan pago guarda un % de descuento (discountPct)
-- sobre ese mismo concepto -- el precio con membresía se calcula solo en la app (ver
-- rateItemDisplay), y sigue correcto aunque el precio base cambie después.
--
-- Migra los datos reales de hoy preservando el precio efectivo actual: Sin plan cobra $8.00/
-- $6.00 por Liga Propia/Drills; Plan PRO cobraba $5.00/$3.00 (37.5%→38% / 50% de descuento);
-- Plan VIP cobraba $5.00/$0.00 (38% / 100%, gratis).
update public.membership_plans
set rate_card = '[{"id":"rate-liga","label":"Precio Liga Propia","priceUsd":8},{"id":"rate-drills","label":"Precio Sesión Drills","priceUsd":6}]'::jsonb
where name = 'Sin plan';

update public.membership_plans
set rate_card = '[{"id":"rate-liga","label":"Precio Liga Propia","discountPct":38},{"id":"rate-drills","label":"Precio Sesión Drills","discountPct":50}]'::jsonb
where name = 'Plan PRO';

update public.membership_plans
set rate_card = '[{"id":"rate-liga","label":"Precio Liga Propia","discountPct":38},{"id":"rate-drills","label":"Precio Sesión Drills","discountPct":100}]'::jsonb
where name = 'Plan VIP';
