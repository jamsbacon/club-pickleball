-- v2.81.8 -- INCIDENTE REAL: "duración aproximada por partido"/"intervalo entre partidos"
-- vivían SOLO como useState(35)/useState(10) en el navegador -- nunca se guardaban en ningún
-- lado. Cada pestaña/dispositivo/recarga arrancaba de nuevo en 35/10 sin importar qué había
-- configurado el admin la última vez, y esos dos números son los que arman la grilla de
-- horarios que se ve en Calendario (`timeSlotOptions`, App.jsx) -- si el valor vigente en ESE
-- momento no coincide con el que se usó para agendar los partidos de verdad, el partido no
-- calza en ninguna fila de la grilla nueva y desaparece de la vista (parece "otro calendario"
-- desde el celular, o que los partidos "se separan" apenas se toca la duración). Guardarlos en
-- el propio torneo (mismo criterio que daily_start/daily_end) hace que todos los
-- dispositivos/sesiones vean siempre el mismo valor real.
alter table public.tournaments add column if not exists match_duration_min integer;
alter table public.tournaments add column if not exists break_min integer;
