-- ============================================================================
-- Generalidades del torneo (antes "Torneo") ahora deja elegir QUÉ canchas del
-- club quedan dedicadas al torneo -- no basta con guardar solo un número: el
-- generador de calendario (buildSchedule) necesita los IDs reales para saber
-- en cuáles armar el horario. Vacío (default) = se siguen usando TODAS las
-- canchas del club, igual que el comportamiento actual (retrocompatible).
-- Mismo patrón que open_plays.court_ids / classes.court_ids.
-- ============================================================================
alter table public.tournaments add column if not exists court_ids uuid[] not null default '{}';
