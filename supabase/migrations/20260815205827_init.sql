-- ============================================================================
-- Pickle Hub / Club OS — esquema inicial de Supabase (Postgres)
-- ============================================================================
-- Cómo aplicarlo: Supabase Dashboard → SQL Editor → pega este archivo completo → Run.
-- Es seguro volver a correrlo (usa IF NOT EXISTS / OR REPLACE donde aplica), pero no
-- borra datos existentes por sí mismo.
--
-- Decisión de diseño: las entidades simples (canchas, reservas, open plays, clases,
-- membresías) están normalizadas en tablas relacionales. El torneo (categorías, equipos,
-- grupos, partidos) se queda con la MISMA forma anidada que ya usa App.jsx hoy
-- (arrays de objetos), guardada en columnas JSONB — así el motor de brackets/round-robin
-- (buildSchedule, generateDraw, closeGroupsAndSeedBracket, etc.) no hay que reescribirlo,
-- solo leer/guardar el JSON tal cual.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CLUB (fila única de configuración — nombre, horario, tasa Bs/USD, pago móvil)
-- ---------------------------------------------------------------------------
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Pickle Hub',
  open_time text not null default '07:00',   -- "HH:MM", igual que club.openTime
  close_time text not null default '22:00',  -- club.closeTime
  block_minutes int not null default 90,     -- club.blockMinutes
  bs_per_usd numeric not null default 180,   -- club.bsPerUsd
  pago_movil jsonb not null default '{"banco":"","telefono":"","cedula":""}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PROFILES — datos de app por usuario, 1:1 con auth.users (Supabase Auth)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'cliente' check (role in ('admin', 'cliente')),
  plan_id uuid,        -- FK a membership_plans, agregada más abajo (orden de declaración)
  zone text default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- COURTS (canchas)
-- ---------------------------------------------------------------------------
create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs(id) on delete cascade,
  name text not null,
  is_private boolean not null default false,
  price_per_block numeric not null default 0,   -- court.pricePerBlock
  member_price numeric not null default 0,
  price_rules jsonb not null default '[]'::jsonb, -- franjas horarias con precio especial
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- MEMBERSHIP PLANS (planes de membresía)
-- ---------------------------------------------------------------------------
create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  monthly_price numeric not null default 0,
  private_court_access boolean not null default false,
  description text default '',
  rate_card jsonb not null default '[]'::jsonb, -- [{label, price}, ...]
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_plan_id_fkey foreign key (plan_id)
  references public.membership_plans(id) on delete set null;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.membership_plans(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  payment_method text check (payment_method in ('movil', 'efectivo')),
  reference text default '',
  proof_name text default '',
  price_usd numeric,
  price_bs numeric,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- BOOKINGS (reservas de cancha individuales — Reservas tab)
-- ---------------------------------------------------------------------------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid references public.courts(id) on delete cascade,
  date date not null,
  time_min int not null,          -- minutos desde medianoche, igual que timeToMinutes()
  block_minutes int not null,
  user_id uuid references public.profiles(id) on delete set null,
  user_name text not null,
  status text not null default 'pendiente_verificacion'
    check (status in ('pendiente_verificacion', 'pendiente_efectivo', 'confirmada', 'cancelada')),
  payment_method text check (payment_method in ('movil', 'efectivo')),
  reference text default '',
  proof_name text default '',
  price_usd numeric,
  price_bs numeric,
  created_at timestamptz not null default now()
);
create index if not exists bookings_court_date_idx on public.bookings (court_id, date);

-- ---------------------------------------------------------------------------
-- OPEN PLAYS (incluye series recurrentes: una fila por ocurrencia,
-- agrupadas por recurring_group_id — igual que hoy en memoria)
-- ---------------------------------------------------------------------------
create table if not exists public.open_plays (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image text default '',            -- data URL o URL de Supabase Storage
  level text not null default 'Todos',
  price numeric not null default 0,
  member_price numeric not null default 0,
  capacity int not null default 0,  -- cupos/quorum máximo (0 = sin límite, ver nota abajo)
  description text default '',
  court_ids uuid[] not null default '{}',
  date date not null,
  start_time text not null,         -- "HH:MM"
  end_time text not null,
  recurring_group_id uuid,          -- null si es evento único
  occupied_blocks jsonb not null default '[]'::jsonb, -- [{courtId, date, timeMin}, ...]
  created_at timestamptz not null default now()
);
create index if not exists open_plays_date_idx on public.open_plays (date);
create index if not exists open_plays_series_idx on public.open_plays (recurring_group_id);

