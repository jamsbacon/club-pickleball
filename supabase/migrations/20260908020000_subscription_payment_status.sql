-- v2.37.0: una suscripción a un plan pago activaba el plan DE INMEDIATO sin importar el
-- método de pago -- a diferencia de reservas/inscripciones a Open Play/Clase/Torneo, que sí
-- quedan "por verificar" hasta que el admin confirma el pago (ver
-- 20260818044830_registration_payment_status.sql). Mismo vocabulario/valores, para que todo
-- el club hable el mismo idioma de estados de pago.
alter table public.subscriptions add column if not exists payment_status text not null default 'pendiente_efectivo'
  check (payment_status in ('pendiente_efectivo', 'pendiente_verificacion', 'confirmada'));
