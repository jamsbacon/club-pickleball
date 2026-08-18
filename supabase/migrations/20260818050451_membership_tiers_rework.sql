-- v2.22.0: reemplaza el único plan pago "Membresía" ($50) por dos niveles (Plan PRO / Plan
-- VIP) con cupo máximo de miembros activos cada uno, y reescribe el rate_card de los tres
-- planes con los beneficios reales del club (antes eran precios de ejemplo).
--
-- rate_card cambia de forma: cada item pasa de {label, price:number} a {label, value:string}
-- -- un precio en USD ya no alcanza para representar "4/mes", "100% (Gratis)" o "5 días", así
-- que el valor ahora es texto libre ya formateado tal cual se muestra. App.jsx lee `value` con
-- fallback a `price` por si queda algún dato viejo sin migrar.
alter table public.membership_plans add column if not exists max_members integer;

-- "Sin membresía" -> "Sin plan" (mismo id, mismo $0 -- nadie pierde su plan actual).
update public.membership_plans set
  name = 'Sin plan',
  description = 'Pago por uso (Pay per play), sin mensualidad.',
  rate_card = '[
    {"label":"Bloque de reserva gratis*","value":"Ninguno"},
    {"label":"Precio de reserva de cancha*","value":"$15.00"},
    {"label":"Precio Open Play","value":"$6.00"},
    {"label":"Precio Liga Propia","value":"$8.00"},
    {"label":"Precio Sesión Drills","value":"$6.00"},
    {"label":"Ventana de reserva","value":"48 horas"}
  ]'::jsonb
where name = 'Sin membresía';

-- "Membresía" ($50) -> "Plan PRO" (mismo id y mismo precio -- los suscritos actuales quedan
-- automáticamente en PRO sin que les cambie el cobro).
update public.membership_plans set
  name = 'Plan PRO',
  private_court_access = true,
  max_members = 50,
  description = 'Precios preferenciales, bloques de reserva gratis al mes y Open Plays sin costo. Cupo limitado a 50 miembros.',
  rate_card = '[
    {"label":"Bloque de reserva gratis*","value":"4/mes"},
    {"label":"Precio de reserva de cancha*","value":"$5.00"},
    {"label":"Precio Open Play","value":"100% (Gratis)"},
    {"label":"Precio Liga Propia","value":"$5.00"},
    {"label":"Precio Sesión Drills","value":"$3.00"},
    {"label":"Ventana de reserva","value":"5 días"}
  ]'::jsonb
where name = 'Membresía';

-- Plan VIP es nuevo -- solo se inserta si todavía no existe (idempotente si la migración
-- corre más de una vez).
insert into public.membership_plans (name, monthly_price, private_court_access, max_members, description, rate_card)
select 'Plan VIP', 100, true, 20,
  'El plan con más beneficios del club: más bloques de reserva gratis, ventana de reserva más amplia y los precios más bajos. Cupo limitado a 20 miembros.',
  '[
    {"label":"Bloque de reserva gratis*","value":"12/mes"},
    {"label":"Precio de reserva de cancha*","value":"$5.00"},
    {"label":"Precio Open Play","value":"100% (Gratis)"},
    {"label":"Precio Liga Propia","value":"$5.00"},
    {"label":"Precio Sesión Drills","value":"$0.00"},
    {"label":"Ventana de reserva","value":"7 días"}
  ]'::jsonb
where not exists (select 1 from public.membership_plans where name = 'Plan VIP');
