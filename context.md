# Estado del proyecto — Pickle Hub / Club OS

> Este doc es un resumen narrativo de "dónde vamos" para retomar trabajo rápido en una
> sesión nueva. Para arquitectura/convenciones de código, ver [CLAUDE.md](CLAUDE.md) —
> ese archivo sigue siendo la fuente de verdad técnica; este es el estado y la historia.

## Qué es

App de gestión para un club de pickleball ("Pickle Hub"): reservas de cancha, torneos
con brackets, Open Plays y clases recurrentes, membresías, y estadísticas del club.
React + Vite, un solo componente gigante en `src/App.jsx`.

## Estado actual: v2.11.0 — con backend real

Toda la app está migrada a Supabase (Postgres + Auth) — nada vive solo en memoria del
navegador.

- **Auth real** — login/registro con Supabase Auth, sesión persistente entre recargas,
  recuperación de contraseña, onboarding post-registro (ver más abajo).
- **Todas las entidades en base de datos**: club, canchas, reservas, open plays, clases
  (con recurrencia semanal), inscripciones, membresías, suscripciones, torneo,
  categorías (equipos/grupos/partidos guardados en JSONB, mismo formato que ya usaba
  el motor de brackets), directorio de jugadores, imágenes de Open Play en Supabase
  Storage.
- Esquema versionado en `supabase/migrations/` (aplicado vía CLI, nunca a mano en el
  dashboard). Ver [supabase/schema.sql](supabase/schema.sql) para el esquema inicial
  comentado — las migraciones posteriores son la fuente de verdad de lo que se agregó
  después (columnas de `profiles`, `tournaments.court_ids`, el bucket de Storage, etc.).

### Cuentas demo (ya sembradas en Supabase Auth)
- Admin: `admin@club.com` / `admin123` (también `moralesjtr@gmail.com`, promovido a admin)
- Cliente: `cliente@club.com` / `cliente123`

### Despliegue
- **Producción**: https://club-pickleball.vercel.app/ (Vercel, proyecto `menway-lab/club-pickleball`, auto-deploy desde `main`).
- **Repo**: https://github.com/jamsbacon/club-pickleball
- **Backend**: proyecto Supabase `ixgnnkqastpabmwuptnr`. El CLI de Supabase ya está
  autenticado y linkeado localmente (`npx supabase db push` / `npx supabase db query --linked "..."` funcionan directo, sin pedir credenciales).
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
4. Antes de reorganizar/reestructurar UI existente a pedido del usuario: si el pedido es
   grande o toca lógica delicada (el motor de torneo, sobre todo), vale la pena acotar
   alcance con el usuario primero (ver ejemplo del Calendario más abajo) en vez de asumir
   todo de una — el usuario prefiere que se le pregunte a que se le entregue algo a medias
   pulido en la parte más riesgosa.
5. Verificación en vivo (no solo build limpio) es el estándar para cualquier cambio de UI
   o de lógica de negocio: se levanta un dev server temporal en un puerto libre, se prueba
   con las cuentas demo (o datos sintéticos insertados por SQL cuando hace falta un
   escenario específico, siempre limpiados después), y recién ahí se hace commit.

## Bugs encontrados y corregidos (vale la pena recordarlos)

- **`updateCategory` no persistía nada en Supabase** (v2.0.0): leía una variable asignada
  *dentro* del updater de `setCategories(prev => ...)` inmediatamente después de llamarlo
  — en React 18 ese updater no corre síncronamente. Afectaba las 7 funciones del motor de
  torneo. Se resolvió calculando el valor nuevo *antes* del `setState`.
- **Vercel a veces no dispara el auto-deploy** tras un `git push` (sin causa clara, el
  webhook está bien configurado). Si un push no aparece en Deployments después de 1-2 min:
  `git commit --allow-empty -m "..."` + push suele destrabarlo.
- **RLS de `open_play_registrations`/`class_registrations`** estaba limitada a
  dueño/admin, lo que rompía el cálculo de "cupos disponibles". Corregida a lectura
  pública, mismo criterio que `bookings`.
