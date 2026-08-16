# Estado del proyecto — Pickle Hub / Club OS

> Este doc es un resumen narrativo de "dónde vamos" para retomar trabajo rápido en una
> sesión nueva. Para arquitectura/convenciones de código, ver [CLAUDE.md](CLAUDE.md) —
> ese archivo sigue siendo la fuente de verdad técnica; este es el estado y la historia.

## Qué es

App de gestión para un club de pickleball ("Pickle Hub"): reservas de cancha, torneos
con brackets, Open Plays y clases recurrentes, membresías, y estadísticas del club.
React + Vite, un solo componente gigante en `src/App.jsx`.

## Estado actual: v2.1.3 — con backend real

Hasta hace poco toda la app vivía en memoria del navegador (se perdía todo al recargar).
Ya no. **Todo está migrado a Supabase** (Postgres + Auth):

- **Auth real** — login/registro con Supabase Auth, sesión persistente entre recargas.
- **Todas las entidades en base de datos**: club, canchas, reservas, open plays, clases
  (con recurrencia semanal), inscripciones, membresías, suscripciones, torneo,
  categorías (equipos/grupos/partidos guardados en JSONB, mismo formato que ya usaba
  el motor de brackets — no se reescribió esa lógica), y directorio de jugadores.
- Esquema versionado en `supabase/migrations/` (4 migraciones aplicadas vía CLI, no a
  mano en el dashboard). Ver [supabase/schema.sql](supabase/schema.sql) para el esquema
  completo comentado.

### Cuentas demo (ya sembradas en Supabase Auth)
- Admin: `admin@club.com` / `admin123`
- Cliente: `cliente@club.com` / `cliente123`

### Despliegue
- **Producción**: https://club-pickleball.vercel.app/ (Vercel, proyecto `menway-lab/club-pickleball`, auto-deploy desde `main`).
- **Repo**: https://github.com/jamsbacon/club-pickleball
- **Backend**: proyecto Supabase `ixgnnkqastpabmwuptnr` (región `sa-east-1`). El CLI de
  Supabase ya está autenticado y linkeado localmente (se puede correr
  `npx supabase db push` directo para aplicar migraciones nuevas).
- Variables de entorno (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) ya están
  configuradas tanto en `.env.local` (local, gitignored) como en Vercel
  (Production + Preview).

## Reglas de trabajo ya acordadas con el usuario

1. **Cada cambio de código** → bump de `APP_VERSION` (src/App.jsx) + `"version"`
   (package.json), semver (patch/minor/major) — documentado en CLAUDE.md.
2. **Después de cada cambio** → commit + push a `origin/main` sin que el usuario lo pida
   — también documentado en CLAUDE.md ("Commit & push after every change").
3. Cambios de esquema de Supabase van en migraciones nuevas
   (`supabase/migrations/<timestamp>_<nombre>.sql` + `npx supabase db push`), nunca
   editando `supabase/schema.sql` directamente (ese archivo quedó como referencia legible
   del esquema inicial completo).

## Bugs encontrados y corregidos (vale la pena recordarlos)

- **`updateCategory` no persistía nada en Supabase** (v2.0.0, corregido en el mismo
  commit): el código leía una variable asignada *dentro* del updater de
  `setCategories(prev => ...)` inmediatamente después de llamarlo — en React 18 ese
  updater no corre síncronamente. El estado local sí se actualizaba (por eso no era obvio
  en la UI), pero el guardado real nunca se disparaba. Afectaba las 7 funciones del motor
  de torneo (crear equipo, generar draw, cargar resultado, etc). Se resolvió calculando
  el valor nuevo *antes* del `setState`, no adentro.
- **Vercel a veces no dispara el auto-deploy** tras un `git push` (pasó 2 veces en esta
  sesión, sin causa clara — el webhook está bien configurado). Si un push no aparece en
  Deployments después de 1-2 min: `git commit --allow-empty -m "..."` + push suele
  destrabarlo, sin tocar configuración.
- **RLS de `open_play_registrations`/`class_registrations`** estaba limitada a
  dueño/admin, lo que rompía el cálculo de "cupos disponibles" (necesita el conteo
  total). Se corrigió a lectura pública, mismo criterio que `bookings`.

## Decisiones de producto/UI recientes

- La sección **"Eventos" se renombró a "Actividades"** y es la primera pestaña que ve un
  cliente al entrar (antes era Reservas).
- Vista de Actividades rediseñada estilo lista con buscador + chips de filtro
  (Disponibles ahora/Open Plays/Clases/Torneos), tarjetas con ícono de raqueta de
  relleno (dibujado a mano, no existe en la librería de íconos usada).
- Open Play tiene campo de **cupos/quorum** — muestra "cupos disponibles" y bloquea
  inscripción al llenarse.
- Reservas: el flujo es **horario → canchas disponibles** (no cancha → horario).
- Torneo soporta restringir a **días específicos de la semana** (`tournament.playDays`).
- Clases soportan **recurrencia semanal** igual que Open Plays (antes no).
- Tipografía de números: Inter con `tabular-nums` (no monoespaciada — el usuario no
  quería la estética de máquina de escribir).
- Espaciado mobile en Actividades ajustado para que coincida pixel a pixel con el de
  Torneos (medido con `getBoundingClientRect`, no a ojo).

## Lo que falta / posibles próximos pasos

- No hay tests ni linter configurados (a propósito, según CLAUDE.md).
- El resto de la UI (Reservas, Torneos, Membresías) no se ha revisado con el mismo nivel
  de detalle de espaciado mobile que Actividades — si el usuario pide lo mismo en otra
  pestaña, aplicar el mismo patrón (medir con JS, no solo comparar screenshots).
- No hay recuperación de contraseña, ni edición de perfil, ni gestión de usuarios desde
  la UI de admin (todo eso viviría en Supabase Auth pero no tiene pantalla propia todavía).
