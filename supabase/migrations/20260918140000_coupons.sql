-- v2.82.0 -- cupones de descuento para membresías, con QR/link de un solo uso. Cada cupón
-- apunta a UN plan puntual (no "cualquiera") y a un % de descuento -- el link resuelve directo
-- a ese plan con el checkout ya descontado, sin que el cliente tenga que elegir nada.
-- `used`/`used_by`/`used_at` son la marca de un solo uso: apenas se canjea, ese código queda
-- inválido para siempre (nadie más lo puede usar, ni la misma persona dos veces).
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plan_id uuid not null references public.membership_plans(id) on delete cascade,
  discount_pct integer not null check (discount_pct > 0 and discount_pct <= 100),
  used boolean not null default false,
  used_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.coupons enable row level security;

-- Lectura pública (v2.82.0, mismo criterio que tournaments/open_plays): alguien sin sesión
-- todavía necesita poder ver "este cupón vale X% en el plan Y" antes de loguearse/registrarse,
-- igual que ya pasa con un link de torneo compartido.
create policy "public read coupons" on public.coupons for select using (true);

-- Solo el admin crea/edita/borra cupones.
create policy "admin write coupons" on public.coupons for all
  using (public.is_admin()) with check (public.is_admin());

-- Canjear (v2.82.0): cualquier autenticado puede marcar un cupón SIN USAR como usado, pero
-- solo a su propio nombre -- `using` exige que siga sin usar (evita la carrera de dos personas
-- canjeando el mismo código a la vez: el segundo update ya no encuentra la fila con used=false
-- y falla), `with check` exige que el resultado quede en used=true y used_by = quien hace el
-- request (nadie puede canjear a nombre de otro, ni "des-canjear" uno ya usado).
create policy "authenticated redeem coupons" on public.coupons for update
  using (auth.role() = 'authenticated' and used = false)
  with check (auth.role() = 'authenticated' and used = true and used_by = auth.uid());