- **Crear Open Play recurrente con imagen fallaba / el evento único tardaba** — tres
  rondas de fix hasta quedar bien (v2.4.1 → v2.5.0 → v2.7.0):
  1. (v2.4.1) `onCreate` en `EventosTab` no esperaba el resultado de `addOpenPlay` —
     cerraba el formulario igual aunque el insert fallara. Se hizo async + el formulario
     espera y solo cierra si hubo éxito, si no muestra el error.
  2. (v2.5.0) La imagen se guardaba como data URL repetida en CADA fila de una serie
     recurrente (una foto de celular × 8-10 semanas = insert de decenas de MB, rechazado
     por Supabase). Se movió a un bucket de Storage (`open-play-images`, público, solo
     admin escribe) — se sube una sola vez, todas las filas de la serie comparten la URL.
  3. (v2.7.0) La imagen se comprimía con `canvas.toDataURL()` y se resubía reconvirtiendo
     con `fetch(dataURL).blob()` — ese viaje por un string base64 gigante era lento y
     `fetch()` sobre `data:` URIs grandes es frágil en varios navegadores. Fix real:
     `canvas.toBlob()` + `URL.createObjectURL()`, nunca se genera el string base64.
  **Pendiente menor**: borrar un Open Play no borra su archivo de Storage (varias filas
  pueden compartir la misma imagen, no es seguro borrarla solo porque se borre una fila) —
  queda huérfano, costo de almacenamiento bajo, no es un bug de datos.
- **Modal de checkout con hueco arriba en mobile** (v2.7.1): `ReservasTab` envuelve todo
  en `<div className="space-y-5">`, y Tailwind le pone `margin-top` a cualquier hijo que
  no sea el primero — el `Modal`, aunque `position:fixed`, heredaba ese margen (fixed no
  anula margin) y quedaba corrido ~20px, dejando el TopBar visible sin oscurecer. Fix:
  `Modal` se monta con `createPortal` directo en `document.body`, inmune a cualquier
  margin/overflow/z-index de quien lo llame. De paso quedó full-screen de verdad en mobile
  (`min-h-[100dvh]`, sin el padding que antes desperdiciaba espacio).

## Decisiones de producto/UI (orden cronológico)

- **Actividades** (antes "Eventos") es la pestaña de aterrizaje del cliente. Lista estilo
  buscador + chips de filtro, tarjetas con ícono de raqueta dibujado a mano (no existe en
  la librería de íconos). Open Play tiene cupos/quorum. Reservas: flujo horario → canchas
  disponibles (no cancha → horario). Clases soportan recurrencia semanal igual que Open
  Plays. Números en Inter `tabular-nums` (no monoespaciada).
- **v2.2.0 — Recuperación de contraseña**: `resetPasswordForEmail()` + el evento
  `PASSWORD_RECOVERY` fuerza una pantalla de nueva contraseña con prioridad sobre
  `currentUser`. **Sigue sin confirmarse** que el Dashboard de Supabase (Authentication →
  URL Configuration → Redirect URLs) tenga `https://club-pickleball.vercel.app/**` — eso
  no se puede verificar por CLI/DB, hay que pedirle al usuario que lo revise si el link
  del correo no redirige bien.
- **v2.3.0 — Onboarding v1 + tab Usuarios**: primera vuelta, pedía DUPR/WhatsApp en el
  mismo formulario de registro (esto se REEMPLAZÓ en v2.8.0, ver abajo). Tab **Usuarios**
  (admin): lista todos los `profiles` con su membresía actual (`profiles.plan_id`) —
  sigue siendo de **solo lectura** (buscador, sin editar rol/membresía desde la UI).
- **v2.4.0 — Tab Perfil** (todos los roles): cada usuario edita su propio
  name/zone/phone/dupr_rating/gender/birth_date vía `updateProfile` (nunca role/plan_id),
  y ve su membresía (plan, `plan_expires_at`, CTA a Membresías). Todo plan pago es
  mensual; `subscribeToPlan` pone `plan_expires_at = hoy + 1 mes` en cada
  (re)suscripción. `MembresiasTab` distingue plan vigente (bloqueado) de vencido (botón
  "Renovar"). **Vencimiento es solo informativo** — no hay revocación automática de
  precio de miembro al vencer (falta ese chequeo en `courtPriceInfo`/`memberDiscountPct`
  si se necesita bloquear acceso real).
- **RLS endurecida**: como Perfil deja que cualquier cliente escriba su propia fila de
  `profiles`, se agregó el trigger `profiles_prevent_role_self_escalation` (migración
  `profile_plan_expiry.sql`) que revierte cualquier intento de un no-admin de cambiarse
  su propio `role` — la política "own profile update" es a nivel de fila, no de columna.
- **v2.6.0 — Checkout de Actividades/Reservas a modal**: antes vivían como cards apiladas
  debajo del contenido (mala conversión, sobre todo mobile). Componente `Modal`
  reutilizable (ver fix del hueco arriba en v2.7.1). Botón "Ver más" → **"Inscribirme"**
  (Open Play/Clase) o **"Ver torneo"** (Torneo).
- **v2.7.0 — Actividades recurrentes, checkout de un paso para el cliente**: antes
  cualquier usuario en una serie recurrente veía "elige una fecha"; ahora eso es solo
  para admin (necesita borrar fechas puntuales) — el cliente va directo al checkout de la
  ocurrencia más próxima, idéntico a un evento único.
