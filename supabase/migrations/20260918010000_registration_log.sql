-- v2.80.6 -- comprobante histórico de inscripciones, APARTE de categories.teams/waitlist.
-- Nace de un incidente real: una escritura de `categories` calculada sobre el estado LOCAL
-- desactualizado del navegador (ver comentario de updateCategory en App.jsx) se llevó de
-- encuentro la inscripción de dos jugadores (Nicolás Merchán / Camila Sangster) sin que nadie
-- los borrara a mano -- el admin no tenía ninguna forma de comprobar que sí se habían
-- inscrito, más allá de la notificación push que ya había desaparecido de su teléfono.
--
-- Esta tabla es SOLO DE AGREGAR a propósito: no tiene políticas de UPDATE ni DELETE, así que
-- ni siquiera el admin puede editarla o borrarla desde la UI de la app -- si `categories`
-- vuelve a perder una inscripción por el mismo tipo de bug (o cualquier otro), esta tabla sigue
-- mostrando que esa persona SÍ se inscribió, cuándo, y en qué categoría, para poder comparar
-- contra lo que se ve en Inscritos/Duplas y detectar la discrepancia.
create table public.registration_log (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete set null,
  tournament_name text not null,
  category_id uuid references public.categories(id) on delete set null,
  category_name text not null,
  player_names text not null,
  source text not null, -- 'checkout' (auto-registro pagado) | 'walkin' (anotado a mano en Duplas) | 'join_partner' (se unió a un cupo por link)
  created_at timestamptz not null default now()
);
alter table public.registration_log enable row level security;

-- Cualquier autenticado puede AGREGAR (mismo criterio que "authenticated insert into categories"
-- -- un jugador registrándose a sí mismo también necesita poder escribir aquí), pero solo el
-- admin puede LEER el historial completo -- es una bitácora de auditoría, no algo que un jugador
-- necesite ver de los demás.
create policy "authenticated insert registration_log" on public.registration_log for insert
  with check (auth.role() = 'authenticated');
create policy "admin read registration_log" on public.registration_log for select
  using (public.is_admin());
