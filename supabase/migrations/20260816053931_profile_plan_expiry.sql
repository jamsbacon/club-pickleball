-- ============================================================================
-- Tab "Perfil" (self-service): fecha de vencimiento de membresía + endurecer
-- la política "own profile update" ahora que cualquier cliente autenticado
-- puede escribir su propia fila de profiles desde la UI (antes solo lo hacía
-- subscribeToPlan, escribiendo plan_id; ahora también name/zone/phone/dupr).
-- ============================================================================

-- Todos los planes pagos son mensuales (monthly_price) -- subscribeToPlan() calcula
-- hoy + 1 mes al suscribir/renovar. NULL = sin membresía paga o plan gratuito.
alter table public.profiles add column if not exists plan_expires_at date;

-- La política "own profile update" (using id = auth.uid() or is_admin()) es a nivel de
-- fila, no de columna -- deja que cualquier cliente autenticado cambie SU PROPIO `role` a
-- 'admin' llamando a supabase.from('profiles').update() directo, sin pasar por la UI.
-- No se puede resolver restringiendo la política en sí (subscribeToPlan sigue necesitando
-- que un cliente escriba su propio plan_id), así que se bloquea con un trigger: si quien
-- edita no es admin y el `role` cambia, se revierte al valor anterior en vez de fallar el
-- update completo (para no romper el guardado del resto de campos en el mismo request).
create or replace function public.prevent_role_self_escalation()
returns trigger as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists profiles_prevent_role_self_escalation on public.profiles;
create trigger profiles_prevent_role_self_escalation
  before update on public.profiles
  for each row execute procedure public.prevent_role_self_escalation();