- **v2.8.0 — Registro simplificado + Onboarding moderno + torneo por género** (reemplaza
  el registro de v2.3.0): `AuthScreen` "register" ahora solo pide correo+contraseña.
  Nuevo componente `Onboarding` (wizard de un paso, se activa automático post-registro
  vía `profiles.onboarding_completed`, default `true` para cuentas viejas / `false`
  explícito para nuevas): nombre, género (`profiles.gender`, masculino/femenino,
  obligatorio), fecha de nacimiento (`profiles.birth_date`, obligatoria), DUPR y
  domicilio opcionales/saltables. `InscripcionTab` (torneo, jugador) filtra categorías
  por género (`mixto` visible para cualquiera); sin género seteado se ven todas + aviso
  que navega a Perfil.
- **v2.8.1 — Versión visible dentro de la app**: `v{APP_VERSION}` ahora también en
  `Sidebar` (desktop) y `TopBar` (mobile), no solo en `AuthScreen`.
- **v2.9.0 — Inscripción a torneo como carrito multi-categoría** (reemplaza el checkout
  de una-categoría-a-la-vez de v2.8.0): selección múltiple de categorías (cards sin
  truncar el nombre), pareja independiente por categoría de dobles (`PartnerPicker`
  inline), barra de carrito `fixed` con total en vivo, un solo `Modal` de checkout para
  todo el carrito (una misma referencia/comprobante cubre todas las categorías
  elegidas). **Precio siempre individual** (`unitPrice` por categoría, nunca × 2 por
  dobles — la pareja paga su propia inscripción cuando ella se registre).
- **v2.10.0 — Reorganización de la sección Torneo (admin) en 6 pestañas**: Generalidades
  (antes "Torneo" + nuevo selector de canchas dedicadas al torneo,
  `tournament.court_ids`, vacío = todas las del club), Categorías (solo crear/listar/
  borrar), **Participantes** (nueva — `TeamRegistration` por categoría, reemplaza tanto
  lo que vivía dentro de Categorías como la vieja "Inscripción" admin, que se eliminó del
  archivo), **Formatos** (nueva — `FormatAdvisor`/`DrawSetup`/`DrawPreview` por
  categoría), Calendario (ordena por horario Y cancha; nuevo `findScheduleConflicts()`
  como red de seguridad), Resultados (nuevo filtro "Todas", cola cronológica cruzando
  categorías). Categorías/Participantes/Formatos comparten la misma `activeCat` vía
  `CategoryPicker`. "Inscripción" (carrito del cliente) ahora es visible solo para
  `role === "cliente"`.
  **Nota de alcance**: se le dijo al usuario que había un "bug de conflictos entre
  categorías" en el generador de calendario: al trazar `buildSchedule` a fondo para
  arreglarlo, resultó que NO había tal bug — el algoritmo ya es conflict-safe por
  construcción (agenda categorías secuencialmente en el tiempo, nunca se solapan). Lo que
  sí es real: esa secuencialidad desperdicia canchas (no corre categorías en paralelo
  cuando sería seguro), y arreglar eso es esencialmente el mismo problema que el
  siguiente punto pendiente.
