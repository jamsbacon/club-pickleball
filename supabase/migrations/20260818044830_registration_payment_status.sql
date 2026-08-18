-- Estado de pago para inscripciones a Open Plays y Clases (v2.21.0): "por pagar" (efectivo,
-- se paga en el club), "pago por verificar" (Pago Móvil, con referencia/comprobante pero sin
-- confirmar contra el banco) o "pago verificado" (el admin confirmó que el dinero llegó).
-- Mismo vocabulario/valores que ya usa `bookings.status` (pendiente_efectivo/
-- pendiente_verificacion/confirmada) -- se reutilizan los mismos tres valores para que todo
-- el club hable el mismo idioma de estados de pago.
alter table public.open_play_registrations add column if not exists payment_status text not null default 'pendiente_efectivo'
  check (payment_status in ('pendiente_efectivo', 'pendiente_verificacion', 'confirmada'));
alter table public.class_registrations add column if not exists payment_status text not null default 'pendiente_efectivo'
  check (payment_status in ('pendiente_efectivo', 'pendiente_verificacion', 'confirmada'));

-- Backfill: las inscripciones que ya existían antes de este campo se tratan como ya
-- resueltas ("pago verificado") en vez de aparecer de golpe como pendientes -- la app ya las
-- contaba como inscripciones válidas hasta hoy, así que no hay que sembrar dudas retroactivas
-- sobre pagos históricos. Los estados pendiente_* solo aplican a inscripciones nuevas de acá
-- en adelante (calculados en el momento del checkout, ver registerForOpenPlay/registerForClass
-- en App.jsx).
update public.open_play_registrations set payment_status = 'confirmada' where payment_status = 'pendiente_efectivo';
update public.class_registrations set payment_status = 'confirmada' where payment_status = 'pendiente_efectivo';
