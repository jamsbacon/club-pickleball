-- Fix: open_play_registrations/class_registrations solo eran legibles por su dueño o admin.
-- Eso rompe el cálculo de "cupos disponibles" (capacity - total de inscritos), que necesita
-- ver el conteo TOTAL sin importar quién esté mirando -- mismo criterio ya aplicado a
-- `bookings` (public read, using(true)) por la misma razón: occupiedKeys/capacidad son
-- cálculos que todo el mundo necesita poder hacer, con o sin sesión.
drop policy if exists "own or admin read open_play_registrations" on public.open_play_registrations;
create policy "public read open_play_registrations" on public.open_play_registrations for select using (true);

drop policy if exists "own or admin read class_registrations" on public.class_registrations;
create policy "public read class_registrations" on public.class_registrations for select using (true);
