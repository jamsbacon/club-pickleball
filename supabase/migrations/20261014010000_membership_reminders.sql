-- v2.103.0, a pedido del club: avisos automáticos de vencimiento de membresía (push + correo) a los 7
-- días, a los 3 días y el día del vencimiento. Los dispara un cron diario (api/membership-reminders.js).
--
-- Esta tabla solo sirve para NO avisar dos veces lo mismo: una fila por (socio, fecha de vencimiento,
-- aviso '7'|'3'|'0') con los canales que ya salieron. Si el socio renueva, su plan_expires_at cambia y
-- las filas viejas quedan inertes. Solo la toca el servidor (service_role): RLS activo y SIN policies,
-- así que ningún cliente puede leerla ni escribirla. No modifica ninguna fila existente.
create table if not exists public.membership_reminders (
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_on date not null,
  kind text not null check (kind in ('7', '3', '0')),
  push_sent boolean not null default false,
  email_sent boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, expires_on, kind)
);
alter table public.membership_reminders enable row level security;
