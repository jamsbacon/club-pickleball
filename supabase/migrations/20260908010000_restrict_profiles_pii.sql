-- v2.35.0: "profiles" era de lectura pública total (`for select using (true)`) -- cualquiera
-- con la anon key podía leer teléfono, zona, fecha de nacimiento, DUPR y plan de CUALQUIER
-- socio, no solo lo que de verdad hace falta cruzar entre usuarios (PartnerPicker busca pareja
-- de dobles por nombre/correo; los listados de equipos muestran nombres). Se restringe la fila
-- completa a "la propia, o cualquiera si sos admin", y se crea una vista pública aparte con
-- SOLO esas columnas seguras para que PartnerPicker/etc. sigan funcionando sin exponer nada
-- privado.
drop policy if exists "public read profiles" on public.profiles;
create policy "own or admin read profiles" on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- La vista es dueña del rol que corre esta migración (normalmente el rol admin de Supabase,
-- que sí puede saltarse RLS) -- por eso sigue siendo pública aunque `profiles` ya no lo sea.
-- El filtro real de privacidad está en qué columnas selecciona la vista, no en una política.
create or replace view public.profiles_directory
  with (security_invoker = false) as
  select id, name, email, role from public.profiles;

grant select on public.profiles_directory to anon, authenticated;
