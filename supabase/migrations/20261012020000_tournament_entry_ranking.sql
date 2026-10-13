-- v2.96.0, a pedido del club: torneo con inscripción restringida por ranking (ej. la fase final
-- tras la Liga: solo los puestos 1 al 16 del ranking pueden inscribirse).
--   tournaments.entry_ranking_id: ranking que filtra quién se inscribe (null = abierto a todos).
--   tournaments.entry_rank_from / entry_rank_to: rango de puestos permitido, inclusive
--     (null = sin límite por ese lado).
-- El ranking se evalúa EN VIVO al inscribirse (no se guarda ninguna lista). No toca inscripciones
-- ya hechas ni la inscripción manual del admin. No modifica ninguna fila existente.
alter table public.tournaments add column if not exists entry_ranking_id uuid references public.rankings(id) on delete set null;
alter table public.tournaments add column if not exists entry_rank_from integer;
alter table public.tournaments add column if not exists entry_rank_to integer;