create table if not exists public.open_play_registrations (
  id uuid primary key default gen_random_uuid(),
  open_play_id uuid references public.open_plays(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  user_name text not null,
  payment_method text check (payment_method in ('movil', 'efectivo')),
  reference text default '',
  proof_name text default '',
  price_usd numeric,
  price_bs numeric,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CLASSES (mismo patrón de recurrencia que Open Plays)
-- ---------------------------------------------------------------------------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  academy_name text not null,
  level text not null default 'Todos',
  price numeric not null default 0,
  member_price numeric not null default 0,
  court_ids uuid[] not null default '{}',
  date date not null,
  start_time text not null,
  end_time text not null,
  recurring_group_id uuid,
  occupied_blocks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists classes_date_idx on public.classes (date);
create index if not exists classes_series_idx on public.classes (recurring_group_id);

create table if not exists public.class_registrations (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references public.classes(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  user_name text not null,
  payment_method text check (payment_method in ('movil', 'efectivo')),
  reference text default '',
  proof_name text default '',
  price_usd numeric,
  price_bs numeric,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- TOURNAMENT (fila única, como club) + CATEGORIES (equipos/grupos/partidos en JSONB)
-- ---------------------------------------------------------------------------
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Copa Verano Pickleball',
  start_date date,
  end_date date,
  daily_start text not null default '08:00',
  daily_end text not null default '20:00',
  play_days int[] not null default '{}',   -- 0=domingo … 6=sábado; vacío = todos los días
  presale_start date,
  presale_end date,
  presale_price numeric,
  reg_start date,
  reg_end date,
  regular_price numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  name text not null,
  modality text not null check (modality in ('individual', 'dobles')),
  gender text not null check (gender in ('masculino', 'femenino', 'mixto')),
  level text not null,
  max_teams int,
  seed_mode text not null default 'ranking',
  best_of int not null default 3,
  bracket_size int not null default 4,
  format text,                                 -- liga | grupos | eliminatoria | grupos_eliminatoria | doble_eliminacion
  draw_generated boolean not null default false,
  groups_closed boolean not null default false,
  teams jsonb not null default '[]'::jsonb,     -- [{id, name, players[], createdAt, ...checkout}]
  waitlist jsonb not null default '[]'::jsonb,
  groups jsonb not null default '[]'::jsonb,
  matches jsonb not null default '[]'::jsonb,   -- [{id, courtId, day, time, teamA, teamB, winner, ...}]
  created_at timestamptz not null default now()
);
create index if not exists categories_tournament_idx on public.categories (tournament_id);

-- Directorio de jugadores no-usuarios (ranking sugerido para PartnerPicker) — playerDirectory.
create table if not exists public.player_directory (
  key text primary key,        -- nombre normalizado en minúsculas, igual que hoy en memoria
  name text not null,
  ranking numeric not null default 0
);

-- ============================================================================
-- Trigger: crear automáticamente una fila en profiles cuando alguien se
-- registra vía Supabase Auth (equivalente a lo que hoy hace registerUser()).
-- Espera que el signup mande { data: { name, role } } en options.data.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'cliente')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Helper: ¿el usuario autenticado actual es admin? (se usa en las políticas de abajo)
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable set search_path = public;

alter table public.clubs enable row level security;
alter table public.profiles enable row level security;
alter table public.courts enable row level security;
alter table public.membership_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.bookings enable row level security;
alter table public.open_plays enable row level security;
alter table public.open_play_registrations enable row level security;
alter table public.classes enable row level security;
alter table public.class_registrations enable row level security;
alter table public.tournaments enable row level security;
alter table public.categories enable row level security;
alter table public.player_directory enable row level security;

-- Lectura pública (todo el mundo necesita ver canchas, precios, horarios, torneo, etc.
-- para navegar la app sin iniciar sesión) — igual de abierto que hoy, que es 100% cliente.
create policy "public read clubs" on public.clubs for select using (true);
create policy "public read courts" on public.courts for select using (true);
create policy "public read membership_plans" on public.membership_plans for select using (true);
create policy "public read open_plays" on public.open_plays for select using (true);
create policy "public read classes" on public.classes for select using (true);
create policy "public read tournaments" on public.tournaments for select using (true);
create policy "public read categories" on public.categories for select using (true);
create policy "public read player_directory" on public.player_directory for select using (true);
create policy "public read bookings" on public.bookings for select using (true);
create policy "public read profiles" on public.profiles for select using (true); -- PartnerPicker busca por nombre/email

-- Escritura: solo admin en configuración/catálogo del club.
create policy "admin write clubs" on public.clubs for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write courts" on public.courts for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write membership_plans" on public.membership_plans for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write open_plays" on public.open_plays for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write classes" on public.classes for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write tournaments" on public.tournaments for all using (public.is_admin()) with check (public.is_admin());
create policy "admin write categories" on public.categories for all using (public.is_admin()) with check (public.is_admin());
-- Categories también las escribe InscripcionTab (auto-registro de jugadores) — se permite a
-- cualquier usuario autenticado ADEMÁS del admin, porque el equipo se agrega dentro del JSONB
-- de la categoría (no hay forma más fina de restringir "solo tu propio equipo" a nivel de fila).
create policy "authenticated insert into categories" on public.categories for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Reservas / inscripciones / suscripciones: cualquier usuario autenticado puede crear las
-- suyas; solo puede ver/cancelar las suyas (admin ve y gestiona todas).
create policy "own or admin read bookings" on public.bookings for select using (true);
create policy "authenticated create bookings" on public.bookings for insert with check (auth.role() = 'authenticated');
create policy "own or admin update bookings" on public.bookings for update
  using (user_id = auth.uid() or public.is_admin());

create policy "own or admin read open_play_registrations" on public.open_play_registrations for select
  using (user_id = auth.uid() or public.is_admin());
create policy "authenticated create open_play_registrations" on public.open_play_registrations for insert
  with check (auth.role() = 'authenticated');

create policy "own or admin read class_registrations" on public.class_registrations for select
  using (user_id = auth.uid() or public.is_admin());
create policy "authenticated create class_registrations" on public.class_registrations for insert
  with check (auth.role() = 'authenticated');

create policy "own or admin read subscriptions" on public.subscriptions for select
  using (user_id = auth.uid() or public.is_admin());
create policy "authenticated create subscriptions" on public.subscriptions for insert
  with check (auth.role() = 'authenticated');

-- Perfiles: cada quien edita el suyo; admin edita cualquiera (para cambiar roles/plan).
create policy "own profile update" on public.profiles for update using (id = auth.uid() or public.is_admin());

create policy "authenticated write player_directory" on public.player_directory for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================================
-- Seed inicial — un club y dos canchas, igual a los valores por defecto de hoy en App.jsx.
-- Bórralo o ajústalo si ya vas a cargar datos reales.
-- ============================================================================
insert into public.clubs (name, open_time, close_time, block_minutes, bs_per_usd, pago_movil)
select 'Pickle Hub', '07:00', '22:00', 90, 180,
       '{"banco":"Banesco","telefono":"0414-1234567","cedula":"V-12345678"}'::jsonb
where not exists (select 1 from public.clubs);

insert into public.tournaments (name, daily_start, daily_end)
select 'Copa Verano Pickleball', '08:00', '20:00'
where not exists (select 1 from public.tournaments);

insert into public.courts (club_id, name, is_private, price_per_block, member_price)
select c.id, v.name, false, 15, 5
from public.clubs c, (values ('Cancha 1'), ('Cancha 2')) as v(name)
where not exists (select 1 from public.courts);
