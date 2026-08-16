# Estado del proyecto — Pickle Hub / Club OS

> Este doc es un resumen narrativo de "dónde vamos" para retomar trabajo rápido en una
> sesión nueva. Para arquitectura/convenciones de código, ver [CLAUDE.md](CLAUDE.md) —
> ese archivo sigue siendo la fuente de verdad técnica; este es el estado y la historia.

## Qué es

App de gestión para un club de pickleball ("Pickle Hub"): reservas de cancha, torneos
con brackets, Open Plays y clases recurrentes, membresías, y estadísticas del club.
React + Vite, un solo componente gigante en `src/App.jsx`.

## Estado actual: v2.6.0 — con backend real

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
- **Crear Open Play recurrente con imagen sacaba del formulario sin crear nada**
  (v2.4.1). Dos bugs combinados: (1) `image` es un data URL guardado tal cual en cada fila
  — una serie recurrente crea una fila por ocurrencia y repetía la MISMA imagen sin
  comprimir en cada una, así que una foto de celular (1-3MB) por 8-10 semanas hacía un
  INSERT de decenas de MB que Supabase rechazaba; (2) `onCreate` en `EventosTab` no
  esperaba el resultado — cerraba el formulario (`setShowOpenPlayForm(false)`) de
  inmediato sin importar si el insert había fallado, así que el error solo quedaba en
  consola y el usuario veía el formulario desaparecer sin explicación. Fix: `OpenPlayForm`
  reescala la imagen a máx. 1280px y la recomprime a JPEG ~75% antes de guardarla
  (~1.7MB → ~120KB en la prueba); `addOpenPlay`/`addClass` ahora devuelven
  `{error}`/`{}` (con try/catch para no dejar escapar errores de red/parseo sin capturar),
  y el formulario espera ese resultado — solo se cierra si tuvo éxito, si no se queda
  abierto mostrando el error. Mismo patrón aplicado a `ClaseForm` por consistencia aunque
  no maneja imágenes. Verificado end-to-end: serie de 11 ocurrencias con una imagen de
  prueba de 1.69MB se creó sin problema, ninguna fila superó ~160KB de imagen guardada.
- **Imágenes de Open Play movidas a Supabase Storage** (v2.5.0, bucket público
  `open-play-images`, migración `open_play_images_storage.sql`). El fix anterior
  (comprimir antes de guardar) evitaba el crash pero seguía guardando la MISMA imagen
  duplicada como data URL en cada fila de la serie (una por ocurrencia) — el usuario
  hizo notar que no era óptimo. Ahora `addOpenPlay` sube el archivo comprimido una sola
  vez y todas las ocurrencias de la serie guardan la misma URL pública
  (`open_plays.image` pasó de ~120-160KB por fila a ~120 caracteres). Políticas RLS en
  `storage.objects`: lectura pública, escritura solo admin (`public.is_admin()`).
  **Sin limpieza automática todavía**: borrar un Open Play (`removeOpenPlay`) o una serie
  completa (`removeOpenPlaySeries`) no borra el archivo del bucket — varias filas pueden
  compartir la misma imagen, así que no es seguro borrarla solo porque se borre una fila;
  el archivo queda huérfano en Storage (costo de almacenamiento bajo, no es un bug de
  datos, pero si se quiere limpieza real habría que rastrear cuántas filas siguen
  referenciando cada URL antes de borrar el objeto). Verificado end-to-end: serie de 6
  ocurrencias con imagen de 1.69MB → 1 solo archivo subido, las 6 filas comparten la
  misma URL, la URL pública sirve el JPEG (200, ~121KB) sin sesión.

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
- **Checkout de Actividades/Reservas movido a modal** (v2.6.0). Antes `EventDetail`/
  `ClassDetail` y el flujo de Reservas (canchas disponibles → confirmar) se insertaban
  como cards apiladas debajo de lo que el usuario ya estaba viendo — en mobile sobre todo,
  el checkout quedaba fuera de la pantalla y había que hacer scroll para encontrarlo (mala
  conversión). Nuevo componente reutilizable `Modal` (overlay centrado, cierra con Escape
  o clic afuera, bloquea scroll del fondo, scroll propio si el contenido no cabe) — se usa
  para envolver `EventDetail`/`ClassDetail` en `EventosTab` y para el paso
  canchas-disponibles→confirmar en `ReservasTab` (ambos pasos ahora viven en el MISMO
  modal, "Cancelar" en el checkout vuelve a la lista de canchas en vez de cerrar todo).
  De paso, el botón "Ver más" de las cards de Actividades ahora dice **"Inscribirme"**
  (Open Play/Clase) o **"Ver torneo"** (Torneo) — pedido explícito del usuario, mejor CTA
  que un genérico "Ver más".
