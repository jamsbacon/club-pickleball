-- v2.83.0 -- a pedido del club: un cupón ahora puede fijar cuántas veces se puede usar
-- (`max_uses`, antes siempre 1) y una fecha de caducidad opcional (`expires_at`). El link/QR
-- sigue llevando directo al checkout del plan con el % ya aplicado, y sigue pidiendo
-- login/registro si quien lo abre no tiene sesión -- eso no cambia, solo cuántas veces y hasta
-- cuándo sirve el código.
--
-- Ningún cupón real existía todavía en producción (tabla vacía) cuando se hizo este cambio, así
-- que se puede reemplazar `used`/`used_by`/`used_at` (booleano de un solo uso) directo por un
-- contador, sin migrar datos.
alter table public.coupons add column if not exists max_uses integer not null default 1;
alter table public.coupons add column if not exists used_count integer not null default 0;
alter table public.coupons add column if not exists expires_at timestamptz;
alter table public.coupons add constraint coupons_max_uses_positive check (max_uses > 0);

drop policy if exists "authenticated redeem coupons" on public.coupons;

alter table public.coupons drop column if exists used;
alter table public.coupons drop column if exists used_by;
alter table public.coupons drop column if exists used_at;

-- Bitácora de canjes (uno por fila, a diferencia del viejo used_by de un solo valor) -- para que
-- el admin pueda ver QUIÉN canjeó un cupón de varios usos, no solo cuántos le quedan.
create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz not null default now()
);
alter table public.coupon_redemptions enable row level security;
create policy "admin read coupon_redemptions" on public.coupon_redemptions for select using (public.is_admin());

-- Canje atómico real (v2.83.0) -- INCIDENTE de esta misma noche con `categories` (ver
-- updateCategory en App.jsx): dos guardados "leer -> calcular -> escribir" desde el cliente
-- pueden pisarse entre sí si llegan casi al mismo tiempo. Para un contador de usos, la forma
-- correcta y más simple de evitarlo del todo es un solo UPDATE atómico del lado de la base de
-- datos (el propio Postgres serializa la fila) en vez de leer y escribir por separado desde el
-- cliente -- así que el canje ya no es un `.update()` directo desde la app, es esta función.
-- `security definer` porque el cliente autenticado no tiene (ni debe tener) permiso de UPDATE
-- directo sobre `coupons` -- solo esta función, que valida cupo y vigencia ella misma.
create or replace function public.redeem_coupon(p_coupon_id uuid)
returns public.coupons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon public.coupons;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.coupons
  set used_count = used_count + 1
  where id = p_coupon_id
    and used_count < max_uses
    and (expires_at is null or expires_at > now())
  returning * into v_coupon;

  if v_coupon.id is null then
    raise exception 'coupon not available';
  end if;

  insert into public.coupon_redemptions (coupon_id, user_id) values (p_coupon_id, auth.uid());
  return v_coupon;
end;
$$;

revoke all on function public.redeem_coupon(uuid) from public;
grant execute on function public.redeem_coupon(uuid) to authenticated;
