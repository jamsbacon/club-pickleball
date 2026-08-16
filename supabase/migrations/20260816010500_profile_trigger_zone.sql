-- Fix: handle_new_user() no guardaba `zone` desde raw_user_meta_data -- se perdía la
-- zona que el jugador ingresa/detecta al registrarse (usada en EstadisticasTab → groupByZone).
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role, zone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'cliente'),
    coalesce(new.raw_user_meta_data->>'zone', '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;
