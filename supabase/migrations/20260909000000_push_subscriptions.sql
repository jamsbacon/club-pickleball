-- Notificaciones push (v2.42.0): cada suscripción es un endpoint del navegador (Web Push API)
-- asociado a un usuario -- un mismo usuario puede tener varias (celular + laptop, o si
-- reinstaló la PWA). `endpoint` es único porque identifica un solo canal de entrega real; si
-- el navegador lo renueva, el cliente hace upsert por endpoint en vez de acumular basura.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Cada usuario administra sus propias suscripciones (se crean/borran desde su propio
-- navegador al activar/desactivar notificaciones); un admin puede LEERLAS todas porque
-- "Enviar anuncio" (ver ClubTab) necesita saber a cuántos socios les llega antes de mandar.
-- El envío real (api/send-push.js) no pasa por RLS -- usa la service role key del servidor.
create policy "own read push_subscriptions" on public.push_subscriptions for select
  using (user_id = auth.uid() or public.is_admin());
create policy "own insert push_subscriptions" on public.push_subscriptions for insert
  with check (user_id = auth.uid());
create policy "own update push_subscriptions" on public.push_subscriptions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own delete push_subscriptions" on public.push_subscriptions for delete
  using (user_id = auth.uid() or public.is_admin());