- **v2.11.0 — Sesión 1 del rediseño de Calendario: asistente de distribución + motor
  nuevo** (Sesión 2 — drag-and-drop manual — sigue pendiente, ver "Lo que falta" #1).
  `buildSchedule()` se reescribió por completo: antes eran DOS loops independientes (fase
  de grupos de TODAS las categorías mezcladas en una cola por cursor de slot compartido,
  después brackets categoría por categoría con OTRO cursor que arrancaba donde el primero
  había quedado) — ahora es un solo loop que consume una cola unificada por categoría
  (grupos + bracket propio, respetando que una ronda de bracket nunca se agenda antes que
  la anterior de su misma categoría). Nuevo parámetro `plan` (opcional, `null` = sin
  restricciones): `{ mode: "mixed" | "byCategory", categoryOrder, dayCategories }`.
  "mixed" intercala partidos de todas las categorías posición a posición; "byCategory"
  concatena cada cola completa en el orden elegido (esto además corrige que antes los
  brackets NUNCA se paralelizaban entre categorías, ver nota de v2.10.0 arriba — ahora si
  el plan lo permite, sí). El chequeo de choque de jugador (`usedPlayers` por slot) ahora
  también cubre partidos de bracket (antes solo cubría grupos) — corrige un hueco latente
  donde un jugador anotado en dos categorías podía, en teoría, terminar con dos partidos
  de bracket a la misma hora sin que nada lo evitara (aunque en la práctica nunca pasaba,
  por ser secuencial). `findScheduleConflicts()` sigue igual, como red de seguridad.
  Nuevo componente `SchedulerWizardModal` en `CalendarioTab`: el botón "Generar/Actualizar
  calendario" abre el asistente en vez de correr el motor directo; arma el `plan` (modo,
  orden de categorías con botones subir/bajar — sin librería de drag, ver nota de scope
  más abajo — y qué categorías puede jugar cada fecha del torneo, vacío = sin
  restricción) y se lo pasa a `runScheduler(plan)`. Estado del wizard es local, no
  persiste entre aperturas (mismo patrón que `matchDuration`/`breakM`).
  **Alcance acordado con el usuario** (decisiones tomadas antes de programar):
  dropdown "qué se juega cada día" trabaja a nivel de categoría completa, NO de ronda
  individual dentro de una fase de grupos — los partidos de grupo no guardan índice de
  ronda hoy (`round: null` siempre, ver `makeGroupMatch`), bajar a ese nivel de
  granularidad requeriría agregar ese campo primero; se decidió no hacerlo en esta
  sesión. Sesión 2 (drag-and-drop) usará tap-origen→tap-destino, no arrastre físico (la
  app se usa mucho desde el celular), y los partidos movidos a mano quedarán "pineados"
  para que un futuro "Actualizar calendario" no los pise sin avisar.
  **Verificación**: la app no pudo probarse end-to-end en el navegador de esta sesión — la
  red del sandbox no resuelve el host real de Supabase (`ERR_NAME_NOT_RESOLVED`), no es un
  bug del código. Se verificó el motor nuevo con un harness de Node aislado (funciones
  puras copiadas 1:1 de `buildSchedule`/`findScheduleConflicts`) contra datos sintéticos:
  modo mixto intercala categorías, modo por-categoría respeta el orden pedido, la
  restricción por día excluye correctamente la categoría no permitida, un jugador
  anotado en dos categorías nunca queda con doble partido a la misma hora, y una ronda de
  bracket con equipos aún no definidos se agenda igual (sin romper) después de que
  termine la ronda anterior de su categoría. **Falta la pasada visual real** (abrir el
  wizard, generar un calendario de un torneo real y mirarlo) — pendiente para la próxima
  vez que se pueda levantar el dev server contra el Supabase real o probar en producción.

## Lo que falta / próximos pasos

1. **Calendario: drag-and-drop manual para reprogramar partidos** (Sesión 2 del punto
   grande de Calendario — Sesión 1, el asistente de distribución + motor nuevo, se hizo en
   v2.11.0, ver arriba). Falta:
   - Vista de grilla (día × cancha) con los partidos ya agendados.
   - Mover un partido a otra celda vía tap-origen → tap-destino (no arrastre físico,
     decidido con el usuario por el uso mobile de la app), validando en el momento
     (cancha libre, jugadores libres) antes de aceptar el movimiento.
   - Marcar como "pineado" un partido movido a mano para que el asistente (v2.11.0) no lo
     recalcule/pise la próxima vez que se corra "Actualizar calendario" — requiere un
     campo nuevo en el modelo de partido y que `buildSchedule` lo respete.
2. **Pasada visual del asistente v2.11.0** en un torneo real (dev server contra Supabase
   real o producción) — no se pudo hacer en la sesión que lo construyó, ver nota arriba.
3. **Confirmar en el Dashboard de Supabase** (no verificable por CLI): Authentication →
   URL Configuration → Redirect URLs debe incluir `https://club-pickleball.vercel.app/**`
   para que el link de recuperación de contraseña (v2.2.0) redirija bien.
4. Tab **Usuarios** sigue siendo de solo lectura — no hay edición de rol/membresía desde
   la UI (cambiar `role`/`plan_id` a mano sigue siendo vía SQL/dashboard).
5. **Vencimiento de membresía es solo informativo** — no hay revocación automática de
   precio de miembro al vencer. Si se necesita bloquear acceso real, falta el chequeo de
   `plan_expires_at` en `courtPriceInfo`/`memberDiscountPct`.
6. Limpieza de archivos huérfanos en el bucket `open-play-images` de Storage no está
   implementada (borrar un Open Play no borra su imagen si otras filas de la serie la
   comparten) — costo bajo, no urgente.
7. El resto de la UI (Reservas, Torneos, Membresías) no se ha revisado con el mismo nivel
   de detalle de espaciado mobile que Actividades — si el usuario pide lo mismo en otra
   pestaña, aplicar el mismo patrón (medir con JS/`getBoundingClientRect`, no a ojo).
8. No hay tests ni linter configurados (a propósito, según CLAUDE.md) — no asumir
   `npm test`/`npm run lint`.
