-- ============================================================================
-- Onboarding de registro: nivel DUPR y teléfono/WhatsApp por jugador.
-- Se piden en AuthScreen (modo "register") y llegan en options.data del
-- signUp, igual que name/role/zone -- handle_new_user() los toma de ahí.
-- dupr_rating queda nullable (el jugador puede no saber su nivel todavía).
-- phone se usa para contactar por reservas/pagos pendientes de verificación
-- (WhatsApp es el canal habitual del club, igual que pago_movil.telefono).
-- ============================================================================
alter table public.profiles add column if not exists dupr_rating numeric;
alter table public.profiles add column if not exists phone text not null default '';

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role, zone, dupr_rating, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'cliente'),
    coalesce(new.raw_user_meta_data->>'zone', ''),
    nullif(new.raw_user_meta_data->>'dupr_rating', '')::numeric,
    coalesce(new.raw_user_meta_data->>'phone', '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
