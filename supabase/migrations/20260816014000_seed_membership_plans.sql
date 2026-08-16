-- Semilla de los dos planes de membresía que hoy vivían hardcodeados en memoria
-- (useState inicial en App.jsx). Se insertan solo si la tabla está vacía.
insert into public.membership_plans (name, monthly_price, private_court_access, description, rate_card)
select 'Sin membresía', 0, false, 'Pago por uso (Pay per play), sin mensualidad.',
  '[
    {"label":"Reserva de cancha (1h30min)","price":15},
    {"label":"Open Plays","price":8},
    {"label":"Jornada de Liga","price":10},
    {"label":"Mes de clases con APG","price":80},
    {"label":"Sesión de Drills","price":6}
  ]'::jsonb
where not exists (select 1 from public.membership_plans);

insert into public.membership_plans (name, monthly_price, private_court_access, description, rate_card)
select 'Membresía', 50, true, 'Precios preferenciales en canchas, Open Plays, ligas, clases y drills.',
  '[
    {"label":"Reserva de cancha (1h30min)","price":5},
    {"label":"Open Plays","price":0},
    {"label":"Jornada de Liga","price":5},
    {"label":"Mes de clases con APG","price":60},
    {"label":"Sesión de Drills","price":3}
  ]'::jsonb
where (select count(*) from public.membership_plans) < 2;