- **Recuperación de contraseña** (v2.2.0): link "¿Olvidaste tu contraseña?" en login →
  `supabase.auth.resetPasswordForEmail()` → el evento `PASSWORD_RECOVERY` de
  `onAuthStateChange` fuerza una pantalla de "nueva contraseña" (tiene prioridad sobre
  `currentUser`, aunque la sesión de recuperación ya sea válida) antes de dejar pasar a la
  app. **Pendiente de verificar en el Dashboard de Supabase** (no vía CLI/DB): que
  Authentication → URL Configuration tenga `https://club-pickleball.vercel.app/**` en
  Redirect URLs, o el link del correo no redirige bien.
- **Onboarding de registro ampliado + tab "Usuarios"** (v2.3.0): el registro ahora pide
  nivel DUPR (`profiles.dupr_rating`, opcional) y WhatsApp (`profiles.phone`) además de
  nombre/zona — decisión de producto: el teléfono es el canal que ya usa el club para
  pagos/reservas pendientes de verificación (mismo criterio que `pago_movil.telefono`), y
  el DUPR es el estándar de nivel en pickleball. Nueva pestaña admin **Usuarios**
  (`NAV_ITEMS`, solo `role === "admin"`) lista todos los `profiles` con su membresía actual
  (`profiles.plan_id`, no el historial de `subscriptions`) — buscador por nombre/correo/tel.
  DUPR y teléfono NO se pidieron para las cuentas ya registradas antes de esto; quedan en
  blanco hasta que el usuario las complete en algún futuro editor de perfil (no existe
  todavía, ver "Lo que falta").

## Lo que falta / posibles próximos pasos

- No hay tests ni linter configurados (a propósito, según CLAUDE.md).
- El resto de la UI (Reservas, Torneos, Membresías) no se ha revisado con el mismo nivel
  de detalle de espaciado mobile que Actividades — si el usuario pide lo mismo en otra
  pestaña, aplicar el mismo patrón (medir con JS, no solo comparar screenshots).
- La pestaña Usuarios es solo lectura (listar + buscar); no tiene edición de rol/membresía
  desde la UI todavía (cambiar `role`/`plan_id` a mano sigue siendo vía SQL/dashboard).
- **Tab "Perfil"** (v2.4.0, todos los roles): cada usuario edita su propio
  name/zone/phone/dupr_rating (`updateProfile`, nunca role/plan_id) y ve su membresía —
  plan actual, `plan_expires_at` y CTA a Membresías (`setTab("membresias")`) para
  suscribirse/mejorar/renovar. **Vencimiento de membresía es nuevo**: todo plan pago se
  asume mensual, `subscribeToPlan` pone `plan_expires_at = hoy + 1 mes` en cada
  (re)suscripción; un plan gratuito no vence. `MembresiasTab` ahora distingue "tu plan
  vigente" (bloqueado) de "tu plan vencido" (botón pasa a "Renovar") comparando
  `plan_expires_at` con la fecha de hoy — antes de esto, un miembro vencido no podía
  volver a suscribirse al mismo plan porque el botón quedaba deshabilitado para siempre.
  **No hay revocación automática de beneficios al vencer** (ni cron ni chequeo de backend)
  — el vencimiento es solo informativo/UI hasta que el usuario mismo entra a Perfil o
  Membresías; si se necesita bloquear acceso real a precios de miembro al vencer, falta
  ese chequeo en los call sites de `courtPriceInfo`/`memberDiscountPct`.
- **RLS endurecida**: como Perfil ahora deja que cualquier cliente autenticado escriba su
  propia fila de `profiles` (antes solo lo hacía `subscribeToPlan` con `plan_id`), se
  agregó un trigger (`profiles_prevent_role_self_escalation`, migración
  `profile_plan_expiry.sql`) que revierte cualquier intento de un no-admin de cambiarse su
  propio `role` — la política RLS "own profile update" es a nivel de fila, no de columna,
  así que sin este trigger un cliente podría auto-ascenderse a admin llamando al API
  directo (no vía la UI, que nunca manda ese campo, pero sí posible desde devtools).
