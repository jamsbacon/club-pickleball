-- v2.27.0: la "ventana de reserva" de cada plan (cuántas horas de anticipación puede reservar
-- cancha/actividades un usuario) pasa de ser texto suelto en el rate card a un campo real y
-- exigible -- un número no se puede hacer cumplir si solo vive como "5 días" en un string.
alter table public.membership_plans add column if not exists booking_window_hours integer not null default 48;

update public.membership_plans set booking_window_hours = 48 where name = 'Sin plan';
update public.membership_plans set booking_window_hours = 120 where name = 'Plan PRO';   -- 5 días
update public.membership_plans set booking_window_hours = 168 where name = 'Plan VIP';   -- 7 días

-- La fila "Ventana de reserva" del rate card queda redundante (y podía desincronizarse del
-- valor real) -- se quita de los tres planes; App.jsx ahora la muestra como su propia fila,
-- calculada directo desde booking_window_hours, así nunca hay dos fuentes de verdad.
update public.membership_plans
  set rate_card = (select jsonb_agg(item) from jsonb_array_elements(rate_card) item where item->>'label' <> 'Ventana de reserva')
  where rate_card @> '[{"label":"Ventana de reserva"}]';
