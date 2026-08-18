-- El admin necesita poder gestionar a los inscritos de un Open Play/Clase desde el propio
-- modal de la actividad (v2.19.0): marcar quién asistió y quitar una inscripción (canceló,
-- error de captura, invitado que no llegó). Hasta ahora open_play_registrations/
-- class_registrations solo tenían políticas de select/insert -- nunca update ni delete.
alter table public.open_play_registrations add column if not exists attended boolean not null default false;
alter table public.class_registrations add column if not exists attended boolean not null default false;

create policy "admin update open_play_registrations" on public.open_play_registrations for update
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete open_play_registrations" on public.open_play_registrations for delete
  using (public.is_admin());

create policy "admin update class_registrations" on public.class_registrations for update
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete class_registrations" on public.class_registrations for delete
  using (public.is_admin());
