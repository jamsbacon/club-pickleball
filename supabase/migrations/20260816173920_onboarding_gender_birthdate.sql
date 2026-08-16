-- ============================================================================
-- Onboarding moderno post-registro: el registro (AuthScreen) pasa a pedir solo
-- correo + contraseña; el resto (nombre, género, fecha de nacimiento, DUPR,
-- domicilio) se completa en un wizard de un paso a la vez justo después de
-- crear la cuenta. `onboarding_completed` es el flag que decide si ese wizard
-- se le muestra al usuario -- default TRUE aquí para no atrapar a las cuentas
-- que ya existen (se registraron con el formulario viejo, ya tienen sus datos);
-- el trigger de abajo lo pone en FALSE explícito para cada cuenta nueva.
--
-- `gender` alimenta el filtro de categorías de torneo por género en
-- InscripcionTab (una categoría 'mixto' es visible para cualquiera).
-- `birth_date` se pide en el onboarding pero por ahora no se usa en ninguna
-- regla de negocio (no hay categorías juveniles/senior todavía).
-- ============================================================================
alter table public.profiles add column if not exists gender text check (gender is null or gender in ('masculino', 'femenino'));
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists onboarding_completed boolean not null default true;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role, zone, dupr_rating, phone, onboarding_completed)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'cliente'),
    coalesce(new.raw_user_meta_data->>'zone', ''),
    nullif(new.raw_user_meta_data->>'dupr_rating', '')::numeric,
    coalesce(new.raw_user_meta_data->>'phone', ''),
    false
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
