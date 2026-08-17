# Estado del proyecto — Pickle Hub / Club OS

> Este doc es un resumen narrativo de "dónde vamos" para retomar trabajo rápido en una
> sesión nueva. Para arquitectura/convenciones de código, ver [CLAUDE.md](CLAUDE.md) —
> ese archivo sigue siendo la fuente de verdad técnica; este es el estado y la historia.

## Qué es

App de gestión para un club de pickleball ("Pickle Hub"): reservas de cancha, torneos
con brackets (varios a la vez, el club organiza torneos con frecuencia — desde v2.13.0),
Open Plays y clases recurrentes, membresías, y estadísticas del club.
React + Vite, un solo componente gigante en `src/App.jsx`.

## Estado actual: v2.16.0 — con backend real

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
- **v2.12.0 — Sesión 2 del rediseño de Calendario: reprogramar partidos a mano**. Nuevo
  campo `locked` en el modelo de partido (`matches[]` dentro de `categories`, JSONB, no
  requirió migración de esquema — sigue viviendo dentro de la columna existente).
  `buildSchedule()` (v2.11.0) ahora respeta `locked: true`: no resetea esos partidos ni los
  vuelve a meter en la cola, y reserva su bloque (cancha+hora) y a sus jugadores en ese
  horario para todo lo demás — igual que un bloque ya ocupado por una reserva. Dos
  mutadores nuevos junto a `updateCategory`: `moveMatch(categoryId, matchId, {day, time,
  courtId})` (aplica el cambio + marca `locked: true`, persiste vía `updateCategory`) y
  `unlockMatch` (quita el pin, conserva la posición actual hasta la próxima regeneración).
  `checkMoveConflict()` — misma lógica de choque que `findScheduleConflicts` pero para un
  movimiento puntual — valida ANTES de confirmar: cancha libre (cruzando reservas/eventos/
  otros partidos vía el mismo `occupiedKeys` de toda la app) y ningún jugador del partido
  con otro partido a esa hora. En `CalendarioTab`: botón "Editar manualmente" (admin) activa
  un modo donde tocar un partido de la tabla lo selecciona como origen; aparece una tarjeta
  con selects de día/hora/cancha como destino (tap-origen → tap-destino con formulario, no
  arrastre físico ni grilla visual — decidido así por scope/tiempo de la sesión, ver "Lo que
  falta"), con la validación de `checkMoveConflict` antes de aceptar. Los partidos fijados
  muestran un ícono de candado (clic para liberar) y un contador arriba avisa cuántos no se
  tocarán la próxima vez que se corra "Actualizar calendario".
  **Verificación**: mismo problema de red que v2.11.0 (el sandbox de esta sesión tampoco
  pudo resolver el host real de Supabase) — se verificó con un segundo harness de Node
  aislado: un partido fijado sobrevive intacto a una regeneración completa sin que nada
  invada su cancha/horario/jugadores, y `checkMoveConflict` bloquea correctamente mover a
  una cancha ocupada, permite un destino libre, y no se autobloquea al "mover" un partido a
  su propio slot actual.
- **v2.13.0 — Sesión 1 de multi-torneo: crear torneos + lista admin**. Hasta acá la app era
  de un solo torneo *por diseño* (el comentario del propio schema decía "fila única, como
  club") — no existía ninguna función para crear un torneo desde la UI, el único que había
  se sembró directo en la base. El pedido real del usuario: el club organiza varios torneos
  con frecuencia, cada uno con sus propias categorías/fechas/horarios/inscripción, y el
  cliente se inscribe en los que le calcen (no un solo torneo "activo" a la vez).
  Cambios: `tournament` (objeto único) → `tournaments` (array completo) + `activeTournamentId`
  (cuál se está viendo/editando; `null` = lista). Nueva `createTournament(name)` (insert +
  dejarlo abierto para editar, RLS ya lo permitía -- `admin write tournaments` ya era `for
  all`, no hizo falta migración). **El fix importante y no visible**: la consulta de
  `categories` nunca filtraba por torneo (traía TODAS las de TODOS los torneos mezcladas) --
  se mantiene así a propósito (occupiedKeys necesita ver los partidos de todos los torneos
  para no chocar canchas entre ellos) pero ahora cada categoría carga `tournamentId`
  (`mapCategoryRow`) y cada pantalla de un torneo puntual recibe el subconjunto ya filtrado.
  `runScheduler` tenía el mismo problema en la otra dirección: clonaba y programaba TODAS las
  categorías de TODOS los torneos juntas, y el guardado pisaba el array completo -- ahora
  clona/programa solo el subconjunto del torneo activo y lo mezcla de vuelta sin tocar los
  demás. Nuevo `TournamentsListTab` (pantalla de aterrizaje de la pestaña Torneos): tarjetas
  con nombre/fechas/cantidad de categorías y equipos, "Editar" (admin) o "Ver torneo"
  (cliente), + "Crear nuevo torneo" (admin). `TorneosSection` (la pantalla de 6 sub-pestañas
  que ya existía) ahora es "un torneo puntual" con un botón "← Volver a Torneos" arriba, en
  vez de ser LA pantalla de torneo. Documentado en detalle en CLAUDE.md ("Multi-tournament:
  `tournaments[]` + `activeTournamentId`, pero `categories` sigue global").
  **Verificación**: mismo problema de red que v2.11.0/v2.12.0 -- tampoco se pudo probar en el
  navegador (ni el sandbox local ni Claude in Chrome, que el usuario no llegó a conectar en
  esta sesión). Se hizo revisión de código línea por línea de cada punto de acceso a
  `tournament`/`categories` en el archivo (grep de `\btournament\b` completo) para confirmar
  que no quedó ninguna referencia colgante al modelo viejo, más build limpio. **Falta la
  pasada visual real, más que en las sesiones anteriores** — este cambio toca flujos de
  usuario (crear torneo, navegar la lista, volver), no solo un algoritmo interno.
  **Sesión 2 pendiente** (acordada con el usuario): tarjeta por torneo + botón "Crear
  torneo" dentro de Actividades -- de hecho, para no dejar la app rota, `EventosTab` YA se
  actualizó en esta sesión para mostrar una tarjeta por torneo (antes tenía una fija
  hardcodeada) en vez de solo el botón; lo que falta de la Sesión 2 es el botón "+ Crear
  torneo" ahí mismo (hoy solo se crea desde la pestaña Torneos) y cualquier pulido visual
  que el usuario pida después de ver las tarjetas en uso.
- **v2.13.1 — Verificación real de multi-torneo (Claude in Chrome) + fix de texto**. El
  usuario conectó la extensión Claude in Chrome (no estaba instalada en las sesiones
  anteriores) -- primera vez en toda la racha de sesiones bloqueadas por red que se pudo
  probar algo de punta a punta en un navegador real. Se verificó en producción, como admin
  y como cliente: crear un torneo nuevo desde cero (el formulario inline con
  "Crear"/"Cancelar" funciona), que la lista muestre ambos torneos con sus conteos de
  categorías/equipos correctamente separados, que "Categorías" del torneo nuevo arranque
  vacía y NO mezclada con las 3 categorías del torneo viejo (la prueba más importante --
  confirma el fix de `tournamentId` de v2.13.0), navegación "Volver a Torneos", y que
  Actividades muestre una tarjeta por torneo con "Ver detalles"/"Ver torneo" saltando
  directo al torneo correcto. El torneo de prueba se creó vía UI y se borró después por SQL
  (`npx supabase db query --linked`, no hay botón de borrar en la UI todavía -- ver punto
  pendiente). De paso se encontró y arregló un detalle de texto real (no un bug de datos):
  la tarjeta de un torneo con categorías creadas pero 0 equipos inscritos decía "Sin
  categorías aún" (heredado tal cual del código de un-solo-torneo) -- ahora distingue "sin
  categorías todavía" de "hay categorías, todavía sin inscritos".
- **v2.14.0 — Sesión 2 de multi-torneo: borrar torneo + "+ Torneo" en Actividades**. Cierra
  el punto grande de multi-torneo que arrancó en v2.13.0.
  - `removeTournament(id)`: `tournaments.id` ya tenía `ON DELETE CASCADE` hacia
    `categories.tournament_id` (se aprovechó, sin migración nueva) -- borra el torneo y de
    paso todas sus categorías/equipos/partidos en la base. Cliente alinea `categories`/
    `tournaments` locales a mano (filtrando el id) y, si era el torneo que se estaba
    editando, vuelve a la lista. Ícono de basurero (mismo patrón visual que
    `removeCategory`) en cada tarjeta de `TournamentsListTab`, sin modal de confirmación --
    a propósito: es el mismo comportamiento de un clic que ya tenía `removeCategory` en
    toda la app, no se introdujo un patrón de UI nuevo.
  - Botón "+ Torneo" en Actividades, junto a "+ Open Play"/"+ Clase" (admin). A diferencia
    de esos dos, no abre un formulario propio ahí mismo -- el formulario de creación ya
    vive en `TournamentsListTab`, así que el estado `showForm`/`setShowForm` se subió al
    componente principal (antes vivía dentro de `TournamentsListTab`) para que este botón
    pueda navegar a la pestaña Torneos Y pedirle que abra el formulario de una, sin
    duplicar el formulario en dos lugares.
  - **Verificación**: probado en producción con Claude in Chrome. "+ Torneo" en Actividades
    navega a Torneos y abre el formulario de una (sin paso intermedio). Se creó un torneo de
    prueba, se borró con el ícono de basurero (desaparece al toque de la lista) y se
    confirmó por SQL que también se borró de la base de verdad (`select ... from
    tournaments` solo devuelve el torneo real) -- no hizo falta limpieza manual esta vez,
    a diferencia de v2.13.0.
- **v2.15.0 — Editar y borrar cualquier actividad desde Actividades**. Pedido del usuario:
  admin necesita editar/borrar Open Plays, Clases y Torneos sin salir de la pestaña
  Actividades. Antes de esto **no existía ninguna forma de editar** un Open Play o una Clase
  ya creados (solo crear y borrar) -- se agregó de cero.
  - Cuatro mutadores nuevos: `updateOpenPlay`/`updateClass` (una fila puntual -- fecha,
    hora, cancha, precio, etc. de esa ocurrencia sola) y `updateOpenPlaySeries`/
    `updateClassSeries` (campos COMPARTIDOS de toda una serie recurrente -- nombre, precio,
    nivel, cancha, horario, imagen -- la fecha de cada ocurrencia nunca se toca ahí, es lo
    que la hace serie y no un evento repetido el mismo día). Misma dualidad
    ocurrencia/serie que ya existía para borrar (`onRemove`/`onRemoveSeries`) -- se extendió
    el mismo patrón a editar en vez de inventar uno nuevo. Todos refrescan desde Supabase al
    terminar (`fetchOpenPlays`/`fetchClasses`) en vez de parchear el estado local a mano.
  - `OpenPlayForm`/`ClaseForm` (antes solo-crear) ahora aceptan `initial` (precarga valores,
    su presencia = modo edición) y `hideDate` (oculta el campo Fecha cuando se edita una
    serie entera, ya que no aplica una fecha única). El bloque de "evento/clase recurrente"
    se oculta por completo al editar (la recurrencia no es editable retroactivamente). El
    prop se renombró de `onCreate` a `onSubmit` en ambos formularios -- mismo contrato
    (async, devuelve un error o vacío), el nombre viejo confundía ahora que también guarda
    ediciones.
  - `EventDetail`/`ClassDetail`: ícono de lápiz junto al de basurero que ya tenían -- "Editar"
    (evento único o el header cuando no es serie), "Editar toda la serie" (header cuando sí
    es serie), y un lápiz por fila en la lista de fechas de una serie (editar esa fecha
    puntual sin tocar el resto). Al pulsar, el modal cambia de mostrar
    EventDetail/ClassDetail a mostrar el formulario precargado, en vez de abrir un modal
    aparte.
  - Torneo: "editar" ya existía (entrar a un torneo aterriza en Generalidades, que ES el
    formulario de edición) pero "borrar" solo vivía en la tarjeta de `TournamentsListTab`
    (la lista) -- si el admin llegaba directo a editar un torneo puntual desde Actividades,
    no tenía forma de borrarlo sin volver antes a la lista. Se agregó el mismo ícono de
    basurero junto a "← Volver a Torneos" dentro de `TorneosSection`.
  - **Verificación**: completa en producción con Claude in Chrome, en dos pasadas. Primera:
    crear un Open Play de prueba → editarlo (lápiz, precio $5→$99, precarga correcta, sin
    bloque de recurrencia) → confirmar que persiste → borrarlo (basurero, sigue andando
    después del cambio de `onCreate`→`onSubmit`); crear un torneo de prueba → borrarlo con
    el basurero nuevo DENTRO de Generalidades (no desde la lista) → confirma que vuelve
    solo a la lista. Segunda pasada (lo que había quedado pendiente): serie de Open Play de
    3 fechas (3, 10 y 17/sept) → "Editar toda la serie" (precio 5→77) → confirmado por SQL
    que **las 3 filas** cambiaron de precio y **ninguna** cambió de fecha → "Editar esta
    fecha" en la ocurrencia del 10/sept nomás (precio 77→111) → confirmado por SQL que
    **solo esa fila** cambió (3 y 17/sept siguieron en 77) -- exactamente el comportamiento
    que el diseño prometía. Mismo circuito repetido con una serie de Clase (3 fechas,
    "Editar toda la serie", precio 15→88) → confirmado por SQL que las 3 filas cambiaron
    con sus fechas intactas, validando que `ClaseForm` en modo edición funciona igual que
    `OpenPlayForm`. Las tres series de prueba se borraron con "Eliminar toda la serie" y se
    confirmó por SQL que no quedó nada huérfano en `open_plays`, `classes` ni
    `tournaments`. Sin probar todavía, por acotar el alcance de esta pasada: editar una
    ocurrencia puntual dentro de una serie de Clase (`updateClass` en solitario) -- mismo
    código que `updateOpenPlay`, ya probado, así que la confianza es alta igual.
- **v2.16.0 — Borrador/Publicado para torneos**. Bug real reportado por el usuario con
  captura: creó un torneo solo con el nombre ("Copa APG", sin fechas) y apareció de
  inmediato en Actividades, visible para clientes, con "Por definir" en la fecha y sin
  categorías -- un torneo a medio armar no debe ser visible hasta que el club decida
  mostrarlo. Nueva columna `tournaments.status` (`'draft' | 'published'`, default
  `'draft'`) vía migración -- **con backfill**: los torneos que ya tenían fecha inicio y
  fin cargadas (ej. "Inauguración PickleHub") se marcaron `published` de entrada (ya
  estaban visibles, no tenía sentido esconder algo que el club ya venía mostrando); el que
  no tenía fechas (el caso real, "Copa APG") quedó en `draft` y desapareció de Actividades
  apenas se aplicó la migración, sin que el admin tuviera que tocar nada.
  - `TorneoTab` (Generalidades): tarjeta nueva arriba de todo con badge Borrador/Publicado
    + botón "Publicar torneo"/"Volver a borrador". Publicar exige fecha de inicio Y fin
    cargadas (el botón queda deshabilitado con un aviso si falta alguna) -- es la única
    validación de "información publicable" que se pidió esta vuelta; no se exigió tener
    categorías cargadas para no bloquear un "guarda la fecha" temprano.
  - `EventosTab` (Actividades): filtra a `status === "published"` para TODOS los roles,
    admin incluido -- Actividades pasó a ser "lo que está en vivo"; gestionar/completar un
    borrador es tarea de la pestaña Torneos, no de Actividades.
  - `TournamentsListTab` (la lista dentro de la pestaña Torneos): el cliente solo ve
    torneos publicados (mismo criterio que Actividades, para no dejar un hueco raro donde
    un borrador es invisible en una pantalla pero entrable desde otra); el admin sigue
    viendo TODOS, con badge "Borrador" en los que no están publicados, para poder
    encontrarlos y completarlos.
  - **Verificación**: completa en producción con Claude in Chrome, usando el propio "Copa
    APG" real del usuario (el caso que motivó el reporte) en vez de un torneo de prueba
    aparte. Confirmado: recién creado (solo nombre) no aparecía en Actividades ni filtrando
    por "Torneos"; en la lista de la pestaña Torneos sí aparecía, con badge "Borrador";
    dentro de Generalidades el botón "Publicar torneo" estaba deshabilitado con el aviso de
    fechas faltantes; al cargar fecha inicio/fin el botón se habilitó; al publicar,
    apareció de inmediato en Actividades con esas fechas. **Importante**: como se probó
    sobre el torneo real (no uno descartable), se restauraron sus datos originales al
    terminar (`status` de vuelta a `draft`, fechas de vuelta a vacías, por SQL) -- el
    usuario sigue teniendo que cargar sus fechas reales y publicarlo cuando esté listo,
    esta pasada no le dejó fechas inventadas puestas.

## Lo que falta / próximos pasos

1. **Pasada visual real del rediseño de Calendario** (v2.11.0 y v2.12.0) -- lo único que
   sigue sin probarse en el navegador; todo lo demás (multi-torneo v2.13.x, editar/borrar
   actividades v2.15.0, Borrador/Publicado v2.16.0) ya se verificó de punta a punta en vivo
   con Claude in Chrome, ver arriba. Orden sugerido: (a) el asistente de distribución de
   punta a punta; (b) "Editar manualmente" (elegir un
   partido, moverlo, candado de fijado, liberarlo); (c) que todo el layout nuevo se vea
   bien en mobile (nada de esto se midió con `getBoundingClientRect` como el resto de
   Actividades, ver el punto de UI mobile más abajo).
2. **Posible mejora futura**: el "Editar manualmente" de v2.12.0 (Calendario) es tap-origen
   → formulario de destino (día/hora/cancha por dropdown), no una grilla visual día×cancha
   arrastrable — se eligió así por scope/tiempo de esa sesión, priorizando que la validación
   de conflictos quedara sólida. Si el usuario lo prueba y prefiere una grilla real, es un
   trabajo de UI aparte (la lógica de `moveMatch`/`checkMoveConflict` ya no cambiaría).
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
