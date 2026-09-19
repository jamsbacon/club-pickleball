import React, { useState, useMemo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import {
  Trophy, Users, MapPin, Calendar, ClipboardList, Plus, Trash2,
  ChevronRight, ChevronDown, ChevronUp, Shuffle, ArrowUpDown, CheckCircle2,
  Clock, AlertTriangle, Swords, ListOrdered, Settings2, X,
  UserPlus, Pencil, Medal, Hourglass, Euro,
  CalendarClock, PartyPopper, Award, Lock, Unlock,
  Image as ImageIcon, Smartphone, Banknote, Upload, Star, Building2,
  GraduationCap, Sparkles, Check, ArrowRight, LogOut, Shield, Mail, KeyRound, BarChart3, MapPinned, ChevronLeft, Repeat, Search, UserCircle,
  RefreshCw, TrendingUp, Wallet, ShieldAlert, Bell, BellOff, Megaphone, Share2, Eye, Download, AlertCircle,
  Tag, QrCode, Copy
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import clubLogo from "./assets/pickle-hub-logo.png";

/* =========================================================================
   ID / UTILITY HELPERS
   ========================================================================= */
// v2.61.0: CRITICAL FIX -- uid() usaba un contador en memoria (`__id`) que arranca en 1 cada
// vez que se carga la página. Eso lo hacía ÚNICO solo dentro de UNA pestaña/sesión, nunca entre
// personas distintas: dos jugadores que abren la app por su cuenta y son cada uno el primero en
// crear un equipo en SU sesión terminan con el MISMO id ("team_1"). Como categories.teams vive
// como JSONB (nada de UNIQUE de base de datos que lo hubiera evitado), esto produjo IDs
// duplicados de verdad en producción -- y filter(t => t.id !== teamId)/find(t => t.id ===
// teamId) (removePersonFromCategory, resolveJoinInfo, joinTeam...) no distinguen "el" equipo de
// "los" equipos con ese id: borrar a UNA persona borraba a TODAS las que compartían id por
// accidente, y un link "invitar a mi pareja" podía resolver al equipo de OTRA persona con el
// mismo id. Así se perdieron de verdad las inscripciones de Adrián Morales y Jessica Betancourt
// en Dobles Mixto Open (colisión real en producción, torneo ACP 500) al borrar a alguien más
// que compartía su mismo id "team_1" -- y "Dobles Femenino 3.5" tenía OTRA colisión viva
// (Angelica Da Silva / Marianni Maizo) esperando el mismo accidente. Ahora usa crypto.randomUUID
// (soportado en todo navegador moderno sobre HTTPS o localhost, que es donde corre esta app) --
// con un respaldo con timestamp+random solo por si ese API no existe -- para que dos IDs jamás
// vuelvan a coincidir sin importar cuántas sesiones distintas los generen a la vez.
const uid = (p = "id") => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `${p}_${crypto.randomUUID()}`;
  return `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
};

// Estado de pago (v2.21.0) -- mismo vocabulario para bookings, open_play_registrations,
// class_registrations y equipos de torneo (categories.teams, JSONB): "por pagar" (efectivo,
// se cobra en el club), "pago por verificar" (Pago Móvil, con referencia/comprobante pero sin
// confirmar contra el banco) y "pago verificado" (el admin confirmó que el dinero llegó).
// `initialPaymentStatus` calcula el estado de arranque a partir del método elegido en
// CheckoutPanel -- efectivo nunca arranca "verificado" solo por completar el checkout, porque
// nadie del club ha visto el dinero todavía.
// `priceUsd` es opcional -- cuando el total a cobrar es $0 (100% de descuento de plan, o un
// bloque gratis de cupo mensual, v2.30.0) no hay nada que verificar, así que arranca
// "confirmada" directo sin importar el método elegido.
const initialPaymentStatus = (paymentMethod, priceUsd) =>
  (priceUsd != null && Number(priceUsd) === 0) ? "confirmada" : (paymentMethod === "movil" ? "pendiente_verificacion" : "pendiente_efectivo");
const PAYMENT_STATUS_META = {
  pendiente_efectivo: { label: "Por pagar", bg: "#EDEFF4", fg: "#6B7688" },
  pendiente_verificacion: { label: "Pago por verificar", bg: "#FBF3E4", fg: "#8A5A16" },
  confirmada: { label: "Pago verificado", bg: "#DCEBD5", fg: "#0A1830" },
};

// Notificaciones push (v2.42.0) -- pega a api/send-push.js con la sesión actual. Función de
// nivel de módulo (no vive dentro de PickleballTournamentApp) para que cualquier componente
// la pueda llamar directo, sin pasarla como prop por 5 niveles. A propósito nunca lanza: si
// el push falla (sin conexión, el usuario nunca activó notificaciones, el endpoint no está
// configurado todavía...) no debe tumbar la acción real que la disparó -- confirmar un pago,
// crear una actividad -- solo se registra en consola.
const sendPush = async (type, payload) => {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    await fetch("/api/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, ...payload }),
    });
  } catch (err) {
    console.error("sendPush:", err?.message || err);
  }
};

// Bitácora de inscripciones (v2.80.6, ver migración registration_log) -- INSERT-only, APARTE de
// categories.teams/waitlist. Nace del incidente real Nicolás Merchán/Camila Sangster: una
// inscripción de verdad desapareció de `categories` sin que nadie la borrara a mano, y no había
// ningún otro rastro de que hubiera existido más allá de una notificación push ya perdida.
// Fire-and-forget a propósito -- si esto falla (tabla sin migrar todavía, sin red) NUNCA debe
// bloquear ni hacer fallar la inscripción real, solo se pierde el respaldo extra de esa vez.
const logRegistration = async ({ tournamentId, tournamentName, categoryId, categoryName, playerNames, source }) => {
  try {
    await supabase.from("registration_log").insert({
      tournament_id: tournamentId || null, tournament_name: tournamentName || "—",
      category_id: categoryId || null, category_name: categoryName || "—",
      player_names: playerNames, source,
    });
  } catch (err) {
    console.error("logRegistration:", err?.message || err);
  }
};

// Conversión estándar de la llave pública VAPID (base64url) al Uint8Array que pide
// pushManager.subscribe -- la misma función que aparece en cualquier tutorial de Web Push.
const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
};

// Link para compartir una actividad (v2.43.0) -- `kind` es "open_play"/"clase"/"torneo", `id`
// es la clave de la serie (recurringGroupId || id) para Open Play/Clase, o el id del torneo.
// Un visitante sin cuenta que abre este link ve PublicActivityView (ver más abajo, cerca de
// AuthScreen) SIN loguearse -- solo se le pide cuenta al tocar "Inscribirme". No usa un router
// de verdad (no hace falta: query param + `window.history.replaceState` alcanza para un solo
// destino posible) -- ver el parseo de `act` y el efecto de auto-navegación en
// PickleballTournamentApp.
const shareActivityUrl = (kind, id) => `${window.location.origin}${window.location.pathname}?act=${kind}:${id}`;

// Link para invitar a tu pareja a un cupo de dobles que quedó "esperando pareja" (v2.44.2,
// reemplaza "invitar por correo/WhatsApp") -- `catId` identifica la categoría, `teamId` el
// equipo dentro de ella (ambos hacen falta: los equipos viven en categories.teams, no en su
// propia tabla). Quien abre este link ve JoinTeamView (cerca de PublicActivityView) y, si
// decide unirse, paga SU PROPIA inscripción -- nunca la de quien lo invitó.
const joinTeamUrl = (catId, teamId) => `${window.location.origin}${window.location.pathname}?join=${catId}:${teamId}`;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const teamRankSum = (team) =>
  (team.players || []).reduce((s, p) => s + (Number(p.ranking) || 0), 0);

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Standard bracket seeding order, e.g. for 8 -> [1,8,4,5,2,7,3,6]
function seedOrder(n) {
  if (n === 1) return [1];
  const prev = seedOrder(n / 2);
  const res = [];
  prev.forEach((s) => {
    res.push(s);
    res.push(n + 1 - s);
  });
  return res;
}

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(m) {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
// Display-only 12h am/pm formatter. Internal storage/comparisons always stay
// in 24h "HH:MM" / minutes-since-midnight — only render sites call this.
function minutesToAmPm(m) {
  if (m === null || m === undefined || Number.isNaN(m)) return "";
  let h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, "0");
  const period = h >= 12 ? "p.m." : "a.m.";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mm} ${period}`;
}
function formatTimeAmPm(t) {
  if (t === null || t === undefined || t === "") return "";
  return minutesToAmPm(typeof t === "number" ? t : timeToMinutes(t));
}
function dateRange(start, end) {
  const dates = [];
  if (!start || !end) return dates;
  let d = new Date(start + "T00:00:00");
  const endD = new Date(end + "T00:00:00");
  while (d <= endD) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}
// Weekday values follow Date#getDay() (0 = domingo … 6 = sábado).
const WEEKDAY_OPTIONS = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];
// An empty/undefined playDays list means "sin restricción" (todos los días del rango juegan).
function filterDatesByPlayDays(dates, playDays) {
  if (!playDays || playDays.length === 0) return dates;
  return dates.filter((iso) => playDays.includes(new Date(iso + "T00:00:00").getDay()));
}
function formatDateHuman(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const s = d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1); // "sáb." -> "Sáb." -- toLocaleDateString siempre lo da en minúscula
}
// Full "jueves, 14 de agosto" label — used where the day of week needs to stand out
// (the reservation date picker, event forms) rather than the compact abbreviated form above.
function formatDateFull(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const s = d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function weekdayLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const s = d.toLocaleDateString("es-ES", { weekday: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// A match that was decided by a walkover (one side is a permanent BYE) never gets played,
// so it shouldn't occupy a calendar slot or show up for score loading.
function isByeMatch(m) {
  return m.teamALabel === "BYE" || m.teamBLabel === "BYE";
}

// v2.75.0: buildSchedule() ya no deja partidos sin ubicar cuando se acaban las franjas dentro
// de dailyStart/dailyEnd -- en vez de eso extiende el día más allá de la hora de cierre
// configurada, para que NUNCA quede uno invisible. Esto es lo que le avisa al organizador,
// tarjeta por tarjeta en el tablero, cuáles de esos partidos cayeron fuera de la franja que se
// configuró en Generalidades -- el partido se agenda igual, pero con un aviso bien visible.
function isOvertimeMatch(m, tournament) {
  return !!(m.day && m.time && tournament?.dailyEnd && timeToMinutes(m.time) >= timeToMinutes(tournament.dailyEnd));
}

/* =========================================================================
   CLUB SCHEDULE HELPERS — turns opening hours + block length into the grid
   of bookable blocks, and builds a single "occupied" key so a block claimed
   by a booking, an Open Play, a class or a tournament match is never double-sold.
   ========================================================================= */
function generateDayBlocks(openTime, closeTime, blockMinutes) {
  const blocks = [];
  const startM = timeToMinutes(openTime || "07:00"), endM = timeToMinutes(closeTime || "22:00");
  const step = Number(blockMinutes) || 60;
  let t = startM;
  while (t + step <= endM) { blocks.push(t); t += step; }
  return blocks;
}
function blockKey(courtId, date, timeMin) { return `${courtId}|${date}|${timeMin}`; }

// Semanal, desde `startDate` hasta `until` inclusive (o solo `startDate` si no hay `until`) --
// compartido entre addOpenPlay/addClass (arman la serie real al guardar) y OpenPlayForm/
// ClaseForm (necesitan las mismas fechas para poder avisar de conflictos ANTES de guardar,
// v2.24.0) para que nunca puedan desincronizarse en qué fechas caen.
function expandWeeklyDates(startDate, until) {
  if (!startDate) return [];
  if (!until || until < startDate) return [startDate];
  const out = [];
  let d = new Date(startDate + "T00:00:00");
  const end = new Date(until + "T00:00:00");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 7); }
  return out;
}

// Bloques que un Open Play/Clase con estas canchas/fechas/horario reclamaría, cruzados contra
// `occupiedKeys` -- usado por OpenPlayForm/ClaseForm para avisar y bloquear el guardado ANTES
// de que dos actividades distintas terminen reclamando la misma cancha/fecha/hora (v2.24.0).
// `ignoreKeys` excluye los bloques que ya pertenecen a la propia actividad que se está
// editando, para no marcarla como "en conflicto consigo misma".
function findBlockConflicts(club, courtIds, dates, startTime, endTime, occupiedKeys, ignoreKeys) {
  if (!club || !courtIds?.length || !dates?.length || !startTime || !endTime || startTime >= endTime) return [];
  const blocks = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes)
    .filter((t) => t >= timeToMinutes(startTime) && t < timeToMinutes(endTime));
  const conflicts = [];
  dates.forEach((date) => {
    courtIds.forEach((courtId) => {
      blocks.forEach((timeMin) => {
        const key = blockKey(courtId, date, timeMin);
        if (occupiedKeys.has(key) && !ignoreKeys?.has(key)) conflicts.push({ courtId, date, timeMin });
      });
    });
  });
  return conflicts;
}

// Texto legible para la ventana de reserva de un plan (v2.27.0) -- horas exactas si no arman
// días completos, "N día(s)" si sí. Un solo lugar para formatear evita que la tabla
// comparativa/cards y cualquier mensaje de "fuera de tu ventana" digan cosas distintas.
function formatBookingWindow(hours) {
  const h = Number(hours) || 0;
  if (h <= 0) return "Sin límite";
  if (h % 24 === 0) { const d = h / 24; return `${d} día${d === 1 ? "" : "s"}`; }
  return `${h} hora${h === 1 ? "" : "s"}`;
}

function formatMoney(n, symbol = "€") {
  const v = Number(n) || 0;
  return `${symbol}${v.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Member pricing lives as a flat price on the item itself (court / open play / class),
// not as a percentage on the membership plan — different items can have very different
// member savings. CheckoutPanel still speaks baseUsd+discountPct, so this derives an
// equivalent rounded percentage from the two flat prices at the call site.
function memberDiscountPct(base, memberPrice) {
  const b = Number(base) || 0;
  if (b <= 0) return 0;
  const m = memberPrice === undefined || memberPrice === null || memberPrice === "" ? b : Number(memberPrice) || 0;
  return Math.max(0, Math.round((1 - m / b) * 100));
}

// Precio con descuento de un ítem del tarifario de un plan pago, calculado en caliente contra
// lo que YA cobra "Sin plan" por ese mismo concepto (v2.38.0) -- generaliza el mismo criterio
// que courtDiscountPct/openPlayDiscountPct (v2.30.0, un % en el plan aplicado sobre un precio
// base ajeno) a la lista libre de conceptos del tarifario ("Precio Liga Propia", etc.), que
// antes guardaba un valor tipeado a mano por plan, sin ninguna conexión entre ellos. Devuelve
// null si no hay de dónde calcularlo (el plan base no tiene ese concepto todavía).
function rateItemDiscountedPrice(discountPct, basePriceUsd) {
  if (basePriceUsd == null) return null;
  return Number(basePriceUsd) * (1 - (Number(discountPct) || 0) / 100);
}

// Texto a mostrar para el concepto `label` de un plan cualquiera. El plan base (Sin plan,
// monthlyPrice === 0) muestra su propio precio tal cual -- es la fuente de verdad. Cualquier
// otro plan muestra el % de descuento JUNTO con el monto resultante ("38% off → $4.96", v2.38.2
// -- antes solo mostraba el monto final y el socio tenía que adivinar de dónde salía), para que
// no haga falta calcular nada a mano. Recalculado del precio ACTUAL de `basePlan` -- si mañana
// cambia el precio base, esto se actualiza solo, sin tener que volver a tipear nada en cada
// plan pago.
function rateItemDisplay(plan, label, basePlan) {
  if (!plan) return "—";
  if (plan.monthlyPrice === 0) {
    const item = plan.rateCard?.find((r) => r.label === label);
    return item?.priceUsd != null ? formatMoney(item.priceUsd) : "—";
  }
  const item = plan.rateCard?.find((r) => r.label === label);
  const baseItem = basePlan?.rateCard?.find((r) => r.label === label);
  const discounted = item ? rateItemDiscountedPrice(item.discountPct, baseItem?.priceUsd) : null;
  if (discounted == null) return "—";
  const pct = Number(item.discountPct) || 0;
  if (pct <= 0) return formatMoney(discounted);
  return discounted <= 0 ? "100% (Gratis)" : `${pct}% off → ${formatMoney(discounted)}`;
}

// Precio de reserva de UNA cancha real (courts.price_per_block -- la fuente de verdad de
// Mi Club → Canchas, nunca un número aparte tipeado en el plan) según el plan: Sin plan
// muestra el precio real de esa cancha; cualquier plan pago muestra el % de descuento que YA
// aplica de verdad en el checkout (plan.courtDiscountPct) junto al monto resultante -- mismo
// formato "% off → $" que rateItemDisplay, pero para canchas reales en vez del tarifario libre
// (v2.38.2, reemplaza la fila única "Descuento en canchas*" por una fila POR cancha, a pedido
// del club: "el plan base debe mostrar el precio de cada cancha").
function courtRowDisplay(plan, court) {
  if (!plan) return "—";
  const base = Number(court.pricePerBlock) || 0;
  if (plan.monthlyPrice === 0) return formatMoney(base);
  const pct = plan.courtDiscountPct || 0;
  if (pct <= 0) return formatMoney(base);
  const discounted = base * (1 - pct / 100);
  return discounted <= 0 ? "100% (Gratis)" : `${pct}% off → ${formatMoney(discounted)}`;
}

// Precio MARGINAL de agregar la categoría #`tier` al carrito (tier 3 cubre la 3ra Y cualquier
// categoría después de esa, ver tournamentRegPrice -- no hay un cuarto nivel). Presale gana
// mientras hoy caiga dentro de [presaleStart, presaleEnd] (y esté cargado); si no, cae al
// precio regular de ese mismo nivel -- un solo carrito no puede pagar parte en presale y parte
// a precio regular.
function tournamentTierPrice(tournament, tier) {
  const today = new Date().toISOString().slice(0, 10);
  const inPresale = tournament.presaleStart && tournament.presaleEnd && today >= tournament.presaleStart && today <= tournament.presaleEnd;
  const presale = Number(tournament[`presalePrice${tier}`]) || 0;
  if (inPresale && presale > 0) return presale;
  return Number(tournament[`regularPrice${tier}`]) || 0;
}

// Precio TOTAL por inscribirse en `catCount` categorías de una, en el mismo carrito (v2.44.1):
// solo dos niveles -- price1 = precio de la 1ra categoría, price2 = "categoría adicional",
// el mismo monto se suma por CADA categoría después de la 1ra (2da, 3ra, 4ta... todas al mismo
// precio marginal, sin un tercer nivel que las cubra distinto). El total se arma:
// 1 categoría = price1, n categorías = price1 + price2*(n-1).
// Ejemplo pedido por el club: price1=$30, price2=$15 -> 3 categorías = 30+15+15 = $60.
// Esta función sola NO acumula entre inscripciones separadas en momentos distintos -- un
// carrito que arranca de cero siempre paga su propio nivel 1. La acumulación real (si la
// persona ya venía inscrita en categorías de un checkout ANTERIOR) la resuelve
// tournamentRegPriceFrom, justo debajo, apoyándose en esta misma función.
// (v2.32.0-v2.44.0 tuvieron un 3er nivel, "price3", que cubría la 3ra categoría en adelante a un
// precio propio -- se colapsó en uno solo porque en la práctica nunca hacía falta un precio
// DISTINTO para la 3ra vs. la 2da adicional; las columnas presale_price_3/regular_price_3
// siguen en la base por compatibilidad pero ya no se leen ni se muestran.)
function tournamentRegPrice(tournament, catCount) {
  const n = Math.max(1, Number(catCount) || 1);
  return tournamentTierPrice(tournament, 1) + tournamentTierPrice(tournament, 2) * (n - 1);
}

// Precio TOTAL de agregar `newCount` categorías más en un carrito NUEVO, cuando la persona ya
// está inscrita (de un checkout anterior y separado) en `alreadyCount` categorías de este mismo
// torneo (v2.56.0). Antes cada carrito arrancaba su propio nivel 1 sin memoria de checkouts
// pasados (ver nota arriba) -- a pedido del club, si ya pagó su 1ra categoría en algún momento,
// este carrito nuevo debe arrancar directo en precio de "categoría adicional" para TODO lo que
// agregue ahora, en vez de volver a cobrar el precio de 1ra categoría. Se calcula como la
// diferencia entre el total acumulado hasta (alreadyCount+newCount) y el acumulado hasta
// alreadyCount, reusando tournamentRegPrice para no duplicar la lógica de tiers -- con
// alreadyCount=0 da exactamente lo mismo que tournamentRegPrice(tournament, newCount) de
// siempre (upTo(0) = 0).
function tournamentRegPriceFrom(tournament, alreadyCount, newCount) {
  const n = Math.max(0, Number(newCount) || 0);
  if (n === 0) return 0;
  const already = Math.max(0, Number(alreadyCount) || 0);
  const upTo = (count) => (count <= 0 ? 0 : tournamentRegPrice(tournament, count));
  return upTo(already + n) - upTo(already);
}

// Cuántas categorías de ESTE torneo tiene ya un jugador (teams o waitlist -- la lista de espera
// también pagó al inscribirse, ver InscripcionTab) -- usado para que un checkout nuevo sepa
// desde qué nivel de tournamentRegPriceFrom debe arrancar. `excludeCatId` opcional para no
// contar la categoría que se está por unir en el mismo flujo (ver JoinTeamModal).
function countRegisteredCategories(categories, tournamentId, identity, excludeCatId) {
  return categories.filter((c) => {
    if (c.tournamentId !== tournamentId) return false;
    if (excludeCatId && c.id === excludeCatId) return false;
    return [...(c.teams || []), ...(c.waitlist || [])].some((t) =>
      (t.players || []).some((p) => (identity.userId ? p.userId === identity.userId : p.name.trim().toLowerCase() === identity.name.trim().toLowerCase())));
  }).length;
}

// Capacidad real de una categoría, en JUGADORES -- no en filas de `teams` (v2.57.0). En
// individual cada fila es 1 jugador, así que maxTeams ya era la capacidad real. En DOBLES cada
// fila es una DUPLA de hasta 2 jugadores, y desde v2.51.0 una dupla puede arrancar con un solo
// jugador "esperando pareja" (ver InscripcionTab) -- antes de este fix, el cupo se comparaba
// contra la cantidad de FILAS, así que 16 personas anotándose solas (sin pareja todavía) ya
// llenaban las 16 filas y mandaban a la 17ma persona a lista de espera, cuando "16 duplas" para
// el club significa 32 jugadores. Devuelve null si la categoría no tiene límite (maxTeams vacío).
function categoryMaxPlayers(cat) {
  if (!cat.maxTeams) return null;
  return cat.modality === "individual" ? cat.maxTeams : cat.maxTeams * 2;
}

// Cuántos jugadores hay de verdad anotados en una lista de filas (`teams` o `waitlist` -- cada
// fila puede tener 1 o 2 jugadores si es una dupla que sigue esperando pareja).
function countCategoryPlayers(teams) {
  return (teams || []).reduce((sum, t) => sum + (t.players || []).length, 0);
}

// Si una categoría ya llegó a su cupo real (en jugadores, ver categoryMaxPlayers arriba) -- el
// punto en el que un addTeam nuevo debe caer en lista de espera en vez del roster principal.
function categoryIsFull(cat) {
  const capacity = categoryMaxPlayers(cat);
  return capacity !== null && countCategoryPlayers(cat.teams) >= capacity;
}

// Cuántas filas de `teams` son duplas de verdad COMPLETAS (2 jugadores) -- v2.67.0, separado de
// countCategoryPlayers/categoryCountLabel porque llamar "1 dupla" a una fila con un solo
// jugador esperando pareja es literalmente falso: todavía no hay dupla, hay una persona sola.
// Usado donde hace falta distinguir "cuántas parejas ya se formaron" de "cuántas filas hay"
// (que puede incluir gente esperando pareja, ver joinTeam/InscripcionTab).
function countCompleteDuplas(teams) {
  return (teams || []).filter((t) => (t.players || []).length === 2).length;
}

// Texto legible de cuántos hay anotados en una categoría, en la unidad correcta según
// modalidad -- "X/Y jugadores" en individual (1 fila = 1 persona); en dobles, "X/Y jugadores
// (N duplas formadas)" -- v2.67.0, antes decía "X duplas (Y/Z jugadores)" contando FILAS como
// si cada una fuera ya una dupla completa (ver countCompleteDuplas arriba para el porqué eso
// era incorrecto: una fila puede tener 1 solo jugador esperando pareja). Reemplaza los "X/Y
// equipos" repetidos por toda la pantalla de inscripción/roster que asumían 1 fila = 1 persona.
function categoryCountLabel(cat) {
  const players = countCategoryPlayers(cat.teams);
  const maxPlayers = categoryMaxPlayers(cat);
  if (cat.modality === "individual") {
    return `${players}${maxPlayers ? `/${maxPlayers}` : ""} jugador${players === 1 ? "" : "es"}`;
  }
  const duplas = countCompleteDuplas(cat.teams);
  return `${players}${maxPlayers ? `/${maxPlayers}` : ""} jugador${players === 1 ? "" : "es"} (${duplas} dupla${duplas === 1 ? "" : "s"} formada${duplas === 1 ? "" : "s"})`;
}

// Resolves a court's BASE price for a given time-of-day, honoring an optional list of
// time-window overrides (peak/off-peak pricing) before falling back to the court's base price.
// Used to just return {base, member} -- member pricing moved to the membership plan's own
// courtDiscountPct (v2.30.0, see ReservasTab), applied uniformly on top of whatever this
// returns instead of a flat per-court/per-rule override that could drift from the plan.
function courtPriceInfo(court, timeMin) {
  const rule = (court.priceRules || []).find((r) => timeMin >= timeToMinutes(r.startTime) && timeMin < timeToMinutes(r.endTime));
  return Number(rule ? rule.price : court.pricePerBlock) || 0;
}

// Redimensiona una imagen a un máximo de MAX_IMAGE_DIM px y la recomprime a JPEG ~75% vía
// canvas.toBlob() -- a propósito no usa toDataURL()/FileReader.readAsDataURL: pasar por un
// string base64 (y luego fetch(dataURL) para reconvertirlo a Blob al subir) es frágil y lento
// en varios navegadores para archivos de cientos de KB, y es justo lo que hacía que cargar una
// imagen "tardara" (ver nota en addOpenPlay). Devuelve una promesa con el Blob liviano listo
// para subir a Supabase Storage -- usado por OpenPlayForm y por el flyer de Torneo.
const MAX_IMAGE_DIM = 1280;
function resizeImageToBlob(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale) || 1;
      const h = Math.round(img.height * scale) || 1;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("No se pudo procesar esa imagen -- prueba con otro archivo."));
        else resolve(blob);
      }, "image/jpeg", 0.75);
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("No se pudo leer esa imagen -- prueba con otro archivo.")); };
    img.src = objectUrl;
  });
}

// Resiliencia sin internet para el día de un torneo (v2.34.0): antes, si el organizador
// registraba resultados o movía partidos justo cuando se iba el internet, el guardado en
// Supabase fallaba en silencio (solo console.error, sin aviso ni reintento) y se perdía para
// siempre. Y si además se cerraba/refrescaba la pestaña en medio del apagón, hasta el
// calendario/categorías que sí se veían en pantalla desaparecían, porque nada quedaba guardado
// localmente -- la app queda en blanco hasta que vuelva la señal. Estos dos helpers guardan un
// snapshot en localStorage (club, canchas, torneos, categorías y la cola de cambios
// pendientes) para que reabrir la app durante un apagón siga mostrando el torneo tal como
// quedó, en vez de una pantalla vacía. Alcance a propósito: solo Torneo -- Reservas y el resto
// de la app no pasan por acá.
const LS_PREFIX = "pickle-hub-cache:";
function loadCache(key, fallback) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveCache(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch { /* storage lleno o bloqueado -- no es crítico, se sigue funcionando en memoria */ }
}

/* =========================================================================
   ANALYTICS HELPERS — unify every source of revenue (reservas, open plays,
   clases, membresías) into one transaction list, then aggregate it by day,
   month and hour-of-day for the admin dashboard.
   ========================================================================= */
function buildTransactions(bookings, openPlays, classes, subscriptions) {
  const list = [];
  bookings.filter((b) => b.status !== "cancelada").forEach((b) => list.push({ ts: b.createdAt, usd: b.priceUsd || 0, type: "Reservas", timeMin: b.timeMin }));
  openPlays.forEach((e) => e.registrations.forEach((r) => list.push({ ts: r.createdAt, usd: r.priceUsd || 0, type: "Open Plays" })));
  classes.forEach((e) => e.registrations.forEach((r) => list.push({ ts: r.createdAt, usd: r.priceUsd || 0, type: "Clases" })));
  subscriptions.forEach((s) => list.push({ ts: s.createdAt, usd: s.priceUsd || 0, type: "Membresías" }));
  return list;
}

// Every paid, attendance-worthy activity (booking, Open Play, class, tournament team) resolved
// to a specific registered client — the basis for the "Clientes más leales" leaderboard.
// Membership fees are deliberately left out: they're a subscription, not attendance.
// Resolution prefers the userId stamped at checkout (see ReservasTab/EventDetail/ClassDetail/
// InscripcionTab confirm handlers); it falls back to a name match for older/admin-entered
// records that predate userId tracking, and drops anything that matches no known client.
function buildClientActivity(bookings, openPlays, classes, categories, users) {
  const byId = {}; users.forEach((u) => { byId[u.id] = u; });
  const byName = {}; users.forEach((u) => { byName[u.name.trim().toLowerCase()] = u; });
  const resolve = (userId, userName) => {
    if (userId && byId[userId]) return byId[userId];
    if (userName) return byName[userName.trim().toLowerCase()] || null;
    return null;
  };

  const entries = [];
  bookings.filter((b) => b.status !== "cancelada").forEach((b) => {
    const client = resolve(b.userId, b.userName);
    if (client) entries.push({ client, usd: Number(b.priceUsd) || 0, ts: b.createdAt, kind: "Reserva de cancha" });
  });
  openPlays.forEach((e) => e.registrations.forEach((r) => {
    const client = resolve(r.userId, r.userName);
    if (client) entries.push({ client, usd: Number(r.priceUsd) || 0, ts: r.createdAt, kind: "Open Play" });
  }));
  classes.forEach((e) => e.registrations.forEach((r) => {
    const client = resolve(r.userId, r.userName);
    if (client) entries.push({ client, usd: Number(r.priceUsd) || 0, ts: r.createdAt, kind: "Clase" });
  }));
  categories.forEach((c) => {
    [...c.teams, ...c.waitlist].forEach((t) => {
      if (t.priceUsd !== undefined) {
        const client = resolve(t.userId, null);
        if (client) entries.push({ client, usd: Number(t.priceUsd) || 0, ts: t.createdAt, kind: "Torneo" });
      }
      // Un jugador que se unió a un equipo ya creado (ver joinTeam, v2.44.2) pagó SU PROPIA
      // inscripción por separado -- queda en su propio objeto de jugador, no en `t.priceUsd`
      // (eso sigue siendo solo lo que pagó quien creó el equipo). Sin esto, su pago quedaría
      // invisible para "Clientes más leales" pese a haber pagado de verdad.
      (t.players || []).forEach((p) => {
        if (p.priceUsd === undefined) return;
        const client = resolve(p.userId, null);
        if (client) entries.push({ client, usd: Number(p.priceUsd) || 0, ts: p.joinedAt || t.createdAt, kind: "Torneo" });
      });
    });
  });
  return entries;
}

function filterActivityByPeriod(entries, period) {
  if (period === "all") return entries;
  const now = new Date();
  return entries.filter((e) => {
    if (!e.ts) return false;
    const d = new Date(e.ts);
    if (period === "day") return d.toDateString() === now.toDateString();
    if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === "year") return d.getFullYear() === now.getFullYear();
    return true;
  });
}

// Ranks by activity count first (loyalty ~ how often they show up), spend as the tiebreaker.
function rankClientsByActivity(entries) {
  const byClientId = new Map();
  entries.forEach((e) => {
    const row = byClientId.get(e.client.id) || { client: e.client, usd: 0, count: 0 };
    row.usd += e.usd;
    row.count += 1;
    byClientId.set(e.client.id, row);
  });
  return [...byClientId.values()].sort((a, b) => b.count - a.count || b.usd - a.usd);
}

function groupByDay(transactions, days = 14) {
  const map = {};
  transactions.forEach((t) => { const d = new Date(t.ts).toISOString().slice(0, 10); map[d] = (map[d] || 0) + t.usd; });
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    out.push({ label: d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }), value: map[iso] || 0 });
  }
  return out;
}

function groupByMonth(transactions, months = 6) {
  const map = {};
  transactions.forEach((t) => {
    const d = new Date(t.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map[key] = (map[key] || 0) + t.usd;
  });
  const out = [];
  const today = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ label: d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" }), value: map[key] || 0 });
  }
  return out;
}

function groupByHour(bookings, club) {
  const blocks = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes);
  const counts = {};
  bookings.filter((b) => b.status !== "cancelada").forEach((b) => { counts[b.timeMin] = (counts[b.timeMin] || 0) + 1; });
  return blocks.map((t) => ({ label: minutesToAmPm(t), value: counts[t] || 0 }));
}

// De dónde sale la plata: reservas vs. Open Plays vs. clases vs. membresías. Antes "Ingresos
// totales" era un solo número sin desglose -- el admin no podía saber si venía de reservas
// puntuales o de membresías recurrentes sin ir a revisar cada sección por separado.
function groupByType(transactions) {
  const map = {};
  transactions.forEach((t) => { map[t.type] = (map[t.type] || 0) + t.usd; });
  return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function groupByZone(users) {
  const map = {};
  users.filter((u) => u.role === "cliente").forEach((u) => {
    const z = (u.zone || "").trim() || "Sin especificar";
    map[z] = (map[z] || 0) + 1;
  });
  return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

// Un socio de plan pago cuenta como vigente solo si su plan no venció -- antes cualquier perfil
// con planId apuntando a un plan pago contaba como "activo" para siempre, incluso con
// planExpiresAt ya pasado hace meses (esto es justo lo que hacía "desconfiables" las
// estadísticas: un socio que dejó de pagar seguía sumando a Membresías activas/MRR
// indefinidamente). Mismo criterio que ya usaban ProfileTab/MembresiasTab para mostrar
// "Vencida", ahora centralizado acá para que Estadísticas, Usuarios y el MRR usen la misma
// regla. Un plan sin planExpiresAt (viejo, de antes de v2.27.0, o el plan gratuito) se
// considera vigente -- no vence.
function isActiveMember(user, plan, todayIso) {
  if (!plan || !(plan.monthlyPrice > 0)) return false;
  if (!user.planExpiresAt) return true;
  return user.planExpiresAt >= todayIso;
}

function groupByPlan(users, membershipPlans, todayIso) {
  const byId = {}; membershipPlans.forEach((p) => { byId[p.id] = p; });
  const map = {};
  users.filter((u) => u.role === "cliente" && isActiveMember(u, byId[u.planId], todayIso)).forEach((u) => { map[u.planId] = (map[u.planId] || 0) + 1; });
  return membershipPlans.filter((p) => p.monthlyPrice > 0).map((p) => ({ label: p.name, value: map[p.id] || 0 }));
}

// MRR (ingreso mensual recurrente): suma el monthlyPrice de cada socio con plan pago vigente
// -- a diferencia de "Ingresos totales" (histórico, un evento por cada alta/renovación real en
// la tabla subscriptions), este número se calcula del ESTADO ACTUAL de cada perfil, así que
// sigue siendo correcto incluso si a alguien se le activó el plan a mano (o por cualquier vía
// que no haya dejado un registro en subscriptions) -- no depende de que exista ese historial.
function computeMRR(users, membershipPlans, todayIso) {
  const byId = {}; membershipPlans.forEach((p) => { byId[p.id] = p; });
  return users.filter((u) => u.role === "cliente").reduce((sum, u) => {
    const plan = byId[u.planId];
    return isActiveMember(u, plan, todayIso) ? sum + plan.monthlyPrice : sum;
  }, 0);
}

// Riesgo de cancelación: socios con plan pago ya vencido (perdieron el beneficio pero el admin
// puede no haberse dado cuenta -- ya no suman al MRR de arriba) o por vencer dentro de
// `withinDays`. Ordenado por urgencia: primero los ya vencidos (más tiempo vencido primero),
// luego los que están por vencer, del más próximo al más lejano.
function membershipRisk(users, membershipPlans, todayIso, withinDays = 7) {
  const byId = {}; membershipPlans.forEach((p) => { byId[p.id] = p; });
  const cutoff = new Date(todayIso + "T00:00:00"); cutoff.setDate(cutoff.getDate() + withinDays);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  return users
    .filter((u) => u.role === "cliente" && u.planId)
    .map((u) => ({ user: u, plan: byId[u.planId] }))
    .filter(({ plan }) => plan && plan.monthlyPrice > 0)
    .filter(({ user }) => user.planExpiresAt && user.planExpiresAt <= cutoffIso)
    .map(({ user, plan }) => ({ user, plan, expired: user.planExpiresAt < todayIso }))
    .sort((a, b) => (a.user.planExpiresAt || "").localeCompare(b.user.planExpiresAt || ""));
}

/* =========================================================================
   GROUP DISTRIBUTION — auto-calculates number/size of groups and how many
   qualifiers each group must produce so the elimination bracket ends up
   with exactly the size the organizer requested.
   ========================================================================= */
function computeGroupDistribution(numTeams, desiredBracketSize) {
  const Q = Math.min(desiredBracketSize, numTeams);
  let best = null;
  for (let G = 1; G <= Q; G++) {
    const baseSize = Math.floor(numTeams / G);
    const extraSize = numTeams % G;
    if (baseSize < 2 && !(baseSize === 1 && extraSize > 0)) continue; // group too small
    const baseQ = Math.floor(Q / G);
    const extraQ = Q % G;
    if (baseQ < 1) continue;
    if (baseSize < baseQ) continue; // can't qualify more teams than are in the group
    const avgSize = numTeams / G;
    const sizeScore = Math.abs(avgSize - 4.2); // prefer ~4 teams/group
    const groupCountScore = Math.abs(G - Q / Math.max(1, Math.round(Q / G || 1))) * 0.01;
    const score = sizeScore + groupCountScore;
    if (!best || score < best.score) {
      best = { G, baseSize, extraSize, baseQ, extraQ, score };
    }
  }
  if (!best) {
    return [{ size: numTeams, qualifiers: Math.min(numTeams, Q) }];
  }
  const groups = [];
  for (let i = 0; i < best.G; i++) {
    groups.push({
      size: best.baseSize + (i < best.extraSize ? 1 : 0),
      qualifiers: best.baseQ + (i < best.extraQ ? 1 : 0),
    });
  }
  return groups;
}

function distributeTeamsToGroups(teams, groupsMeta, mode) {
  const ordered =
    mode === "ranking"
      ? [...teams].sort((a, b) => teamRankSum(b) - teamRankSum(a))
      : shuffle(teams);
  const groups = groupsMeta.map((g, i) => ({
    id: uid("grp"),
    name: `Grupo ${String.fromCharCode(65 + i)}`,
    size: g.size,
    qualifiers: g.qualifiers,
    teamIds: [],
  }));
  let gi = 0;
  for (const team of ordered) {
    let tries = 0;
    while (groups[gi].teamIds.length >= groups[gi].size && tries < groups.length) {
      gi = (gi + 1) % groups.length;
      tries++;
    }
    groups[gi].teamIds.push(team.id);
    gi = (gi + 1) % groups.length;
  }
  return groups;
}

/* Round robin (circle method). Returns array of rounds, each an array of [idA, idB]. */
function roundRobinPairs(teamIds) {
  const ids = [...teamIds];
  if (ids.length < 2) return [];
  if (ids.length % 2 !== 0) ids.push(null); // bye
  const n = ids.length;
  const rounds = [];
  let arr = [...ids];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a !== null && b !== null) pairs.push([a, b]);
    }
    rounds.push(pairs);
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed, ...rest];
  }
  return rounds;
}

/* =========================================================================
   BRACKET BUILDING
   ========================================================================= */
// Pure knockout directly from a team list (format "eliminatoria")
function buildDirectBracket(categoryId, teams, seedMode) {
  const ordered =
    seedMode === "ranking"
      ? [...teams].sort((a, b) => teamRankSum(b) - teamRankSum(a))
      : shuffle(teams);
  const size = nextPow2(ordered.length);
  const order = seedOrder(size);
  const slots = new Array(size).fill(null);
  order.forEach((seed, idx) => {
    slots[idx] = ordered[seed - 1] || null; // null = BYE
  });
  const round1 = [];
  for (let i = 0; i < size; i += 2) {
    const a = slots[i], b = slots[i + 1];
    round1.push({
      id: uid("m"),
      categoryId,
      phase: "bracket",
      round: 1,
      teamAId: a ? a.id : null,
      teamBId: b ? b.id : null,
      teamALabel: a ? a.name : "BYE",
      teamBLabel: b ? b.name : "BYE",
      sets: [],
      winnerId: a && !b ? a.id : !a && b ? b.id : null,
      nextMatchId: null,
      nextSlot: null,
      day: null, time: null, courtId: null,
    });
  }
  return finishBracketRounds(round1);
}

// Bracket seeded from group qualifiers (format "grupos_eliminatoria")
function buildQualifierBracket(categoryId, groups, bracketSize) {
  const maxQ = Math.max(...groups.map((g) => g.qualifiers));
  const qualList = [];
  for (let rank = 1; rank <= maxQ; rank++) {
    groups.forEach((g) => {
      if (rank <= g.qualifiers) qualList.push({ groupId: g.id, groupName: g.name, rank });
    });
  }
  const order = seedOrder(bracketSize);
  const slots = new Array(bracketSize);
  order.forEach((seed, idx) => {
    slots[idx] = qualList[seed - 1];
  });
  const round1 = [];
  for (let i = 0; i < bracketSize; i += 2) {
    const sA = slots[i], sB = slots[i + 1];
    round1.push({
      id: uid("m"),
      categoryId,
      phase: "bracket",
      round: 1,
      teamAId: null,
      teamBId: null,
      teamASrc: sA,
      teamBSrc: sB,
      teamALabel: `${sA.rank}° ${sA.groupName}`,
      teamBLabel: `${sB.rank}° ${sB.groupName}`,
      sets: [],
      winnerId: null,
      nextMatchId: null,
      nextSlot: null,
      day: null, time: null, courtId: null,
    });
  }
  return finishBracketRounds(round1);
}

function finishBracketRounds(round1) {
  const rounds = [round1];
  let prev = round1;
  let roundNum = 2;
  while (prev.length > 1) {
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      const mid = uid("m");
      next.push({
        id: mid,
        categoryId: prev[i].categoryId,
        phase: "bracket",
        round: roundNum,
        teamAId: null,
        teamBId: null,
        teamASrc: { type: "winner", matchId: prev[i].id },
        teamBSrc: { type: "winner", matchId: prev[i + 1].id },
        teamALabel: "Por definir",
        teamBLabel: "Por definir",
        sets: [],
        winnerId: null,
        nextMatchId: null,
        nextSlot: null,
        day: null, time: null, courtId: null,
      });
      prev[i].nextMatchId = mid; prev[i].nextSlot = "A";
      prev[i + 1].nextMatchId = mid; prev[i + 1].nextSlot = "B";
    }
    rounds.push(next);
    prev = next;
    roundNum++;
  }
  const flat = rounds.flat();
  // resolve immediate byes (a team with no opponent already has winnerId set)
  propagateWinner(flat, null);
  return flat;
}

function propagateWinner(allMatches, justResolvedId) {
  let changed = true;
  while (changed) {
    changed = false;
    allMatches.forEach((m) => {
      if (m.winnerId) {
        const loserId = m.winnerId === m.teamAId ? m.teamBId : m.teamAId;
        const winnerLabel = m.winnerId === m.teamAId ? m.teamALabel : m.teamBLabel;
        const loserLabel = m.winnerId === m.teamAId ? m.teamBLabel : m.teamALabel;

        if (m.nextMatchId) {
          const nm = allMatches.find((x) => x.id === m.nextMatchId);
          if (nm) {
            if (m.nextSlot === "A" && nm.teamAId !== m.winnerId) { nm.teamAId = m.winnerId; nm.teamALabel = winnerLabel; changed = true; }
            if (m.nextSlot === "B" && nm.teamBId !== m.winnerId) { nm.teamBId = m.winnerId; nm.teamBLabel = winnerLabel; changed = true; }
          }
        }
        // losers drop into the losers bracket (double elimination only)
        if (m.loserNextMatchId) {
          const nm = allMatches.find((x) => x.id === m.loserNextMatchId);
          if (nm) {
            if (loserId) {
              if (m.loserNextSlot === "A" && nm.teamAId !== loserId) { nm.teamAId = loserId; nm.teamALabel = loserLabel; changed = true; }
              if (m.loserNextSlot === "B" && nm.teamBId !== loserId) { nm.teamBId = loserId; nm.teamBLabel = loserLabel; changed = true; }
            } else {
              // the feeding match was itself a walkover (BYE) — there is no real loser, so this slot is a BYE too
              if (m.loserNextSlot === "A" && nm.teamALabel !== "BYE" && !nm.teamAId) { nm.teamALabel = "BYE"; changed = true; }
              if (m.loserNextSlot === "B" && nm.teamBLabel !== "BYE" && !nm.teamBId) { nm.teamBLabel = "BYE"; changed = true; }
            }
          }
        }
      }
      // auto-resolve a walkover if the other slot is a permanent BYE
      if (m.teamALabel === "BYE" && m.teamBId && !m.winnerId) { m.winnerId = m.teamBId; changed = true; }
      if (m.teamBLabel === "BYE" && m.teamAId && !m.winnerId) { m.winnerId = m.teamAId; changed = true; }
    });
  }
}

function makeBracketMatch(categoryId, phase, round, seq, teamAId, teamBId, teamALabel, teamBLabel) {
  return {
    id: uid("m"), categoryId, phase, round, seq,
    teamAId: teamAId || null, teamBId: teamBId || null,
    teamALabel, teamBLabel,
    sets: [], winnerId: null,
    nextMatchId: null, nextSlot: null,
    loserNextMatchId: null, loserNextSlot: null,
    day: null, time: null, courtId: null,
  };
}
function wireWinner(from, to, slot) { from.nextMatchId = to.id; from.nextSlot = slot; }
function wireLoser(from, to, slot) { from.loserNextMatchId = to.id; from.loserNextSlot = slot; }

/* Double elimination — Llave A (ganadores) es la única vía al título: solo un
   equipo invicto en la Llave A puede ser campeón. Cada equipo que pierde en la
   Llave A cae a la Llave B (repechaje), que juega únicamente para definir el
   3er lugar; quien pierde en la Llave B queda eliminado del todo. */
function buildDoubleElimination(categoryId, teams, seedMode) {
  const ordered = seedMode === "ranking" ? [...teams].sort((a, b) => teamRankSum(b) - teamRankSum(a)) : shuffle(teams);
  const size = nextPow2(ordered.length);
  const order = seedOrder(size);
  const slotsArr = new Array(size).fill(null);
  order.forEach((seed, idx) => { slotsArr[idx] = ordered[seed - 1] || null; });
  const k = Math.log2(size);

  let seq = 1;
  const round0 = [];
  for (let i = 0; i < size; i += 2) {
    const a = slotsArr[i], b = slotsArr[i + 1];
    round0.push(makeBracketMatch(categoryId, "bracket_wr", 1, seq,
      a ? a.id : null, b ? b.id : null, a ? a.name : "BYE", b ? b.name : "BYE"));
  }
  round0.forEach((m) => {
    if (m.teamAId && !m.teamBId) m.winnerId = m.teamAId;
    if (m.teamBId && !m.teamAId) m.winnerId = m.teamBId;
  });

  if (k === 1) {
    round0[0].isFinalMatch = true;
    return round0;
  }

  seq++;
  const wr = [round0];
  const lbAll = [];

  const lb1 = [];
  for (let i = 0; i < round0.length; i += 2) {
    const m = makeBracketMatch(categoryId, "bracket_lb", 1, seq, null, null, "Por definir", "Por definir");
    wireLoser(round0[i], m, "A");
    wireLoser(round0[i + 1], m, "B");
    lb1.push(m);
  }
  lbAll.push(lb1);
  seq++;
  let prevSurvivors = lb1;
  let lbRoundNum = 2;

  for (let r = 2; r <= k - 1; r++) {
    const prevWR = wr[wr.length - 1];
    const wrRound = [];
    for (let i = 0; i < prevWR.length; i += 2) {
      const m = makeBracketMatch(categoryId, "bracket_wr", r, seq, null, null, "Por definir", "Por definir");
      wireWinner(prevWR[i], m, "A");
      wireWinner(prevWR[i + 1], m, "B");
      wrRound.push(m);
    }
    wr.push(wrRound);
    seq++;

    const reversedLosers = [...wrRound].reverse();
    const merge = [];
    for (let i = 0; i < prevSurvivors.length; i++) {
      const m = makeBracketMatch(categoryId, "bracket_lb", lbRoundNum, seq, null, null, "Por definir", "Por definir");
      wireWinner(prevSurvivors[i], m, "A");
      wireLoser(reversedLosers[i], m, "B");
      merge.push(m);
    }
    lbAll.push(merge);
    seq++;
    lbRoundNum++;

    if (merge.length > 1) {
      const reduce = [];
      for (let i = 0; i < merge.length; i += 2) {
        const m = makeBracketMatch(categoryId, "bracket_lb", lbRoundNum, seq, null, null, "Por definir", "Por definir");
        wireWinner(merge[i], m, "A");
        wireWinner(merge[i + 1], m, "B");
        reduce.push(m);
      }
      lbAll.push(reduce);
      seq++;
      lbRoundNum++;
      prevSurvivors = reduce;
    } else {
      prevSurvivors = merge;
    }
  }

  const lbFinal = prevSurvivors[0];
  if (lbFinal) lbFinal.isThirdPlaceMatch = true;

  const semiFinalWR = wr[wr.length - 1];
  const finalMatch = makeBracketMatch(categoryId, "bracket_wr", k, seq, null, null, "Por definir", "Por definir");
  wireWinner(semiFinalWR[0], finalMatch, "A");
  wireWinner(semiFinalWR[1], finalMatch, "B");
  finalMatch.isFinalMatch = true;
  wr.push([finalMatch]);

  const all = [...wr.flat(), ...lbAll.flat()];
  propagateWinner(all, null);
  return all;
}

function computePodium(cat) {
  const wrFinal = cat.matches.find((m) => m.phase === "bracket_wr" && m.isFinalMatch);
  const lbFinal = cat.matches.find((m) => m.phase === "bracket_lb" && m.isThirdPlaceMatch);
  const podium = {};
  if (wrFinal && wrFinal.winnerId) {
    podium.first = wrFinal.winnerId === wrFinal.teamAId ? wrFinal.teamALabel : wrFinal.teamBLabel;
    podium.second = wrFinal.winnerId === wrFinal.teamAId ? wrFinal.teamBLabel : wrFinal.teamALabel;
  }
  if (lbFinal && lbFinal.winnerId) {
    podium.third = lbFinal.winnerId === lbFinal.teamAId ? lbFinal.teamALabel : lbFinal.teamBLabel;
    podium.fourth = lbFinal.winnerId === lbFinal.teamAId ? lbFinal.teamBLabel : lbFinal.teamALabel;
  }
  return podium;
}

/* =========================================================================
   STANDINGS
   ========================================================================= */
function computeStandings(teams, teamIds, matches) {
  const rows = {};
  // v2.81.0: un cupo vacío de grupo (ver removeTeamFromGroup) guarda `null` en teamIds en vez
  // de encoger el arreglo -- filtrarlo acá evita una fila fantasma "?" en la tabla de posiciones
  // mientras el cupo sigue sin asignar.
  teamIds.filter(Boolean).forEach((tid) => {
    const team = teams.find((t) => t.id === tid);
    rows[tid] = {
      teamId: tid, name: team ? team.name : "?",
      pj: 0, pg: 0, pp: 0, setsF: 0, setsC: 0, ptsF: 0, ptsC: 0,
    };
  });
  matches.forEach((m) => {
    if (!m.winnerId || !m.teamAId || !m.teamBId) return;
    if (!rows[m.teamAId] || !rows[m.teamBId]) return;
    const a = rows[m.teamAId], b = rows[m.teamBId];
    a.pj++; b.pj++;
    let setsA = 0, setsB = 0;
    (m.sets || []).forEach((s) => {
      a.ptsF += Number(s.a) || 0; a.ptsC += Number(s.b) || 0;
      b.ptsF += Number(s.b) || 0; b.ptsC += Number(s.a) || 0;
      if (Number(s.a) > Number(s.b)) setsA++; else if (Number(s.b) > Number(s.a)) setsB++;
    });
    a.setsF += setsA; a.setsC += setsB;
    b.setsF += setsB; b.setsC += setsA;
    if (m.winnerId === m.teamAId) { a.pg++; b.pp++; } else { b.pg++; a.pp++; }
  });
  // v2.81.3, a pedido del club: 4to criterio de desempate -- enfrentamiento directo. Solo
  // entra en juego si los 3 de arriba (partidos ganados, diferencia de sets, diferencia de
  // puntos) quedan exactamente empatados entre DOS duplas puntuales. Como cada grupo es round
  // robin (un solo partido por par), basta con guardar el ganador de cada partido jugado bajo
  // una llave sin orden ("idA|idB" ordenado) y consultarla en el sort.
  const h2h = {};
  matches.forEach((m) => {
    if (!m.winnerId || !m.teamAId || !m.teamBId) return;
    h2h[[m.teamAId, m.teamBId].sort().join("|")] = m.winnerId;
  });
  return Object.values(rows).sort((x, y) => {
    if (y.pg !== x.pg) return y.pg - x.pg;
    const diffX = x.setsF - x.setsC, diffY = y.setsF - y.setsC;
    if (diffY !== diffX) return diffY - diffX;
    const pdX = x.ptsF - x.ptsC, pdY = y.ptsF - y.ptsC;
    if (pdY !== pdX) return pdY - pdX;
    const winner = h2h[[x.teamId, y.teamId].sort().join("|")];
    if (winner === x.teamId) return -1;
    if (winner === y.teamId) return 1;
    return 0;
  });
}

/* =========================================================================
   SCHEDULER — assigns day / time / court to every match, guaranteeing that
   no player is ever booked into two matches at the same time slot.

   `plan` (opcional, lo arma el asistente de CalendarioTab) controla el orden:
     - plan.mode === "mixed": intercala partidos de todas las categorías
       (primer partido pendiente de cada categoría, luego el segundo, ...) en
       vez de agotar una categoría antes de pasar a la siguiente.
     - plan.mode === "byCategory" (default si no hay plan): agenda cada
       categoría completa antes de pasar a la siguiente, en el orden de
       plan.categoryOrder (categorías no listadas ahí se agregan al final, en
       su orden original).
     - plan.dayCategories: { [dateISO]: [categoryId, ...] } — restringe qué
       categorías pueden jugar cada fecha. Fecha ausente o array vacío =
       sin restricción, cualquier categoría puede jugar ese día.
   Dentro de cada categoría el orden interno nunca se toca: grupos primero
   (round-robin, en el orden en que se crearon), luego bracket por ronda
   (bye excluidos, no ocupan cancha) — una ronda de bracket jamás se agenda
   antes que la anterior de su misma categoría.

   Un partido con `locked: true` (movido a mano desde el grid de CalendarioTab,
   ver `moveMatch`) nunca se resetea ni vuelve a la cola -- conserva su día/hora/
   cancha tal cual, y ese lugar (más los jugadores que ocupa a esa hora) queda
   reservado para todo lo demás, igual que un bloque ya ocupado por una reserva.
   ========================================================================= */
// Identifica la "ronda" de un partido para el panel Planificar (v2.69.0): fase de grupos es
// una sola ronda ("group"); cada ronda del cuadro eliminatorio (incluidas ambas llaves de
// doble eliminación) es la suya, por fase+número. `roundOptionsForCategory` la traduce a
// etiquetas legibles reutilizando `roundLabel` (Final/Semifinal/Cuartos...) para el cuadro
// simple; las llaves de doble eliminación usan un rótulo más simple ("Llave A Ronda N") porque
// roundLabel asume un solo cuadro.
function roundKeyOf(m) {
  return m.phase === "group" ? "group" : `${m.phase}:${m.round}`;
}
function roundOptionsForCategory(cat) {
  const opts = [];
  if (cat.matches.some((m) => m.phase === "group")) opts.push({ key: "group", label: "Fase de grupos" });
  const byPhase = {};
  cat.matches.filter((m) => m.phase !== "group" && !isByeMatch(m)).forEach((m) => {
    (byPhase[m.phase] = byPhase[m.phase] || new Set()).add(m.round);
  });
  Object.keys(byPhase).forEach((phase) => {
    const rounds = [...byPhase[phase]].sort((a, b) => a - b);
    rounds.forEach((rn) => {
      let label;
      if (phase === "bracket") label = roundLabel(rn, rounds.length);
      else if (phase === "bracket_wr") label = `Llave A — ${roundLabel(rn, rounds.length)}`;
      else if (phase === "bracket_lb") label = `Llave B — Ronda ${rn + 1}`;
      else label = `Ronda ${rn + 1}`;
      opts.push({ key: `${phase}:${rn}`, label });
    });
  });
  return opts;
}
// Duck-typing deliberado -- `plan.roundKeys[catId]` puede llegar como Set (así lo arma el
// panel Planificar, más cómodo para .has()) o como array plano (por si algún día se persiste
// o se arma a mano) -- ambos funcionan igual acá sin que el llamador tenga que normalizar.
function roundSetHas(allowed, key) {
  if (!allowed) return true;
  return allowed.has ? allowed.has(key) : allowed.includes(key);
}

function buildSchedule(categories, courts, dates, dailyStart, dailyEnd, matchDuration, breakM, occupiedKeys = new Set(), plan = null) {
  const slots = [];
  const startM = timeToMinutes(dailyStart), endM = timeToMinutes(dailyEnd);
  dates.forEach((date) => {
    let t = startM;
    while (t + Number(matchDuration) <= endM) {
      slots.push({ date, timeMin: t });
      t += Number(matchDuration) + Number(breakM);
    }
  });

  const catById = {};
  categories.forEach((c) => (catById[c.id] = c));
  const playersOf = (m) => {
    const cat = catById[m.categoryId];
    const a = cat.teams.find((t) => t.id === m.teamAId);
    const b = cat.teams.find((t) => t.id === m.teamBId);
    return [
      ...(a ? a.players.map((p) => p.name.trim().toLowerCase()) : []),
      ...(b ? b.players.map((p) => p.name.trim().toLowerCase()) : []),
    ];
  };

  // `plan.categoryIds`/`plan.roundKeys` (v2.69.0) acotan qué entra a la cola de ESTA corrida --
  // ver más abajo dónde se usan para armar la cola. Se calculan acá arriba (antes del reset)
  // porque el reset de abajo también los necesita: un partido de una categoría/ronda FUERA de
  // la selección actual no debe resetearse solo porque no esté fijado -- eso rompía un caso
  // real: planificar la categoría A limpiaba en silencio el horario sin fijar de la categoría
  // B (o de otra ronda de la propia A que no se había seleccionado esta vez), aunque nadie la
  // hubiera tocado. Sin `plan` (nadie llama así hoy fuera del panel Planificar), todo cuenta
  // como "dentro de la selección" y el comportamiento es el de siempre.
  const inSelection = (cat) => !plan?.categoryIds?.length || plan.categoryIds.includes(cat.id);
  const roundAllowed = (cat, m) => roundSetHas(plan?.roundKeys?.[cat.id], roundKeyOf(m));

  // Partidos fijados a mano O fuera de la selección de esta corrida: se dejan tal cual (no se
  // resetean, no vuelven a la cola, y sí cuentan como ocupados para no chocar con lo que SÍ se
  // va a agendar ahora). Solo lo que está adentro de la selección y sin fijar se resetea.
  const preOccupied = new Set(occupiedKeys);
  const lockedPlayersBySlot = {}; // "date|timeMin" -> Set(jugador)
  categories.forEach((c) => c.matches.forEach((m) => {
    const keepAsIs = m.locked || !inSelection(c) || !roundAllowed(c, m);
    if (keepAsIs && m.day && m.time && m.courtId) {
      preOccupied.add(blockKey(m.courtId, m.day, timeToMinutes(m.time)));
      const key = `${m.day}|${timeToMinutes(m.time)}`;
      const set = (lockedPlayersBySlot[key] = lockedPlayersBySlot[key] || new Set());
      playersOf(m).forEach((p) => set.add(p));
    } else if (!keepAsIs) {
      m.day = null; m.time = null; m.courtId = null;
    }
  }));

  // v2.69.0: el panel Planificar manda `plan.categoryIds` -- solo esas categorías entran a la
  // cola de este run (las demás quedan tal cual, sus partidos sin tocar). Sin `categoryIds`
  // (nadie lo manda hoy fuera del panel nuevo) el comportamiento es el de siempre: todas.
  const orderedCats = (() => {
    const base = categories.filter((c) => inSelection(c));
    if (plan?.mode === "byCategory" && plan.categoryOrder?.length) {
      const rank = {}; plan.categoryOrder.forEach((id, i) => (rank[id] = i));
      return [...base].sort((a, b) => (rank[a.id] ?? 999) - (rank[b.id] ?? 999));
    }
    return base;
  })();

  // Cola propia de cada categoría: grupos (tal cual se crearon) + bracket agrupado
  // por ronda/seq y ordenado ascendente -- exactamente el mismo criterio que usaba
  // el loop de bracket original, solo que ahora se arma como lista en vez de
  // consumirse con su propio cursor de slots independiente. Los fijados a mano ya
  // tienen lugar (arriba) y no entran acá.
  //
  // v2.81.4 -- INCIDENTE REAL: un partido de bracket con equipos aún no definidos (teamAId/
  // teamBId null, ver buildQualifierBracket) nunca choca por jugador -- más abajo, `ps.length
  // > 0 && ...` es false para él, así que jamás lo descarta el chequeo de choque. Si el partido
  // de GRUPO que le tocaba a un hueco de cancha/horario quedaba descartado por choque de
  // jugador, el buscador seguía bajando por la cola y terminaba agendando ahí un partido de
  // LLAVE en su lugar -- aunque sus equipos dependan de que la fase de grupos de esa MISMA
  // categoría ya haya cerrado. Resultado real: semifinal/final con el MISMO horario (o antes)
  // que partidos de grupo de la propia categoría, imposibles de jugar en ese momento.
  //
  // `matchBucket` numera la fase de cada partido POR CATEGORÍA (0 = grupos, 1 = ronda 1 de
  // bracket, 2 = ronda 2, ...) y `bucketRemaining` cuenta cuántos de cada fase le quedan sin
  // agendar a esa categoría. Un partido de fase N recién se considera elegible más abajo cuando
  // ya no queda NINGÚN partido de fase < N sin agendar en su categoría -- dentro de la MISMA
  // fase el orden se queda libre, como siempre (los partidos de grupo entre sí, o los de una
  // misma ronda de bracket entre sí, no tienen por qué respetar ningún orden particular).
  const matchBucket = new Map();
  const bucketRemaining = {}; // catId -> [cantidad sin agendar por fase]
  const perCatQueues = orderedCats.map((cat) => {
    const group = cat.matches.filter((m) => m.phase === "group" && !m.locked && roundAllowed(cat, m));
    const byRound = {};
    cat.matches.filter((m) => m.phase !== "group" && !isByeMatch(m) && !m.locked && roundAllowed(cat, m)).forEach((m) => {
      const key = m.seq != null ? m.seq : m.round;
      byRound[key] = byRound[key] || [];
      byRound[key].push(m);
    });
    const roundKeys = Object.keys(byRound).map(Number).sort((a, b) => a - b);
    const bracket = roundKeys.flatMap((rn) => byRound[rn]);
    group.forEach((m) => matchBucket.set(m, 0));
    roundKeys.forEach((rn, bi) => byRound[rn].forEach((m) => matchBucket.set(m, bi + 1)));
    bucketRemaining[cat.id] = [group.length, ...roundKeys.map((rn) => byRound[rn].length)];
    return [...group, ...bracket];
  });

  // "byCategory": concatena cada cola completa en el orden elegido (una categoría
  // entera, luego la siguiente). "mixed": intercala posición a posición entre
  // categorías, así las rondas quedan mezcladas en vez de una entera por vez.
  const queue = [];
  if (plan?.mode === "mixed") {
    const maxLen = Math.max(0, ...perCatQueues.map((q) => q.length));
    for (let i = 0; i < maxLen; i++) perCatQueues.forEach((q) => { if (q[i]) queue.push(q[i]); });
  } else {
    perCatQueues.forEach((q) => queue.push(...q));
  }

  const dateAllows = (categoryId, date) => {
    const allowed = plan?.dayCategories?.[date];
    return !allowed || allowed.length === 0 || allowed.includes(categoryId);
  };

  // v2.75.0: si la cola se queda sin franjas dentro de dailyStart/dailyEnd, YA NO se deja
  // ningún partido sin ubicar (ver incidente: quedaban invisibles, día que el club pidió
  // corregir de raíz) -- en vez de eso se sigue extendiendo el ÚLTIMO día de esta corrida más
  // allá de la hora de cierre configurada, con el mismo incremento de siempre, hasta que la
  // cola se vacíe. `isOvertimeMatch()` (más arriba en el archivo) es quien marca esos partidos
  // con el aviso "fuera de tu franja de horario" en el tablero -- acá no se distingue en nada,
  // simplemente se les da un horario real como a cualquier otro.
  let slotIndex = 0;
  let overtimeGuard = 0;
  while (queue.length > 0) {
    if (slotIndex >= slots.length) {
      if (overtimeGuard++ > 2000) break; // nunca debería hacer falta -- red de seguridad contra un loop infinito
      const prev = slots[slots.length - 1];
      const date = prev ? prev.date : dates[dates.length - 1];
      const timeMin = prev ? prev.timeMin + Number(matchDuration) + Number(breakM) : startM;
      slots.push({ date, timeMin });
    }
    const slot = slots[slotIndex];
    const usedPlayers = new Set(lockedPlayersBySlot[`${slot.date}|${slot.timeMin}`] || []);
    // v2.81.4 -- foto de bucketRemaining ANTES de repartir esta franja entre canchas: si se
    // usara el contador en vivo, el último partido de grupo de una categoría y el primero de
    // bracket podrían caer en la MISMA franja (cancha distinta) apenas ese contador llegara a
    // cero a mitad del loop de canchas -- aunque ya no "choquen" en la cola, el partido de
    // grupo todavía no se habría JUGADO a esa hora. Congelar la foto al empezar la franja
    // obliga al de bracket a esperar, como mínimo, a la franja siguiente.
    const bucketRemainingAtSlotStart = {};
    Object.keys(bucketRemaining).forEach((cid) => { bucketRemainingAtSlotStart[cid] = [...bucketRemaining[cid]]; });
    for (let c = 0; c < courts.length && queue.length > 0; c++) {
      if (preOccupied.has(blockKey(courts[c].id, slot.date, slot.timeMin))) continue;
      // v2.81.5 -- hora de inicio propia por cancha (panel Planificar, `plan.courtStartTimes`,
      // a pedido del club: por ejemplo, arrancar con 2 canchas a las 9am y sumar las otras 2 a
      // las 10am). Una cancha sin hora propia configurada sigue usando `dailyStart` como
      // siempre -- esto es 100% opcional, no cambia nada para quien no lo use.
      const courtStart = plan?.courtStartTimes?.[courts[c].id];
      if (courtStart && slot.timeMin < timeToMinutes(courtStart)) continue;
      let foundIdx = -1;
      for (let i = 0; i < queue.length; i++) {
        const m = queue[i];
        if (!dateAllows(m.categoryId, slot.date)) continue;
        // v2.81.4 -- ver comentario de matchBucket/bucketRemaining arriba: nunca elegible
        // todavía si a su categoría le queda algún partido de una fase ANTERIOR sin agendar,
        // sin importar que este partido puntual no choque por jugador.
        const bucket = matchBucket.get(m);
        if (bucketRemainingAtSlotStart[m.categoryId].slice(0, bucket).some((n) => n > 0)) continue;
        const ps = playersOf(m);
        // Un partido de bracket con equipos aún no definidos (rondas futuras, o
        // llave alimentada por grupos que todavía no cerraron) no tiene jugadores
        // conocidos -- se agenda igual sin chequeo de choque, como hacía el loop
        // de bracket original. Si ya se conocen, sí se exige que ninguno esté
        // jugando otro partido en esta misma franja (cruzando categorías incluso).
        if (ps.length > 0 && !ps.every((p) => !usedPlayers.has(p))) continue;
        foundIdx = i;
        break;
      }
      if (foundIdx === -1) continue;
      const match = queue.splice(foundIdx, 1)[0];
      bucketRemaining[match.categoryId][matchBucket.get(match)]--;
      playersOf(match).forEach((p) => usedPlayers.add(p));
      match.day = slot.date; match.time = minutesToTime(slot.timeMin); match.courtId = courts[c].id;
      // v2.69.0: el panel Planificar arma cada corrida para UN día -- que lo que acaba de
      // ubicar quede fijo es lo que hace posible planificar el día siguiente sin que se
      // reordene lo de hoy (ver preOccupied arriba: un partido `locked` nunca se resetea).
      if (plan?.lockAfterSchedule) match.locked = true;
    }
    slotIndex++;
  }

  const unscheduled = queue.length;

  const allScheduled = categories.flatMap((c) => c.matches).filter((m) => m.day);
  let start = null, end = null;
  allScheduled.forEach((m) => {
    const key = m.day + " " + m.time;
    if (!start || key < start.key) start = { key, day: m.day, time: m.time };
    const endMin = timeToMinutes(m.time) + Number(matchDuration);
    const endKey = m.day + " " + minutesToTime(endMin);
    if (!end || endKey > end.key) end = { key: endKey, day: m.day, time: minutesToTime(endMin) };
  });

  return {
    capacityExceeded: unscheduled > 0,
    unscheduledGroup: unscheduled,
    totalSlots: slots.length,
    start, end,
  };
}

// Vista previa del panel Planificar (v2.69.0) -- corre buildSchedule sobre un clon descartable
// (nunca toca `categories` de verdad ni persiste nada) solo para saber, ANTES de que el admin
// confirme, cuántos partidos de la selección actual entrarían a la cola y cuántos de esos
// alcanzan a ubicarse con las franjas/canchas disponibles ese día -- el "X/Y" del botón
// Planificar. Si `plan.reschedule` está activo, primero desbloquea (en el clon, nada más) los
// partidos que ya estaban planificados y calzan con la selección, para que la vista previa
// refleje que sí se van a volver a mezclar.
function previewSchedule(categories, courts, dates, dailyStart, dailyEnd, matchDuration, breakM, occupiedKeys, plan) {
  const clone = structuredClone(categories);
  if (plan?.reschedule && plan.categoryIds?.length) {
    clone.forEach((c) => {
      if (!plan.categoryIds.includes(c.id)) return;
      c.matches.forEach((m) => { if (roundSetHas(plan.roundKeys?.[c.id], roundKeyOf(m))) m.locked = false; });
    });
  }
  let queued = 0;
  clone.forEach((c) => {
    if (plan?.categoryIds?.length && !plan.categoryIds.includes(c.id)) return;
    c.matches.forEach((m) => {
      if (isByeMatch(m) || m.locked) return;
      if (!roundSetHas(plan?.roundKeys?.[c.id], roundKeyOf(m))) return;
      queued++;
    });
  });
  if (queued === 0) return { queued: 0, scheduled: 0 };
  const info = buildSchedule(clone, courts, dates, dailyStart, dailyEnd, matchDuration, breakM, occupiedKeys, { ...plan, lockAfterSchedule: false });
  return { queued, scheduled: queued - info.unscheduledGroup };
}

// Escanea TODO el calendario ya generado (todas las categorías juntas) y detecta si algún
// jugador quedó con dos partidos distintos en el mismo día+hora -- sin importar cancha o
// categoría. buildSchedule() en la práctica nunca produce esto hoy (el orden en que llena
// slots es secuencial por categoría), pero el chequeo se deja como red de seguridad
// explícita: cubre ediciones manuales futuras del calendario y cualquier cambio al
// algoritmo de scheduling que sí pudiera cruzar categorías. Identifica al jugador por
// userId cuando se registró él mismo; si no, cae a nombre normalizado (roster manual).
function findScheduleConflicts(categories) {
  const bySlot = {}; // "playerKey||day||time" -> [{playerName, catName, matchId, day, time}]
  categories.forEach((cat) => {
    cat.matches.forEach((m) => {
      if (!m.day || !m.time || isByeMatch(m)) return;
      const a = cat.teams.find((t) => t.id === m.teamAId);
      const b = cat.teams.find((t) => t.id === m.teamBId);
      const players = [...(a?.players || []), ...(b?.players || [])];
      const seen = new Set();
      players.forEach((p) => {
        const key = p.userId || (p.name || "").trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        const slotKey = `${key}||${m.day}||${m.time}`;
        (bySlot[slotKey] = bySlot[slotKey] || []).push({ playerName: p.name, catName: cat.name, matchId: m.id, day: m.day, time: m.time });
      });
    });
  });
  return Object.values(bySlot).filter((entries) => new Set(entries.map((e) => e.matchId)).size > 1);
}

// Valida un movimiento manual ANTES de confirmarlo (tablero de CalendarioTab, tap-destino o
// arrastrar-y-soltar): la cancha destino debe estar libre en ese bloque (cruzando cualquier
// módulo -- reservas, open plays, clases u otro partido de torneo YA FIJADO, vía el mismo
// `occupiedKeys` que usa el resto de la app) -- eso sigue bloqueando de verdad, es físicamente
// imposible jugar dos cosas en la misma cancha a la misma hora. El propio bloque de origen del
// partido no cuenta como "ocupado" para sí mismo.
//
// v2.71.0: que un jugador quede con dos partidos a la misma hora YA NO bloquea el movimiento
// -- antes sí, pero el tablero ahora marca ese choque con un ícono rojo en ambas tarjetas
// (ver `findScheduleConflicts` + CalendarioTab), así que tiene más sentido dejar que el
// organizador lo haga a propósito (o lo note y lo corrija él mismo) que impedírselo de una.
// Sigue devolviendo el motivo en `warning` (no en `reason`, que ahora es solo para lo que sí
// bloquea) para que quien llama pueda avisar del choque en el momento, además del ícono
// persistente en la tarjeta.
function checkMoveConflict(match, target, categories, occupiedKeys) {
  const targetKey = blockKey(target.courtId, target.day, timeToMinutes(target.time));
  const ownKey = match.day && match.courtId ? blockKey(match.courtId, match.day, timeToMinutes(match.time)) : null;
  if (targetKey !== ownKey && occupiedKeys.has(targetKey)) {
    return { ok: false, reason: "Esa cancha ya está ocupada a esa hora (otra reserva, evento o partido)." };
  }
  const cat = categories.find((c) => c.id === match.categoryId);
  const a = cat?.teams.find((t) => t.id === match.teamAId);
  const b = cat?.teams.find((t) => t.id === match.teamBId);
  const myKeys = new Set([...(a?.players || []), ...(b?.players || [])].map((p) => (p.userId || p.name || "").trim().toLowerCase()).filter(Boolean));
  if (myKeys.size === 0) return { ok: true };
  for (const c of categories) {
    for (const m of c.matches) {
      if (m.id === match.id || !m.day || !m.time || isByeMatch(m)) continue;
      if (m.day !== target.day || m.time !== target.time) continue;
      const ta = c.teams.find((t) => t.id === m.teamAId);
      const tb = c.teams.find((t) => t.id === m.teamBId);
      const collision = [...(ta?.players || []), ...(tb?.players || [])]
        .find((p) => myKeys.has((p.userId || p.name || "").trim().toLowerCase()));
      if (collision) return { ok: true, warning: `${collision.name} ya tiene otro partido a esa hora (${c.name}).` };
    }
  }
  return { ok: true };
}

/* =========================================================================
   APP VERSION
   ========================================================================= */
const APP_VERSION = "2.82.3";

/* =========================================================================
   DESIGN TOKENS
   ========================================================================= */
const COLORS = {
  court: "#16325C",        // deep refined pine green — primary
  courtDark: "#0A1830",    // near-black pine — sidebar / dark surfaces
  chalk: "#F5F6F9",        // warm ivory paper — canvas + light text on dark
  ink: "#101A2C",          // near-black body text
  ball: "#FF6A1A",         // citrus lime — signature accent
  ballDark: "#CC4A00",
  clay: "#DB5A34",         // clay-court terracotta — secondary CTA / alerts
  line: "#E2E6EE",         // warm hairline border
  card: "#FFFFFF",
};

// Paleta de colores pastel por categoría (v2.70.0) -- Calendario tiene muchas categorías
// mezcladas en el mismo tablero (una tarjeta de partido junto a otra en la misma cancha) y
// hasta ahora todas se veían iguales salvo por el texto; esto les da una identidad visual
// para diferenciarlas de un vistazo, sin que el admin tenga que asignar colores a mano.
// `buildCategoryColorMap` asigna por posición en la lista (ver más abajo) -- la MISMA
// categoría siempre cae en el mismo color, en cualquier pantalla, sin guardar nada nuevo en
// la base de datos.
const CATEGORY_PALETTE = [
  { bg: "#FCE7EC", text: "#B23A5C" }, // rosa
  { bg: "#FDEBD9", text: "#B2621B" }, // durazno
  { bg: "#FBF3D2", text: "#8A6D1B" }, // ámbar
  { bg: "#EEF7DA", text: "#5A7A1B" }, // lima
  { bg: "#DFF5EA", text: "#1B7A4F" }, // menta
  { bg: "#DAF3F1", text: "#1B7A78" }, // aguamarina
  { bg: "#DCEEFB", text: "#1B5FA0" }, // cielo
  { bg: "#E3E4FB", text: "#4A3FA0" }, // índigo
  { bg: "#EDE0FA", text: "#6B32A0" }, // violeta
  { bg: "#F7E0F6", text: "#9C2E96" }, // orquídea
  { bg: "#FDE2DE", text: "#B2401F" }, // coral
  { bg: "#E7EAF0", text: "#3D4A66" }, // pizarra
];
// Por índice (no por hash del id) -- así, mientras el torneo tenga 12 categorías o menos
// (el caso normal), CADA UNA saca un color distinto garantizado. Un hash del id es estable
// pero puede chocar entre dos categorías cualquiera (probado: con 9 categorías reales pasó);
// el orden en que llegan (por created_at, no cambia solo) hace que ir por posición sea
// igual de estable en la práctica y sin el riesgo de choque mientras entren en la paleta.
function buildCategoryColorMap(categories) {
  const map = {};
  categories.forEach((c, i) => { map[c.id] = CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]; });
  return map;
}

const FORMAT_LABELS = {
  liga: "Liga (todos contra todos)",
  grupos: "Fase de grupos",
  eliminatoria: "Eliminación directa",
  grupos_eliminatoria: "Grupos + Eliminatoria",
  doble_eliminacion: "Doble Eliminación (Llave A / Llave B)",
};

const MODALITY_LABELS = { individual: "Individual (single)", dobles: "Dobles" };
const GENDER_LABELS = { masculino: "Masculino", femenino: "Femenino", mixto: "Mixto", libre: "Libre" };
// "Master (+50)" (v2.42.1) es una categoría por edad, no por nivel de habilidad -- convive acá
// porque LEVEL_OPTIONS es la misma lista que arma el nombre de categoría de torneo
// (NewCategoryForm) y el "nivel recomendado" de Open Play/Clase; se agrega al final para no
// mover el índice de ninguna opción existente (recommendFormat usa esa posición como
// prioridad de cancha entre categorías -- ver comentario ahí).
const LEVEL_OPTIONS = ["Principiante", "3.0", "3.5", "4.0", "4.5", "5.0+", "Open", "Master (+50)"];

function makeCategoryName(modality, gender, level) {
  return `${MODALITY_LABELS[modality]} ${GENDER_LABELS[gender]} ${level}`.replace("Individual (single)", "Individual");
}

// Etiqueta de la tarjeta en "Cargar resultados" (v2.77.0, a pedido del club) -- mismos tres
// datos que makeCategoryName pero en el orden que pidieron: nivel primero, modalidad+género
// después (ej. "Open Dobles Mixto", "3.5 Dobles Masculino"). Es solo para esta etiqueta puntual
// -- el nombre real de la categoría (cat.name, usado en Categorías/Calendario/Inscripción) no
// cambia.
function catBadgeLabel(cat) {
  return `${cat.level} ${MODALITY_LABELS[cat.modality]} ${GENDER_LABELS[cat.gender]}`.replace("Individual (single)", "Individual");
}

// Orden compartido por Resultados y Clasificación (v2.77.0/v2.77.1) -- nivel primero (mismo
// orden que LEVEL_OPTIONS), después modalidad y género, en vez del orden de creación.
function sortCategoriesByLevel(categories) {
  const levelRank = {}; LEVEL_OPTIONS.forEach((l, i) => { levelRank[l] = i; });
  return [...categories].sort((a, b) => {
    const byLevel = (levelRank[a.level] ?? 999) - (levelRank[b.level] ?? 999);
    if (byLevel !== 0) return byLevel;
    const byModality = a.modality.localeCompare(b.modality);
    if (byModality !== 0) return byModality;
    return a.gender.localeCompare(b.gender);
  });
}

/* =========================================================================
   FORMAT ADVISOR — recommends a tournament format per category based on how
   many teams registered, how much court-time is available for the whole
   event, and how much of that time other categories are already claiming
   (with higher-level categories getting priority for the richer formats).
   ========================================================================= */
function computeCapacity(courts, dates, dailyStart, dailyEnd, matchDuration, breakM) {
  const startM = timeToMinutes(dailyStart || "08:00"), endM = timeToMinutes(dailyEnd || "20:00");
  let slotsPerDay = 0, t = startM;
  const step = Number(matchDuration) + Number(breakM);
  while (step > 0 && t + Number(matchDuration) <= endM) { slotsPerDay++; t += step; }
  return slotsPerDay * courts.length * dates.length;
}

// Real (non-BYE) matches a format needs for n teams — used to weigh formats against available time.
function estimateMatches(format, n) {
  if (n < 2) return 0;
  switch (format) {
    case "eliminatoria": return n - 1;
    case "doble_eliminacion": return Math.max(0, 2 * (n - 1) - 1);
    case "liga": return (n * (n - 1)) / 2;
    case "grupos": {
      const groups = Math.max(1, Math.round(n / 4));
      const base = Math.floor(n / groups), extra = n % groups;
      let total = 0;
      for (let i = 0; i < groups; i++) { const size = base + (i < extra ? 1 : 0); total += (size * (size - 1)) / 2; }
      return total;
    }
    case "grupos_eliminatoria": {
      const bracketSize = nextPow2(Math.max(2, Math.round(n / 2)));
      return estimateMatches("grupos", n) + Math.max(0, bracketSize - 1);
    }
    default: return n - 1;
  }
}

const FORMAT_RICHNESS = ["liga", "grupos_eliminatoria", "doble_eliminacion", "grupos", "eliminatoria"];

function recommendFormat(cat, categories, courts, dates, tournament, matchDuration, breakM) {
  const n = cat.teams.length;
  if (n < 2) return null;
  const capacity = computeCapacity(courts, dates, tournament.dailyStart, tournament.dailyEnd, matchDuration, breakM);

  const siblings = categories.filter((c) => c.id !== cat.id && c.teams.length >= 2);
  const othersDemand = siblings.reduce((sum, c) => sum + estimateMatches(c.format || "grupos_eliminatoria", c.teams.length), 0);
  const remaining = Math.max(0, capacity - othersDemand);

  const myLevelIdx = LEVEL_OPTIONS.indexOf(cat.level);
  const higherPriority = siblings.filter((c) => LEVEL_OPTIONS.indexOf(c.level) > myLevelIdx).length;
  const budget = higherPriority === 0 ? remaining : remaining / (higherPriority + 1);

  const candidates = FORMAT_RICHNESS.map((format) => ({ format, matches: estimateMatches(format, n) }));
  let pick = candidates.find((c) => c.matches <= budget);
  if (!pick) pick = candidates[candidates.length - 1];

  return { format: pick.format, matches: pick.matches, capacity, othersDemand, remaining, budget, n };
}

/* =========================================================================
   MAIN APP
   ========================================================================= */
export default function PickleballTournamentApp() {
  // Recordar en qué pestaña quedó el admin/cliente (v2.53.1) -- antes SIEMPRE arrancaba en
  // "club" (admin) o "eventos" (cliente) sin importar de dónde venía, así que actualizar la
  // página a mitad de revisar, por ejemplo, Inscritos de un torneo lo mandaba de vuelta a Mi
  // Club de una. `loginUser`/`registerUser` SÍ siguen fijando un tab de arranque a propósito
  // (ver más abajo) -- eso es explícito y deliberado, no lo toca esta persistencia; solo
  // reemplaza el valor inicial fijo de este useState por lo último guardado.
  const [tab, setTab] = useState(() => loadCache("tab", "club"));
  useEffect(() => { saveCache("tab", tab); }, [tab]);

  // Link compartido de una actividad (v2.43.0) -- `?act=<kind>:<id>`, parseado UNA sola vez al
  // montar (no reactivo a cambios de URL después: esta app no tiene router, un solo destino
  // posible al abrir es todo lo que hace falta). Sin sesión, dispara PublicActivityView en vez
  // de AuthScreen (ver más abajo); con sesión (ya la tenía, o la creó recién desde ahí), un
  // efecto más abajo lo traduce a navegación real dentro de la app y limpia el query param.
  const [publicAct] = useState(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("act");
      if (!raw) return null;
      const sep = raw.indexOf(":");
      if (sep < 0) return null;
      const kind = raw.slice(0, sep), id = raw.slice(sep + 1);
      if (!id || !["open_play", "clase", "torneo"].includes(kind)) return null;
      return { kind, id };
    } catch { return null; }
  });
  const publicActConsumedRef = useRef(false);

  // Link "invitar a mi pareja" (v2.44.2) -- `?join=<catId>:<teamId>`, mismo criterio de parseo
  // que publicAct. A diferencia de publicAct, esto no navega a ningún tab -- se resuelve
  // siempre como un modal flotante (JoinTeamModal, con sesión) o una pantalla propia
  // (PublicJoinTeamView, sin sesión) encima de lo que sea que la app esté mostrando, porque
  // unirse a un equipo es una tarea puntual, no "ir a ver algo".
  const [joinParam] = useState(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get("join");
      if (!raw) return null;
      const sep = raw.indexOf(":");
      if (sep < 0) return null;
      const catId = raw.slice(0, sep), teamId = raw.slice(sep + 1);
      if (!catId || !teamId) return null;
      return { catId, teamId };
    } catch { return null; }
  });
  const [joinModalDismissed, setJoinModalDismissed] = useState(false);
  useEffect(() => {
    if (joinParam) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Link de cupón de descuento (v2.82.0) -- `?cupon=<code>`, mismo criterio de parseo que
  // act/join de arriba. A diferencia de esos dos, el código no identifica nada que ya viva en
  // el estado general (`coupons` solo se carga para el admin, ver fetchCoupons) -- se resuelve
  // aparte, con su propio fetch por code, funcione o no haya sesión todavía. `couponInfo`:
  // `undefined` mientras carga, `null` si el código no existe, `{coupon, plan}` si es válido
  // (el propio `coupon.used` dice si ya se canjeó).
  const [couponCode] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("cupon") || null; } catch { return null; }
  });
  const [couponInfo, setCouponInfo] = useState(undefined);
  useEffect(() => {
    if (!couponCode) { setCouponInfo(null); return; }
    (async () => {
      const { data: couponRow } = await supabase.from("coupons").select("*").eq("code", couponCode).maybeSingle();
      if (!couponRow) { setCouponInfo(null); return; }
      const { data: planRow } = await supabase.from("membership_plans").select("*").eq("id", couponRow.plan_id).maybeSingle();
      setCouponInfo({ coupon: mapCouponRow(couponRow), plan: planRow ? mapPlanRow(planRow) : null });
    })();
  }, [couponCode]);
  useEffect(() => {
    if (couponCode) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // ---- Club-wide schedule & courts (shared by Reservas, Eventos y Torneos) ----
  // `clubs`/`courts` en Supabase son la fuente real; estos mappers convierten las filas
  // (snake_case) a la misma forma camelCase que ya consumía el resto de la app, para no
  // tocar los componentes que leen club.openTime, court.pricePerBlock, etc.
  const mapClubRow = (r) => ({
    id: r.id, name: r.name, openTime: r.open_time, closeTime: r.close_time,
    blockMinutes: r.block_minutes, bsPerUsd: Number(r.bs_per_usd),
    pagoMovil: r.pago_movil || { banco: "", telefono: "", cedula: "" },
  });
  const mapCourtRow = (r) => ({
    id: r.id, name: r.name, isPrivate: r.is_private, pricePerBlock: Number(r.price_per_block),
    memberPrice: Number(r.member_price), priceRules: r.price_rules || [],
  });

  // Fallback histórico si por algún motivo la fila semilla de `clubs` no existe (no confundir
  // con un error de red -- ver más abajo).
  const FALLBACK_CLUB = { id: null, name: "Pickle Hub", openTime: "07:00", closeTime: "22:00", blockMinutes: 90, bsPerUsd: 180, pagoMovil: { banco: "", telefono: "", cedula: "" } };
  // Semilla desde caché (v2.34.0) para que reabrir la app durante un apagón de internet siga
  // mostrando el club/canchas reales en vez de un torneo sin canchas -- ver nota de
  // loadCache/saveCache.
  const [club, setClub] = useState(() => loadCache("club", null) || FALLBACK_CLUB);
  const [courts, setCourts] = useState(() => loadCache("courts", []));
  const [clubDataLoading, setClubDataLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [clubRes, courtsRes] = await Promise.all([
        supabase.from("clubs").select("*").limit(1),
        supabase.from("courts").select("*").order("created_at"),
      ]);
      // En error (sin señal) no se pisa lo que ya había en caché/estado con el default vacío
      // -- eso dejaría Torneos sin canchas justo cuando más hace falta.
      if (clubRes.error) console.error("fetch clubs:", clubRes.error.message);
      else setClub(clubRes.data?.[0] ? mapClubRow(clubRes.data[0]) : FALLBACK_CLUB);
      if (courtsRes.error) console.error("fetch courts:", courtsRes.error.message);
      else setCourts((courtsRes.data || []).map(mapCourtRow));
      setClubDataLoading(false);
    })();
  }, []);
  // Mantiene la copia en caché al día con CUALQUIER cambio posterior, sin importar de dónde
  // venga (carga inicial exitosa, updateClub, addCourt/updateCourt/removeCourt...).
  useEffect(() => { saveCache("club", club); }, [club]);
  useEffect(() => { saveCache("courts", courts); }, [courts]);

  // Actualiza local al toque (UI instantánea) y persiste en Supabase en segundo plano.
  const updateClub = (patch) => {
    setClub((c) => (c ? { ...c, ...patch } : c));
    if (!club?.id) return;
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("openTime" in patch) dbPatch.open_time = patch.openTime;
    if ("closeTime" in patch) dbPatch.close_time = patch.closeTime;
    if ("blockMinutes" in patch) dbPatch.block_minutes = patch.blockMinutes;
    if ("bsPerUsd" in patch) dbPatch.bs_per_usd = patch.bsPerUsd;
    if ("pagoMovil" in patch) dbPatch.pago_movil = patch.pagoMovil;
    supabase.from("clubs").update(dbPatch).eq("id", club.id).then(({ error }) => {
      if (error) console.error("updateClub:", error.message);
    });
  };

  // Estado de la sincronización con la API del BCV.
  const [rateStatus, setRateStatus] = useState({ loading: false, error: null, lastSync: null, source: "manual", effectiveDate: null });

  const syncBcvRate = async () => {
    setRateStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      // v2.39.1: bcv.today (la API de antes) dejó de existir -- el dominio ni siquiera
      // resuelve por DNS, no fue un bloqueo puntual. dolarapi.com es el reemplazo: mismo
      // concepto (tasa EUR "oficial" del BCV, no la oficial en USD ni el paralelo) en un
      // servicio real y activo hoy.
      const res = await fetch("https://ve.dolarapi.com/v1/euros/oficial");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.promedio) throw new Error("La respuesta no trajo tasa EUR");
      updateClub({ bsPerUsd: Number(data.promedio) });
      setRateStatus({ loading: false, error: null, lastSync: Date.now(), source: "bcv_eur", effectiveDate: data.fechaActualizacion ? data.fechaActualizacion.slice(0, 10) : null });
    } catch (err) {
      setRateStatus((s) => ({
        ...s, loading: false,
        error: `No se pudo conectar con la API de tasas (${err.message || "error de red"}). La tasa se mantiene editable manualmente.`,
      }));
    }
  };

  // Sincroniza en cuanto el club termina de cargar desde Supabase, y luego cada 30 minutos.
  useEffect(() => {
    if (clubDataLoading) return;
    syncBcvRate();
    const interval = setInterval(syncBcvRate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [clubDataLoading]);

  const addCourt = async (data) => {
    if (!club?.id) return;
    const { data: row, error } = await supabase.from("courts").insert({
      club_id: club.id, name: data.name, is_private: data.isPrivate,
      price_per_block: data.pricePerBlock, member_price: data.memberPrice, price_rules: data.priceRules || [],
    }).select().single();
    if (error) { console.error("addCourt:", error.message); return; }
    setCourts((cs) => [...cs, mapCourtRow(row)]);
  };
  const updateCourt = (id, patch) => {
    setCourts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("isPrivate" in patch) dbPatch.is_private = patch.isPrivate;
    if ("pricePerBlock" in patch) dbPatch.price_per_block = patch.pricePerBlock;
    if ("memberPrice" in patch) dbPatch.member_price = patch.memberPrice;
    if ("priceRules" in patch) dbPatch.price_rules = patch.priceRules;
    supabase.from("courts").update(dbPatch).eq("id", id).then(({ error }) => {
      if (error) console.error("updateCourt:", error.message);
    });
  };
  const removeCourt = (id) => {
    setCourts((cs) => cs.filter((c) => c.id !== id));
    supabase.from("courts").delete().eq("id", id).then(({ error }) => {
      if (error) console.error("removeCourt:", error.message);
    });
  };

  // ---- Reservas (individual court bookings) ----
  const mapBookingRow = (r) => ({
    id: r.id, courtId: r.court_id, date: r.date, timeMin: r.time_min, blockMinutes: r.block_minutes,
    userId: r.user_id, userName: r.user_name, status: r.status, paymentMethod: r.payment_method,
    reference: r.reference, proofName: r.proof_name, freeBlock: !!r.free_block,
    priceUsd: r.price_usd != null ? Number(r.price_usd) : null, priceBs: r.price_bs != null ? Number(r.price_bs) : null,
    createdAt: new Date(r.created_at).getTime(),
  });
  const [bookings, setBookings] = useState([]);
  const fetchBookings = async () => {
    const { data, error } = await supabase.from("bookings").select("*").order("created_at");
    if (error) { console.error("fetch bookings:", error.message); return; }
    setBookings(data.map(mapBookingRow));
  };
  useEffect(() => { fetchBookings(); }, []);

  // ---- Eventos: Open Plays y Clases (Torneos ya tiene su propio estado más abajo) ----
  const [openPlays, setOpenPlays] = useState([]);
  const [classes, setClasses] = useState([]);

  // ---- Membresías ----
  // Each plan carries a "rateCard" — free-form line items (league days, drills, etc.) for
  // anything that doesn't have a real booking flow yet. Court reservations and Open Plays
  // used to read a flat memberPrice set on each individual item instead, completely
  // disconnected from what the plan itself advertised (courtPriceInfo/memberDiscountPct) --
  // that's exactly what let a court/Open Play drift out of sync with its own plan's promised
  // discount (v2.29.0 fixed one instance of this; v2.30.0 removes the whole failure mode).
  // courtDiscountPct/openPlayDiscountPct/freeBlocksPerMonth are now the single source of
  // truth for those two categories — editing the plan changes the real price everywhere
  // instantly. Classes keep their own item-level memberPrice: the club never defined a
  // plan-wide class discount, so there's nothing real to migrate there yet.
  const mapPlanRow = (r) => ({
    id: r.id, name: r.name, monthlyPrice: Number(r.monthly_price), privateCourtAccess: r.private_court_access,
    maxMembers: r.max_members != null ? Number(r.max_members) : null,
    // Cuántas horas de anticipación puede reservar cancha/actividades alguien con este plan
    // (v2.27.0) -- 48h por defecto si el plan es viejo y no trae el campo todavía.
    bookingWindowHours: r.booking_window_hours != null ? Number(r.booking_window_hours) : 48,
    // % de descuento sobre el precio base de cancha/Open Play para socios de este plan
    // (v2.30.0), y cuántos bloques de cancha completamente gratis (fuera de horario pico y
    // fuera de días de torneo) tiene cada socio por mes calendario.
    courtDiscountPct: r.court_discount_pct != null ? Number(r.court_discount_pct) : 0,
    openPlayDiscountPct: r.open_play_discount_pct != null ? Number(r.open_play_discount_pct) : 0,
    freeBlocksPerMonth: r.free_blocks_per_month != null ? Number(r.free_blocks_per_month) : 0,
    description: r.description || "",
    // Cada ítem del tarifario guarda UNA de dos cosas, según sea o no el plan base (v2.38.0):
    // el plan base (Sin plan, monthlyPrice===0) guarda priceUsd -- el precio real, fuente de
    // verdad. Cualquier plan pago guarda discountPct -- % de descuento sobre lo que el plan
    // base cobra por ese MISMO label -- ver rateItemDisplay, que resuelve cuál mostrar. Ya no
    // se guarda un `value` pre-formateado a mano (eso era lo que dejaba un plan pago
    // desactualizado si el precio base cambiaba después).
    rateCard: (r.rate_card || []).map((it, i) => ({
      id: it.id || `${r.id}-rate-${i}`, label: it.label,
      priceUsd: it.priceUsd != null ? Number(it.priceUsd) : undefined,
      discountPct: it.discountPct != null ? Number(it.discountPct) : undefined,
    })),
  });
  const [membershipPlans, setMembershipPlans] = useState([]);
  const fetchMembershipPlans = async () => {
    const { data, error } = await supabase.from("membership_plans").select("*").order("monthly_price");
    if (error) { console.error("fetch membership_plans:", error.message); return; }
    setMembershipPlans(data.map(mapPlanRow));
  };
  useEffect(() => { fetchMembershipPlans(); }, []);

  const mapSubscriptionRow = (r) => ({
    id: r.id, planId: r.plan_id, userId: r.user_id, paymentMethod: r.payment_method,
    reference: r.reference, proofName: r.proof_name,
    priceUsd: r.price_usd != null ? Number(r.price_usd) : null, priceBs: r.price_bs != null ? Number(r.price_bs) : null,
    paymentStatus: r.payment_status || "pendiente_efectivo", createdAt: new Date(r.created_at).getTime(),
  });
  const [subscriptions, setSubscriptions] = useState([]);
  const fetchSubscriptions = async () => {
    const { data, error } = await supabase.from("subscriptions").select("*").order("created_at");
    if (error) { console.error("fetch subscriptions:", error.message); return; }
    setSubscriptions(data.map(mapSubscriptionRow));
  };
  useEffect(() => { fetchSubscriptions(); }, []);

  // ---- Cupones de descuento (v2.82.0, ver migración coupons) ----
  // Cada cupón apunta a UN plan puntual con un % de descuento, de un solo uso -- se comparte
  // como link/QR (`?cupon=<code>`, ver publicCoupon más abajo, mismo patrón que publicAct/join)
  // que lleva directo al checkout de ese plan ya descontado. `coupons` (lista completa) es solo
  // para la pantalla de administración (Membresías, admin) -- lectura pública en RLS, pero acá
  // solo hace falta cargarla para quien la vaya a gestionar.
  const mapCouponRow = (r) => ({
    id: r.id, code: r.code, planId: r.plan_id, discountPct: Number(r.discount_pct),
    used: !!r.used, usedBy: r.used_by, usedAt: r.used_at ? new Date(r.used_at).getTime() : null,
    createdAt: new Date(r.created_at).getTime(),
  });
  const [coupons, setCoupons] = useState([]);
  const fetchCoupons = async () => {
    const { data, error } = await supabase.from("coupons").select("*").order("created_at", { ascending: false });
    if (error) { console.error("fetch coupons:", error.message); return; }
    setCoupons(data.map(mapCouponRow));
  };
  // v2.82.1 -- este efecto se movió más abajo (ver `currentUser` cerca de la línea 2060):
  // usarlo acá arriba, en el dependency array, lo leía ANTES de que `currentUser` quedara
  // declarado más abajo en este mismo componente -- un ReferenceError de TDZ real
  // ("Cannot access 'currentUser' before initialization") que tumbaba la app ENTERA en cada
  // carga, para cualquier usuario, no solo admin. Ver el useEffect real más abajo.

  // Código corto, legible, fácil de teclear a mano si el QR no escanea bien -- 6 caracteres en
  // mayúsculas sin 0/O/1/I (se confunden fácil a simple vista). No hay unicidad garantizada acá
  // (la tabla sí tiene `unique` real) -- si por pura mala suerte choca con uno existente, el
  // insert de createCoupon falla y create Coupon simplemente lo reintenta con otro código.
  const genCouponCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };
  const createCoupon = async (planId, discountPct, tries = 0) => {
    if (tries > 5) return { error: "No se pudo generar un código único -- intenta de nuevo." };
    const code = genCouponCode();
    const { data, error } = await supabase.from("coupons").insert({ code, plan_id: planId, discount_pct: Number(discountPct) }).select().single();
    if (error) {
      if (error.code === "23505") return createCoupon(planId, discountPct, tries + 1); // choque de código único -- reintenta con otro
      console.error("createCoupon:", error.message);
      return { error: error.message };
    }
    const created = mapCouponRow(data);
    setCoupons((prev) => [created, ...prev]);
    return { data: created };
  };
  const removeCoupon = async (id) => {
    setCoupons((prev) => prev.filter((c) => c.id !== id));
    const { error } = await supabase.from("coupons").delete().eq("id", id);
    if (error) console.error("removeCoupon:", error.message);
  };
  // Canjear (v2.82.0) -- marca el cupón usado a nombre de quien está logueado AHORA MISMO. La
  // política RLS "authenticated redeem coupons" es la que de verdad protege esto (exige
  // used=false antes y used=true + used_by=auth.uid() después) -- esto solo refleja el
  // resultado en el estado local si el UPDATE real se aceptó.
  const redeemCoupon = async (couponId) => {
    if (!currentUser) return { error: "Necesitas iniciar sesión." };
    const { data, error } = await supabase.from("coupons")
      .update({ used: true, used_by: currentUser.id, used_at: new Date().toISOString() })
      .eq("id", couponId).eq("used", false).select().single();
    if (error || !data) return { error: "Este cupón ya no está disponible -- puede que alguien más lo haya usado justo antes." };
    const updated = mapCouponRow(data);
    setCoupons((prev) => prev.map((c) => (c.id === couponId ? updated : c)));
    // v2.82.0 -- `couponInfo` (resuelto del link/QR con el que se llegó, ver couponCode más
    // arriba) es un estado APARTE de `coupons` -- sin esto, tras canjearlo, el checkout de ESE
    // mismo plan seguiría mostrando el cupón como disponible si el cliente lo reabre a mano en
    // la misma sesión (el canje real igual se rechazaría bien, esto es solo para que la
    // pantalla no siga ofreciendo un descuento que ya no aplica).
    setCouponInfo((prev) => (prev && prev.coupon.id === couponId ? { ...prev, coupon: updated } : prev));
    return { data: updated };
  };

  // ---- Cuentas (login / registro) ----
  // Backend real: Supabase Auth guarda las credenciales; la tabla `profiles` (1:1 con
  // auth.users, creada por un trigger en cuanto alguien se registra — ver supabase/schema.sql)
  // guarda el resto (name, role, planId, zone, teléfono, DUPR...).
  //
  // v2.35.0: `profiles` dejó de ser de lectura pública total -- ahora cada quien solo puede
  // leer su PROPIA fila completa (o cualquiera, si es admin). Lo que sí sigue siendo público
  // (buscar socio por nombre/correo en RegistrantPicker, mostrar nombres en equipos)
  // vive en la vista `profiles_directory`, que solo expone id/name/email/role -- nunca
  // teléfono, zona, DUPR, fecha de nacimiento ni plan de nadie más. `profiles` (estado local:
  // la propia fila siempre, y TODAS si sos admin, según RLS) y `directory` (todas, pero solo
  // esas 4 columnas) se combinan en el `users` derivado de abajo para que el resto de la app
  // (EstadisticasTab, LoyalClientsCard, RegistrantPicker, InscripcionTab...) siga viendo un solo
  // array, igual que antes -- solo que ahora los campos privados de OTRA persona vienen
  // ausentes en vez de expuestos.
  const [profiles, setProfiles] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Supabase abre una sesión temporal de "recuperación" cuando el usuario entra desde el
  // enlace del correo de reset -- no es un login normal, así que se intercepta con este flag
  // para forzar la pantalla de "elige tu nueva contraseña" en vez de dejarlo pasar a la app.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const currentUserId = session?.user?.id || null;

  const mapProfileRow = (p) => ({
    id: p.id, name: p.name, email: p.email, role: p.role, planId: p.plan_id,
    zone: p.zone || "", duprRating: p.dupr_rating ?? null, phone: p.phone || "",
    gender: p.gender || null, birthDate: p.birth_date || null, onboardingCompleted: p.onboarding_completed,
    planExpiresAt: p.plan_expires_at || null, createdAt: new Date(p.created_at).getTime(),
  });
  const mapDirectoryRow = (r) => ({ id: r.id, name: r.name, email: r.email, role: r.role });

  const fetchAllProfiles = async () => {
    const { data, error } = await supabase.from("profiles").select("*").order("created_at");
    if (error) { console.error("fetchAllProfiles:", error.message); return; }
    setProfiles(data.map(mapProfileRow));
  };
  const fetchDirectory = async () => {
    const { data, error } = await supabase.from("profiles_directory").select("*");
    if (error) { console.error("fetch profiles_directory:", error.message); return; }
    setDirectory(data.map(mapDirectoryRow));
  };
  const users = useMemo(() => {
    const byId = {};
    directory.forEach((d) => { byId[d.id] = d; });
    profiles.forEach((p) => { byId[p.id] = { ...byId[p.id], ...p }; }); // el perfil completo (propio, o todos si admin) completa/pisa al del directorio
    return Object.values(byId);
  }, [directory, profiles]);
  const currentUser = users.find((u) => u.id === currentUserId) || null;

  // v2.82.1 -- carga la lista de cupones solo para el admin (ver bloque "Cupones de descuento"
  // más arriba); movido a ESTA línea, después de declarar `currentUser`, para arreglar el
  // ReferenceError de TDZ descrito ahí.
  useEffect(() => { if (currentUser?.role === "admin") fetchCoupons(); }, [currentUser?.role]);

  // Traduce el link compartido (`publicAct`) a navegación real UNA sola vez que hay sesión --
  // ya sea porque el visitante se acaba de loguear/registrar desde PublicActivityView, o
  // porque ya tenía sesión abierta en este dispositivo cuando tocó el link. "torneo" entra
  // directo a ese torneo (activeTournamentId ya alcanza, TorneosSection se encarga del resto);
  // Open Play/Clase necesitan que EventosTab, más abajo, abra el detalle -- eso lo hace su
  // propio efecto leyendo el prop `autoOpen` que le pasamos con el mismo publicAct.
  useEffect(() => {
    if (!publicAct || !currentUser || publicActConsumedRef.current) return;
    publicActConsumedRef.current = true;
    if (publicAct.kind === "torneo") { setActiveTournamentId(publicAct.id); setActiveCatId(null); }
    setTab(publicAct.kind === "torneo" ? "torneos" : "eventos");
    window.history.replaceState({}, "", window.location.pathname);
  }, [publicAct, currentUser]);

  useEffect(() => {
    fetchAllProfiles();
    fetchDirectory();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "SIGNED_IN") fetchAllProfiles(); // trae el perfil recién creado/logueado
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true); // vino del link del correo de reset
      if (event === "SIGNED_OUT") { setTab("club"); setActiveTournamentId(null); setPasswordRecovery(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Registro simplificado: solo correo + contraseña. El resto (nombre, género, fecha de
  // nacimiento, DUPR, domicilio) se pide justo después en el wizard de Onboarding -- el
  // trigger handle_new_user() crea el perfil con onboarding_completed=false, lo que hace
  // que el gate de más abajo (antes de renderizar la app) le muestre el wizard en vez de
  // dejarlo pasar directo.
  const registerUser = async ({ email, password }) => {
    if (!email.trim() || !password) return { error: "Completa todos los campos." };
    const { error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { role: "cliente" } },
    });
    if (error) {
      const msg = /already registered|already exists/i.test(error.message) ? "Ya existe una cuenta con ese correo." : error.message;
      return { error: msg };
    }
    setTab("eventos");
    return {};
  };
  const loginUser = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { error: "Correo o contraseña incorrectos." };
    const { data: prof } = await supabase.from("profiles").select("role").eq("id", data.user.id).single();
    setTab(prof?.role === "admin" ? "club" : "eventos");
    return {};
  };
  const logoutUser = async () => { await supabase.auth.signOut(); };

  // Envía el correo de "recuperar contraseña" (Supabase Auth). redirectTo apunta al origin
  // actual (funciona igual en localhost que en producción) -- Supabase abre esa URL con un
  // token de recuperación que el propio cliente detecta solo (detectSessionInUrl, on por
  // defecto) y dispara el evento PASSWORD_RECOVERY arriba en onAuthStateChange.
  const resetPasswordUser = async (email) => {
    if (!email.trim()) return { error: "Escribe tu correo." };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) return { error: error.message };
    return {};
  };

  // Se llama desde la pantalla de "nueva contraseña" mientras dura la sesión temporal de
  // recuperación. Al terminar, apaga passwordRecovery -- como la sesión ya es válida, el
  // usuario entra directo a la app sin tener que loguearse de nuevo.
  const updatePassword = async (newPassword) => {
    if (!newPassword || newPassword.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres." };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    setPasswordRecovery(false);
    return {};
  };

  const mapTournamentRow = (r) => ({
    id: r.id, name: r.name, status: r.status || "draft", startDate: r.start_date || "", endDate: r.end_date || "",
    dailyStart: r.daily_start, dailyEnd: r.daily_end, playDays: r.play_days || [],
    // v2.81.8 -- ver migración tournament_match_duration: nunca guardados antes de esto, así
    // que una fila vieja sencillamente no tiene el campo -- ?? 35/10 son los MISMOS defaults
    // que ya tenía el useState() de antes, ningún torneo existente cambia de comportamiento.
    matchDuration: r.match_duration_min ?? 35, breakM: r.break_min ?? 10,
    presaleStart: r.presale_start || "", presaleEnd: r.presale_end || "",
    presalePrice1: r.presale_price_1 ?? "", presalePrice2: r.presale_price_2 ?? "", presalePrice3: r.presale_price_3 ?? "",
    regStart: r.reg_start || "", regEnd: r.reg_end || "",
    regularPrice1: r.regular_price_1 ?? "", regularPrice2: r.regular_price_2 ?? "", regularPrice3: r.regular_price_3 ?? "",
    courtIds: r.court_ids || [], image: r.image || "",
  });
  // El club organiza torneos con frecuencia -- `tournaments` trae TODOS los que existan
  // (antes esto era una fila única fija, `.limit(1)`, y no había forma de crear uno nuevo
  // desde la UI). `activeTournamentId` es cuál se está viendo/editando ahora mismo dentro de
  // la pestaña Torneos (null = se muestra la lista, ver TournamentsListTab); `tournament` es
  // ese torneo puntual, derivado, tal como lo esperan TorneosSection y todo lo que cuelga de
  // ahí (no cambiaron su forma de recibir "el torneo" y "sus categorías", solo cuál les llega).
  const [tournaments, setTournaments] = useState(() => loadCache("tournaments", []));
  useEffect(() => {
    supabase.from("tournaments").select("*").order("created_at", { ascending: false }).then(({ data, error }) => {
      if (error) { console.error("fetch tournaments:", error.message); return; }
      setTournaments((data || []).map(mapTournamentRow));
    });
  }, []);
  useEffect(() => { saveCache("tournaments", tournaments); }, [tournaments]);
  // Mismo criterio que `tab` arriba (v2.53.1) -- si al actualizar la página estaba DENTRO de
  // un torneo puntual (viendo Inscritos, Calendario, etc.), que la recargue vuelva a abrir ESE
  // torneo en vez de mandarlo a la lista de Torneos. Se valida contra `tournaments` recién
  // cargado más abajo (si ese id ya no existe -- se borró el torneo -- `tournament` da null y
  // TorneosSection ni se monta, mismo comportamiento que si el admin lo hubiera cerrado a mano).
  const [activeTournamentId, setActiveTournamentId] = useState(() => loadCache("activeTournamentId", null));
  useEffect(() => { saveCache("activeTournamentId", activeTournamentId); }, [activeTournamentId]);
  const tournament = tournaments.find((t) => t.id === activeTournamentId) || null;
  // Botón "Pagos" en la card de un torneo en Actividades (v2.45.1) -- valor de un solo uso
  // que le dice a TorneosSection en qué sub-pestaña aterrizar apenas se abre; se limpia solo
  // apenas se consume (ver TorneosSection) para no pisar un cambio de pestaña posterior.
  const [pendingTorneoSubTab, setPendingTorneoSubTab] = useState(null);

  // "Ver como cliente" (v2.48.0) -- el admin previsualiza la app tal como la ve un socio, SIN
  // cerrar sesión ni cambiar su role real en Supabase: solo pisa la variable `role` de más
  // abajo (el único lugar donde se calcula, de ahí cuelga toda la app -- nav, pestañas
  // admin-only, controles admin dentro de cada tab). `currentUser.role` real queda intacto --
  // Sidebar/TopBar/Perfil lo siguen leyendo directo para el badge "Administrador", así nunca se
  // pierde de vista que sigue siendo admin de verdad. Las reglas de seguridad reales (RLS)
  // también lo siguen tratando como admin -- esto es solo para revisar la interfaz, no
  // reemplaza probar con una cuenta cliente real cuando lo que hace falta confirmar es qué
  // permite o bloquea la base de datos. Persiste en localStorage para sobrevivir un refresh
  // mientras se prueba (sin esto, cada F5 volvería a vista admin a mitad de una prueba).
  const [viewAsClient, setViewAsClient] = useState(() => {
    try { return localStorage.getItem("pickleHub_viewAsClient") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("pickleHub_viewAsClient", viewAsClient ? "1" : "0"); } catch {}
  }, [viewAsClient]);

  // Crea un torneo nuevo y lo deja abierto para editar de inmediato (antes no existía ESTA
  // función -- el único torneo que había se sembró directo en la base de datos, nunca se creó
  // desde la app). Arranca con los mismos defaults sensatos que tenía la fila única sembrada.
  const createTournament = async (name) => {
    const { data, error } = await supabase.from("tournaments").insert({
      name: name?.trim() || "Nuevo torneo", status: "draft", daily_start: "08:00", daily_end: "20:00",
    }).select().single();
    if (error) { console.error("createTournament:", error.message); return { error: error.message }; }
    const created = mapTournamentRow(data);
    setTournaments((prev) => [created, ...prev]);
    setActiveTournamentId(created.id);
    setActiveCatId(null);
    return { data: created };
  };

  // Controla el formulario inline "Crear nuevo torneo" de TournamentsListTab desde afuera --
  // vive acá (no dentro de ese componente) para que el botón "+ Torneo" de Actividades
  // (EventosTab) pueda abrirlo de una al navegar, en vez de que el admin tenga que volver a
  // pulsar "Crear nuevo torneo" una vez ya en la pestaña Torneos.
  const [tournamentFormOpen, setTournamentFormOpen] = useState(false);

  // Borra un torneo completo. `tournaments.id` tiene ON DELETE CASCADE hacia
  // categories.tournament_id (ver supabase/schema.sql) -- la base se lleva sus categorías/
  // equipos/partidos sola. Acá solo hace falta alinear el estado local a mano (categories no
  // se vuelve a consultar solo). Si era el torneo que se estaba editando, vuelve a la lista.
  const removeTournament = (id) => {
    setTournaments((prev) => prev.filter((t) => t.id !== id));
    setCategories((prev) => prev.filter((c) => c.tournamentId !== id));
    if (activeTournamentId === id) { setActiveTournamentId(null); setActiveCatId(null); }
    supabase.from("tournaments").delete().eq("id", id).then(({ error }) => { if (error) console.error("removeTournament:", error.message); });
  };

  // Actualiza local al toque y persiste en `tournaments` en segundo plano (mismo patrón que
  // updateClub) -- ahora actualiza SOLO la fila del torneo activo dentro del array completo.
  const updateTournament = (patch) => {
    if (!tournament) return;
    const id = tournament.id;
    setTournaments((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("status" in patch) dbPatch.status = patch.status;
    if ("startDate" in patch) dbPatch.start_date = patch.startDate || null;
    if ("endDate" in patch) dbPatch.end_date = patch.endDate || null;
    if ("dailyStart" in patch) dbPatch.daily_start = patch.dailyStart;
    if ("dailyEnd" in patch) dbPatch.daily_end = patch.dailyEnd;
    if ("matchDuration" in patch) dbPatch.match_duration_min = Number(patch.matchDuration) || null;
    if ("breakM" in patch) dbPatch.break_min = Number(patch.breakM) || null;
    if ("playDays" in patch) dbPatch.play_days = patch.playDays;
    if ("presaleStart" in patch) dbPatch.presale_start = patch.presaleStart || null;
    if ("presaleEnd" in patch) dbPatch.presale_end = patch.presaleEnd || null;
    if ("presalePrice1" in patch) dbPatch.presale_price_1 = patch.presalePrice1 === "" ? null : patch.presalePrice1;
    if ("presalePrice2" in patch) dbPatch.presale_price_2 = patch.presalePrice2 === "" ? null : patch.presalePrice2;
    if ("presalePrice3" in patch) dbPatch.presale_price_3 = patch.presalePrice3 === "" ? null : patch.presalePrice3;
    if ("regStart" in patch) dbPatch.reg_start = patch.regStart || null;
    if ("regEnd" in patch) dbPatch.reg_end = patch.regEnd || null;
    if ("regularPrice1" in patch) dbPatch.regular_price_1 = patch.regularPrice1 === "" ? null : patch.regularPrice1;
    if ("regularPrice2" in patch) dbPatch.regular_price_2 = patch.regularPrice2 === "" ? null : patch.regularPrice2;
    if ("regularPrice3" in patch) dbPatch.regular_price_3 = patch.regularPrice3 === "" ? null : patch.regularPrice3;
    if ("courtIds" in patch) dbPatch.court_ids = patch.courtIds;
    if ("image" in patch) dbPatch.image = patch.image || null;
    supabase.from("tournaments").update(dbPatch).eq("id", id).then(({ error }) => {
      if (error) console.error("updateTournament:", error.message);
    });
    // Push "nueva actividad publicada" (v2.42.0) -- justo el momento en que un torneo pasa de
    // borrador a visible para todos (ver "Torneo status" en CLAUDE.md), no antes.
    if (patch.status === "published") {
      sendPush("activity_published", { title: "Nuevo torneo publicado", body: `Ya puedes inscribirte en "${tournament.name}".`, url: "/" });
    }
  };

  // Flyer promocional del torneo (v2.33.0), mismo patrón que addOpenPlay: el archivo ya viene
  // redimensionado/recomprimido (ver resizeImageToBlob, llamado desde TorneoTab) y se sube UNA
  // vez a su propio bucket público -- acá solo hace falta subirlo y guardar la URL resultante
  // en la fila del torneo activo (updateTournament ya sabe persistir "image").
  const uploadTournamentImage = async (blob) => {
    if (!tournament) return { error: "No hay torneo seleccionado." };
    try {
      const path = `${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("tournament-images").upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      const url = supabase.storage.from("tournament-images").getPublicUrl(path).data.publicUrl;
      updateTournament({ image: url });
      return {};
    } catch (err) {
      console.error("uploadTournamentImage:", err?.message || err);
      return { error: err?.message || "No se pudo subir la imagen." };
    }
  };

  // v2.81.8 -- INCIDENTE REAL: esto era un useState(35)/useState(10) SUELTO, nunca guardado en
  // ningún lado -- cada dispositivo/pestaña/recarga arrancaba de cero sin importar qué se
  // había configurado antes. Como la grilla de Calendario (`timeSlotOptions`) se arma con estos
  // dos números, un desfase entre el valor "vigente ahora" y el que de verdad se usó para
  // agendar los partidos hacía que un partido ya agendado no calzara en ninguna fila de la
  // grilla nueva y pareciera desaparecido -- justo lo que reportó el club ("desde el celular me
  // muestra otro calendario", "al cambiar la duración los partidos se separan"). Ahora vive en
  // el propio torneo (mismo criterio que dailyStart/dailyEnd) -- todo dispositivo/sesión ve
  // siempre el mismo valor real. `set*` sigue viéndose igual desde afuera (una función que
  // recibe el valor nuevo) para no tocar ningún llamador existente.
  const matchDuration = tournament?.matchDuration ?? 35;
  const breakM = tournament?.breakM ?? 10;
  const setMatchDuration = (v) => updateTournament({ matchDuration: v });
  const setBreakM = (v) => updateTournament({ breakM: v });

  const mapCategoryRow = (r) => ({
    id: r.id, tournamentId: r.tournament_id, name: r.name, format: r.format, modality: r.modality, gender: r.gender, level: r.level,
    maxTeams: r.max_teams, minTeams: r.min_teams, seedMode: r.seed_mode, bestOf: r.best_of, bracketSize: r.bracket_size,
    teams: r.teams || [], waitlist: r.waitlist || [], groups: r.groups || [], matches: r.matches || [],
    drawGenerated: r.draw_generated, groupsClosed: r.groups_closed,
  });
  // `categories` trae TODAS las categorías de TODOS los torneos del club (no se filtra en la
  // query) -- necesario para que occupiedKeys (más abajo) bloquee canchas cruzando torneos.
  // Cada pantalla de un torneo puntual (TorneosSection) recibe el subconjunto ya filtrado por
  // `tournamentId` al armar sus props, nunca este array completo directo.
  const [categories, setCategories] = useState(() => loadCache("categories", []));
  useEffect(() => {
    supabase.from("categories").select("*").order("created_at").then(({ data, error }) => {
      if (error) { console.error("fetch categories:", error.message); return; }
      setCategories(data.map(mapCategoryRow));
    });
  }, []);
  // Mantiene la copia en caché al día con CUALQUIER cambio (carga inicial, updateCategory,
  // runScheduler, addCategory/removeCategory...) -- así reabrir la app durante un apagón sigue
  // mostrando el calendario/categorías tal como quedaron, en vez de pantalla vacía (v2.34.0).
  useEffect(() => { saveCache("categories", categories); }, [categories]);
  // Bitácora de inscripciones (v2.80.6, ver logRegistration/migración registration_log) --
  // INSERT-only, nada la puede sobreescribir desde la UI. Solo el admin puede leerla (RLS); se
  // carga una vez al confirmar ese rol, no necesita refrescarse en vivo -- es historial de
  // consulta, no un dato que se edite desde acá.
  const [registrationLog, setRegistrationLog] = useState([]);
  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    supabase.from("registration_log").select("*").order("created_at", { ascending: false }).limit(300).then(({ data, error }) => {
      if (error) { console.error("fetch registration_log:", error.message); return; }
      setRegistrationLog(data || []);
    });
  }, [currentUser?.role]);
  const [activeCatId, setActiveCatId] = useState(null);
  const [scheduleInfo, setScheduleInfo] = useState(null);
  // App-wide player ranking directory: { "nombre en minúsculas": { name, ranking } }
  // Vive en la tabla `player_directory` -- historial de ranking sugerido, compartido por
  // todos los organizadores, no solo dentro de la sesión de un navegador.
  const [playerDirectory, setPlayerDirectory] = useState({});
  useEffect(() => {
    supabase.from("player_directory").select("*").then(({ data, error }) => {
      if (error) { console.error("fetch player_directory:", error.message); return; }
      const dict = {};
      (data || []).forEach((r) => { dict[r.key] = { name: r.name, ranking: Number(r.ranking) }; });
      setPlayerDirectory(dict);
    });
  }, []);

  const activeCat = categories.find((c) => c.id === activeCatId) || null;
  // `currentPlan` son los beneficios REALES vigentes (v2.27.0) -- precio de miembro y ventana
  // de reserva -- no simplemente "el plan al que está suscrito". Un plan pago vencido vuelve a
  // los beneficios del plan gratuito hasta que se renueve, aunque currentUser.planId siga
  // apuntando al plan vencido (eso se conserva a propósito: ProfileTab/MembresiasTab resuelven
  // su propio `plan` local, sin pasar por esta variable, para poder seguir mostrando "Plan PRO
  // · Vencida" + botón Renovar en vez de que el vencimiento borre de dónde vino el usuario).
  const subscribedPlan = membershipPlans.find((p) => p.id === currentUser?.planId) || membershipPlans[0];
  const subscribedPlanExpired = !!subscribedPlan && subscribedPlan.monthlyPrice > 0 && !!currentUser?.planExpiresAt
    && currentUser.planExpiresAt < new Date().toISOString().slice(0, 10);
  const currentPlan = subscribedPlanExpired
    ? (membershipPlans.find((p) => p.monthlyPrice === 0) || membershipPlans[0])
    : subscribedPlan;

  // `tournament` es null mientras se está viendo la lista de torneos (nadie seleccionado
  // todavía) -- dates queda vacío en ese caso, nadie lo necesita hasta entrar a uno puntual.
  const dates = useMemo(
    () => (tournament ? filterDatesByPlayDays(dateRange(tournament.startDate, tournament.endDate), tournament.playDays) : []),
    [tournament]
  );

  // Every block already claimed by a booking, an Open Play, a class or a scheduled tournament
  // match — the single source of truth so nothing ever gets double-booked across modules.
  // v2.69.0: solo cuenta un partido de torneo `locked` (comprometido de verdad) -- uno sin
  // bloquear es apenas provisional (el panel Planificar lo puede volver a mezclar en cualquier
  // momento, ver buildSchedule) y NO debe "ocuparse a sí mismo": antes de este cambio, un
  // partido ya agendado pero sin fijar contaba como ocupado acá, así que Planificar nunca
  // conseguía volver a ubicarlo (todas sus franjas se veían "tomadas" por él mismo) -- quedaba
  // en "0 planificados" aunque hubiera de sobra espacio libre real.
  const occupiedKeys = useMemo(() => {
    const set = new Set();
    bookings.forEach((b) => { if (b.status !== "cancelada") set.add(blockKey(b.courtId, b.date, b.timeMin)); });
    openPlays.forEach((e) => e.occupiedBlocks.forEach((b) => set.add(blockKey(b.courtId, b.date, b.timeMin))));
    classes.forEach((e) => e.occupiedBlocks.forEach((b) => set.add(blockKey(b.courtId, b.date, b.timeMin))));
    categories.forEach((cat) => cat.matches.forEach((m) => {
      if (m.day && m.courtId && m.locked && !isByeMatch(m)) set.add(blockKey(m.courtId, m.day, timeToMinutes(m.time)));
    }));
    return set;
  }, [bookings, openPlays, classes, categories]);

  // Punto único por el que pasan setCategoryFormat/addTeam/removePersonFromCategory/
  // generateDraw/closeGroupsAndSeedBracket/submitScore -- persistir acá cubre los seis de una vez.
  // NOTA: no se puede leer una variable asignada *dentro* del updater de setCategories
  // justo después de llamarlo -- en React 18 ese updater no corre síncronamente, corre
  // en el siguiente render. Por eso `updated` se calcula ACÁ AFUERA, a partir del
  // `categories` del closure de este render (que si es el actual), y se usa tanto para
  // el setState como para el guardado en Supabase.
  // Cola de cambios de torneo pendientes de sincronizar (v2.34.0): updateCategory/runScheduler
  // ya actualizan el estado local al instante (optimista) -- lo que faltaba era qué pasa si el
  // guardado en Supabase FALLA (sin señal en medio de un torneo): antes se perdía en silencio,
  // solo un console.error, sin aviso ni reintento. Como cada guardado manda la fila COMPLETA de
  // la categoría (no un delta), no hace falta una cola de operaciones en orden -- basta con
  // quedarse con el ÚLTIMO intento pendiente por categoría (en un ref, para no depender de
  // closures viejas) y reintentarlo entero en cuanto vuelva la señal. `pendingCategoryCount` es
  // solo para que la UI muestre el aviso ("N cambios sin sincronizar").
  const pendingCategoryWritesRef = useRef(loadCache("pendingCategoryWrites", {})); // { [catId]: { fields, upsert } }
  const [pendingCategoryCount, setPendingCategoryCount] = useState(Object.keys(pendingCategoryWritesRef.current).length);

  // Async desde v2.44.4 (antes era fire-and-forget con .then()) -- devuelve {error} para que
  // quien de verdad necesita saber si el guardado llegó a pasar (ver updateCategory) pueda
  // esperarlo. Sigue encolando para reintento automático igual que antes -- esto no le quita
  // la resiliencia sin internet al admin, solo le agrega a QUIEN LLAMA la posibilidad de
  // enterarse del resultado en el momento, en vez de solo el aviso "N sin sincronizar" (que
  // además es admin-only, ver más abajo el porqué de este cambio).
  // v2.82.2 -- `expectedRev` (opcional): cuando se pasa, el UPDATE se condiciona a que la
  // columna `rev` de la fila siga siendo esa misma (control de concurrencia optimista, ver
  // comentario de updateCategory más abajo y la migración categories_rev_concurrency). Si
  // nadie más escribió en el medio, el UPDATE afecta la fila y de paso sube `rev` en 1; si
  // alguien SÍ escribió en el medio, `rev` ya cambió, el UPDATE no afecta ninguna fila (0
  // filas, sin error), y devolvemos `conflict: true` para que updateCategory reintente en vez
  // de asumir que se guardó.
  const persistCategoryWrite = async (id, fields, upsert = false, expectedRev = null) => {
    let query;
    if (upsert) {
      query = supabase.from("categories").upsert({ id, ...fields }).select("id");
    } else if (expectedRev != null) {
      query = supabase.from("categories").update({ ...fields, rev: expectedRev + 1 }).eq("id", id).eq("rev", expectedRev).select("id");
    } else {
      query = supabase.from("categories").update(fields).eq("id", id).select("id");
    }
    const { data, error } = await query;
    const conflict = !error && expectedRev != null && !upsert && (!data || data.length === 0);
    const next = { ...pendingCategoryWritesRef.current };
    if (error) { console.error("persistCategoryWrite:", error.message); next[id] = { fields, upsert }; }
    else if (!conflict) delete next[id];
    pendingCategoryWritesRef.current = next;
    saveCache("pendingCategoryWrites", next);
    setPendingCategoryCount(Object.keys(next).length);
    return { error: error?.message || null, conflict };
  };
  const flushPendingCategoryWrites = () => {
    Object.entries(pendingCategoryWritesRef.current).forEach(([id, { fields, upsert }]) => persistCategoryWrite(id, fields, upsert));
  };
  // Reintenta la cola sola: al recuperar señal (evento "online" del navegador) y de respaldo
  // cada 20s -- "online" no siempre dispara de forma confiable (wifi "conectado" pero sin
  // salida real a internet), así que el intervalo es quien de verdad garantiza que se vacíe.
  // También reintenta una vez al montar, por si quedaron pendientes de una sesión anterior.
  useEffect(() => {
    if (Object.keys(pendingCategoryWritesRef.current).length > 0) flushPendingCategoryWrites();
    const onOnline = () => flushPendingCategoryWrites();
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => { if (Object.keys(pendingCategoryWritesRef.current).length > 0) flushPendingCategoryWrites(); }, 20000);
    return () => { window.removeEventListener("online", onOnline); clearInterval(interval); };
  }, []);

  // Devuelve la promesa de persistCategoryWrite (v2.44.4) -- el update optimista de
  // setCategories sigue siendo instantáneo (nunca espera a la red), pero ahora quien llama
  // PUEDE (no tiene que) esperar el resultado real antes de decirle al usuario "listo".
  // Ningún llamador existente que no lo esperaba se rompe -- una promesa sin await simplemente
  // corre en segundo plano, igual que antes.
  //
  // v2.80.5 -- INCIDENTE REAL DE PÉRDIDA DE DATOS: esta función leía `current` del estado LOCAL
  // (`categories`), que se carga UNA sola vez al abrir la pantalla (ver el useEffect de arriba
  // -- no hay Supabase Realtime, nada refresca esto solo) y escribía TODO el array
  // `teams`/`waitlist` de vuelta como un swap completo, no un merge. Si alguien se inscribió en
  // esa MISMA categoría después de que este navegador cargó -- o mientras la pestaña del admin
  // quedó abierta toda la noche -- la siguiente escritura desde ese navegador pisaba esa
  // inscripción sin que nadie la tocara a propósito ni la borrara a mano. Pasó de verdad:
  // Nicolás Merchán/Camila Sangster se inscribieron por su cuenta (push de confirmación
  // incluido) y una acción del admin sobre esa MISMA categoría (quitar a otra persona) los
  // borró de encuentro -- "last write wins" sobre una copia vieja. Ahora se relee la categoría
  // FRESCA de Supabase justo antes de aplicar `updater`, así el cambio siempre parte del estado
  // real más reciente en vez de lo que el navegador recuerde de cuando cargó la página. Si el
  // refetch falla por red (no porque la fila se haya borrado), cae de vuelta al estado local
  // como último recurso -- mismo riesgo de antes, pero solo cuando de verdad no hay conexión.
  // v2.82.2 -- INCIDENTE REAL: releer la fila fresca (v2.80.5, arriba) evita que una pestaña
  // vieja pise datos nuevos, pero NO evita que DOS llamadas a updateCategory sobre la MISMA
  // categoría, casi al mismo milisegundo (ej. un jugador auto-inscribiéndose por checkout
  // mientras el admin empareja una dupla a mano en esa misma categoría), se pisen entre sí --
  // ambas leen la misma fila "fresca" antes de que ninguna haya escrito, cada una calcula su
  // propio `updated` por separado, y la que escribe SEGUNDA borra sin avisar lo que la primera
  // acababa de guardar. Pasó de verdad la noche antes del ACP 500: se perdieron así la
  // inscripción de Norvelys Calvo, la de María Kurilo, y el emparejo de Armando Valdivieso con
  // Ronald Ascanio -- las tres notificaciones push SÍ llegaron (se mandan solo si el guardado
  // "tuvo éxito" desde el punto de vista de quien lo hizo), pero el dato ya no estaba.
  //
  // Ahora cada intento manda el `rev` que leyó junto con el guardado (control de concurrencia
  // optimista, ver persistCategoryWrite y la migración categories_rev_concurrency) -- el UPDATE
  // solo aplica si `rev` sigue siendo ese mismo número. Si alguien más ya escribió en el medio,
  // el guardado no afecta ninguna fila (en vez de pisarla) y acá se detecta como `conflict`:
  // se relee la categoría YA CON ese otro cambio incluido, se reaplica `updater` sobre eso, y se
  // reintenta -- hasta 5 veces, lo cual cubre con margen incluso una ráfaga de inscripciones
  // simultáneas la noche antes de un torneo.
  const updateCategory = async (id, updater, attempt = 0) => {
    const { data: freshRow } = await supabase.from("categories").select("*").eq("id", id).single();
    const current = freshRow ? mapCategoryRow(freshRow) : categories.find((c) => c.id === id);
    if (!current) return { error: "Esta categoría ya no existe." };
    const updated = updater({ ...current });
    setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
    const expectedRev = freshRow ? (freshRow.rev || 0) : null;
    const result = await persistCategoryWrite(id, {
      name: updated.name, max_teams: updated.maxTeams, min_teams: updated.minTeams, seed_mode: updated.seedMode,
      best_of: updated.bestOf, bracket_size: updated.bracketSize, format: updated.format,
      draw_generated: updated.drawGenerated, groups_closed: updated.groupsClosed,
      teams: updated.teams, waitlist: updated.waitlist, groups: updated.groups, matches: updated.matches,
    }, false, expectedRev);
    if (result?.conflict && attempt < 5) return updateCategory(id, updater, attempt + 1);
    if (result?.conflict) return { error: "Dos personas guardaron esto al mismo tiempo -- intenta de nuevo." };
    return result;
  };

  // Reprograma un partido ya agendado a mano (grid de CalendarioTab, tap-origen →
  // tap-destino) y lo marca `locked` para que buildSchedule() ya no lo toque la próxima
  // vez que se corra el asistente ("Actualizar calendario"). No valida conflictos acá --
  // CalendarioTab ya corrió `checkMoveConflict` antes de llamar y le mostró la advertencia
  // al organizador si hacía falta; esta función solo aplica el cambio y persiste (vía
  // updateCategory, que ya cubre el guardado en Supabase de una categoría).
  const moveMatch = (categoryId, matchId, { day, time, courtId }) => {
    updateCategory(categoryId, (c) => {
      c.matches = c.matches.map((m) => (m.id === matchId ? { ...m, day, time, courtId, locked: true } : m));
      return c;
    });
  };
  // Quita el pin de un partido movido a mano -- vuelve a quedar disponible para que
  // buildSchedule() lo recalcule la próxima vez que se corra el asistente. Conserva su
  // día/hora/cancha actual hasta que eso pase (no lo deja "flotando" sin horario).
  const unlockMatch = (categoryId, matchId) => {
    updateCategory(categoryId, (c) => {
      c.matches = c.matches.map((m) => (m.id === matchId ? { ...m, locked: false } : m));
      return c;
    });
  };
  // "En cancha" (v2.79.1, a pedido del club) -- todo partido arranca sin `checkedIn` (falsy por
  // default, ningún match-creation site lo tiene que setear a mano) hasta que mesa técnica
  // confirma en el panel "En cancha ahora" que los jugadores YA entraron a la cancha de
  // verdad -- antes de eso se muestra resaltado, con un botón "En cancha" en vez de "Cargar
  // marcador", para que no se olvide anunciar el partido y verificar que entren. Persiste (vía
  // updateCategory) para que cualquier dispositivo/refresh de la mesa técnica vea el mismo
  // estado -- no es un estado local del componente.
  const markMatchOnCourt = (categoryId, matchId) => {
    updateCategory(categoryId, (c) => {
      c.matches = c.matches.map((m) => (m.id === matchId ? { ...m, checkedIn: true } : m));
      return c;
    });
  };
  // Reordenar arrastrando dentro de una cancha, o empujando en cadena entre dos (v2.73.0 /
  // v2.74.x) -- el partido soltado se inserta en el puesto elegido y TODOS los que quedaban
  // entre su horario viejo y el nuevo se corren un puesto para abrirle campo, en vez de
  // intercambiarse sin más con uno solo. `updates` ya viene armado por CalendarioTab (ver
  // reorderWithinColumn/reorderAcrossColumns ahí) como una lista plana de {categoryId, matchId,
  // day, time, courtId}; acá solo se agrupa por categoría para que cada una se guarde en UN
  // solo updateCategory -- dos updateCategory seguidos a la misma categoría se pisarían entre
  // sí (el segundo partiría de un `current` todavía viejo, sin el cambio del primero, y su
  // guardado en Supabase lo revertiría en silencio).
  const reorderColumn = (updates) => {
    const byCategory = {};
    updates.forEach((u) => { (byCategory[u.categoryId] = byCategory[u.categoryId] || []).push(u); });
    Object.entries(byCategory).forEach(([catId, ups]) => {
      updateCategory(catId, (c) => {
        c.matches = c.matches.map((m) => {
          const u = ups.find((x) => x.matchId === m.id);
          return u ? { ...m, day: u.day, time: u.time, courtId: u.courtId, locked: true } : m;
        });
        return c;
      });
    });
  };
  // "Limpiar este día" del panel Planificar (v2.69.0) -- vacía el horario de TODAS las
  // categorías del torneo activo para esa fecha puntual (incluidos los partidos fijados a
  // mano/planificados, ver `locked`), sin tocar ningún otro día. Mismo patrón que
  // `runScheduler`: clona solo el subconjunto del torneo activo, muta el clon, y persiste
  // categoría por categoría para que un corte de señal a mitad de camino dañe como mucho una
  // categoría (la cola de pendientes se encarga del resto).
  const clearDaySchedule = (date) => {
    if (!tournament) return;
    const scoped = categories.filter((c) => c.tournamentId === tournament.id);
    const clone = structuredClone(scoped);
    let touched = false;
    clone.forEach((c) => c.matches.forEach((m) => {
      if (m.day === date) { m.day = null; m.time = null; m.courtId = null; m.locked = false; touched = true; }
    }));
    if (!touched) return;
    setCategories((prev) => prev.map((c) => clone.find((cc) => cc.id === c.id) || c));
    clone.forEach((c) => persistCategoryWrite(c.id, {
      tournament_id: tournament.id, name: c.name, modality: c.modality, gender: c.gender, level: c.level,
      max_teams: c.maxTeams, min_teams: c.minTeams, seed_mode: c.seedMode, best_of: c.bestOf, bracket_size: c.bracketSize, format: c.format,
      draw_generated: c.drawGenerated, groups_closed: c.groupsClosed,
      teams: c.teams, waitlist: c.waitlist, groups: c.groups, matches: c.matches,
    }, true));
  };

  // Looks up a player's suggested ranking from the directory (read-only unless the organizer overrides it).
  const suggestedRanking = (name) => {
    const row = playerDirectory[name.trim().toLowerCase()];
    return row ? row.ranking : "";
  };
  // Only the organizer's explicit edit calls this with force=true; auto-fill never overwrites a stored value.
  const upsertPlayerRanking = (name, ranking, force = false) => {
    const key = name.trim().toLowerCase();
    if (!key) return;
    if (playerDirectory[key] && !force) return; // never silently overwrite an existing ranking
    const entry = { name: name.trim(), ranking: Number(ranking) || 0 };
    setPlayerDirectory((prev) => ({ ...prev, [key]: entry }));
    supabase.from("player_directory").upsert({ key, name: entry.name, ranking: entry.ranking }).then(({ error }) => {
      if (error) console.error("upsertPlayerRanking:", error.message);
    });
  };

  const addCategory = async (modality, gender, level, maxTeams, minTeams) => {
    const { data: row, error } = await supabase.from("categories").insert({
      tournament_id: tournament.id, name: makeCategoryName(modality, gender, level),
      modality, gender, level, max_teams: maxTeams ? Number(maxTeams) : null, min_teams: minTeams ? Number(minTeams) : null,
      seed_mode: "ranking", best_of: 3, bracket_size: 4,
      teams: [], waitlist: [], groups: [], matches: [], draw_generated: false, groups_closed: false,
    }).select().single();
    if (error) { console.error("addCategory:", error.message); return; }
    const cat = mapCategoryRow(row);
    setCategories((p) => [...p, cat]);
    setActiveCatId(cat.id);
    setTab("torneos"); // "categorias" es una sub-pestaña de TorneosSection, no un tab de nivel superior
  };

  const removeCategory = (id) => {
    setCategories((p) => p.filter((c) => c.id !== id));
    if (activeCatId === id) setActiveCatId(null);
    supabase.from("categories").delete().eq("id", id).then(({ error }) => { if (error) console.error("removeCategory:", error.message); });
  };

  // The format is chosen once registration numbers are known (see FormatAdvisor), not at category creation.
  const setCategoryFormat = (catId, format) => {
    updateCategory(catId, (c) => {
      c.format = format;
      c.drawGenerated = false;
      c.groupsClosed = false;
      c.groups = [];
      c.matches = [];
      return c;
    });
    setScheduleInfo(null);
  };

  // Shared by both the organizer's roster editor and the player self-registration screen.
  // Automatically fills the waitlist once maxTeams is reached — no organizer action required.
  // `checkout` is optional — the organizer's manual roster editor (CategoriasTab) omits it;
  // the player self-registration screen (InscripcionTab) passes the CheckoutPanel result so
  // the payment/price sticks to the team record for the loyalty/revenue stats.
  // Devuelve {teamId, error} (v2.44.4, antes solo el id sin chequear si de verdad se guardó) --
  // AWAIT de verdad al resultado de updateCategory en vez de fire-and-forget: un socio
  // pagando su propia inscripción necesita saber YA MISMO si el guardado falló, no enterarse
  // nunca porque el aviso de "sin sincronizar" solo lo ve el admin (ver persistCategoryWrite).
  // Esto fue justo lo que pasó con al menos un socio real el día del lanzamiento -- el
  // checkout mostraba "¡Listo!" con el equipo ya optimísticamente en pantalla, pero el guardado
  // en Supabase nunca llegó a confirmar (quedó solo en la cola de reintento de este navegador,
  // invisible para el jugador) y nunca apareció para el admin.
  const addTeam = async (catId, players, checkout) => {
    const teamId = uid("team");
    const name = players.map((p) => p.name).join(" / ");
    players.forEach((p) => upsertPlayerRanking(p.name, p.ranking, true));
    const result = await updateCategory(catId, (c) => {
      // Sin checkout (organizador anotando un walk-in a mano, ver InscripcionAdminForm) arranca
      // igual que un pago en efectivo -- "por pagar" -- nunca se asume cobrado solo por
      // registrarse; el admin lo pasa a "pago verificado" cuando de verdad reciba el dinero.
      const paymentStatus = checkout ? initialPaymentStatus(checkout.paymentMethod) : "pendiente_efectivo";
      const team = { id: teamId, name, players, createdAt: Date.now(), ...(checkout || {}), paymentStatus };
      // v2.57.0: cupo real en JUGADORES, no en filas -- ver categoryIsFull. Antes esto
      // comparaba contra c.teams.length, así que en dobles cada persona anotándose SOLA
      // (esperando pareja) ocupaba una fila entera del cupo en vez de solo su mitad.
      if (categoryIsFull(c)) {
        c.waitlist = [...c.waitlist, team];
      } else {
        c.teams = [...c.teams, team];
      }
      return c;
    });
    // Push a los admins con cada inscripción real (v2.52.0) -- "admins_except_caller" en
    // api/send-push.js decide el destino: si quien llama es admin (auto-registro, o un
    // walk-in anotado a mano en Duplas), no se manda a sí mismo un aviso de su propia acción.
    if (!result?.error) {
      const cat = categories.find((c) => c.id === catId);
      const tournament = tournaments.find((t) => t.id === cat?.tournamentId);
      sendPush("new_registration", {
        title: "Nueva inscripción",
        body: `${name} se inscribió en ${cat?.name || "una categoría"}${tournament ? ` -- ${tournament.name}` : ""}.`,
        url: "/",
      });
      logRegistration({
        tournamentId: tournament?.id, tournamentName: tournament?.name,
        categoryId: catId, categoryName: cat?.name,
        playerNames: name, source: checkout ? "checkout" : "walkin",
      });
    }
    return { teamId, error: result?.error };
  };
  // Une un segundo jugador a un equipo de DOBLES que quedó "esperando pareja" -- a diferencia
  // de addTeam, no crea un equipo nuevo (v2.44.2, reemplaza "invitar por correo/WhatsApp": antes
  // ese modo anotaba a la pareja de una, sin cuenta ni pago propio, cobrándole todo al que
  // creaba el equipo; ahora cada quien paga su propia inscripción, cuando de verdad se anota).
  // El precio/estado de pago de este jugador se guarda en SU PROPIO objeto dentro de
  // `players` -- nunca se mezcla con el de quien creó el equipo (createTeam ya dejó el suyo en
  // los campos de nivel de equipo, ver arriba), porque pudieron pagar en momentos y métodos
  // distintos. Devuelve {error} si el cupo ya no existe, alguien más ya lo tomó primero, o el
  // guardado en Supabase falló de verdad (v2.44.4, AWAIT real -- ver mismo comentario en
  // addTeam) -- el llamador debe avisarle a este jugador en vez de dejarlo creer que ya quedó
  // unido cuando en realidad no se guardó nada.
  const joinTeam = async (catId, teamId, player, checkout) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return { error: "Esta categoría ya no existe." };
    const team = cat.teams.find((t) => t.id === teamId) || cat.waitlist.find((t) => t.id === teamId);
    if (!team) return { error: "Este cupo ya no existe -- puede que lo hayan borrado." };
    if ((team.players || []).length >= 2) return { error: "Este cupo ya se completó -- alguien más se anotó primero." };
    // v2.61.0: una dupla MIXTA es 1 hombre + 1 mujer, nunca 2 del mismo género -- nada lo
    // impedía hasta ahora (el filtro de "categorías elegibles" en InscripcionTab/JoinTeamModal
    // deja pasar CUALQUIER género para "mixto" a propósito, porque cualquiera puede ARRANCAR un
    // cupo mixto; lo que faltaba validar es que la SEGUNDA persona que se une sea del género
    // contrario). El team/player guardado no lleva gender (solo vive en profiles/directory), así
    // que se resuelve buscando el userId de cada quien en `users`. Si no se puede saber el
    // género de alguno de los dos (invitado sin cuenta, perfil incompleto) no se bloquea -- mismo
    // criterio de "si no se conoce, no se filtra" que ya usa el resto de la app.
    if (cat.gender === "mixto") {
      const creator = team.players[0];
      const creatorGender = users.find((u) => u.id === creator?.userId)?.gender;
      const joinerGender = users.find((u) => u.id === player.userId)?.gender;
      if (creatorGender && joinerGender && creatorGender === joinerGender) {
        return { error: `Esta categoría es mixta -- necesita 1 hombre y 1 mujer. ${creator?.name || "Quien creó este cupo"} ya está anotado/a, así que no te puedes unir con el mismo género.` };
      }
    }
    upsertPlayerRanking(player.name, player.ranking, true);
    const paymentStatus = initialPaymentStatus(checkout.paymentMethod, checkout.priceUsd);
    const joinedPlayer = {
      ...player, priceUsd: checkout.priceUsd, priceBs: checkout.priceBs, paymentMethod: checkout.paymentMethod,
      reference: checkout.reference, proofName: checkout.proofName, paymentStatus, joinedAt: Date.now(),
    };
    const result = await updateCategory(catId, (c) => {
      const patch = (t) => {
        if (t.id !== teamId) return t;
        const players = [...t.players, joinedPlayer];
        return { ...t, players, name: players.map((p) => p.name).join(" / ") };
      };
      c.teams = c.teams.map(patch);
      c.waitlist = c.waitlist.map(patch);
      return c;
    });
    // Push a los admins (v2.52.0) -- mismo criterio que addTeam, ver ese comentario.
    if (!result?.error) {
      const tournament = tournaments.find((t) => t.id === cat.tournamentId);
      sendPush("new_registration", {
        title: "Nueva inscripción",
        body: `${player.name} se unió al equipo de ${team.players[0]?.name || "alguien"} en ${cat.name}${tournament ? ` -- ${tournament.name}` : ""}.`,
        url: "/",
      });
      logRegistration({
        tournamentId: tournament?.id, tournamentName: tournament?.name,
        categoryId: catId, categoryName: cat.name,
        playerNames: `${player.name} (se unió a ${team.players[0]?.name || "alguien"})`, source: "join_partner",
      });
    }
    return { error: result?.error };
  };
  // Estado de pago del SEGUNDO jugador de un equipo, cuando pagó su propia inscripción por
  // separado (ver joinTeam) -- setTeamPaymentStatus sigue gobernando el pago de quien creó el
  // equipo, este es su equivalente para el que se unió después. Ver TeamRegistration para
  // cuándo se muestra uno u otro (o ambos).
  const setPlayerPaymentStatus = (catId, teamId, playerIdx, paymentStatus) => {
    updateCategory(catId, (c) => {
      const patch = (t) => (t.id === teamId ? { ...t, players: t.players.map((p, i) => (i === playerIdx ? { ...p, paymentStatus } : p)) } : t);
      c.teams = c.teams.map(patch);
      c.waitlist = c.waitlist.map(patch);
      return c;
    });
  };
  // Pago PARCIAL de una categoría puntual (v2.80.3) -- caso real: Flor Monttalti quedó anotada
  // en una categoría de $20 pero solo pagó $15 (el resto de un carrito de 2 categorías que se
  // desarmó). Antes de esto, "pagado" era todo o nada -- ver buildTournamentParticipants, que
  // asumía SIEMPRE el precio completo (`priceUsd`) apenas el estatus dejaba de ser
  // "pendiente_efectivo". Esto guarda un `paidUsd`/`paidBs` EXPLÍCITO, que puede ser menor al
  // precio total, sin fingir que ya entró todo -- buildTournamentParticipants usa este valor en
  // vez de asumir el precio completo cuando existe (ver comentario ahí). Si lo pagado cubre el
  // precio entero, se marca "confirmada" igual que el flujo viejo; si no, se queda
  // "pendiente_verificacion" -- hay plata real registrada, pero falta el resto.
  const recordPartialPayment = async (catId, teamId, playerIdx, { paidUsd, paidBs, paymentMethod, reference }) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return { error: "Esta categoría ya no existe." };
    const list = cat.teams || [];
    if (list.filter((t) => t.id === teamId).length > 1) {
      return { error: `Hay más de un equipo con el mismo identificador en "${cat.name}" (dato corrupto) -- no se guardó nada. Avísale al admin de la app para revisarlo a mano.` };
    }
    const team = list.find((t) => t.id === teamId);
    if (!team) return { error: "Este cupo ya no existe -- puede que lo hayan borrado." };
    const target = playerIdx > 0 ? team.players?.[playerIdx] : team;
    const priceUsd = Number(target?.priceUsd) || 0;
    const paymentStatus = Number(paidUsd) >= priceUsd ? "confirmada" : "pendiente_verificacion";
    const result = await updateCategory(catId, (c) => {
      const patch = (t) => {
        if (t.id !== teamId) return t;
        if (playerIdx > 0) {
          return { ...t, players: t.players.map((p, i) => (i === playerIdx ? { ...p, paidUsd: Number(paidUsd) || 0, paidBs: Number(paidBs) || 0, paymentMethod, reference: reference || "", paymentStatus } : p)) };
        }
        return { ...t, paidUsd: Number(paidUsd) || 0, paidBs: Number(paidBs) || 0, paymentMethod, reference: reference || "", paymentStatus };
      };
      c.teams = c.teams.map(patch);
      c.waitlist = c.waitlist.map(patch);
      return c;
    });
    if (result?.error) return { error: result.error };
    if (paymentStatus === "confirmada" && target?.userId) {
      sendPush("payment_confirmed", { userId: target.userId, title: "Pago verificado", body: "Tu inscripción al torneo quedó confirmada.", url: "/" });
    }
    return {};
  };
  // Borra a UNA persona de una categoría puntual (v2.50.0) -- reemplaza a los removeTeam/
  // removeFromWaitlist de antes, que borraban el EQUIPO entero sin distinguir cuál de los dos
  // jugadores era el que en realidad se quería sacar. Ahora: si es el titular (players[0]), el
  // equipo entero desaparece de esta categoría -- nadie más queda con ese cupo. Si es quien se
  // unió después por su cuenta (players[1], ver joinTeam), sale SOLO ella -- el titular
  // conserva su propio cupo ya pagado, el equipo vuelve a "esperando pareja" en vez de
  // desaparecer entero. AWAIT real (mismo criterio que addTeam/joinTeam desde v2.44.4): el
  // único lugar que llama a esto es Inscritos (ver removePersonFromTournament ahí mismo, que
  // puede llamarlo varias veces seguidas para borrar a la misma persona de TODAS sus
  // categorías de una) -- el borrado ya no vive en Duplas/TeamRegistration.
  // v2.55.0: además reajusta el precio de las categorías que le QUEDAN a esta persona en el
  // mismo torneo -- si pagó 2 categorías juntas ($35, repartido $17.50 c/u -- ver
  // InscripcionTab/JoinTeamModal, mismo criterio de reparto parejo) y se retira de una, la que
  // le queda debe pasar a costar lo que cuesta 1 sola categoría ($20), no quedarse pegada para
  // siempre en el precio de "categoría adicional" de un carrito que ya no existe. NUNCA toca
  // una categoría cuyo pago YA esté verificado -- eso es plata que de verdad entró; cambiar ese
  // número después sería falsear la contabilidad. El ajuste solo alcanza a lo que sigue "por
  // verificar" (ver rebalancePersonPricing).
  const removePersonFromCategory = async (catId, teamId, playerIdx, inWaitlist) => {
    const targetCat = categories.find((c) => c.id === catId);
    if (!targetCat) return { error: "Esta categoría ya no existe." };
    // v2.61.0: blindaje contra IDs duplicados -- uid() ya no debería producirlos (ver su
    // comentario, esto es lo que causó que borrar a UNA persona se llevara de encuentro a otras
    // que por accidente compartían el mismo "team_id"), pero datos viejos de ANTES de ese fix
    // podrían seguir teniendo colisiones sin detectar. Si el id no es único en esta lista, mejor
    // no borrar nada que arriesgarse a borrar al equipo equivocado en silencio otra vez.
    const list = inWaitlist ? (targetCat.waitlist || []) : (targetCat.teams || []);
    if (list.filter((t) => t.id === teamId).length > 1) {
      console.error(`removePersonFromCategory: id de equipo duplicado ("${teamId}") en "${targetCat.name}" -- abortado.`);
      return { error: `Hay más de un equipo con el mismo identificador en "${targetCat.name}" (dato corrupto de una colisión de IDs vieja) -- no se borró nada para no arriesgarse a borrar al equipo equivocado. Avísale al admin de la app para revisarlo a mano.` };
    }
    const removedTeam = list.find((t) => t.id === teamId);
    const removedPlayer = removedTeam?.players?.[playerIdx];
    const personKey = removedPlayer ? (removedPlayer.userId || (removedPlayer.name || "").trim().toLowerCase()) : null;
    const tournamentId = targetCat.tournamentId;

    const result = await updateCategory(catId, (c) => {
      if (inWaitlist) {
        c.waitlist = playerIdx === 0
          ? c.waitlist.filter((t) => t.id !== teamId)
          : c.waitlist.map((t) => (t.id === teamId ? { ...t, players: t.players.filter((_, i) => i !== playerIdx) } : t));
        return c;
      }
      if (playerIdx === 0) {
        c.teams = c.teams.filter((t) => t.id !== teamId);
        // Mismo criterio que el removeTeam de antes: si se vació un cupo de verdad (no solo
        // se achicó un equipo de dobles a 1 jugador), promover de la lista de espera.
        if (c.waitlist.length > 0) {
          const [promoted, ...restWaitlist] = c.waitlist;
          c.teams = [...c.teams, promoted];
          c.waitlist = restWaitlist;
        }
      } else {
        c.teams = c.teams.map((t) => (t.id === teamId ? { ...t, players: t.players.filter((_, i) => i !== playerIdx) } : t));
      }
      return c;
    });
    if (result?.error) return { error: result.error };
    if (personKey && tournamentId) await rebalancePersonPricing(tournamentId, personKey, catId);
    return {};
  };

  // "Cambiar de categoría" (v2.80.0, a pedido del club: alguien quedó anotado en la categoría
  // que no le corresponde -- nivel, género, lo que sea) -- solo para una inscripción SOLA
  // ("esperando pareja", team.players.length === 1). Una dupla ya formada primero hay que
  // desemparejarla (splitTeam) y mover a cada quien por separado -- mover a los dos juntos
  // arrastraría a la pareja a una categoría que ella nunca eligió, sin preguntarle.
  //
  // A diferencia de addTeam, el precio/estado de pago que YA tenía se conserva TAL CUAL -- no
  // se recalcula para la categoría nueva (el club lo pidió así: es la misma persona, el mismo
  // dinero, solo cambió dónde compite). Por eso esto copia el objeto `team` completo en vez de
  // llamar a addTeam (que generaría un paymentStatus nuevo desde cero).
  //
  // Orden deliberado -- agrega primero, borra después: si el segundo paso fallara (red, etc.),
  // el peor caso es quedar registrada en LAS DOS categorías (visible, se corrige a mano) en vez
  // de en NINGUNA (se perdería la inscripción sin que nadie lo note). Mismo blindaje de IDs
  // duplicados que removePersonFromCategory.
  const moveSoloRegistration = async (fromCatId, teamId, toCatId) => {
    const fromCat = categories.find((c) => c.id === fromCatId);
    if (!fromCat) return { error: "La categoría de origen ya no existe." };
    const toCat = categories.find((c) => c.id === toCatId);
    if (!toCat) return { error: "La categoría destino ya no existe." };
    const inWaitlist = (fromCat.waitlist || []).some((t) => t.id === teamId);
    const list = inWaitlist ? (fromCat.waitlist || []) : (fromCat.teams || []);
    if (list.filter((t) => t.id === teamId).length > 1) {
      return { error: `Hay más de un equipo con el mismo identificador en "${fromCat.name}" (dato corrupto) -- no se movió nada. Avísale al admin de la app para revisarlo a mano.` };
    }
    const team = list.find((t) => t.id === teamId);
    if (!team) return { error: "Este cupo ya no existe -- puede que lo hayan borrado." };
    if ((team.players || []).length !== 1) return { error: "Solo se puede cambiar de categoría a alguien que todavía está esperando pareja -- desempareja la dupla primero (Duplas → Desemparejar)." };
    // Blindaje: que la categoría destino no la tenga ya inscrita -- sin esto, moverla ahí
    // crearía una SEGUNDA fila para la misma persona en esa categoría en vez de reemplazar nada.
    const player = team.players[0];
    const personKey = player.userId || (player.name || "").trim().toLowerCase();
    const alreadyThere = [...(toCat.teams || []), ...(toCat.waitlist || [])].some((t) =>
      (t.players || []).some((p) => (p.userId || (p.name || "").trim().toLowerCase()) === personKey));
    if (alreadyThere) return { error: `${player.name} ya está inscrita en "${toCat.name}" -- no se puede mover ahí de nuevo.` };

    const addResult = await updateCategory(toCatId, (c) => {
      if (categoryIsFull(c)) c.waitlist = [...c.waitlist, team];
      else c.teams = [...c.teams, team];
      return c;
    });
    if (addResult?.error) return { error: addResult.error };

    const removeResult = await updateCategory(fromCatId, (c) => {
      if (inWaitlist) { c.waitlist = c.waitlist.filter((t) => t.id !== teamId); return c; }
      c.teams = c.teams.filter((t) => t.id !== teamId);
      if (c.waitlist.length > 0) {
        const [promoted, ...restWaitlist] = c.waitlist;
        c.teams = [...c.teams, promoted];
        c.waitlist = restWaitlist;
      }
      return c;
    });
    if (removeResult?.error) return { error: `Se agregó a "${toCat.name}" pero no se pudo quitar de "${fromCat.name}" (${removeResult.error}) -- revisa a mano, puede haber quedado inscrita en las dos.` };
    return {};
  };

  // Une dos inscripciones sueltas "esperando pareja" de la MISMA categoría en una sola dupla
  // (v2.66.0, pestaña Duplas) -- a pedido del club: hasta ahora la única forma de completar un
  // cupo era que la propia pareja abriera el link de invitación y pagara por su cuenta; si el
  // admin ya sabe quién va con quién (dos personas que se registraron cada una por su lado), no
  // había manera de juntarlas sin borrar una de las dos inscripciones y perder su pago.
  // `targetTeamId` es la fila que SOBREVIVE (el otro jugador entra ahí como players[1], con SU
  // PROPIO pago -- mismo shape que deja joinTeam cuando alguien se une por el link real, así el
  // resto de la app -- buildTournamentParticipants, Pagos, Inscritos -- no necesita tratarlo
  // distinto); `sourceTeamId` es la fila que desaparece. Nunca toca ningún pago -- cada quien se
  // queda con el suyo, solo se combinan en una fila. Mismo blindaje de IDs duplicados que
  // removePersonFromCategory (ver su comentario) y misma regla de género en categorías mixtas
  // que joinTeam (nunca dos del mismo género, ver ese comentario para el porqué).
  const mergeIntoTeam = async (catId, targetTeamId, sourceTeamId) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return { error: "Esta categoría ya no existe." };
    const matchesTarget = (cat.teams || []).filter((t) => t.id === targetTeamId);
    const matchesSource = (cat.teams || []).filter((t) => t.id === sourceTeamId);
    if (matchesTarget.length > 1 || matchesSource.length > 1) {
      return { error: "Hay equipos con el mismo identificador en esta categoría (dato corrupto) -- no se unió nada para no arriesgarse a mezclar al equipo equivocado. Avísale al admin de la app para revisarlo a mano." };
    }
    const target = matchesTarget[0];
    const source = matchesSource[0];
    if (!target || !source) return { error: "Uno de los dos cupos ya no existe -- puede que ya se haya emparejado o borrado." };
    if ((target.players || []).length !== 1 || (source.players || []).length !== 1) {
      return { error: "Alguno de los dos cupos ya no está esperando pareja." };
    }
    if (cat.gender === "mixto") {
      const g1 = users.find((u) => u.id === target.players[0].userId)?.gender;
      const g2 = users.find((u) => u.id === source.players[0].userId)?.gender;
      if (g1 && g2 && g1 === g2) {
        return { error: "Esta categoría es mixta -- necesita 1 hombre y 1 mujer, no puedes emparejar a dos del mismo género." };
      }
    }
    const mergedPlayer = {
      ...source.players[0], priceUsd: source.priceUsd, priceBs: source.priceBs,
      paymentMethod: source.paymentMethod, reference: source.reference, proofName: source.proofName,
      paymentStatus: source.paymentStatus, joinedAt: source.createdAt,
    };
    const result = await updateCategory(catId, (c) => {
      c.teams = c.teams.filter((t) => t.id !== sourceTeamId).map((t) => {
        if (t.id !== targetTeamId) return t;
        const players = [...t.players, mergedPlayer];
        return { ...t, players, name: players.map((p) => p.name).join(" / ") };
      });
      return c;
    });
    return result?.error ? { error: result.error } : {};
  };

  // Deshace un emparejamiento -- separa al segundo jugador de una dupla completa de vuelta en
  // su propio cupo "esperando pareja" (v2.66.1, inverso de mergeIntoTeam justo arriba: mismo
  // shape, mismo criterio de blindaje). Solo tiene sentido cuando ese segundo jugador tiene SU
  // PROPIO pago guardado (paymentStatus !== undefined -- vino de mergeIntoTeam o de un join real
  // por link): un equipo completo anotado a mano por el organizador (TeamRegistration, ambos
  // nombres juntos, sin checkout) no tiene de dónde sacar un pago propio para el segundo, así
  // que ahí no aplica -- se bloquea antes de intentarlo en vez de inventar un pago que no
  // existió. Nunca toca el pago de nadie -- cada quien se queda con el suyo, solo se separan en
  // dos filas de nuevo.
  const splitTeam = async (catId, teamId) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return { error: "Esta categoría ya no existe." };
    const matches = (cat.teams || []).filter((t) => t.id === teamId);
    if (matches.length > 1) {
      return { error: `Hay más de un equipo con el mismo identificador en "${cat.name}" (dato corrupto) -- no se separó nada para no arriesgarse a tocar al equipo equivocado. Avísale al admin de la app para revisarlo a mano.` };
    }
    const team = matches[0];
    if (!team) return { error: "Este equipo ya no existe." };
    const partner = team.players?.[1];
    if (!partner || partner.paymentStatus === undefined) {
      return { error: "Este equipo no se puede separar -- el segundo jugador no tiene un pago propio guardado." };
    }
    const newTeam = {
      id: uid("team"), name: partner.name,
      players: [{ name: partner.name, ranking: partner.ranking || 0, ...(partner.userId ? { userId: partner.userId } : {}) }],
      paymentMethod: partner.paymentMethod, priceUsd: partner.priceUsd, priceBs: partner.priceBs,
      reference: partner.reference, proofName: partner.proofName, paymentStatus: partner.paymentStatus,
      createdAt: partner.joinedAt || Date.now(), userName: partner.name,
      ...(partner.userId ? { userId: partner.userId } : {}),
    };
    const result = await updateCategory(catId, (c) => {
      c.teams = c.teams.map((t) => (t.id === teamId ? { ...t, players: t.players.slice(0, 1), name: t.players[0].name } : t));
      c.teams = [...c.teams, newTeam];
      return c;
    });
    return result?.error ? { error: result.error } : {};
  };

  // Recalcula el precio de las categorías SIN VERIFICAR que le quedan a una persona en un
  // torneo, justo después de quitarle una (v2.55.0). Mismo reparto parejo que usa el checkout
  // (tournamentRegPrice(tournament, N) / N), aplicado de nuevo con la N que le queda de verdad.
  // `justRemovedCatId` se descarta a mano de la búsqueda porque el closure de `categories` acá
  // todavía es el de ANTES del borrado que se acaba de guardar (React no re-renderiza a mitad
  // de esta función) -- confiar en que ya no aparezca sin este descarte volvería a contar una
  // categoría que en la práctica ya se fue.
  const rebalancePersonPricing = async (tournamentId, personKey, justRemovedCatId) => {
    const tournament = tournaments.find((t) => t.id === tournamentId);
    if (!tournament) return;
    const matchesPerson = (p) => (p.userId || (p.name || "").trim().toLowerCase()) === personKey;
    const remaining = [];
    categories.forEach((c) => {
      if (c.tournamentId !== tournamentId || c.id === justRemovedCatId) return;
      [...(c.teams || []), ...(c.waitlist || [])].forEach((team) => {
        (team.players || []).forEach((p, idx) => {
          if (!matchesPerson(p)) return;
          const ownPayment = idx > 0 && p.paymentStatus !== undefined;
          const paymentStatus = ownPayment ? p.paymentStatus : team.paymentStatus;
          if (paymentStatus === "confirmada") return; // plata ya verificada -- no se toca
          remaining.push({ catId: c.id, teamId: team.id, playerIdx: idx, ownPayment });
        });
      });
    });
    if (remaining.length === 0) return;
    const total = tournamentRegPrice(tournament, remaining.length);
    const pricePerCat = total / remaining.length;
    const bsRate = Number(club.bsPerUsd) || 0;
    for (const r of remaining) {
      await updateCategory(r.catId, (c) => {
        const patch = (t) => {
          if (t.id !== r.teamId) return t;
          if (r.ownPayment) {
            return { ...t, players: t.players.map((p, i) => (i === r.playerIdx ? { ...p, priceUsd: pricePerCat, priceBs: pricePerCat * bsRate } : p)) };
          }
          return { ...t, priceUsd: pricePerCat, priceBs: pricePerCat * bsRate };
        };
        c.teams = (c.teams || []).map(patch);
        c.waitlist = (c.waitlist || []).map(patch);
        return c;
      });
    }
  };
  // Estado de pago de un equipo (v2.21.0) -- vive en el propio JSONB de `teams` (igual que el
  // resto de sus campos), así que basta con un patch normal via updateCategory, sin migración.
  const setTeamPaymentStatus = (catId, teamId, paymentStatus) => {
    updateCategory(catId, (c) => {
      c.teams = c.teams.map((t) => (t.id === teamId ? { ...t, paymentStatus } : t));
      return c;
    });
    // Push "pago verificado" (v2.42.0) -- a cada jugador del equipo que tenga cuenta (un
    // compañero invitado por correo, sin userId todavía, simplemente no recibe nada).
    if (paymentStatus === "confirmada") {
      const team = categories.find((c) => c.id === catId)?.teams.find((t) => t.id === teamId);
      (team?.players || []).forEach((p) => {
        if (p.userId) sendPush("payment_confirmed", { userId: p.userId, title: "Pago verificado", body: "Tu inscripción al torneo quedó confirmada.", url: "/" });
      });
    }
  };

  const generateDraw = (catId, opts) => {
    updateCategory(catId, (c) => {
      c.seedMode = opts.seedMode;
      c.bestOf = opts.bestOf;
      let matches = [];
      let groups = [];
      if (c.format === "eliminatoria") {
        matches = buildDirectBracket(c.id, c.teams, opts.seedMode);
      } else if (c.format === "doble_eliminacion") {
        matches = buildDoubleElimination(c.id, c.teams, opts.seedMode);
      } else if (c.format === "liga") {
        groups = [{ id: uid("grp"), name: "Liga General", teamIds: c.teams.map((t) => t.id), qualifiers: c.teams.length }];
        roundRobinPairs(groups[0].teamIds).forEach((round) => {
          round.forEach(([a, b]) => {
            matches.push(makeGroupMatch(c.id, groups[0].id, a, b));
          });
        });
      } else if (c.format === "grupos") {
        // simple: split evenly into opts.numGroups groups, no playoff
        const n = Math.max(1, Number(opts.numGroups) || 1);
        const meta = [];
        const base = Math.floor(c.teams.length / n), extra = c.teams.length % n;
        for (let i = 0; i < n; i++) meta.push({ size: base + (i < extra ? 1 : 0), qualifiers: base + (i < extra ? 1 : 0) });
        groups = distributeTeamsToGroups(c.teams, meta, opts.seedMode);
        groups.forEach((g) => {
          roundRobinPairs(g.teamIds).forEach((round) => {
            round.forEach(([a, b]) => matches.push(makeGroupMatch(c.id, g.id, a, b)));
          });
        });
      } else if (c.format === "grupos_eliminatoria") {
        const bracketSize = nextPow2(Number(opts.bracketSize));
        c.bracketSize = bracketSize;
        const meta = computeGroupDistribution(c.teams.length, bracketSize);
        groups = distributeTeamsToGroups(c.teams, meta, opts.seedMode);
        groups.forEach((g) => {
          roundRobinPairs(g.teamIds).forEach((round) => {
            round.forEach(([a, b]) => matches.push(makeGroupMatch(c.id, g.id, a, b)));
          });
        });
        const bracketMatches = buildQualifierBracket(c.id, groups, bracketSize);
        matches = [...matches, ...bracketMatches];
      }
      c.groups = groups;
      c.matches = matches;
      c.drawGenerated = true;
      c.groupsClosed = c.format !== "grupos_eliminatoria";
      return c;
    });
    setScheduleInfo(null);
  };

  function makeGroupMatch(categoryId, groupId, a, b) {
    return {
      id: uid("m"), categoryId, phase: "group", groupId, round: null,
      teamAId: a, teamBId: b, teamALabel: null, teamBLabel: null,
      sets: [], winnerId: null, nextMatchId: null, nextSlot: null,
      day: null, time: null, courtId: null,
    };
  }

  const closeGroupsAndSeedBracket = (catId) => {
    updateCategory(catId, (c) => {
      c.groups.forEach((g) => {
        const standings = computeStandings(c.teams, g.teamIds, c.matches.filter((m) => m.groupId === g.id));
        g.standings = standings;
      });
      c.matches.forEach((m) => {
        if (m.phase === "bracket" && m.teamASrc && m.teamASrc.type !== "winner" && !m.teamAId) {
          const g = c.groups.find((gr) => gr.id === m.teamASrc.groupId);
          const row = g && g.standings && g.standings[m.teamASrc.rank - 1];
          if (row) { m.teamAId = row.teamId; m.teamALabel = row.name; }
        }
        if (m.phase === "bracket" && m.teamBSrc && m.teamBSrc.type !== "winner" && !m.teamBId) {
          const g = c.groups.find((gr) => gr.id === m.teamBSrc.groupId);
          const row = g && g.standings && g.standings[m.teamBSrc.rank - 1];
          if (row) { m.teamBId = row.teamId; m.teamBLabel = row.name; }
        }
      });
      propagateWinner(c.matches, null);
      c.groupsClosed = true;
      return c;
    });
    setScheduleInfo(null);
  };

  // v2.81.0: quitar/reasignar una dupla de un grupo YA generado -- a pedido del club: alguien
  // se retira o quedó en el grupo equivocado DESPUÉS de generar el draw, y hasta ahora la única
  // forma de corregirlo era regenerar TODO el draw de la categoría (perdiendo cualquier
  // resultado ya cargado en los demás grupos). `removeTeamFromGroup` deja ese cupo VACÍO (null)
  // en vez de encoger el grupo -- así el admin ve el hueco y lo puede volver a llenar en vez de
  // perder la cuenta de cuántos cupos tiene el grupo -- y borra los partidos de fase de grupos
  // donde esa dupla jugaba (ya no pueden jugarse; si alguno ya tenía marcador cargado, ese
  // resultado se pierde -- inevitable, la dupla que lo jugó ya no está en el grupo).
  const removeTeamFromGroup = (catId, groupId, teamId) => {
    updateCategory(catId, (c) => {
      c.groups = c.groups.map((g) => (g.id !== groupId ? g : { ...g, teamIds: g.teamIds.map((tid) => (tid === teamId ? null : tid)) }));
      c.matches = c.matches.filter((m) => !(m.groupId === groupId && (m.teamAId === teamId || m.teamBId === teamId)));
      return c;
    });
  };
  // Inversa de arriba: llena un cupo vacío (null) de un grupo con una dupla que todavía no
  // tiene grupo asignado en esta categoría, y genera sus partidos de fase de grupos contra cada
  // rival que YA está en ese grupo (mismo formato que makeGroupMatch/generateDraw). No los
  // programa por su cuenta -- esos partidos nuevos salen "sin horario" hasta la próxima corrida
  // de "Actualizar calendario" (buildSchedule ya garantiza que todo partido sin horario termine
  // ubicado, ver v2.75.0).
  const assignTeamToGroupSlot = (catId, groupId, slotIndex, newTeamId) => {
    updateCategory(catId, (c) => {
      const group = c.groups.find((g) => g.id === groupId);
      if (!group) return c;
      const others = group.teamIds.filter((tid, i) => i !== slotIndex && tid);
      c.groups = c.groups.map((g) => (g.id !== groupId ? g : { ...g, teamIds: g.teamIds.map((tid, i) => (i === slotIndex ? newTeamId : tid)) }));
      const newMatches = others.map((otherId) => makeGroupMatch(catId, groupId, newTeamId, otherId));
      c.matches = [...c.matches, ...newMatches];
      return c;
    });
  };

  const submitScore = (catId, matchId, sets) => {
    updateCategory(catId, (c) => {
      const m = c.matches.find((mm) => mm.id === matchId);
      if (!m) return c;
      m.sets = sets;
      let setsA = 0, setsB = 0;
      sets.forEach((s) => {
        if (Number(s.a) > Number(s.b)) setsA++;
        else if (Number(s.b) > Number(s.a)) setsB++;
      });
      m.winnerId = setsA > setsB ? m.teamAId : setsB > setsA ? m.teamBId : null;
      propagateWinner(c.matches, m.id);
      return c;
    });
  };

  // ---- Reservas ----
  const createBooking = async (data) => {
    // `free_block` (cupo mensual gratis del plan, v2.30.0) es lo que deja contar cuántos
    // bloques gratis ya usó este socio este mes (ver ReservasTab) -- el estado de pago sale
    // solo de priceUsd (0 => "confirmada" directo, nada que verificar).
    const status = initialPaymentStatus(data.paymentMethod, data.priceUsd);
    const { data: row, error } = await supabase.from("bookings").insert({
      court_id: data.courtId, date: data.date, time_min: data.timeMin, block_minutes: data.blockMinutes,
      user_id: data.userId, user_name: data.userName, status, free_block: !!data.freeBlock,
      payment_method: data.freeBlock ? null : data.paymentMethod, reference: data.reference, proof_name: data.proofName,
      price_usd: data.priceUsd, price_bs: data.priceBs,
    }).select().single();
    if (error) { console.error("createBooking:", error.message); return null; }
    const booking = mapBookingRow(row);
    setBookings((p) => [...p, booking]);
    return booking;
  };
  const cancelBooking = (id) => {
    setBookings((p) => p.map((b) => (b.id === id ? { ...b, status: "cancelada" } : b)));
    supabase.from("bookings").update({ status: "cancelada" }).eq("id", id).then(({ error }) => {
      if (error) console.error("cancelBooking:", error.message);
    });
  };
  const confirmBooking = (id) => {
    setBookings((p) => p.map((b) => (b.id === id ? { ...b, status: "confirmada" } : b)));
    supabase.from("bookings").update({ status: "confirmada" }).eq("id", id).then(({ error }) => {
      if (error) console.error("confirmBooking:", error.message);
    });
    const booking = bookings.find((b) => b.id === id);
    if (booking?.userId) sendPush("payment_confirmed", { userId: booking.userId, title: "Pago verificado", body: "Tu reserva de cancha quedó confirmada.", url: "/" });
  };

  // ---- Eventos: Open Plays y Clases ----
  const computeOccupiedBlocks = (courtIds, date, startTime, endTime) => {
    const blocks = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes)
      .filter((t) => t >= timeToMinutes(startTime) && t < timeToMinutes(endTime));
    const out = [];
    courtIds.forEach((courtId) => blocks.forEach((timeMin) => out.push({ courtId, date, timeMin })));
    return out;
  };

  const mapRegistrationRow = (r) => ({
    id: r.id, userId: r.user_id, userName: r.user_name, paymentMethod: r.payment_method,
    reference: r.reference, proofName: r.proof_name, attended: !!r.attended,
    paymentStatus: r.payment_status || "confirmada",
    priceUsd: r.price_usd != null ? Number(r.price_usd) : null, priceBs: r.price_bs != null ? Number(r.price_bs) : null,
    createdAt: new Date(r.created_at).getTime(),
  });
  const mapOpenPlayRow = (r) => ({
    id: r.id, type: "open_play", name: r.name, image: r.image || "", level: r.level,
    price: Number(r.price), memberPrice: Number(r.member_price), capacity: r.capacity,
    description: r.description || "", courtIds: r.court_ids || [], date: r.date,
    startTime: r.start_time, endTime: r.end_time, recurringGroupId: r.recurring_group_id,
    occupiedBlocks: r.occupied_blocks || [],
    registrations: (r.open_play_registrations || []).map(mapRegistrationRow),
    createdAt: new Date(r.created_at).getTime(),
  });
  const mapClassRow = (r) => ({
    id: r.id, type: "clase", academyName: r.academy_name, level: r.level,
    price: Number(r.price), memberPrice: Number(r.member_price),
    courtIds: r.court_ids || [], date: r.date, startTime: r.start_time, endTime: r.end_time,
    recurringGroupId: r.recurring_group_id, occupiedBlocks: r.occupied_blocks || [],
    registrations: (r.class_registrations || []).map(mapRegistrationRow),
    createdAt: new Date(r.created_at).getTime(),
  });

  const fetchOpenPlays = async () => {
    const { data, error } = await supabase.from("open_plays").select("*, open_play_registrations(*)").order("date");
    if (error) { console.error("fetch open_plays:", error.message); return; }
    setOpenPlays(data.map(mapOpenPlayRow));
  };
  const fetchClasses = async () => {
    const { data, error } = await supabase.from("classes").select("*, class_registrations(*)").order("date");
    if (error) { console.error("fetch classes:", error.message); return; }
    setClasses(data.map(mapClassRow));
  };
  // Bandera de "ya sabemos qué hay" (v2.43.0), solo para PublicActivityView -- sin ella, un
  // visitante sin cuenta con internet lento vería "esta actividad ya no está disponible" por
  // el instante en que openPlays/classes todavía están vacíos, antes de que el fetch
  // resuelva -- un falso negativo confuso. La app logueada no necesita este flag: ahí una
  // lista vacía momentánea nunca se muestra como "no existe", solo como "cargando".
  const [activitiesLoaded, setActivitiesLoaded] = useState(false);
  useEffect(() => { Promise.all([fetchOpenPlays(), fetchClasses()]).finally(() => setActivitiesLoaded(true)); }, []);

  // Todo lo que ve el dashboard de Estadísticas se trae una sola vez al montar la app -- si un
  // socio se activa desde otra sesión (o el admin lo activa y sigue navegando sin recargar la
  // página), Ingresos/MRR/Membresías activas se quedan mostrando lo que había al loguearse, no
  // el estado real (esto es lo que hacía que "Ingresos totales" pudiera verse en $0 después de
  // activar a alguien: el número era correcto, pero viejo). EstadisticasTab llama esto solo al
  // entrar al tab, más un botón manual -- no vale la pena un canal realtime todavía para un
  // club de este tamaño.
  const refreshStats = async () => {
    await Promise.all([fetchAllProfiles(), fetchBookings(), fetchSubscriptions(), fetchOpenPlays(), fetchClasses()]);
  };

  // A recurring Open Play (e.g. "Jueves de DUPR, todos los jueves a las 6pm") se guarda como
  // una fila independiente por cada ocurrencia semanal -- todas comparten recurring_group_id
  // (un UUID generado acá, porque Postgres necesita el mismo valor en cada fila del lote)
  // para que la UI las agrupe/borre en bloque.
  const addOpenPlay = async ({ recurrence, imageBlob, ...data }) => {
    try {
      // Si hay imagen, se sube UNA sola vez a Storage (como Blob directo -- ver
      // OpenPlayForm.handleImage, que ahora usa canvas.toBlob() en vez de toDataURL()) y
      // todas las ocurrencias de la serie guardan la misma URL pública. Antes se pasaba
      // por un data URL base64 y luego fetch(dataURL).blob() para volver a convertirlo a
      // Blob -- ese viaje de ida y vuelta es lo que hacía que subir una sola imagen
      // "tardara" (codificar/decodificar un string base64 de cientos de KB en el hilo
      // principal) y lo que más probablemente seguía haciendo fallar las series largas
      // (fetch() sobre data: URIs muy grandes es conocido por fallar o colgarse en varios
      // navegadores). Subir el Blob tal cual evita ambos problemas.
      let imageUrl = "";
      if (imageBlob) {
        const path = `${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from("open-play-images").upload(path, imageBlob, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        imageUrl = supabase.storage.from("open-play-images").getPublicUrl(path).data.publicUrl;
      }

      const occurrenceDates = expandWeeklyDates(data.date, recurrence?.until);
      const seriesId = occurrenceDates.length > 1 ? crypto.randomUUID() : null;
      const rows = occurrenceDates.map((dt) => ({
        // member_price ya no lo llena OpenPlayForm (v2.30.0: el precio de socio sale del %
        // del plan, no de esta actividad) -- data.memberPrice siempre venía undefined, y
        // mandarlo así rompía el insert entero (la columna es not null, sin poder omitirla).
        // 0 es el valor correcto ahora: la columna queda muerta pero coherente con lo que ya
        // se migró en el resto de Open Plays existentes (ver 20260902010829).
        name: data.name, image: imageUrl, level: data.level, price: data.price, member_price: 0,
        capacity: data.capacity, description: data.description || "", court_ids: data.courtIds,
        date: dt, start_time: data.startTime, end_time: data.endTime, recurring_group_id: seriesId,
        occupied_blocks: computeOccupiedBlocks(data.courtIds, dt, data.startTime, data.endTime),
      }));
      const { data: inserted, error } = await supabase.from("open_plays").insert(rows).select();
      if (error) throw error;
      setOpenPlays((p) => [...p, ...inserted.map((r) => mapOpenPlayRow({ ...r, open_play_registrations: [] }))]);
      // Push "nueva actividad publicada" (v2.42.0) -- un solo aviso por creación, aunque sea
      // una serie recurrente de varias fechas (nadie quiere 8 notificaciones idénticas).
      sendPush("activity_published", { title: "Nuevo Open Play", body: `Se abrió "${data.name}" -- ${formatDateHuman(occurrenceDates[0])}.`, url: "/" });
      return {};
    } catch (err) {
      console.error("addOpenPlay:", err?.message || err);
      return { error: err?.message || "No se pudo crear la actividad. Si tiene imagen, intenta con una más liviana." };
    }
  };
  // Mismo patrón de expansión que addOpenPlay, para clases recurrentes.
  const addClass = async ({ recurrence, ...data }) => {
    try {
      const occurrenceDates = expandWeeklyDates(data.date, recurrence?.until);
      const seriesId = occurrenceDates.length > 1 ? crypto.randomUUID() : null;
      const rows = occurrenceDates.map((dt) => ({
        academy_name: data.academyName, level: data.level, price: data.price, member_price: data.memberPrice,
        court_ids: data.courtIds, date: dt, start_time: data.startTime, end_time: data.endTime,
        recurring_group_id: seriesId, occupied_blocks: computeOccupiedBlocks(data.courtIds, dt, data.startTime, data.endTime),
      }));
      const { data: inserted, error } = await supabase.from("classes").insert(rows).select();
      if (error) throw error;
      setClasses((p) => [...p, ...inserted.map((r) => mapClassRow({ ...r, class_registrations: [] }))]);
      // Push "nueva actividad publicada" (v2.42.0) -- ver mismo comentario en addOpenPlay.
      sendPush("activity_published", { title: "Nueva clase", body: `Se abrió la clase con ${data.academyName} -- ${formatDateHuman(occurrenceDates[0])}.`, url: "/" });
      return {};
    } catch (err) {
      console.error("addClass:", err?.message || err);
      return { error: err?.message || "No se pudo crear la clase." };
    }
  };
  const removeOpenPlay = (id) => {
    setOpenPlays((p) => p.filter((e) => e.id !== id));
    supabase.from("open_plays").delete().eq("id", id).then(({ error }) => { if (error) console.error("removeOpenPlay:", error.message); });
  };
  const removeOpenPlaySeries = (recurringGroupId) => {
    setOpenPlays((p) => p.filter((e) => e.recurringGroupId !== recurringGroupId));
    supabase.from("open_plays").delete().eq("recurring_group_id", recurringGroupId).then(({ error }) => { if (error) console.error("removeOpenPlaySeries:", error.message); });
  };
  const removeClass = (id) => {
    setClasses((p) => p.filter((e) => e.id !== id));
    supabase.from("classes").delete().eq("id", id).then(({ error }) => { if (error) console.error("removeClass:", error.message); });
  };
  const removeClassSeries = (recurringGroupId) => {
    setClasses((p) => p.filter((e) => e.recurringGroupId !== recurringGroupId));
    supabase.from("classes").delete().eq("recurring_group_id", recurringGroupId).then(({ error }) => { if (error) console.error("removeClassSeries:", error.message); });
  };

  // Edita UNA ocurrencia puntual (una fila) -- fecha/hora/cancha propias, precio, nombre,
  // etc. Si cambia cancha/fecha/horario, occupied_blocks se recalcula para esa fila. Refresca
  // desde Supabase al final (fetchOpenPlays) en vez de parchear el estado local a mano --
  // más simple y evita divergencias, el volumen de filas es chico.
  const updateOpenPlay = async (id, { imageBlob, ...patch }) => {
    try {
      const dbPatch = {};
      if ("name" in patch) dbPatch.name = patch.name;
      if ("level" in patch) dbPatch.level = patch.level;
      if ("price" in patch) dbPatch.price = patch.price;
      if ("memberPrice" in patch) dbPatch.member_price = patch.memberPrice;
      if ("capacity" in patch) dbPatch.capacity = patch.capacity;
      if ("description" in patch) dbPatch.description = patch.description;
      if ("courtIds" in patch) dbPatch.court_ids = patch.courtIds;
      if ("date" in patch) dbPatch.date = patch.date;
      if ("startTime" in patch) dbPatch.start_time = patch.startTime;
      if ("endTime" in patch) dbPatch.end_time = patch.endTime;
      if (imageBlob) {
        const path = `${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from("open-play-images").upload(path, imageBlob, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        dbPatch.image = supabase.storage.from("open-play-images").getPublicUrl(path).data.publicUrl;
      }
      const current = openPlays.find((o) => o.id === id);
      dbPatch.occupied_blocks = computeOccupiedBlocks(
        dbPatch.court_ids ?? current?.courtIds ?? [], dbPatch.date ?? current?.date,
        dbPatch.start_time ?? current?.startTime, dbPatch.end_time ?? current?.endTime,
      );
      const { error } = await supabase.from("open_plays").update(dbPatch).eq("id", id);
      if (error) throw error;
      await fetchOpenPlays();
      return {};
    } catch (err) {
      console.error("updateOpenPlay:", err?.message || err);
      return { error: err?.message || "No se pudo actualizar la actividad." };
    }
  };
  // Edita los campos COMPARTIDOS de toda una serie recurrente (nombre, precio, nivel,
  // cancha, horario, imagen...) -- la fecha de cada ocurrencia NUNCA se toca acá, es lo que
  // hace que sea una serie y no un solo evento repetido el mismo día. occupied_blocks se
  // recalcula fila por fila (depende de la fecha propia de cada una) aunque no haya cambiado
  // cancha/horario -- es barato y evita una rama de código aparte para el caso común.
  const updateOpenPlaySeries = async (recurringGroupId, { imageBlob, ...patch }) => {
    try {
      const dbPatch = {};
      if ("name" in patch) dbPatch.name = patch.name;
      if ("level" in patch) dbPatch.level = patch.level;
      if ("price" in patch) dbPatch.price = patch.price;
      if ("memberPrice" in patch) dbPatch.member_price = patch.memberPrice;
      if ("capacity" in patch) dbPatch.capacity = patch.capacity;
      if ("description" in patch) dbPatch.description = patch.description;
      if ("courtIds" in patch) dbPatch.court_ids = patch.courtIds;
      if ("startTime" in patch) dbPatch.start_time = patch.startTime;
      if ("endTime" in patch) dbPatch.end_time = patch.endTime;
      if (imageBlob) {
        const path = `${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from("open-play-images").upload(path, imageBlob, { contentType: "image/jpeg" });
        if (upErr) throw upErr;
        dbPatch.image = supabase.storage.from("open-play-images").getPublicUrl(path).data.publicUrl;
      }
      const rows = openPlays.filter((o) => o.recurringGroupId === recurringGroupId);
      const results = await Promise.all(rows.map((r) => supabase.from("open_plays").update({
        ...dbPatch,
        occupied_blocks: computeOccupiedBlocks(dbPatch.court_ids ?? r.courtIds, r.date, dbPatch.start_time ?? r.startTime, dbPatch.end_time ?? r.endTime),
      }).eq("id", r.id)));
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
      await fetchOpenPlays();
      return {};
    } catch (err) {
      console.error("updateOpenPlaySeries:", err?.message || err);
      return { error: err?.message || "No se pudo actualizar la serie." };
    }
  };
  // Mismo criterio que updateOpenPlay, para una clase puntual (sin imagen ni cupo -- las
  // clases no tienen esos campos, ver mapClassRow).
  const updateClass = async (id, patch) => {
    try {
      const dbPatch = {};
      if ("academyName" in patch) dbPatch.academy_name = patch.academyName;
      if ("level" in patch) dbPatch.level = patch.level;
      if ("price" in patch) dbPatch.price = patch.price;
      if ("memberPrice" in patch) dbPatch.member_price = patch.memberPrice;
      if ("courtIds" in patch) dbPatch.court_ids = patch.courtIds;
      if ("date" in patch) dbPatch.date = patch.date;
      if ("startTime" in patch) dbPatch.start_time = patch.startTime;
      if ("endTime" in patch) dbPatch.end_time = patch.endTime;
      const current = classes.find((c) => c.id === id);
      dbPatch.occupied_blocks = computeOccupiedBlocks(
        dbPatch.court_ids ?? current?.courtIds ?? [], dbPatch.date ?? current?.date,
        dbPatch.start_time ?? current?.startTime, dbPatch.end_time ?? current?.endTime,
      );
      const { error } = await supabase.from("classes").update(dbPatch).eq("id", id);
      if (error) throw error;
      await fetchClasses();
      return {};
    } catch (err) {
      console.error("updateClass:", err?.message || err);
      return { error: err?.message || "No se pudo actualizar la clase." };
    }
  };
  // Mismo criterio que updateOpenPlaySeries: campos compartidos, fecha de cada fila intacta.
  const updateClassSeries = async (recurringGroupId, patch) => {
    try {
      const dbPatch = {};
      if ("academyName" in patch) dbPatch.academy_name = patch.academyName;
      if ("level" in patch) dbPatch.level = patch.level;
      if ("price" in patch) dbPatch.price = patch.price;
      if ("memberPrice" in patch) dbPatch.member_price = patch.memberPrice;
      if ("courtIds" in patch) dbPatch.court_ids = patch.courtIds;
      if ("startTime" in patch) dbPatch.start_time = patch.startTime;
      if ("endTime" in patch) dbPatch.end_time = patch.endTime;
      const rows = classes.filter((c) => c.recurringGroupId === recurringGroupId);
      const results = await Promise.all(rows.map((r) => supabase.from("classes").update({
        ...dbPatch,
        occupied_blocks: computeOccupiedBlocks(dbPatch.court_ids ?? r.courtIds, r.date, dbPatch.start_time ?? r.startTime, dbPatch.end_time ?? r.endTime),
      }).eq("id", r.id)));
      const failed = results.find((r) => r.error);
      if (failed) throw failed.error;
      await fetchClasses();
      return {};
    } catch (err) {
      console.error("updateClassSeries:", err?.message || err);
      return { error: err?.message || "No se pudo actualizar la serie." };
    }
  };

  const registerForOpenPlay = async (id, reg) => {
    const { data: row, error } = await supabase.from("open_play_registrations").insert({
      open_play_id: id, user_id: reg.userId, user_name: reg.userName, payment_method: reg.paymentMethod,
      reference: reg.reference, proof_name: reg.proofName, price_usd: reg.priceUsd, price_bs: reg.priceBs,
      payment_status: initialPaymentStatus(reg.paymentMethod, reg.priceUsd),
    }).select().single();
    if (error) { console.error("registerForOpenPlay:", error.message); return; }
    setOpenPlays((p) => p.map((e) => (e.id === id ? { ...e, registrations: [...e.registrations, mapRegistrationRow(row)] } : e)));
    // Push "cupo casi lleno" (v2.42.0) -- el servidor vuelve a chequear la capacidad real
    // antes de mandar nada (ver api/send-push.js); esta llamada es solo un "avisa si aplica".
    sendPush("capacity_alert", { activityKind: "open_play", occurrenceId: id, title: "¡Últimos cupos!", body: "Un Open Play se está llenando -- inscríbete antes de que se agote.", url: "/" });
    // Push a los admins con cada inscripción real (v2.52.0) -- ver mismo criterio en addTeam.
    const openPlay = openPlays.find((e) => e.id === id);
    sendPush("new_registration", { title: "Nueva inscripción", body: `${reg.userName} se inscribió en el Open Play "${openPlay?.name || ""}".`, url: "/" });
  };
  const registerForClass = async (id, reg) => {
    const { data: row, error } = await supabase.from("class_registrations").insert({
      class_id: id, user_id: reg.userId, user_name: reg.userName, payment_method: reg.paymentMethod,
      reference: reg.reference, proof_name: reg.proofName, price_usd: reg.priceUsd, price_bs: reg.priceBs,
      payment_status: initialPaymentStatus(reg.paymentMethod, reg.priceUsd),
    }).select().single();
    if (error) { console.error("registerForClass:", error.message); return; }
    setClasses((p) => p.map((e) => (e.id === id ? { ...e, registrations: [...e.registrations, mapRegistrationRow(row)] } : e)));
    // Push "cupo casi lleno" -- ver mismo comentario en registerForOpenPlay.
    sendPush("capacity_alert", { activityKind: "clase", occurrenceId: id, title: "¡Últimos cupos!", body: "Una clase se está llenando -- inscríbete antes de que se agote.", url: "/" });
    // Push a los admins con cada inscripción real (v2.52.0) -- ver mismo criterio en addTeam.
    const clase = classes.find((e) => e.id === id);
    sendPush("new_registration", { title: "Nueva inscripción", body: `${reg.userName} se inscribió en la clase con ${clase?.academyName || ""}.`, url: "/" });
  };

  // Gestión de inscritos por el admin (v2.19.0) -- quitar una inscripción (canceló, error de
  // captura) o marcar asistencia, ambas desde la pestaña "Inscritos" del modal de la actividad.
  // occurrenceId identifica la fecha puntual (una fila de openPlays/classes), registrationId
  // la inscripción dentro de esa fecha -- una serie recurrente tiene inscripciones separadas
  // por fecha, así que el patch solo toca el array `registrations` de esa única ocurrencia.
  const removeOpenPlayRegistration = async (occurrenceId, registrationId) => {
    const { error } = await supabase.from("open_play_registrations").delete().eq("id", registrationId);
    if (error) { console.error("removeOpenPlayRegistration:", error.message); return; }
    setOpenPlays((p) => p.map((e) => (e.id === occurrenceId ? { ...e, registrations: e.registrations.filter((r) => r.id !== registrationId) } : e)));
  };
  const removeClassRegistration = async (occurrenceId, registrationId) => {
    const { error } = await supabase.from("class_registrations").delete().eq("id", registrationId);
    if (error) { console.error("removeClassRegistration:", error.message); return; }
    setClasses((p) => p.map((e) => (e.id === occurrenceId ? { ...e, registrations: e.registrations.filter((r) => r.id !== registrationId) } : e)));
  };
  const setOpenPlayAttendance = async (occurrenceId, registrationId, attended) => {
    setOpenPlays((p) => p.map((e) => (e.id === occurrenceId ? { ...e, registrations: e.registrations.map((r) => (r.id === registrationId ? { ...r, attended } : r)) } : e)));
    const { error } = await supabase.from("open_play_registrations").update({ attended }).eq("id", registrationId);
    if (error) console.error("setOpenPlayAttendance:", error.message);
  };
  const setClassAttendance = async (occurrenceId, registrationId, attended) => {
    setClasses((p) => p.map((e) => (e.id === occurrenceId ? { ...e, registrations: e.registrations.map((r) => (r.id === registrationId ? { ...r, attended } : r)) } : e)));
    const { error } = await supabase.from("class_registrations").update({ attended }).eq("id", registrationId);
    if (error) console.error("setClassAttendance:", error.message);
  };
  // Estado de pago (v2.21.0) -- el admin cambia manualmente entre los tres estados
  // (PAYMENT_STATUS_META) desde la misma pestaña "Inscritos"; la verificación automática por
  // correo queda para una fase aparte.
  const setOpenPlayPaymentStatus = async (occurrenceId, registrationId, paymentStatus) => {
    setOpenPlays((p) => p.map((e) => (e.id === occurrenceId ? { ...e, registrations: e.registrations.map((r) => (r.id === registrationId ? { ...r, paymentStatus } : r)) } : e)));
    const { error } = await supabase.from("open_play_registrations").update({ payment_status: paymentStatus }).eq("id", registrationId);
    if (error) console.error("setOpenPlayPaymentStatus:", error.message);
    if (paymentStatus === "confirmada") {
      const userId = openPlays.find((e) => e.id === occurrenceId)?.registrations.find((r) => r.id === registrationId)?.userId;
      if (userId) sendPush("payment_confirmed", { userId, title: "Pago verificado", body: "Tu inscripción al Open Play quedó confirmada.", url: "/" });
    }
  };
  const setClassPaymentStatus = async (occurrenceId, registrationId, paymentStatus) => {
    setClasses((p) => p.map((e) => (e.id === occurrenceId ? { ...e, registrations: e.registrations.map((r) => (r.id === registrationId ? { ...r, paymentStatus } : r)) } : e)));
    const { error } = await supabase.from("class_registrations").update({ payment_status: paymentStatus }).eq("id", registrationId);
    if (error) console.error("setClassPaymentStatus:", error.message);
    if (paymentStatus === "confirmada") {
      const userId = classes.find((e) => e.id === occurrenceId)?.registrations.find((r) => r.id === registrationId)?.userId;
      if (userId) sendPush("payment_confirmed", { userId, title: "Pago verificado", body: "Tu inscripción a la clase quedó confirmada.", url: "/" });
    }
  };

  // ---- Membresías ----
  const addMembershipPlan = async (plan) => {
    const { data: row, error } = await supabase.from("membership_plans").insert({
      name: plan.name, monthly_price: plan.monthlyPrice, private_court_access: plan.privateCourtAccess,
      max_members: plan.maxMembers === "" ? null : plan.maxMembers, booking_window_hours: plan.bookingWindowHours,
      court_discount_pct: plan.courtDiscountPct, open_play_discount_pct: plan.openPlayDiscountPct,
      free_blocks_per_month: plan.freeBlocksPerMonth,
      description: plan.description, rate_card: plan.rateCard,
    }).select().single();
    if (error) { console.error("addMembershipPlan:", error.message); return; }
    setMembershipPlans((p) => [...p, mapPlanRow(row)]);
  };
  const updateMembershipPlan = (id, patch) => {
    setMembershipPlans((p) => p.map((pl) => (pl.id === id ? { ...pl, ...patch } : pl)));
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("monthlyPrice" in patch) dbPatch.monthly_price = patch.monthlyPrice;
    if ("privateCourtAccess" in patch) dbPatch.private_court_access = patch.privateCourtAccess;
    if ("maxMembers" in patch) dbPatch.max_members = patch.maxMembers === "" ? null : patch.maxMembers;
    if ("bookingWindowHours" in patch) dbPatch.booking_window_hours = patch.bookingWindowHours;
    if ("courtDiscountPct" in patch) dbPatch.court_discount_pct = patch.courtDiscountPct;
    if ("openPlayDiscountPct" in patch) dbPatch.open_play_discount_pct = patch.openPlayDiscountPct;
    if ("freeBlocksPerMonth" in patch) dbPatch.free_blocks_per_month = patch.freeBlocksPerMonth;
    if ("description" in patch) dbPatch.description = patch.description;
    if ("rateCard" in patch) dbPatch.rate_card = patch.rateCard;
    supabase.from("membership_plans").update(dbPatch).eq("id", id).then(({ error }) => {
      if (error) console.error("updateMembershipPlan:", error.message);
    });
  };
  const removeMembershipPlan = (id) => {
    setMembershipPlans((p) => p.filter((pl) => pl.id !== id));
    supabase.from("membership_plans").delete().eq("id", id).then(({ error }) => {
      if (error) console.error("removeMembershipPlan:", error.message);
    });
  };
  // Todos los planes pagos son mensuales -- al activarse, vencen en 1 mes desde HOY (no desde
  // que se pidió la suscripción, si quedó pendiente de verificar un tiempo -- el socio empieza
  // a contar su mes desde que de verdad puede usarlo). Un plan gratuito ($0) no vence.
  const computePlanExpiry = (planId) => {
    const plan = membershipPlans.find((p) => p.id === planId);
    if (!plan || !(plan.monthlyPrice > 0)) return null;
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  };

  // Activa de verdad el plan de un socio: le pone plan_id + fecha de vencimiento en su
  // perfil. Separado de subscribeToPlan/setSubscriptionPaymentStatus porque ambos necesitan
  // hacer exactamente esto, pero en momentos distintos (v2.37.0 -- ver comentario de abajo).
  const activateProfilePlan = async (userId, planId) => {
    const expiresAt = computePlanExpiry(planId);
    setProfiles((prev) => prev.map((u) => (u.id === userId ? { ...u, planId, planExpiresAt: expiresAt } : u)));
    const { error } = await supabase.from("profiles").update({ plan_id: planId, plan_expires_at: expiresAt }).eq("id", userId);
    if (error) console.error("activateProfilePlan:", error.message);
  };

  const subscribeToPlan = async (planId, checkout) => {
    // v2.37.0: una suscripción a un plan pago ya NO activa el plan de una -- queda "pendiente
    // de verificar" (mismo criterio que reservas/inscripciones a Open Play/Clase/Torneo) hasta
    // que el admin confirme que de verdad llegó el pago (ver setSubscriptionPaymentStatus,
    // Usuarios). Solo se activa de inmediato si no hay nada que verificar (priceUsd === 0).
    const paymentStatus = initialPaymentStatus(checkout.paymentMethod, checkout.priceUsd);
    const { data: row, error } = await supabase.from("subscriptions").insert({
      plan_id: planId, user_id: currentUser?.id, payment_method: checkout.paymentMethod,
      reference: checkout.reference, proof_name: checkout.proofName, price_usd: checkout.priceUsd, price_bs: checkout.priceBs,
      payment_status: paymentStatus,
    }).select().single();
    if (error) { console.error("subscribeToPlan:", error.message); return; }
    setSubscriptions((p) => [...p, mapSubscriptionRow(row)]);
    if (paymentStatus === "confirmada") await activateProfilePlan(currentUser?.id, planId);
  };

  // Cambia el estado de pago de una suscripción (admin, Usuarios -- v2.37.0). A diferencia del
  // mismo control en reservas/inscripciones (ahí es solo informativo, ver PaymentStatusSelect),
  // acá SÍ activa beneficios reales: pasar a "confirmada" es lo que recién le pone plan_id/
  // plan_expires_at al socio -- antes de eso, aunque haya "pagado", sigue con el plan que
  // tenía (o sin plan) hasta que el admin lo confirme.
  const setSubscriptionPaymentStatus = async (subscription, newStatus) => {
    const wasConfirmed = subscription.paymentStatus === "confirmada";
    setSubscriptions((prev) => prev.map((s) => (s.id === subscription.id ? { ...s, paymentStatus: newStatus } : s)));
    const { error } = await supabase.from("subscriptions").update({ payment_status: newStatus }).eq("id", subscription.id);
    if (error) { console.error("setSubscriptionPaymentStatus:", error.message); return; }
    if (newStatus === "confirmada" && !wasConfirmed) {
      await activateProfilePlan(subscription.userId, subscription.planId);
      sendPush("payment_confirmed", { userId: subscription.userId, title: "Pago verificado", body: "Tu membresía ya está activa.", url: "/" });
    }
  };

  // El admin promueve/degrada el rol de OTRO socio (v2.47.0, pestaña Usuarios) -- optimista en
  // el estado local, luego el UPDATE real. Esto SÍ pasa el trigger profiles_prevent_role_self_
  // escalation (a diferencia de un UPDATE hecho por fuera de la app -- SQL directo, Table
  // Editor del dashboard -- que no lleva sesión de Auth y el trigger revierte en silencio):
  // acá corre con la sesión real del admin logueado, así que is_admin() sí puede confirmar
  // quién hace el cambio. UsuariosTab bloquea intentar esto sobre la propia fila (además el
  // trigger tampoco dejaría auto-promoverse, pero un admin real SÍ podría auto-degradarse por
  // accidente si se lo permitiéramos -- mejor ni ofrecer el botón en esa fila).
  const setUserRole = async (userId, role) => {
    setProfiles((prev) => prev.map((u) => (u.id === userId ? { ...u, role } : u)));
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) { console.error("setUserRole:", error.message); return { error: error.message }; }
    return {};
  };

  // Elimina la cuenta de un socio por completo (v2.58.0, pestaña Usuarios) -- a pedido del
  // club: borra TODO lo que no tenga el pago verificado (reservas, inscripciones a torneo/Open
  // Play/clase, suscripciones de membresía por pagar o por verificar) y de verdad revoca su
  // acceso -- borra también su cuenta de Auth, no solo la fila de perfil, así que no puede
  // volver a entrar con ese correo. Los pagos YA VERIFICADOS se CONSERVAN a propósito como
  // historial del club (ver buildUserDeletionSummary/findUnverifiedCategoryEntries) -- nunca se
  // tocan acá.
  //
  // Dos pasos, en este orden:
  // 1. Categorías de torneo primero, EN EL CLIENTE: reusa removePersonFromCategory (misma
  //    lógica ya probada de reajuste de precio/promoción de lista de espera) -- replicar eso en
  //    el servidor sería duplicar lógica delicada que hoy vive en un solo lugar.
  // 2. Todo lo demás (reservas/suscripciones/inscripciones a Open Play y clase sin verificar,
  //    push_subscriptions, la fila de profiles, y la cuenta de Auth) va al endpoint
  //    api/delete-user.js -- tiene que correr con la service_role key porque RLS a propósito no
  //    deja borrar bookings/subscriptions/profiles desde el cliente, ni con sesión de admin (ver
  //    el comentario de seguridad de api/send-push.js: ninguna llave privada llega nunca al
  //    bundle). Ese endpoint además revalida token+rol admin por su cuenta -- nunca confía en lo
  //    que diga el cliente.
  const deleteUserAccount = async (targetUserId) => {
    const unverified = findUnverifiedCategoryEntries(categories, targetUserId);
    for (const t of unverified) {
      const result = await removePersonFromCategory(t.catId, t.teamId, t.playerIdx, t.inWaitlist);
      if (result?.error) return { error: `No se pudo limpiar su inscripción en "${t.catName}" -- intenta de nuevo.` };
    }
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return { error: "Tu sesión expiró -- vuelve a iniciar sesión e intenta de nuevo." };
    let res;
    try {
      res = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: targetUserId }),
      });
    } catch {
      return { error: "No se pudo conectar con el servidor -- revisa tu conexión e intenta de nuevo." };
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body?.error || "No se pudo eliminar el usuario -- intenta de nuevo." };
    setProfiles((prev) => prev.filter((u) => u.id !== targetUserId));
    setDirectory((prev) => prev.filter((u) => u.id !== targetUserId));
    return {};
  };

  // Auto-edición de perfil (nombre, WhatsApp, zona, DUPR) desde el tab Perfil -- nunca manda
  // role/plan_id, esos solo cambian vía subscribeToPlan o el admin (además, el trigger
  // profiles_prevent_role_self_escalation revierte cualquier intento de cambiar el role propio).
  const updateProfile = async (patch) => {
    setProfiles((prev) => prev.map((u) => (u.id === currentUser?.id ? { ...u, ...patch } : u)));
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("zone" in patch) dbPatch.zone = patch.zone;
    if ("phone" in patch) dbPatch.phone = patch.phone;
    if ("duprRating" in patch) dbPatch.dupr_rating = patch.duprRating === "" ? null : patch.duprRating;
    if ("gender" in patch) dbPatch.gender = patch.gender || null;
    if ("birthDate" in patch) dbPatch.birth_date = patch.birthDate || null;
    if ("onboardingCompleted" in patch) dbPatch.onboarding_completed = patch.onboardingCompleted;
    const { error } = await supabase.from("profiles").update(dbPatch).eq("id", currentUser?.id);
    if (error) return { error: error.message };
    return {};
  };

  const runScheduler = (plan = null, datesOverride = null) => {
    if (!tournament) return;
    if (!tournament.startDate || !tournament.endDate) {
      alert("Define primero la fecha de inicio y fin del torneo.");
      setTab("torneos");
      return;
    }
    if (courts.length === 0) {
      alert("Agrega al menos una cancha en la sección Club.");
      setTab("club");
      return;
    }
    // Generalidades deja elegir un subconjunto de canchas dedicadas al torneo -- si no se
    // eligió ninguna (default), se sigue usando el club completo, igual que antes. El panel
    // Planificar (v2.69.0) puede acotar todavía más con `plan.courtIds` (los "campos" de esa
    // corrida puntual) -- sin eso, se usan todas las del torneo, como siempre.
    const tournamentCourts = tournament.courtIds?.length ? courts.filter((c) => tournament.courtIds.includes(c.id)) : courts;
    const scheduleCourts = plan?.courtIds?.length ? tournamentCourts.filter((c) => plan.courtIds.includes(c.id)) : tournamentCourts;
    if (scheduleCourts.length === 0) {
      alert("Las canchas elegidas para el torneo ya no existen -- revisa Generalidades.");
      setTab("torneos");
      return;
    }
    // `categories` trae las de TODOS los torneos -- acá solo debe entrar/tocarse el
    // subconjunto del torneo activo, si no las categorías de otros torneos se mezclarían en
    // este calendario (y peor, un setCategories(clone) con solo estas pisaría a las demás).
    const scoped = categories.filter((c) => c.tournamentId === tournament.id);
    const clone = structuredClone(scoped);
    // "Volver a mezclar" (v2.69.0): antes de agendar, desbloquea justo los partidos de la
    // selección actual que ya estaban fijados de una corrida anterior de Planificar -- así
    // vuelven a la cola de este run sin tocar nada fuera de esa selección (otros días, otras
    // rondas, partidos movidos a mano desde el grid siguen intactos).
    if (plan?.reschedule && plan.categoryIds?.length) {
      clone.forEach((c) => {
        if (!plan.categoryIds.includes(c.id)) return;
        c.matches.forEach((m) => { if (roundSetHas(plan.roundKeys?.[c.id], roundKeyOf(m))) m.locked = false; });
      });
    }
    const scheduleDates = datesOverride?.length ? datesOverride : dates;
    const info = buildSchedule(clone, scheduleCourts, scheduleDates, tournament.dailyStart, tournament.dailyEnd, matchDuration, breakM, occupiedKeys, plan);
    setCategories((prev) => prev.map((c) => clone.find((cc) => cc.id === c.id) || c));
    setScheduleInfo(info);
    setTab("torneos");
    // buildSchedule pudo tocar matches/groups de varias categorías a la vez -- un
    // persistCategoryWrite (upsert) por categoría, en vez de un solo upsert masivo, para que si
    // el internet se va a mitad de esto, cada categoría que no se alcance a guardar quede en la
    // cola de pendientes por su cuenta (v2.34.0) en vez de perderse toda la tanda junta.
    //
    // v2.80.5 -- mismo incidente de fondo que updateCategory (ver su comentario): `clone` sale
    // de `categories`, el estado LOCAL que puede estar desactualizado si alguien se inscribió
    // en esta categoría DESPUÉS de que este navegador cargó la pantalla. runScheduler solo
    // necesita persistir matches/groups (lo que de verdad calculó) -- escribir de vuelta
    // `c.teams`/`c.waitlist` tal como estaban en ese clon viejo pisaría cualquier inscripción
    // nueva que haya llegado mientras tanto. Por eso relee cada categoría FRESCA de Supabase
    // justo antes de escribir y manda ESE teams/waitlist, no el del clon.
    clone.forEach(async (c) => {
      const { data: freshRow } = await supabase.from("categories").select("teams, waitlist").eq("id", c.id).single();
      persistCategoryWrite(c.id, {
        tournament_id: tournament.id, name: c.name, modality: c.modality, gender: c.gender, level: c.level,
        max_teams: c.maxTeams, min_teams: c.minTeams, seed_mode: c.seedMode, best_of: c.bestOf, bracket_size: c.bracketSize, format: c.format,
        draw_generated: c.drawGenerated, groups_closed: c.groupsClosed,
        teams: freshRow ? (freshRow.teams || []) : c.teams, waitlist: freshRow ? (freshRow.waitlist || []) : c.waitlist,
        groups: c.groups, matches: c.matches,
      }, true);
    });
  };

  // v2.81.8, a pedido del club: cambiar la duración/intervalo NO debe dejar huecos entre
  // partidos ya agendados -- deberían "recogerse hacia arriba", uno detrás de otro, con la
  // duración nueva. Antes de esto no existía ninguna acción para eso: cambiar el número solo
  // afectaba corridas FUTURAS de "Planificar" (buildSchedule), los partidos que ya tenían
  // horario se quedaban con su hora vieja -- que ya no calza con la franja nueva que dibuja el
  // tablero (ver comentario de matchDuration/breakM más arriba), ahí es donde aparecían los
  // huecos/separaciones que reportó el club. Este botón SÍ retoca los partidos ya agendados:
  // agrupa por (día, cancha) -- varias categorías pueden compartir cancha el mismo día -- los
  // ordena por su hora ACTUAL (conserva el orden real, no reordena por categoría/nombre) y les
  // vuelve a repartir horarios consecutivos desde dailyStart con la duración/intervalo VIGENTES
  // ahora mismo. Un partido `locked` (fijado a mano) nunca se toca, pero si comparte cancha/día
  // con otros sin fijar, ese grupo entero se salta por completo -- reflowear alrededor de un
  // horario fijo podría chocarlo contra el que le tocaría después, más vale no tocar nada ahí
  // y dejar que el admin lo acomode a mano (Editar manualmente).
  const reflowSchedule = async () => {
    if (!tournament) return;
    const cats = categories.filter((c) => c.tournamentId === tournament.id);
    const groups = {}; // "day|courtId" -> [{catId, matchId, time, locked}]
    cats.forEach((c) => c.matches.forEach((m) => {
      if (!m.day || !m.time || !m.courtId) return;
      const key = `${m.day}|${m.courtId}`;
      (groups[key] = groups[key] || []).push({ catId: c.id, matchId: m.id, time: m.time, locked: !!m.locked });
    }));
    const startM = timeToMinutes(tournament.dailyStart);
    const step = Number(matchDuration) + Number(breakM);
    const updatesByCategory = {}; // catId -> Map(matchId -> nuevo time)
    Object.values(groups).forEach((list) => {
      if (list.some((item) => item.locked)) return; // ver comentario -- grupo con algo fijado, no se toca
      list.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
      let t = startM;
      list.forEach((item) => {
        const newTime = minutesToTime(t);
        if (newTime !== item.time) {
          (updatesByCategory[item.catId] = updatesByCategory[item.catId] || new Map()).set(item.matchId, newTime);
        }
        t += step;
      });
    });
    for (const catId of Object.keys(updatesByCategory)) {
      const changes = updatesByCategory[catId];
      await updateCategory(catId, (c) => {
        c.matches = c.matches.map((m) => (changes.has(m.id) ? { ...m, time: changes.get(m.id) } : m));
        return c;
      });
    }
  };

  const stats = {
    courts: courts.length,
    bookings: bookings.filter((b) => b.status !== "cancelada").length,
    events: new Set(openPlays.map((e) => e.recurringGroupId || e.id)).size + new Set(classes.map((e) => e.recurringGroupId || e.id)).size + (categories.some((c) => c.teams.length > 0) ? 1 : 0),
    members: subscriptions.length,
  };

  // Mientras se resuelve la sesión de Supabase o se cargan club/canchas (una sola vez, al
  // cargar) no mostramos nada todavía -- evita el parpadeo de "no hay sesión"/datos vacíos
  // antes de confirmar qué hay realmente.
  if (authLoading || clubDataLoading) {
    return (
      <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen" />
    );
  }

  // Prioridad sobre currentUser: aunque la sesión temporal de recuperación ya tenga un
  // usuario válido, no lo dejamos pasar a la app hasta que elija una contraseña nueva.
  if (passwordRecovery) {
    return (
      <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
        <GlobalStyles />
        <AuthScreen club={club} registerUser={registerUser} loginUser={loginUser}
          resetPasswordUser={resetPasswordUser} updatePassword={updatePassword} forceReset />
      </div>
    );
  }

  if (!currentUser) {
    // Alguien sin cuenta abrió un link compartido (v2.43.0) -- ve la ficha pública de esa
    // actividad en vez del login de una, y solo llega al login/registro si toca
    // "Inscribirme" (ver PublicActivityView). Si el link ya no aplica (id inválido, o la
    // actividad de verdad no existe/no está publicada) cae de vuelta al login normal más
    // abajo -- resolvePublicActivity devuelve null y PublicActivityView ya sabe mostrar ese
    // caso con su propio mensaje, no hace falta un branch aparte.
    if (publicAct) {
      return (
        <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
          <GlobalStyles />
          <PublicActivityView
            loading={!activitiesLoaded}
            activity={activitiesLoaded ? resolvePublicActivity(publicAct, openPlays, classes, tournaments, categories) : null}
            club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />
        </div>
      );
    }
    // Mismo criterio para un link "invitar a mi pareja" (v2.44.2, ver joinParam más arriba).
    if (joinParam) {
      return (
        <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
          <GlobalStyles />
          <PublicJoinTeamView
            loading={!activitiesLoaded}
            info={activitiesLoaded ? resolveJoinInfo(joinParam, categories, tournaments) : null}
            club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />
        </div>
      );
    }
    // Mismo criterio para un link/QR de cupón de descuento (v2.82.0, ver couponCode/couponInfo
    // más arriba) -- couponInfo se resuelve solo, no depende de activitiesLoaded.
    if (couponCode) {
      return (
        <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
          <GlobalStyles />
          <PublicCouponView couponInfo={couponInfo} club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />
        </div>
      );
    }
    return (
      <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
        <GlobalStyles />
        <AuthScreen club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />
      </div>
    );
  }

  // Cuenta recién creada (registro solo pide correo+contraseña) -- el trigger de Supabase
  // crea el perfil con onboarding_completed=false, así que antes de dejarlo entrar a la app
  // se le pide el resto de sus datos (nombre, género, fecha de nacimiento, DUPR, domicilio)
  // en un wizard de un paso a la vez. Las cuentas admin nunca pasan por aquí (se crean por
  // SQL, no por este formulario) ni las que ya existían antes de este flag (quedaron con
  // onboarding_completed=true al migrar la columna).
  if (currentUser.role === "cliente" && !currentUser.onboardingCompleted) {
    return (
      <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
        <GlobalStyles />
        <Onboarding currentUser={currentUser} club={club} updateProfile={updateProfile} logoutUser={logoutUser} />
      </div>
    );
  }

  const role = currentUser.role === "admin" && viewAsClient ? "cliente" : currentUser.role;
  const visibleNav = NAV_ITEMS.filter((it) => it.roles.includes(role));
  const effectiveTab = visibleNav.some((it) => it.id === tab) ? tab : visibleNav[0].id;

  return (
    <div style={{ background: COLORS.chalk, color: COLORS.ink, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen flex">
      <GlobalStyles />

      <Sidebar tab={effectiveTab} setTab={setTab} club={club} stats={stats} currentUser={currentUser} currentPlan={currentPlan} logoutUser={logoutUser} visibleNav={visibleNav} />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar tab={effectiveTab} stats={stats} currentUser={currentUser} currentPlan={currentPlan} logoutUser={logoutUser} visibleNav={visibleNav} />

        <main className="max-w-7xl w-full mx-auto px-4 md:px-10 pt-6 pb-28 md:pb-16 flex-1">
          {/* Banner de "Ver como cliente" (v2.48.0) -- visible en CUALQUIER pestaña y viewport
             (a diferencia del switch de Perfil, que solo vive ahí) para que apagarlo nunca
             requiera navegar de vuelta a Perfil primero. Ver el useState en el componente
             principal para el resto del mecanismo. */}
          {viewAsClient && (
            <div className="mb-4 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap" style={{ background: "#FBF3E4", border: "1px solid #F2D9A6" }}>
              <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: "#8A5A16" }}>
                <Eye size={13} className="shrink-0" /> Viendo la app como la vería un cliente -- seguís siendo admin de verdad.
              </span>
              <button onClick={() => setViewAsClient(false)} className="text-xs font-bold px-3 py-1.5 rounded-full shrink-0" style={{ background: "#8A5A16", color: "#fff" }}>
                Volver a admin
              </button>
            </div>
          )}
          {effectiveTab === "club" && role === "admin" && (
            <ClubTab club={club} updateClub={updateClub} courts={courts} addCourt={addCourt} updateCourt={updateCourt} removeCourt={removeCourt} rateStatus={rateStatus} syncBcvRate={syncBcvRate}
              membershipPlans={membershipPlans} addMembershipPlan={addMembershipPlan} updateMembershipPlan={updateMembershipPlan} removeMembershipPlan={removeMembershipPlan}
              subscribeToPlan={subscribeToPlan} currentUser={currentUser} users={users} subscriptions={subscriptions}
              coupons={coupons} createCoupon={createCoupon} removeCoupon={removeCoupon} />
          )}

          {effectiveTab === "usuarios" && role === "admin" && (
            <UsuariosTab users={users} subscriptions={subscriptions} membershipPlans={membershipPlans} setSubscriptionPaymentStatus={setSubscriptionPaymentStatus} setUserRole={setUserRole} currentUser={currentUser}
              deleteUserAccount={deleteUserAccount} categories={categories} bookings={bookings} openPlays={openPlays} classes={classes} />
          )}

          {effectiveTab === "estadisticas" && role === "admin" && (
            <EstadisticasTab bookings={bookings} openPlays={openPlays} classes={classes} subscriptions={subscriptions}
              membershipPlans={membershipPlans} users={users} club={club} courts={courts} categories={categories} refreshStats={refreshStats}
              removeOpenPlayRegistration={removeOpenPlayRegistration} removeClassRegistration={removeClassRegistration}
              setOpenPlayAttendance={setOpenPlayAttendance} setClassAttendance={setClassAttendance}
              setOpenPlayPaymentStatus={setOpenPlayPaymentStatus} setClassPaymentStatus={setClassPaymentStatus} />
          )}

          {effectiveTab === "pagos" && role === "admin" && (
            <PagosTab tournaments={tournaments} categories={categories} openPlays={openPlays} classes={classes}
              setTeamPaymentStatus={setTeamPaymentStatus} setPlayerPaymentStatus={setPlayerPaymentStatus}
              setOpenPlayPaymentStatus={setOpenPlayPaymentStatus} setClassPaymentStatus={setClassPaymentStatus} />
          )}

          {effectiveTab === "reservas" && (
            <ReservasTab club={club} courts={courts} occupiedKeys={occupiedKeys} bookings={bookings}
              createBooking={createBooking} cancelBooking={cancelBooking} currentUser={currentUser} currentPlan={currentPlan}
              categories={categories} openPlays={openPlays} classes={classes} role={role} />
          )}

          {effectiveTab === "eventos" && (
            <EventosTab club={club} courts={courts} openPlays={openPlays} classes={classes}
              addOpenPlay={addOpenPlay} addClass={addClass}
              updateOpenPlay={updateOpenPlay} updateOpenPlaySeries={updateOpenPlaySeries} updateClass={updateClass} updateClassSeries={updateClassSeries}
              removeOpenPlay={removeOpenPlay} removeOpenPlaySeries={removeOpenPlaySeries} removeClass={removeClass} removeClassSeries={removeClassSeries}
              registerForOpenPlay={registerForOpenPlay} registerForClass={registerForClass}
              removeOpenPlayRegistration={removeOpenPlayRegistration} removeClassRegistration={removeClassRegistration}
              setOpenPlayAttendance={setOpenPlayAttendance} setClassAttendance={setClassAttendance}
              setOpenPlayPaymentStatus={setOpenPlayPaymentStatus} setClassPaymentStatus={setClassPaymentStatus} users={users}
              currentUser={currentUser} currentPlan={currentPlan} membershipPlans={membershipPlans} role={role}
              tournaments={tournaments} categories={categories} occupiedKeys={occupiedKeys} setTab={setTab}
              openTournament={(id) => { setActiveTournamentId(id); setActiveCatId(null); setTab("torneos"); }}
              openTournamentInscritos={(id) => { setActiveTournamentId(id); setActiveCatId(null); setTab("torneos"); setPendingTorneoSubTab("inscritos"); }}
              openTournamentInscripcion={(id) => { setActiveTournamentId(id); setActiveCatId(null); setTab("torneos"); setPendingTorneoSubTab("inscripcion"); }}
              onCreateTournament={() => { setActiveTournamentId(null); setActiveCatId(null); setTournamentFormOpen(true); setTab("torneos"); }}
              autoOpen={publicAct?.kind === "open_play" || publicAct?.kind === "clase" ? publicAct : null} />
          )}

          {effectiveTab === "torneos" && (
            activeTournamentId && tournament ? (
              <TorneosSection
                role={role} currentUser={currentUser} users={users} club={club} setTab={setTab}
                tournament={tournament} setTournament={updateTournament} uploadTournamentImage={uploadTournamentImage} dates={dates}
                registrationLog={registrationLog.filter((r) => r.tournament_id === tournament.id)}
                categories={categories.filter((c) => c.tournamentId === tournament.id)}
                activeCat={activeCat} setActiveCatId={setActiveCatId}
                addCategory={addCategory} removeCategory={removeCategory} updateCategory={updateCategory}
                addTeam={addTeam} removePersonFromCategory={removePersonFromCategory} moveSoloRegistration={moveSoloRegistration} mergeIntoTeam={mergeIntoTeam} splitTeam={splitTeam} setTeamPaymentStatus={setTeamPaymentStatus} setPlayerPaymentStatus={setPlayerPaymentStatus} recordPartialPayment={recordPartialPayment}
                generateDraw={generateDraw} closeGroupsAndSeedBracket={closeGroupsAndSeedBracket} removeTeamFromGroup={removeTeamFromGroup} assignTeamToGroupSlot={assignTeamToGroupSlot}
                suggestedRanking={suggestedRanking} upsertPlayerRanking={upsertPlayerRanking}
                setCategoryFormat={setCategoryFormat} courts={courts}
                matchDuration={matchDuration} breakM={breakM}
                runScheduler={runScheduler} scheduleInfo={scheduleInfo} reflowSchedule={reflowSchedule}
                setMatchDuration={setMatchDuration} setBreakM={setBreakM}
                occupiedKeys={occupiedKeys} moveMatch={moveMatch} unlockMatch={unlockMatch} clearDaySchedule={clearDaySchedule} reorderColumn={reorderColumn}
                markMatchOnCourt={markMatchOnCourt}
                submitScore={submitScore}
                pendingCategoryCount={pendingCategoryCount} flushPendingCategoryWrites={flushPendingCategoryWrites}
                initialSubTab={pendingTorneoSubTab} onConsumeInitialSubTab={() => setPendingTorneoSubTab(null)}
                onBackToList={() => { setActiveTournamentId(null); setActiveCatId(null); }}
                onRemoveTournament={() => { removeTournament(tournament.id); setActiveTournamentId(null); setActiveCatId(null); }}
              />
            ) : (
              <TournamentsListTab tournaments={tournaments} categories={categories} role={role} currentUser={currentUser}
                onSelect={(id) => { setActiveTournamentId(id); setActiveCatId(null); }}
                onCreate={createTournament} onRemove={removeTournament}
                showForm={tournamentFormOpen} setShowForm={setTournamentFormOpen} />
            )
          )}

          {effectiveTab === "membresias" && (
            <MembresiasTab membershipPlans={membershipPlans} club={club} courts={courts} users={users} subscriptions={subscriptions}
              addMembershipPlan={addMembershipPlan} updateMembershipPlan={updateMembershipPlan} removeMembershipPlan={removeMembershipPlan}
              subscribeToPlan={subscribeToPlan} currentUser={currentUser} role={role}
              coupons={coupons} createCoupon={createCoupon} removeCoupon={removeCoupon}
              couponInfo={couponInfo} redeemCoupon={redeemCoupon} />
          )}

          {effectiveTab === "perfil" && (
            <ProfileTab currentUser={currentUser} membershipPlans={membershipPlans} subscriptions={subscriptions} courts={courts} updateProfile={updateProfile} setTab={setTab}
              viewAsClient={viewAsClient} setViewAsClient={setViewAsClient} />
          )}
        </main>
      </div>

      <MobileNav tab={effectiveTab} setTab={setTab} visibleNav={visibleNav} />

      {/* Link "invitar a mi pareja" con sesión ya abierta (v2.44.2) -- flota encima de
         cualquier tab en el que esté el usuario, en vez de forzar una navegación a Torneos:
         unirse a un equipo es una tarea puntual de un solo paso, no algo que amerite dejar lo
         que se estaba viendo. */}
      {joinParam && !joinModalDismissed && (
        <JoinTeamModal info={resolveJoinInfo(joinParam, categories, tournaments)} currentUser={currentUser} club={club}
          joinTeam={joinTeam} addTeam={addTeam} categories={categories} suggestedRanking={suggestedRanking} users={users}
          onClose={() => setJoinModalDismissed(true)} />
      )}
    </div>
  );
}

/* =========================================================================
   GLOBAL STYLES
   ========================================================================= */
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700;800&display=swap');
      .disp { font-family: 'Space Grotesk', 'Inter', sans-serif; letter-spacing: -0.015em; }
      .mono { font-family: 'Inter', sans-serif; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1, 'zero' 1; }
      input, select, textarea { font-family: 'Inter', sans-serif; background:#fff; transition: border-color .15s ease, box-shadow .15s ease; }
      input:focus, select:focus, textarea:focus { border-color: ${COLORS.court} !important; box-shadow: 0 0 0 3px rgba(18,59,50,0.10); }
      button { transition: transform .12s ease, opacity .12s ease, background-color .15s ease; }
      button:active { transform: scale(0.97); }
      ::-webkit-scrollbar{height:8px;width:8px;}
      ::-webkit-scrollbar-thumb{background:#DCD6C4;border-radius:8px;}
      ::-webkit-scrollbar-track{background:transparent;}
    `}</style>
  );
}

// Compartir por WhatsApp (v2.43.0) -- visible tanto para el admin como para el cliente (a
// diferencia de casi todo lo demás en una ficha de actividad, esto nunca se filtra por
// isAdmin). wa.me es el link universal de WhatsApp: abre la app si está instalada o WhatsApp
// Web si no -- no hace falta ninguna API ni backend propio, el usuario elige a quién
// mandárselo dentro de la propia WhatsApp.
function ShareButton({ kind, id, text, className, style, iconSize = 16 }) {
  const url = shareActivityUrl(kind, id);
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
  return (
    <a href={waHref} target="_blank" rel="noopener noreferrer" title="Compartir por WhatsApp"
      onClick={(e) => e.stopPropagation()}
      className={className || "text-gray-300 hover:text-green-600"} style={style}>
      <Share2 size={iconSize} />
    </a>
  );
}

// Arma el resumen público de una actividad a partir de lo que YA está cargado en memoria
// (openPlays/classes/tournaments/categories se traen sin importar si hay sesión -- ver
// fetchOpenPlays/fetchClasses y los efectos de tournaments/categories en
// PickleballTournamentApp) -- nunca dispara una consulta propia. Mismo criterio de "torneo
// publicado" que EventosTab/TournamentsListTab: un torneo en borrador no es visible ni
// siquiera con el link directo en la mano.
function resolvePublicActivity({ kind, id }, openPlays, classes, tournaments, categories) {
  const todayIso = new Date().toISOString().slice(0, 10);
  if (kind === "open_play") {
    const rows = openPlays.filter((e) => (e.recurringGroupId || e.id) === id);
    if (rows.length === 0) return null;
    const rep = rows.find((o) => o.date >= todayIso) || rows[rows.length - 1];
    const slotsLeft = rep.capacity ? Math.max(0, rep.capacity - rep.registrations.length) : null;
    return {
      kind, id, name: rep.name, description: rep.description || `Nivel ${rep.level}`, image: rep.image,
      dateLabel: formatDateHuman(rep.date), timeLabel: `${formatTimeAmPm(rep.startTime)}–${formatTimeAmPm(rep.endTime)}`,
      priceLabel: rep.price > 0 ? formatMoney(rep.price) : "Gratis",
      spotsLabel: slotsLeft === null ? null : slotsLeft > 0 ? `${slotsLeft} cupo${slotsLeft === 1 ? "" : "s"} disponible${slotsLeft === 1 ? "" : "s"}` : "Cupo lleno",
    };
  }
  if (kind === "clase") {
    const rows = classes.filter((e) => (e.recurringGroupId || e.id) === id);
    if (rows.length === 0) return null;
    const rep = rows.find((c) => c.date >= todayIso) || rows[rows.length - 1];
    return {
      kind, id, name: rep.academyName, description: `Nivel ${rep.level}`, image: null,
      dateLabel: formatDateHuman(rep.date), timeLabel: `${formatTimeAmPm(rep.startTime)}–${formatTimeAmPm(rep.endTime)}`,
      priceLabel: rep.price > 0 ? formatMoney(rep.price) : "Gratis", spotsLabel: null,
    };
  }
  if (kind === "torneo") {
    const t = tournaments.find((x) => x.id === id && x.status === "published");
    if (!t) return null;
    const tCats = categories.filter((c) => c.tournamentId === t.id);
    const entryPrice = tournamentRegPrice(t, 1);
    return {
      kind, id, name: t.name || "Torneo del club",
      description: tCats.length ? `${tCats.length} categoría${tCats.length === 1 ? "" : "s"} abierta${tCats.length === 1 ? "" : "s"}.` : "Sin categorías aún.",
      image: t.image || null,
      dateLabel: t.startDate ? formatDateHuman(t.startDate) : "Fecha por confirmar",
      timeLabel: t.dailyStart ? `${formatTimeAmPm(t.dailyStart)}–${formatTimeAmPm(t.dailyEnd)}` : "",
      priceLabel: entryPrice > 0 ? `Desde ${formatMoney(entryPrice)}` : "Gratis", spotsLabel: null,
    };
  }
  return null;
}

// Ficha pública de una actividad (v2.43.0) -- lo que ve alguien SIN cuenta que abre un link
// compartido por WhatsApp. `activity` ya viene resuelta (resolvePublicActivity) o null si no
// existe / (torneo) no está publicado. `loading` distingue "todavía no sabemos" (spinner) de
// "de verdad no existe" -- sin esto, un visitante con internet lento vería "no disponible" por
// un instante antes de que carguen los datos, un falso negativo confuso. Tocar "Inscribirme"
// no inscribe nada acá -- solo abre el login/registro normal; la inscripción de verdad sigue
// pasando por EventDetail/ClassDetail/InscripcionTab una vez adentro (ver auto-navegación en
// PickleballTournamentApp).
function PublicActivityView({ activity, loading, club, registerUser, loginUser, resetPasswordUser }) {
  const [wantsAuth, setWantsAuth] = useState(false);

  if (wantsAuth) {
    return <AuthScreen club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />;
  }

  return (
    <div className="w-full min-h-screen flex items-center justify-center p-4" style={{ background: COLORS.chalk }}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: COLORS.court }}>
            <PartyPopper size={18} color="#fff" />
          </div>
          <span className="font-extrabold truncate" style={{ color: COLORS.courtDark }}>{club?.name || "Pickle Hub"}</span>
        </div>

        {loading ? (
          <p className="text-sm py-6 text-center" style={{ color: "#6B7688" }}>Cargando actividad…</p>
        ) : activity ? (
          <>
            {activity.image && <img src={activity.image} alt="" className="w-full h-36 object-cover rounded-xl mb-4" />}
            <p className="disp text-xl mb-1" style={{ color: COLORS.courtDark }}>{activity.name}</p>
            <p className="text-sm mb-3" style={{ color: "#6B7688" }}>{activity.dateLabel}{activity.timeLabel && ` · ${activity.timeLabel}`}</p>
            {activity.description && <p className="text-sm mb-4" style={{ color: "#3D4A5C" }}>{activity.description}</p>}
            <div className="flex items-center justify-between mb-5 px-3 py-2.5 rounded-xl" style={{ background: "#EEF1F7" }}>
              <span className="text-sm font-bold" style={{ color: COLORS.court }}>{activity.priceLabel}</span>
              {activity.spotsLabel && <span className="text-xs" style={{ color: "#6B7688" }}>{activity.spotsLabel}</span>}
            </div>
          </>
        ) : (
          <p className="text-sm mb-5" style={{ color: "#6B7688" }}>Esta actividad ya no está disponible, pero puedes iniciar sesión para ver todo lo que tiene el club ahora mismo.</p>
        )}

        {!loading && (
          <button onClick={() => setWantsAuth(true)} style={{ background: COLORS.court, color: "#fff" }}
            className="w-full py-3 rounded-xl font-bold text-sm">
            {activity ? "Iniciar sesión para inscribirme" : "Iniciar sesión"}
          </button>
        )}
      </div>
    </div>
  );
}

// Resuelve un link "invitar a mi pareja" (v2.44.2, ver joinTeamUrl) contra lo que YA está
// cargado en memoria (categories/tournaments se traen sin importar si hay sesión, igual que
// resolvePublicActivity) -- null si la categoría/equipo/torneo ya no existen. `full` (el
// equipo ya tiene sus 2 jugadores) y `drawStarted` (la categoría ya generó su calendario, ya
// no admite inscritos nuevos) quedan calculados acá para que tanto la vista pública como el
// modal con sesión compartan el mismo criterio de "este link ya no sirve".
function resolveJoinInfo({ catId, teamId }, categories, tournaments) {
  const cat = categories.find((c) => c.id === catId);
  if (!cat) return null;
  const team = (cat.teams || []).find((t) => t.id === teamId) || (cat.waitlist || []).find((t) => t.id === teamId);
  if (!team) return null;
  const tournament = tournaments.find((t) => t.id === cat.tournamentId);
  if (!tournament) return null;
  return { cat, team, tournament, full: (team.players || []).length >= 2, drawStarted: (cat.matches || []).length > 0 };
}

// Ficha pública de una invitación a equipo (v2.44.2) -- lo que ve alguien SIN cuenta que abre
// un link "invitar a mi pareja". Mismo patrón que PublicActivityView: solo pide login/registro
// al tocar el botón, nunca antes. Une-de-verdad-y-paga pasa por JoinTeamModal, después de
// loguearse -- acá solo se muestra de qué se trata.
function PublicJoinTeamView({ info, loading, club, registerUser, loginUser, resetPasswordUser }) {
  const [wantsAuth, setWantsAuth] = useState(false);

  if (wantsAuth) {
    return <AuthScreen club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />;
  }

  const unavailable = !info || info.full || info.drawStarted;
  const creatorName = info?.team.players[0]?.name;

  return (
    <div className="w-full min-h-screen flex items-center justify-center p-4" style={{ background: COLORS.chalk }}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: COLORS.court }}>
            <UserPlus size={18} color="#fff" />
          </div>
          <span className="font-extrabold truncate" style={{ color: COLORS.courtDark }}>{club?.name || "Pickle Hub"}</span>
        </div>

        {loading ? (
          <p className="text-sm py-6 text-center" style={{ color: "#6B7688" }}>Cargando invitación…</p>
        ) : !unavailable ? (
          <>
            <p className="disp text-xl mb-1" style={{ color: COLORS.courtDark }}>Te invitó {creatorName}</p>
            <p className="text-sm mb-4" style={{ color: "#6B7688" }}>a jugar <b>{info.cat.name}</b> en {info.tournament.name}. Tu inscripción es propia -- pagas tú tu cupo al unirte.</p>
          </>
        ) : (
          <p className="text-sm mb-5" style={{ color: "#6B7688" }}>
            {info?.full ? "Este cupo ya se completó -- alguien más se anotó primero." : info?.drawStarted ? "Esta categoría ya cerró su inscripción." : "Este link ya no está disponible."}
            {" "}Puedes iniciar sesión para ver todo lo que tiene el club ahora mismo.
          </p>
        )}

        {!loading && (
          <button onClick={() => setWantsAuth(true)} style={{ background: COLORS.court, color: "#fff" }}
            className="w-full py-3 rounded-xl font-bold text-sm">
            {!unavailable ? "Iniciar sesión para unirme" : "Iniciar sesión"}
          </button>
        )}
      </div>
    </div>
  );
}

// Mismo patrón que PublicJoinTeamView -- alguien sin sesión escaneó/abrió un link de cupón
// (v2.82.0, `?cupon=<code>`, ver couponInfo en el componente principal). Solo previsualiza
// (plan + % de descuento + precio ya calculado) y empuja a loguearse/registrarse -- el canje
// real (redeemCoupon) pasa recién adentro de la app, una vez con sesión, para que quede
// atribuido a una cuenta real (ver MembresiasTab/CouponCheckoutBanner).
function PublicCouponView({ couponInfo, club, registerUser, loginUser, resetPasswordUser }) {
  const [wantsAuth, setWantsAuth] = useState(false);
  if (wantsAuth) {
    return <AuthScreen club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />;
  }
  const loading = couponInfo === undefined;
  const valid = !!(couponInfo && couponInfo.plan && !couponInfo.coupon.used);
  const discounted = valid ? couponInfo.plan.monthlyPrice * (1 - couponInfo.coupon.discountPct / 100) : null;

  return (
    <div className="w-full min-h-screen flex items-center justify-center p-4" style={{ background: COLORS.chalk }}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
        <div className="flex items-center gap-2 mb-5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: COLORS.ball }}>
            <Tag size={18} color="#fff" />
          </div>
          <span className="font-extrabold truncate" style={{ color: COLORS.courtDark }}>{club?.name || "Pickle Hub"}</span>
        </div>

        {loading ? (
          <p className="text-sm py-6 text-center" style={{ color: "#6B7688" }}>Cargando cupón…</p>
        ) : valid ? (
          <>
            <p className="disp text-xl mb-1" style={{ color: COLORS.courtDark }}>¡Tienes un cupón!</p>
            <p className="text-sm mb-3" style={{ color: "#6B7688" }}>{couponInfo.coupon.discountPct}% de descuento en <b>{couponInfo.plan.name}</b>.</p>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="disp text-2xl" style={{ color: COLORS.courtDark }}>{formatMoney(discounted)}</span>
              <span className="text-sm line-through" style={{ color: "#9AA6BC" }}>{formatMoney(couponInfo.plan.monthlyPrice)}</span>
              <span className="text-xs" style={{ color: "#6B7688" }}>/mes</span>
            </div>
          </>
        ) : (
          <p className="text-sm mb-5" style={{ color: "#6B7688" }}>
            {couponInfo?.coupon?.used ? "Este cupón ya fue usado -- solo sirve una vez." : "Este cupón ya no está disponible."}
            {" "}Puedes iniciar sesión para ver todo lo que tiene el club ahora mismo.
          </p>
        )}

        {!loading && (
          <button onClick={() => setWantsAuth(true)} style={{ background: COLORS.court, color: "#fff" }}
            className="w-full py-3 rounded-xl font-bold text-sm">
            {valid ? "Iniciar sesión para canjearlo" : "Iniciar sesión"}
          </button>
        )}
      </div>
    </div>
  );
}

// Modal para completar la unión a un equipo YA con sesión abierta (v2.44.2) -- ya sea porque
// el jugador se acaba de loguear/registrar desde PublicJoinTeamView, o porque ya tenía sesión
// en este dispositivo cuando tocó el link. Flota encima de la app (ver el render en
// PickleballTournamentApp) sin importar en qué tab esté. Vuelve a chequear `full`/`drawStarted`
// (pudieron cambiar entre que se resolvió el link y que se abre el modal) y agrega dos casos
// propios: es tu propio cupo (te compartiste el link a ti mismo sin querer), o ya estás
// inscrito en esta misma categoría con otro equipo.
//
// v2.49.0: además de unirse al cupo del link, deja agregar OTRAS categorías abiertas del
// mismo torneo al mismo checkout -- antes unirse SIEMPRE cobraba tournamentRegPrice(tournament,
// 1), el precio de una sola categoría, sin importar que la persona quisiera jugar más de una.
// Eso la perjudicaba: si además quería, por ejemplo, Mixto, tenía que pagarlo aparte en un
// segundo checkout, perdiendo el descuento de "categoría adicional" que sí tiene el carrito
// normal de InscripcionTab. Ahora la categoría del link cuenta como una más del mismo carrito
// -- mismo tournamentRegPrice(tournament, catCount) que usa InscripcionTab, split en partes
// iguales entre el join y cada equipo nuevo (ver confirm más abajo).
function JoinTeamModal({ info, currentUser, club, joinTeam, addTeam, categories, suggestedRanking, users, onClose }) {
  const [done, setDone] = useState(null); // { names, failedNames, pendingTeams } tras confirmar
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [extraIds, setExtraIds] = useState([]);
  const [expandedLevels, setExpandedLevels] = useState([]);

  if (!info) {
    return (
      <Modal onClose={onClose} maxWidth={420}>
        <div className="p-5">
          <p className="text-sm" style={{ color: "#6B7688" }}>Este link ya no es válido -- puede que el cupo o la categoría se hayan borrado.</p>
          <button onClick={onClose} className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold" style={{ background: COLORS.court, color: "#fff" }}>Cerrar</button>
        </div>
      </Modal>
    );
  }

  const { cat, team, tournament, full, drawStarted } = info;
  const creator = team.players[0];
  const isOwnTeam = creator.userId === currentUser.id;
  const alreadyInCat = [...cat.teams, ...cat.waitlist].some((t) => t.players.some((p) => p.userId === currentUser.id));
  // v2.61.0: mismo bloqueo que ya aplica joinTeam del lado de la app principal (ver ese
  // comentario) -- acá se repite SOLO para avisar de entrada, antes de que la persona llegue al
  // botón de pagar, en vez de dejarla completar el checkout y recién ahí enterarse. joinTeam
  // sigue siendo la validación real (esto es apenas la UI adelantándose).
  const genderMismatch = cat.gender === "mixto" && creator.userId && currentUser.gender
    && users.find((u) => u.id === creator.userId)?.gender === currentUser.gender;
  const blocked = full || drawStarted || isOwnTeam || alreadyInCat || genderMismatch;

  // Mismo criterio de elegibilidad que InscripcionTab.eligible -- otras categorías de ESTE
  // torneo (nunca la del link, esa se une aparte con joinTeam) todavía abiertas y en las que
  // este jugador no esté ya inscrito.
  const extraEligible = blocked ? [] : categories.filter((c) => {
    if (c.tournamentId !== tournament.id || c.id === cat.id) return false;
    if ((c.matches || []).length > 0) return false;
    const already = [...(c.teams || []), ...(c.waitlist || [])].some((t) => (t.players || []).some((p) => p.userId === currentUser.id));
    if (already) return false;
    if (currentUser.gender && c.gender !== "mixto" && c.gender !== "libre" && c.gender !== currentUser.gender) return false;
    return true;
  });
  const selectedExtras = extraEligible.filter((c) => extraIds.includes(c.id));
  const catCount = 1 + selectedExtras.length;
  // v2.56.0: si currentUser ya está inscrito en otras categorías de este torneo de un checkout
  // ANTERIOR (nunca cuenta `cat`, la del link -- alreadyInCat ya bloquea ese caso más arriba),
  // este carrito tampoco debe volver a cobrar precio de 1ra categoría -- mismo criterio que
  // InscripcionTab (ver tournamentRegPriceFrom).
  const alreadyRegisteredCount = countRegisteredCategories(categories, tournament.id, { userId: currentUser.id, name: currentUser.name }, cat.id);
  const total = tournamentRegPriceFrom(tournament, alreadyRegisteredCount, catCount);
  const pricePerCat = total / catCount;

  const toggleExtra = (id) => setExtraIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  // Agrupar las extra por nivel (v2.51.0), mismo patrón que InscripcionTab -- primero el nivel
  // con un botón, debajo las modalidades disponibles en ese nivel.
  const extraLevelGroups = [];
  extraEligible.forEach((c) => {
    let group = extraLevelGroups.find((g) => g[0] === c.level);
    if (!group) { group = [c.level, []]; extraLevelGroups.push(group); }
    group[1].push(c);
  });
  const toggleLevel = (level) => setExpandedLevels((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]));

  const confirm = async (checkout) => {
    if (confirming) return;
    setConfirming(true); setError("");
    const bsRate = Number(club.bsPerUsd) || 0;
    const joinResult = await joinTeam(cat.id, team.id, { name: currentUser.name, ranking: 0, userId: currentUser.id },
      { ...checkout, priceUsd: pricePerCat, priceBs: pricePerCat * bsRate });
    if (joinResult?.error) { setConfirming(false); setError(joinResult.error); return; }
    // La unión principal ya se guardó -- de acá para abajo son categorías EXTRA, opcionales.
    // Si alguna falla, no se deshace la unión principal (ya está pagada y confirmada); se
    // avisa cuál faltó para que la intente de nuevo desde Inscripción. Ya no se elige pareja
    // acá (v2.51.0, mismo criterio que InscripcionTab): toda extra de dobles arranca
    // "esperando pareja", el link para completarla sale en la pantalla de éxito de abajo.
    const pendingTeams = [];
    const failedNames = [];
    for (const c of selectedExtras) {
      const players = [{ name: currentUser.name, ranking: suggestedRanking(currentUser.name) || 0, userId: currentUser.id }];
      const result = await addTeam(c.id, players, { ...checkout, priceUsd: pricePerCat, priceBs: pricePerCat * bsRate, userId: currentUser.id });
      if (result.error) { failedNames.push(c.name); continue; }
      if (c.modality !== "individual") pendingTeams.push({ catId: c.id, catName: c.name, teamId: result.teamId });
    }
    setConfirming(false);
    setDone({ names: [cat.name, ...selectedExtras.filter((c) => !failedNames.includes(c.name)).map((c) => c.name)], failedNames, pendingTeams });
  };

  return (
    <Modal onClose={onClose} maxWidth={480}>
      <div className="p-5">
        {done ? (
          <>
            <div className="flex items-center gap-2 mb-3"><CheckCircle2 size={20} color={COLORS.court} /><p className="disp text-lg" style={{ color: COLORS.courtDark }}>¡Listo!</p></div>
            <p className="text-sm mb-1" style={{ color: "#6B7688" }}>
              Quedaste inscrito con {creator.name} en {cat.name}
              {done.names.length > 1 && <>, y también en <strong>{done.names.slice(1).join(", ")}</strong></>}.
            </p>
            {done.failedNames.length > 0 && (
              <p className="text-xs font-semibold mt-2 mb-1" style={{ color: "#B23A1B" }}>
                No se pudo agregar: {done.failedNames.join(", ")} -- revisa tu conexión e inténtalo de nuevo desde Torneos → Inscripción.
              </p>
            )}
            {done.pendingTeams.length > 0 && (
              <div className="space-y-2 mt-3 mb-1">
                {done.pendingTeams.map((pt) => (
                  <a key={pt.teamId} href={`https://wa.me/?text=${encodeURIComponent(`Te invité a jugar ${pt.catName} conmigo en ${tournament.name} -- únete y confirma tu cupo acá:\n${joinTeamUrl(pt.catId, pt.teamId)}`)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#25D366", color: "#fff" }}>
                    <Share2 size={14} /> Invitar a tu pareja en {pt.catName}
                  </a>
                ))}
              </div>
            )}
            <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-bold mt-3" style={{ background: COLORS.court, color: "#fff" }}>Cerrar</button>
          </>
        ) : blocked ? (
          <>
            <p className="text-sm mb-4" style={{ color: "#6B7688" }}>
              {isOwnTeam ? "Este es tu propio cupo -- comparte el link con tu pareja, no contigo mismo."
                : alreadyInCat ? "Ya estás inscrito en esta categoría con otro equipo."
                : genderMismatch ? `Esta categoría es mixta -- necesita 1 hombre y 1 mujer. ${creator.name} ya está anotado/a, así que no te puedes unir con el mismo género.`
                : full ? "Este cupo ya se completó -- alguien más se anotó primero."
                : "Esta categoría ya cerró su inscripción."}
            </p>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: COLORS.court, color: "#fff" }}>Cerrar</button>
          </>
        ) : (
          <>
            <p className="disp text-lg mb-1" style={{ color: COLORS.courtDark }}>Únete a {creator.name}</p>
            <p className="text-sm mb-4" style={{ color: "#6B7688" }}><CategoryLabel cat={cat} /> · {tournament.name}</p>

            {extraLevelGroups.length > 0 && (
              <div className="mb-4">
                <Label>¿Te inscribes en otra categoría también? (opcional)</Label>
                <p className="text-[11px] mb-2" style={{ color: "#6B7688" }}>Súmala acá para pagar el precio de "categoría adicional" en vez de un checkout aparte.</p>
                <div className="space-y-1.5">
                  {extraLevelGroups.map(([level, cats]) => {
                    const isExpanded = expandedLevels.includes(level);
                    const selectedCount = cats.filter((c) => extraIds.includes(c.id)).length;
                    return (
                      <div key={level} className="rounded-xl overflow-hidden" style={{ border: `1.5px solid ${selectedCount > 0 ? COLORS.court : COLORS.line}` }}>
                        <button type="button" onClick={() => toggleLevel(level)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left" style={{ background: selectedCount > 0 ? "#F3F8F1" : "transparent" }}>
                          <span className="text-sm font-bold" style={{ color: COLORS.courtDark }}>{level}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {selectedCount > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: COLORS.court, color: "#fff" }}>{selectedCount}</span>}
                            <ChevronDown size={14} color="#6B7688" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="px-2.5 pb-2.5 space-y-1.5" style={{ borderTop: `1px solid ${COLORS.line}` }}>
                            {cats.map((c) => {
                              const isSelected = extraIds.includes(c.id);
                              return (
                                <button key={c.id} type="button" onClick={() => toggleExtra(c.id)}
                                  className="w-full text-left px-3 py-2 mt-1.5 rounded-lg flex items-center gap-2.5"
                                  style={{ background: isSelected ? "#EAF3E6" : "#F7F8FA", border: `1.5px solid ${isSelected ? COLORS.court : "transparent"}` }}>
                                  <div className="w-4.5 h-4.5 rounded flex items-center justify-center shrink-0" style={{ background: isSelected ? COLORS.court : "#fff", border: `1.5px solid ${isSelected ? COLORS.court : COLORS.line}` }}>
                                    {isSelected && <Check size={11} color="#fff" strokeWidth={3} />}
                                  </div>
                                  <span className="text-sm">{c.modality === "individual" ? "Individual" : "Dobles"} {GENDER_LABELS[c.gender]}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {error && <p className="text-xs font-semibold mb-3" style={{ color: "#B23A1B" }}>{error}</p>}
            <CheckoutPanel title={`Pago de ${catCount} categoría${catCount === 1 ? "" : "s"}`} baseUsd={total} club={club} defaultName={currentUser.name}
              onConfirm={confirm} onCancel={onClose} confirmLabel={confirming ? "Confirmando…" : "Confirmar mi inscripción"} />
          </>
        )}
      </div>
    </Modal>
  );
}

/* =========================================================================
   AUTH — login / registro. Sin backend real: las cuentas viven en memoria
   durante la sesión. Incluye una cuenta admin de muestra para poder ver
   ambas vistas (administrador y cliente) sin salir de la app.
   ========================================================================= */
function AuthScreen({ club, registerUser, loginUser, resetPasswordUser, updatePassword, forceReset }) {
  const [mode, setMode] = useState(forceReset ? "reset" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); // mensaje de éxito (no es error), p.ej. "te enviamos un correo"

  // La sesión temporal de recuperación viene del padre (App) -- mientras dure, no se puede
  // salir de esta pantalla ni volver a login/register.
  useEffect(() => { if (forceReset) setMode("reset"); }, [forceReset]);

  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setError("");
    setNotice("");
    if (mode === "reset" && newPassword !== newPassword2) { setError("Las contraseñas no coinciden."); return; }
    setSubmitting(true);
    let result;
    if (mode === "login") result = await loginUser(email, password);
    // El registro solo pide correo + contraseña -- el resto (nombre, género, fecha de
    // nacimiento, DUPR, domicilio) se completa en el wizard de Onboarding que se muestra
    // automáticamente justo después de crear la cuenta (ver el gate en el componente
    // principal, antes de renderizar la app).
    else if (mode === "register") result = await registerUser({ email, password });
    else if (mode === "recover") {
      result = await resetPasswordUser(email);
      // Mensaje genérico a propósito -- no confirma si el correo existe o no en el sistema.
      if (!result?.error) setNotice("Si ese correo tiene una cuenta, te enviamos un enlace para restablecer la contraseña. Revisa tu bandeja de entrada (y spam).");
    } else if (mode === "reset") {
      result = await updatePassword(newPassword);
    }
    setSubmitting(false);
    if (result?.error) setError(result.error);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: COLORS.courtDark }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-7">
          <img src={clubLogo} alt={club.name || "Pickle Hub"} className="h-16 w-auto" />
        </div>

        <p className="text-center text-[10px] mono mb-4" style={{ color: "#5B6B85" }}>v{APP_VERSION}</p>

        <div className="rounded-[20px] p-6" style={{ background: COLORS.chalk }}>
          {(mode === "login" || mode === "register") && (
            <div className="flex gap-1.5 mb-5 p-1 rounded-xl" style={{ background: "#EDEFF4" }}>
              <button onClick={() => { setMode("login"); setError(""); setNotice(""); }} className="flex-1 py-2 rounded-lg text-sm font-bold"
                style={{ background: mode === "login" ? "#fff" : "transparent", color: mode === "login" ? COLORS.courtDark : "#6B7688", boxShadow: mode === "login" ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
                Iniciar sesión
              </button>
              <button onClick={() => { setMode("register"); setError(""); setNotice(""); }} className="flex-1 py-2 rounded-lg text-sm font-bold"
                style={{ background: mode === "register" ? "#fff" : "transparent", color: mode === "register" ? COLORS.courtDark : "#6B7688", boxShadow: mode === "register" ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
                Crear cuenta
              </button>
            </div>
          )}

          {mode === "recover" && (
            <div className="flex items-center gap-2 mb-5">
              <button onClick={() => { setMode("login"); setError(""); setNotice(""); }} className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#EDEFF4" }}>
                <ChevronLeft size={16} color="#6B7688" />
              </button>
              <p className="text-sm font-bold" style={{ color: COLORS.courtDark }}>Recuperar contraseña</p>
            </div>
          )}

          {mode === "reset" && (
            <div className="mb-5">
              <p className="text-sm font-bold" style={{ color: COLORS.courtDark }}>Elige tu nueva contraseña</p>
              <p className="text-xs mt-1" style={{ color: "#6B7688" }}>Ya verificamos tu correo desde el enlace que te enviamos.</p>
            </div>
          )}

          <div className="space-y-3">
            {(mode === "login" || mode === "register" || mode === "recover") && (
              <div>
                <Label>Correo</Label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                  <input type="email" style={{ ...inputStyle, paddingLeft: 32 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com"
                    onKeyDown={(e) => e.key === "Enter" && submit()} />
                </div>
              </div>
            )}
            {(mode === "login" || mode === "register") && (
              <div>
                <Label>Contraseña</Label>
                <div className="relative">
                  <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                  <input type="password" style={{ ...inputStyle, paddingLeft: 32 }} value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && submit()} />
                </div>
                {mode === "login" && (
                  <button type="button" onClick={() => { setMode("recover"); setError(""); setNotice(""); }} className="text-[11px] font-bold mt-1.5" style={{ color: COLORS.court }}>
                    ¿Olvidaste tu contraseña?
                  </button>
                )}
              </div>
            )}

            {mode === "register" && (
              <p className="text-[11px] -mt-1" style={{ color: "#6B7688" }}>
                Al crear tu cuenta te pediremos tu nombre, nivel DUPR y algunos datos más — toma menos de un minuto.
              </p>
            )}

            {mode === "reset" && (
              <>
                <div>
                  <Label>Nueva contraseña</Label>
                  <div className="relative">
                    <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                    <input type="password" style={{ ...inputStyle, paddingLeft: 32 }} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && submit()} />
                  </div>
                </div>
                <div>
                  <Label>Confirma la nueva contraseña</Label>
                  <div className="relative">
                    <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                    <input type="password" style={{ ...inputStyle, paddingLeft: 32 }} value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)}
                      placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && submit()} />
                  </div>
                </div>
              </>
            )}

            {notice && <p className="text-xs font-semibold" style={{ color: COLORS.court }}>{notice}</p>}
            {error && <p className="text-xs font-semibold" style={{ color: "#B23A1B" }}>{error}</p>}

            <button disabled={submitting} onClick={submit} style={{ background: COLORS.clay, color: "#fff", opacity: submitting ? 0.6 : 1 }} className="w-full py-2.5 rounded-xl font-bold text-sm mt-1">
              {submitting ? "Un momento…" : mode === "login" ? "Entrar" : mode === "register" ? "Crear cuenta" : mode === "recover" ? "Enviar enlace" : "Guardar nueva contraseña"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   ONBOARDING — wizard de un paso a la vez, se muestra justo después de crear
   la cuenta (registro solo pide correo+contraseña). Pide nombre, género,
   fecha de nacimiento (obligatorios), y DUPR/domicilio (opcionales, se
   pueden dejar en blanco y completar después desde Perfil). Al terminar,
   pone onboarding_completed=true en el mismo update -- eso es lo que hace
   que el gate del componente principal deje de mostrar este wizard.
   ========================================================================= */
const ONBOARDING_STEPS = ["name", "gender", "birthdate", "dupr", "zone"];

function Onboarding({ currentUser, club, updateProfile, logoutUser }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [duprRating, setDuprRating] = useState("");
  const [zone, setZone] = useState("");
  const [zoneStatus, setZoneStatus] = useState({ loading: false, error: null, auto: false });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const key = ONBOARDING_STEPS[step];
  const isLast = step === ONBOARDING_STEPS.length - 1;

  const detectZone = () => {
    if (!navigator.geolocation) {
      setZoneStatus({ loading: false, error: "Tu navegador no soporta geolocalización — escríbelo manualmente.", auto: false });
      return;
    }
    setZoneStatus({ loading: true, error: null, auto: false });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=14`);
          const data = await res.json();
          const addr = data.address || {};
          const detected = addr.suburb || addr.neighbourhood || addr.city_district || addr.town || addr.city || addr.county || addr.state || "";
          if (detected) setZoneStatus({ loading: false, error: null, auto: true });
          else setZoneStatus({ loading: false, error: "No se pudo identificar tu ubicación — escríbela manualmente.", auto: false });
          if (detected) setZone(detected);
        } catch {
          setZoneStatus({ loading: false, error: "No se pudo consultar la ubicación — escríbela manualmente.", auto: false });
        }
      },
      () => setZoneStatus({ loading: false, error: "Permiso de ubicación denegado — escríbela manualmente.", auto: false }),
      { timeout: 8000 }
    );
  };
  useEffect(() => { if (key === "zone") detectZone(); }, [key]);

  const requiredOk = {
    name: name.trim().length > 0,
    gender: !!gender,
    birthdate: !!birthDate,
    dupr: true,
    zone: true,
  }[key];

  const goNext = async () => {
    if (!requiredOk) return;
    if (!isLast) { setStep((s) => s + 1); return; }
    setError(""); setSubmitting(true);
    const result = await updateProfile({
      name: name.trim(), gender, birthDate,
      duprRating: duprRating === "" ? "" : Number(duprRating),
      zone: zone.trim(), onboardingCompleted: true,
    });
    setSubmitting(false);
    if (result?.error) setError(result.error);
  };
  const goBack = () => { setError(""); setStep((s) => Math.max(0, s - 1)); };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: COLORS.courtDark }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <img src={clubLogo} alt={club.name || "Pickle Hub"} className="h-16 w-auto mb-3" />
          <h1 className="disp text-xl text-center" style={{ color: COLORS.chalk }}>¡Bienvenido!</h1>
        </div>

        <div className="flex items-center justify-center gap-1.5 mb-5">
          {ONBOARDING_STEPS.map((s, i) => (
            <span key={s} className="h-1.5 rounded-full transition-all" style={{ width: i === step ? 26 : 8, background: i <= step ? COLORS.ball : "rgba(255,255,255,0.22)" }} />
          ))}
        </div>

        <div className="rounded-[20px] p-6" style={{ background: COLORS.chalk }}>
          {key === "name" && (
            <div>
              <SectionTitle sub="Así te verán los demás jugadores del club.">¿Cómo te llamas?</SectionTitle>
              <Label>Nombre y apellido</Label>
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. María Pérez" autoFocus
                onKeyDown={(e) => e.key === "Enter" && goNext()} />
            </div>
          )}

          {key === "gender" && (
            <div>
              <SectionTitle sub="Se usa para mostrarte las categorías del torneo que te corresponden.">¿Cuál es tu género?</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                {[{ v: "masculino", l: "Masculino" }, { v: "femenino", l: "Femenino" }].map((o) => (
                  <button key={o.v} type="button" onClick={() => setGender(o.v)} className="py-5 rounded-2xl text-sm font-bold"
                    style={{ background: gender === o.v ? COLORS.court : "#EEF1F7", color: gender === o.v ? "#fff" : COLORS.ink, border: `1.5px solid ${gender === o.v ? COLORS.court : COLORS.line}` }}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {key === "birthdate" && (
            <div>
              <SectionTitle sub="La usamos solo para tu perfil del club.">¿Cuándo naciste?</SectionTitle>
              <Label>Fecha de nacimiento</Label>
              <input type="date" style={inputStyle} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            </div>
          )}

          {key === "dupr" && (
            <div>
              <SectionTitle sub="Si no lo sabes todavía, puedes dejarlo en blanco y completarlo después desde tu Perfil.">¿Cuál es tu nivel DUPR?</SectionTitle>
              <Label>Nivel DUPR (opcional)</Label>
              <div className="relative">
                <Medal size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                <input type="number" step="0.01" min="2" max="8" style={{ ...inputStyle, paddingLeft: 32 }} value={duprRating}
                  onChange={(e) => setDuprRating(e.target.value)} placeholder="Ej. 3.5" onKeyDown={(e) => e.key === "Enter" && goNext()} />
              </div>
            </div>
          )}

          {key === "zone" && (
            <div>
              <SectionTitle sub="Se usa para las estadísticas del club -- de dónde vienen sus jugadores.">¿Dónde vives?</SectionTitle>
              <Label>Domicilio (opcional)</Label>
              <div className="relative">
                <MapPinned size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                <input style={{ ...inputStyle, paddingLeft: 32 }} value={zone}
                  onChange={(e) => { setZone(e.target.value); setZoneStatus((s) => ({ ...s, auto: false, error: null })); }}
                  placeholder="Ej. Chacao, Caracas" onKeyDown={(e) => e.key === "Enter" && goNext()} />
              </div>
              <div className="flex items-center justify-between mt-1 gap-2">
                <p className="text-[10px]" style={{ color: zoneStatus.error ? "#B23A1B" : zoneStatus.auto ? COLORS.court : "#6B7688" }}>
                  {zoneStatus.loading ? "Detectando tu ubicación…" : zoneStatus.auto ? "Detectada automáticamente — puedes editarla." : zoneStatus.error || "Puedes escribirlo a mano."}
                </p>
                <button type="button" onClick={detectZone} className="text-[10px] font-bold shrink-0" style={{ color: COLORS.court }}>Detectar de nuevo</button>
              </div>
            </div>
          )}

          {error && <p className="text-xs font-semibold mt-3" style={{ color: "#B23A1B" }}>{error}</p>}

          <div className="flex gap-2 mt-6">
            {step > 0 && (
              <button onClick={goBack} className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1" style={{ background: "#EDEFF4", color: COLORS.ink }}>
                <ChevronLeft size={14} /> Atrás
              </button>
            )}
            <button disabled={!requiredOk || submitting} onClick={goNext}
              style={{ background: requiredOk && !submitting ? COLORS.clay : "#E5E5E5", color: requiredOk && !submitting ? "#fff" : "#999" }}
              className="flex-1 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5">
              {submitting ? "Guardando…" : isLast ? "Terminar" : "Siguiente"} {!submitting && !isLast && <ArrowRight size={14} />}
            </button>
          </div>
        </div>

        <button onClick={logoutUser} className="w-full text-center text-[11px] mt-5" style={{ color: "#55677E" }}>
          Cerrar sesión y continuar más tarde
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   SIDEBAR (desktop) + TOPBAR (ticker) + MOBILE NAV
   ========================================================================= */
// Orden para el admin (v2.18.0): Estadísticas, Usuarios, Actividades, Reservas, Torneos,
// Mi Club, Perfil -- "Membresías" deja de ser una pestaña propia del admin porque su
// configuración ahora vive dentro de "Mi Club" (ver ClubTab); para el cliente sigue
// existiendo como su propia pestaña (comparar planes y suscribirse), ubicada antes de Perfil.
const NAV_ITEMS = [
  { id: "estadisticas", label: "Estadísticas", short: "Stats", icon: BarChart3, sub: "Ingresos, horarios pico, membresías y zonas", roles: ["admin"] },
  { id: "usuarios", label: "Usuarios", short: "Usuarios", icon: Users, sub: "Directorio de jugadores y sus membresías", roles: ["admin"] },
  // v2.44.5: antes había que entrar torneo por torneo/categoría por categoría (o actividad
  // por actividad) para verificar cada pago -- esto junta TODAS las inscripciones de
  // torneos, Open Plays y clases en una sola lista, una fila por PERSONA (no por equipo).
  { id: "pagos", label: "Pagos", short: "Pagos", icon: Wallet, sub: "Verifica los pagos de torneos, Open Plays y clases, todos juntos", roles: ["admin"] },
  // "eventos" (id interno sin cambios) va primero para el cliente -- es su sección de aterrizaje.
  { id: "eventos", label: "Actividades", short: "Actividades", icon: PartyPopper, sub: "Open Plays, Torneos y Clases del club", roles: ["admin", "cliente"] },
  { id: "reservas", label: "Reservas", short: "Reservas", icon: CalendarClock, sub: "Reserva un bloque de cancha disponible", roles: ["admin", "cliente"] },
  // "Torneos"/"Mis Torneos" (v2.48.1): mismo id (así visibleNav.find(tab) sigue resolviendo
  // uno u otro sin tocar nada más), pero dos entradas separadas porque el nombre y el
  // contenido de la lista difieren por rol -- el admin gestiona TODOS los torneos del club
  // (TournamentsListTab se lo sigue mostrando así); el cliente solo debería ver en los que ya
  // está inscrito, así que el nombre "Mis Torneos" lo deja claro de entrada (ver el filtro en
  // TournamentsListTab).
  { id: "torneos", label: "Torneos", short: "Torneos", icon: Trophy, sub: "Organiza el torneo del club", roles: ["admin"] },
  { id: "torneos", label: "Mis Torneos", short: "Mis Torneos", icon: Trophy, sub: "Los torneos en los que estás inscrito", roles: ["cliente"] },
  { id: "membresias", label: "Membresías", short: "Planes", icon: Award, sub: "Planes, beneficios y suscripción", roles: ["cliente"] },
  { id: "club", label: "Mi Club", short: "Mi Club", icon: Building2, sub: "Horario, canchas, precios y membresías", roles: ["admin"] },
  { id: "perfil", label: "Perfil", short: "Perfil", icon: UserCircle, sub: "Tus datos y tu membresía", roles: ["admin", "cliente"] },
];

function Sidebar({ tab, setTab, club, stats, currentUser, currentPlan, logoutUser, visibleNav }) {
  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 sticky top-0 h-screen" style={{ background: COLORS.courtDark }}>
      <div className="px-6 pt-7 pb-6">
        <img src={clubLogo} alt={club.name || "Pickle Hub"} className="h-8 w-auto mb-3" />
        <p className="mono text-[10px]" style={{ color: "#4E6180" }}>v{APP_VERSION}</p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {visibleNav.map((it) => {
          const Icon = it.icon;
          const active = tab === it.id;
          return (
            <button key={it.id} onClick={() => setTab(it.id)}
              className="w-full flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-xl text-sm font-medium relative text-left"
              style={{ background: active ? "rgba(212,242,75,0.10)" : "transparent", color: active ? COLORS.ball : "#B7C4DA" }}>
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full" style={{ background: COLORS.ball }} />}
              <Icon size={16} strokeWidth={2.25} /> {it.label}
            </button>
          );
        })}
      </nav>

      <div className="mx-3 mb-3 rounded-2xl px-4 py-3.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: currentUser.role === "admin" ? COLORS.clay : currentPlan?.monthlyPrice > 0 ? COLORS.ball : "#22314B" }}>
            {currentUser.role === "admin" ? <Shield size={14} color="#fff" /> : <Star size={14} color={currentPlan?.monthlyPrice > 0 ? COLORS.courtDark : "#78829A"} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold truncate" style={{ color: COLORS.chalk }}>{currentUser.name}</p>
            <p className="text-[10px] truncate" style={{ color: "#93A8C9" }}>
              {currentUser.role === "admin" ? "Administrador" : currentPlan?.name || "Sin membresía"}
            </p>
          </div>
          <button onClick={logoutUser} title="Cerrar sesión" className="shrink-0 text-[#93A8C9] hover:text-white"><LogOut size={15} /></button>
        </div>
      </div>

      <div className="mx-3 mb-5 rounded-2xl px-4 py-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#4E6180" }}>Resumen en vivo</p>
        <div className="grid grid-cols-2 gap-y-3">
          <StatMini label="Canchas" value={stats.courts} />
          <StatMini label="Reservas" value={stats.bookings} />
          <StatMini label="Actividades" value={stats.events} />
          <StatMini label="Miembros" value={stats.members} />
        </div>
      </div>
    </aside>
  );
}
function StatMini({ label, value }) {
  return (
    <div>
      <p className="mono text-lg font-bold leading-none" style={{ color: COLORS.ball }}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide mt-1" style={{ color: "#55677E" }}>{label}</p>
    </div>
  );
}

function TopBar({ tab, stats, currentUser, currentPlan, logoutUser, visibleNav }) {
  const meta = visibleNav.find((i) => i.id === tab) || visibleNav[0];
  const Icon = meta.icon;
  return (
    <div className="sticky top-0 z-30 backdrop-blur-md" style={{ background: "rgba(247,245,239,0.86)", borderBottom: `1px solid ${COLORS.line}` }}>
      <div className="max-w-7xl mx-auto px-4 md:px-10 py-4 md:py-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: COLORS.court }}>
            <Icon size={16} color={COLORS.chalk} strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <h2 className="disp text-lg leading-none truncate" style={{ color: COLORS.courtDark }}>{meta.label}</h2>
            {/* truncate (no wrap) -- un sub largo (ej. "Open Plays, Torneos y Clases del club" en
               Actividades) no debe empujar el badge/logout de al lado a una segunda línea en mobile. */}
            <p className="text-xs mt-1 truncate" style={{ color: "#6B7688" }}>{meta.sub}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 md:hidden shrink-0">
          <span className="mono text-[9px]" style={{ color: "#9AA6BC" }}>v{APP_VERSION}</span>
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold" style={{ background: currentUser.role === "admin" ? COLORS.clay : "#ECEFF5", color: currentUser.role === "admin" ? "#fff" : COLORS.courtDark }}>
            {currentUser.role === "admin" ? "Admin" : currentPlan?.name || "Sin membresía"}
          </span>
          <button onClick={logoutUser} className="text-gray-400"><LogOut size={16} /></button>
        </div>
        <div className="hidden md:flex items-center gap-4 md:gap-6">
          <TickerStat label="Canchas" value={stats.courts} />
          <TickerStat label="Reservas" value={stats.bookings} />
          <TickerStat label="Actividades" value={stats.events} />
          <TickerStat label="Miembros" value={stats.members} />
        </div>
      </div>
    </div>
  );
}
function TickerStat({ label, value }) {
  return (
    <div className="text-right leading-none">
      <p className="mono text-base font-bold" style={{ color: COLORS.courtDark }}>{value}</p>
      <p className="text-[9px] uppercase tracking-widest mt-1" style={{ color: "#78829A" }}>{label}</p>
    </div>
  );
}

// v2.51.1: el admin tiene 8 pestañas (Estadísticas/Usuarios/Pagos/Actividades/Reservas/
// Torneos/Mi Club/Perfil) contra las 5 del cliente -- `justify-around` sin scroll las repartía
// bien mientras entraban, pero para 8 (que no caben en el ancho de un teléfono) los botones no
// se encogían más allá de su contenido y las últimas pestañas (Perfil incluida) quedaban
// empujadas fuera de la pantalla, imposibles de tocar -- sin scroll para alcanzarlas. `flex-1`
// sigue reparejándolas parejo cuando SÍ caben (el caso normal, sin cambio visual ahí); ahora
// con `overflow-x-auto` (y sin `justify-around`, que en Chrome puede recortar el lado
// izquierdo del contenido que desborda en vez de dejarlo alcanzable con scroll) esas 8 se
// pueden deslizar en vez de recortarse -- nunca más una pestaña inalcanzable, sea cual sea el
// rol.
function MobileNav({ tab, setTab, visibleNav }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex overflow-x-auto px-1.5 py-2"
      style={{ background: COLORS.courtDark, borderTop: "1px solid rgba(255,255,255,0.08)", scrollbarWidth: "none" }}>
      {visibleNav.map((it) => {
        const Icon = it.icon;
        const active = tab === it.id;
        return (
          <button key={it.id} onClick={() => setTab(it.id)} className="flex flex-col items-center gap-1 px-2 py-1 rounded-lg flex-1" style={{ color: active ? COLORS.ball : "#6B7688" }}>
            <Icon size={17} strokeWidth={2.25} />
            <span className="text-[9px] font-semibold whitespace-nowrap">{it.short}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* small reusable card */
function Card({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-[20px] p-5 md:p-6 ${className}`}
      style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, boxShadow: "0 1px 2px rgba(20,30,25,.04), 0 16px 32px -22px rgba(20,30,25,.22)", ...style }}>
      {children}
    </div>
  );
}
// Overlay genérico para flujos de inscripción/checkout (Actividades, Reservas) -- antes
// estos paneles se insertaban en el flujo normal de la página, debajo de lo que el usuario
// ya estaba viendo, obligando a scrollear para encontrarlos (mala conversión, sobre todo en
// mobile). Ahora aparecen sobre el contenido, se cierran con Escape o tocando fuera, y
// bloquean el scroll del fondo mientras están abiertos.
//
// En mobile es pantalla completa de verdad (no una card flotando con el fondo oscuro
// asomando arriba, que se veía como un hueco/error de layout): el propio wrapper blanco
// mide min-h-[100dvh] (dvh, no vh -- así no queda un espacio muerto ni corta contenido
// cuando el navegador muestra/oculta su barra de direcciones) y no tiene el padding/margen
// que antes dejaba ver el backdrop por arriba. De paso eso recupera el espacio vertical que
// antes se desperdiciaba, para que la mayoría de los checkouts quepan sin scroll. Desde
// `sm:` para arriba (tablet/desktop) vuelve a ser la card centrada con el fondo oscuro
// alrededor, que ahí sí se veía bien.
//
// Se monta con createPortal directo en <body> -- NO como hijo normal de donde se llama.
// La causa real del "hueco arriba" en Reservas: ReservasTab envuelve todo su contenido en
// un <div className="mt-2 space-y-5">, y Tailwind's space-y-5 le pone margin-top a CUALQUIER
// hermano que no sea el primero -- el Modal, al ser `position: fixed`, seguía recibiendo ese
// margin-top (fixed no anula margin) y quedaba corrido 20px hacia abajo, dejando ver el
// TopBar de la página sin oscurecer por encima. Un portal saca al modal del árbol DOM del
// componente que lo llama (queda colgando directo de <body>), así ningún contenedor padre
// -- este space-y-5 o cualquier otro futuro -- puede volver a empujarlo/recortarlo por
// margin, overflow o z-index.
function Modal({ onClose, children, maxWidth = 560 }) {
  // `onClose` es una función nueva en cada render del padre (ej. el `closeAll` que arman
  // EventosTab/ReservasTab inline) -- un ref evita que el efecto de abajo (que solo debe
  // correr una vez, al montar) tenga que declarar `onClose` como dependencia y re-disparar
  // en cada re-render mientras el modal sigue abierto.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, []);

  // Botón/gesto de "atrás" del celular (v2.25.0): sin esto, cerrar un popup con el back del
  // teléfono no cerraba el popup -- sacaba de la app entera, porque esta SPA no tiene rutas ni
  // historial propio (todo es un solo estado `tab` en memoria) y el navegador/PWA trata
  // "atrás" como "no hay a dónde volver, salir". Truco estándar: al montar, empujar una
  // entrada de historial "de más"; mientras el modal esté abierto, el "atrás" del teléfono la
  // consume (evento `popstate`) y solo cierra ESTE popup en vez de salir de la app. Si el
  // popup se cierra por cualquier otra vía (X, click afuera, Escape, Cancelar), se hace
  // `history.back()` una sola vez al desmontar para no dejar esa entrada de más colgando como
  // un "atrás" fantasma la próxima vez que alguien navegue. `closedByPopRef` distingue ambos
  // casos para no disparar `history.back()` dos veces.
  //
  // Blindaje contra React.StrictMode (v2.44.2) -- en desarrollo, StrictMode monta-desmonta-
  // remonta este efecto dos veces seguidas para detectar efectos no idempotentes; el
  // desmontaje "falso" de la simulación disparaba este mismo history.back() de arriba,
  // cerrando el modal solo instantáneamente sin que nadie tocara nada (nunca pasaba en
  // producción, donde React no duplica efectos, pero rompía cualquier prueba en el servidor
  // de desarrollo). Dos cambios lo resuelven: (1) un id propio por montaje en vez de un booleano
  // compartido, para poder distinguir "la entrada que YO empujé" de una empujada por un
  // remontaje posterior; (2) diferir el back() un tick con setTimeout -- si StrictMode nos
  // vuelve a montar de inmediato (siempre sucede en el mismo tick, antes de que corra
  // cualquier setTimeout), el remontaje ya empujó su propia entrada con su propio id antes de
  // que el chequeo se ejecute, así que el id ya no coincide y el back() de la simulación se
  // salta solo. Deja, como mucho, una entrada de historial de más sin usar en desarrollo tras
  // un montaje duplicado -- inofensivo (nunca se lee ese id salvo por esta misma comparación) y
  // no ocurre en producción, donde este efecto corre una sola vez.
  const closedByPopRef = useRef(false);
  useEffect(() => {
    const modalId = Math.random().toString(36).slice(2);
    window.history.pushState({ pickleModal: modalId }, "");
    const onPopState = () => { closedByPopRef.current = true; onCloseRef.current(); };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      setTimeout(() => {
        if (!closedByPopRef.current && window.history.state?.pickleModal === modalId) window.history.back();
      }, 0);
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end overflow-y-auto sm:items-center sm:justify-center sm:p-6"
      style={{ background: "rgba(15,23,32,0.55)", margin: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Bottom sheet en mobile, card centrada en sm+ (v2.26.0). Antes mobile forzaba
         min-h-[100dvh] ("pantalla completa siempre") sin importar cuánto contenido hubiera --
         con algo corto (ej. elegir cancha, 4 botones) eso dejaba una hoja blanca gigante con
         un vacío enorme debajo y el fondo oscuro sin asomar en ningún lado, como un error de
         layout. Ahora el alto sigue al contenido (tope 85vh + scroll propio si no alcanza,
         igual que el tope de 90vh de sm+ del fix anterior) y queda anclada abajo con las
         esquinas superiores redondeadas -- mismo patrón de bottom sheet de iOS/Android, con
         el fondo oscuro siempre visible arriba de la hoja. */}
      <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl sm:rounded-2xl sm:max-h-[90vh] sm:mx-auto" style={{ background: COLORS.card, maxWidth }}>
        {children}
      </div>
    </div>,
    document.body
  );
}

// Confirmación antes de borrar (v2.36.0) -- ninguna acción destructiva debería dispararse con
// un solo clic sin poder arrepentirse. `options` son los botones de acción REALES aparte de
// "Cancelar" (que siempre se agrega solo): una sola opción para un borrado simple ("Eliminar"),
// o dos para una actividad recurrente ("Solo esta fecha" / "Toda la serie") -- ver EventDetail/
// ClassDetail, los primeros en usar esto.
function ConfirmDeleteModal({ title, message, options, onCancel }) {
  return (
    <Modal onClose={onCancel} maxWidth={420}>
      <div className="p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "#FBEAE3" }}>
            <AlertTriangle size={17} color={COLORS.clay} />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm" style={{ color: COLORS.courtDark }}>{title}</p>
            {message && <p className="text-xs mt-1" style={{ color: "#6B7688" }}>{message}</p>}
          </div>
        </div>
        <div className="space-y-2">
          {options.map((opt, i) => (
            <button key={i} onClick={opt.onClick} className="w-full py-2.5 rounded-xl font-bold text-sm"
              style={{ background: opt.variant === "danger" ? COLORS.clay : "#EAEEF5", color: opt.variant === "danger" ? "#fff" : COLORS.ink }}>
              {opt.label}
            </button>
          ))}
          <button onClick={onCancel} className="w-full py-2 rounded-xl font-semibold text-sm" style={{ color: "#6B7688" }}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}
function SectionTitle({ children, sub }) {
  return (
    <div className="mb-5">
      <h2 className="disp text-xl md:text-[22px]" style={{ color: COLORS.courtDark }}>{children}</h2>
      {sub && <p className="text-sm mt-1.5" style={{ color: "#6B7688" }}>{sub}</p>}
    </div>
  );
}
function Label({ children }) {
  return <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "#6B7688" }}>{children}</label>;
}
const inputStyle = { border: `1.5px solid ${COLORS.line}`, borderRadius: 12, padding: "9px 12px", width: "100%", fontSize: 14, outline: "none" };

/* =========================================================================
   TAB: TORNEO
   ========================================================================= */
// Precio por cantidad de categorías (v2.17.0, simplificado a 2 niveles en v2.44.1):
// "1ra categoría" + "Categoría adicional" -- el segundo campo se suma UNA vez por cada
// categoría después de la 1ra (2da, 3ra, 4ta... todas al mismo precio), para que inscribirse en
// varias de una salga más barato por categoría que hacerlo una por una sin tener que definir un
// precio propio para la 3ra en adelante. `field` es el prefijo del patch ("presalePrice" o
// "regularPrice"); los dos niveles son field+"1"/"2". Ver tournamentRegPrice para cómo se suman.
function TieredPriceFields({ tournament, set, field }) {
  const tierLabel = { 1: "1ra categoría", 2: "Categoría adicional" };
  return (
    <div className="grid grid-cols-2 gap-2">
      {[1, 2].map((n) => (
        <div key={n}>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "#6B7688" }}>{tierLabel[n]}</p>
          <div className="relative">
            <Euro size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" color="#78829A" />
            <input type="number" min={0} style={{ ...inputStyle, paddingLeft: 26, fontSize: 13 }}
              value={tournament[`${field}${n}`]} onChange={(e) => set(`${field}${n}`, e.target.value)} placeholder="0.00" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TorneoTab({ tournament, setTournament: updateTournament, uploadTournamentImage, dates, courts, club, categories, occupiedKeys }) {
  const set = (k, v) => updateTournament({ [k]: v });
  const selectedCourts = (tournament.courtIds || []).length ? courts.filter((c) => tournament.courtIds.includes(c.id)) : courts;
  const isPublished = tournament.status === "published";

  // Flyer promocional del torneo (v2.33.0), mismo patrón que OpenPlayForm/resizeImageToBlob --
  // a diferencia de Open Play (formulario de una sola pasada), Generalidades autoguarda campo
  // por campo, así que la imagen se sube DE UNA al elegir el archivo (no hay botón "Guardar"
  // que la dispare después) y uploadTournamentImage ya deja la URL puesta en el torneo.
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const handleImage = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageError(""); setImageUploading(true);
    try {
      const blob = await resizeImageToBlob(f);
      const result = await uploadTournamentImage(blob);
      if (result?.error) setImageError(result.error);
    } catch (err) {
      setImageError(err.message);
    }
    setImageUploading(false);
  };

  // Aviso informativo (v2.24.0), NO bloqueante -- a diferencia de Open Play/Clase, un torneo
  // no "reserva" bloques al guardar estos campos: el calendario real lo arma runScheduler
  // más adelante (pestaña Calendario), que ya evita por construcción cualquier bloque ocupado
  // (buildSchedule salta preOccupied) -- nunca se duplica una reserva. Esto solo avisa cuando
  // el rango/canchas elegidos ya tienen algo agendado, para que el admin sepa que el
  // calendario real tendrá menos hueco del que parece. `ignoreKeys` excluye los partidos que
  // este MISMO torneo ya tenga agendados (categories ya viene filtrado a este torneo).
  const ignoreMatchKeys = useMemo(() => {
    const set = new Set();
    (categories || []).forEach((c) => (c.matches || []).forEach((m) => {
      if (m.courtId && m.day && !isByeMatch(m)) set.add(blockKey(m.courtId, m.day, timeToMinutes(m.time)));
    }));
    return set;
  }, [categories]);
  const busyConflicts = useMemo(() => {
    if (!club || !occupiedKeys || !dates.length || !tournament.dailyStart || !tournament.dailyEnd) return [];
    return findBlockConflicts(club, selectedCourts.map((c) => c.id), dates, tournament.dailyStart, tournament.dailyEnd, occupiedKeys, ignoreMatchKeys);
  }, [club, occupiedKeys, selectedCourts, dates, tournament.dailyStart, tournament.dailyEnd, ignoreMatchKeys]);
  const busyDatesCount = new Set(busyConflicts.map((c) => c.date)).size;
  // Mínimo para poder publicar: fechas cargadas -- sin eso el torneo se ve "Por definir" en
  // Actividades, que es justo el problema real que hizo falta este borrador/publicado
  // (v2.16.0): un torneo creado solo con el nombre no debe quedar visible para clientes.
  const canPublish = !!(tournament.startDate && tournament.endDate);
  return (
    <div className="space-y-5 mt-2">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full"
              style={{ background: isPublished ? "#DCEBD5" : "#EAEEF5", color: isPublished ? "#2F6B2F" : "#6B7688" }}>
              {isPublished ? "Publicado" : "Borrador"}
            </span>
            <p className="text-xs" style={{ color: "#6B7688" }}>
              {isPublished
                ? "Visible para los clientes en Actividades y en la lista de Torneos."
                : "Oculto para los clientes -- solo el club lo ve, hasta que se publique."}
            </p>
          </div>
          <button disabled={!isPublished && !canPublish} onClick={() => set("status", isPublished ? "draft" : "published")}
            style={{
              background: isPublished ? "#EAEEF5" : (canPublish ? COLORS.court : "#E5E5E5"),
              color: isPublished ? COLORS.ink : (canPublish ? "#fff" : "#999"),
            }} className="px-4 py-2 rounded-xl font-bold text-sm disabled:cursor-not-allowed">
            {isPublished ? "Volver a borrador" : "Publicar torneo"}
          </button>
        </div>
        {!isPublished && !canPublish && (
          <p className="text-[11px] mt-2 font-semibold" style={{ color: COLORS.clay }}>
            Completa fecha de inicio y fin (más abajo) para poder publicarlo.
          </p>
        )}
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
      <Card>
        <SectionTitle sub="Nombre y días de juego del evento.">Datos generales</SectionTitle>
        <div className="space-y-4">
          <div>
            <Label>Nombre del torneo</Label>
            <input style={inputStyle} value={tournament.name} onChange={(e) => set("name", e.target.value)} placeholder="Copa Verano Pickleball" />
          </div>
          <div>
            <Label>Imagen (flyer promocional, opcional)</Label>
            <div className="flex items-center gap-3">
              {tournament.image && (
                <img src={tournament.image} alt="Flyer del torneo" className="w-14 h-14 rounded-xl object-cover shrink-0" style={{ border: `1px solid ${COLORS.line}` }} />
              )}
              <label className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer" style={{ border: `1.5px dashed ${COLORS.line}`, color: tournament.image ? COLORS.court : "#6B7688" }}>
                <ImageIcon size={14} /> {imageUploading ? "Subiendo imagen…" : tournament.image ? "Imagen actual -- toca para cambiarla" : "Subir imagen"}
                <input type="file" accept="image/*" className="hidden" onChange={handleImage} disabled={imageUploading} />
              </label>
            </div>
            {imageError && <p className="text-[11px] mt-1 font-semibold" style={{ color: "#B23A1B" }}>{imageError}</p>}
            <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>Se muestra en la tarjeta del torneo en Actividades, igual que la imagen de un Open Play.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fecha inicio del torneo</Label>
              <input type="date" style={inputStyle} value={tournament.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </div>
            <div>
              <Label>Fecha fin del torneo</Label>
              <input type="date" style={inputStyle} value={tournament.endDate} onChange={(e) => set("endDate", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Hora inicio diaria</Label>
              <input type="time" style={inputStyle} value={tournament.dailyStart} onChange={(e) => set("dailyStart", e.target.value)} />
            </div>
            <div>
              <Label>Hora fin diaria</Label>
              <input type="time" style={inputStyle} value={tournament.dailyEnd} onChange={(e) => set("dailyEnd", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Días de la semana en que se juega</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_OPTIONS.map((d) => {
                const active = (tournament.playDays || []).includes(d.value);
                return (
                  <button key={d.value} type="button"
                    onClick={() => set("playDays", active ? (tournament.playDays || []).filter((v) => v !== d.value) : [...(tournament.playDays || []), d.value])}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                    style={{ background: active ? COLORS.court : "#EAEEF5", color: active ? "#fff" : COLORS.ink }}>
                    {d.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>
              {(tournament.playDays || []).length === 0 ? "Sin días marcados: se juega todos los días del rango." : "Solo se generarán partidos en los días marcados, dentro del rango de fechas."}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Canchas disponibles para el torneo</Label>
              <span className="mono text-xs font-bold" style={{ color: COLORS.court }}>{selectedCourts.length} cancha{selectedCourts.length === 1 ? "" : "s"}</span>
            </div>
            <MultiCourtSelect courts={courts} value={tournament.courtIds || []} onChange={(ids) => set("courtIds", ids)} />
            <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>
              {(tournament.courtIds || []).length === 0 ? "Ninguna marcada: el calendario usa todas las canchas del club." : "El calendario del torneo solo usará estas canchas -- el resto queda libre para reservas normales."}
            </p>
          </div>
          {dates.length > 0 && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
              {dates.length} día(s) de juego · {formatDateHuman(dates[0])} a {formatDateHuman(dates[dates.length - 1])}
            </div>
          )}
          {busyConflicts.length > 0 && (
            <div className="text-xs px-3 py-2.5 rounded-lg flex items-start gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                Ya hay reservas u otras actividades en {busyDatesCount} de los {dates.length} día(s) de este rango, en alguna de las canchas elegidas.
                El generador de calendario (pestaña Calendario) evita esos bloques automáticamente -- no se duplicarán --, pero tendrás menos disponibilidad real para los partidos del torneo.
              </span>
            </div>
          )}
          <p className="text-xs" style={{ color: "#6B7688" }}>La duración de partidos y el intervalo entre ellos ahora se configuran en la pestaña <b>Calendario</b>, donde puedes ajustarlos antes o después de generar el horario.</p>
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <SectionTitle sub="Ventana de venta anticipada de cupos y su precio.">Preventa</SectionTitle>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Inicio de preventa</Label>
                <input type="date" style={inputStyle} value={tournament.presaleStart} onChange={(e) => set("presaleStart", e.target.value)} />
              </div>
              <div>
                <Label>Fin de preventa</Label>
                <input type="date" style={inputStyle} value={tournament.presaleEnd} onChange={(e) => set("presaleEnd", e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Precio de preventa (por categoría inscrita)</Label>
              <TieredPriceFields tournament={tournament} set={set} field="presalePrice" />
              <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>Se suman: "1ra categoría" es el precio de inscribirse en una sola, y "Categoría adicional" se AGREGA una vez por cada categoría más (2da, 3ra, 4ta... todas al mismo precio). Ej: 30 + 15 + 15 → inscribirse en 3 categorías junto cuesta €60.</p>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle sub="Ventana general de inscripciones (precio regular, fuera de preventa).">Inscripciones generales</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Inicio de inscripciones</Label>
              <input type="date" style={inputStyle} value={tournament.regStart} onChange={(e) => set("regStart", e.target.value)} />
            </div>
            <div>
              <Label>Fin de inscripciones</Label>
              <input type="date" style={inputStyle} value={tournament.regEnd} onChange={(e) => set("regEnd", e.target.value)} />
            </div>
          </div>
          <div className="mt-3">
            <Label>Precio regular, fuera de preventa (por categoría inscrita)</Label>
            <TieredPriceFields tournament={tournament} set={set} field="regularPrice" />
            <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>Mismo criterio que la preventa: "1ra categoría" + "Categoría adicional" una vez por cada categoría más.</p>
          </div>
        </Card>
      </div>
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: CANCHAS
   ========================================================================= */
// Anuncio push a todos los socios (v2.42.0) -- llama directo a api/send-push.js (no hace
// falta que el admin pase por ningún mutator de PickleballTournamentApp; sendPush ya valida
// del lado del servidor que quien llama de verdad sea admin, ver ADMIN_ONLY_TYPES ahí).
function AnnouncementCard() {
  const [title, setTitleI] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const send = async () => {
    if (!title.trim() || !body.trim() || sending) return;
    setSending(true); setResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const res = await fetch("/api/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "announcement", title: title.trim(), body: body.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se pudo enviar.");
      setResult({ ok: true, sent: json.sent ?? 0 });
      setTitleI(""); setBody("");
    } catch (err) {
      setResult({ ok: false, error: err.message || "No se pudo enviar." });
    }
    setSending(false);
  };

  return (
    <Card>
      <SectionTitle sub="Llega como notificación push a todos los socios que las tengan activadas desde su Perfil.">Enviar anuncio</SectionTitle>
      <div className="space-y-3">
        <div><Label>Título</Label><input style={inputStyle} value={title} onChange={(e) => setTitleI(e.target.value)} placeholder="Ej. Cambio de horario este finde" maxLength={60} /></div>
        <div><Label>Mensaje</Label><textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escribe el anuncio…" maxLength={200} /></div>
        {result?.ok && <p className="text-xs font-semibold" style={{ color: COLORS.court }}>Enviado a {result.sent} socio{result.sent === 1 ? "" : "s"} suscrito{result.sent === 1 ? "" : "s"}.</p>}
        {result && !result.ok && <p className="text-xs font-semibold" style={{ color: "#B23A1B" }}>{result.error}</p>}
        <button disabled={sending || !title.trim() || !body.trim()} onClick={send}
          style={{ background: COLORS.court, color: "#fff", opacity: sending || !title.trim() || !body.trim() ? 0.5 : 1 }}
          className="px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2">
          <Megaphone size={14} /> {sending ? "Enviando…" : "Enviar anuncio"}
        </button>
      </div>
    </Card>
  );
}

// v2.54.0: Mi Club pasó de ser una sola página larga (horario, tasa de cambio, canchas,
// anuncio, membresías, todo apilado con scroll) a sub-pestañas, mismo patrón visual y de
// persistencia (loadCache/saveCache) que ya usan Torneos (TORNEO_SUB_ITEMS) y TorneosSection --
// actualizar la página ya no debe sacar de la sub-sección en la que estaba el admin.
const CLUB_SUB_ITEMS = [
  { id: "horarios", label: "Horarios" },
  { id: "canchas", label: "Canchas" },
  { id: "anuncios", label: "Anuncios" },
  { id: "planes", label: "Planes" },
  { id: "moneda", label: "Moneda y Tasa de cambio" },
];

function ClubTab({ club, updateClub, courts, addCourt, updateCourt, removeCourt, rateStatus, syncBcvRate,
  membershipPlans, addMembershipPlan, updateMembershipPlan, removeMembershipPlan, subscribeToPlan, currentUser, users, subscriptions,
  coupons, createCoupon, removeCoupon }) {
  const [subTab, setSubTab] = useState(() => {
    const cached = loadCache("clubSubTab", null);
    return cached && CLUB_SUB_ITEMS.some((it) => it.id === cached) ? cached : CLUB_SUB_ITEMS[0].id;
  });
  useEffect(() => { saveCache("clubSubTab", subTab); }, [subTab]);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [price, setPrice] = useState(8);
  const [hasSpecialPricing, setHasSpecialPricing] = useState(false);
  const [newRules, setNewRules] = useState([]);
  const setC = (k, v) => updateClub({ [k]: v });
  const setPagoMovil = (k, v) => updateClub({ pagoMovil: { ...club.pagoMovil, [k]: v } });

  const handleAddCourt = () => {
    const n = name.trim() || `Cancha ${courts.length + 1}`;
    addCourt({
      name: n, isPrivate, pricePerBlock: Number(price) || 0,
      priceRules: hasSpecialPricing ? newRules : [],
    });
    setName(""); setIsPrivate(false); setPrice(8); setHasSpecialPricing(false); setNewRules([]);
  };

  const blocksPerDay = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes).length;

  const minutesAgo = rateStatus.lastSync ? Math.round((Date.now() - rateStatus.lastSync) / 60000) : null;

  return (
    <div className="mt-2 space-y-5">
      <div className="flex gap-2 mb-1 overflow-x-auto pb-1">
        {CLUB_SUB_ITEMS.map((it) => (
          <button key={it.id} onClick={() => setSubTab(it.id)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap"
            style={{ background: subTab === it.id ? COLORS.court : "#EAEEF5", color: subTab === it.id ? "#fff" : COLORS.ink }}>
            {it.label}
          </button>
        ))}
      </div>

      {subTab === "anuncios" && <AnnouncementCard />}

      {subTab === "horarios" && (
      <Card>
        <SectionTitle sub="Define el horario general del club. Estos bloques son la base de Reservas, Actividades y Torneos.">Horario en bloques</SectionTitle>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <Label>Nombre del club</Label>
            <input style={inputStyle} value={club.name} onChange={(e) => setC("name", e.target.value)} />
          </div>
          <div>
            <Label>Hora de apertura</Label>
            <input type="time" style={inputStyle} value={club.openTime} onChange={(e) => setC("openTime", e.target.value)} />
          </div>
          <div>
            <Label>Hora de cierre</Label>
            <input type="time" style={inputStyle} value={club.closeTime} onChange={(e) => setC("closeTime", e.target.value)} />
          </div>
          <div>
            <Label>Duración de bloque</Label>
            <select style={inputStyle} value={club.blockMinutes} onChange={(e) => setC("blockMinutes", Number(e.target.value))}>
              <option value={60}>1h 00</option>
              <option value={90}>1h 30</option>
              <option value={120}>2h 00</option>
              <option value={45}>45 min</option>
              <option value={30}>30 min</option>
            </select>
          </div>
        </div>
        <div className="text-xs px-3 py-2 rounded-lg mt-3" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
          {blocksPerDay} bloques reservables por cancha, por día ({club.openTime}–{club.closeTime}).
        </div>
      </Card>
      )}

      {subTab === "moneda" && (
      <Card>
        <SectionTitle sub="El monto en Bs del checkout se calcula con la tasa EUR oficial del BCV, sincronizada automáticamente.">Tasa de cambio y cobro</SectionTitle>

        <div className="rounded-xl p-4 mb-4" style={{ background: rateStatus.error ? "#FCE9E4" : COLORS.courtDark }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: rateStatus.error ? "#F2C4B4" : COLORS.ball }}>
                {rateStatus.loading ? <Clock size={14} color={rateStatus.error ? "#B23A1B" : COLORS.courtDark} /> : rateStatus.error ? <AlertTriangle size={14} color="#B23A1B" /> : <CheckCircle2 size={14} color={COLORS.courtDark} />}
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: rateStatus.error ? "#B23A1B" : COLORS.chalk }}>
                  {rateStatus.loading ? "Sincronizando con el BCV…" : rateStatus.source === "bcv_eur" ? "Anclada a la tasa EUR del BCV" : "Tasa manual (sin sincronizar)"}
                </p>
                <p className="text-xs mt-0.5" style={{ color: rateStatus.error ? "#B23A1B" : "#A9C0DC" }}>
                  {rateStatus.error
                    ? rateStatus.error
                    : rateStatus.lastSync
                      ? `Última sincronización: hace ${minutesAgo <= 0 ? "menos de 1" : minutesAgo} min${rateStatus.effectiveDate ? ` · vigente ${formatDateHuman(rateStatus.effectiveDate)}` : ""}`
                      : "Aún no se ha sincronizado."}
                </p>
              </div>
            </div>
            <button onClick={syncBcvRate} disabled={rateStatus.loading}
              className="px-3.5 py-2 rounded-xl text-xs font-bold shrink-0" style={{ background: COLORS.ball, color: COLORS.courtDark, opacity: rateStatus.loading ? 0.6 : 1 }}>
              {rateStatus.loading ? "Consultando…" : "Actualizar ahora"}
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Tasa Bs / USD (tasa EUR BCV)</Label>
            <input type="number" min={0} step="0.01" style={inputStyle} value={club.bsPerUsd}
              onChange={(e) => { setC("bsPerUsd", e.target.value); }} />
            <p className="text-[10px] mt-1" style={{ color: "#6B7688" }}>Se sincroniza sola cada 30 min. Editarla aquí la deja en modo manual hasta la próxima sincronización.</p>
          </div>
          <div className="mono text-xs px-3 py-2.5 rounded-lg h-fit self-end" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
            Ej: {formatMoney(10)} ≈ {formatMoney(10 * (Number(club.bsPerUsd) || 0), "Bs. ")}
          </div>
        </div>
        <p className="text-xs font-bold uppercase tracking-wide mt-4 mb-2" style={{ color: "#6B7688" }}>Datos de Pago Móvil</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Banco</Label><input style={inputStyle} value={club.pagoMovil.banco} onChange={(e) => setPagoMovil("banco", e.target.value)} /></div>
          <div><Label>Teléfono</Label><input style={inputStyle} value={club.pagoMovil.telefono} onChange={(e) => setPagoMovil("telefono", e.target.value)} /></div>
          <div><Label>Cédula / RIF</Label><input style={inputStyle} value={club.pagoMovil.cedula} onChange={(e) => setPagoMovil("cedula", e.target.value)} /></div>
        </div>
      </Card>
      )}

      {subTab === "canchas" && (
      <Card>
        <SectionTitle sub="Cada cancha puede ser pública (cualquiera reserva) o privada (prioridad para miembros). El precio con membresía sale solo del % de descuento en canchas que definas por plan, en Membresías.">Canchas</SectionTitle>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 mb-2">
          <div><Label>Nombre</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cancha 3" /></div>
          <div>
            <Label>Acceso</Label>
            <Segmented value={isPrivate ? "priv" : "pub"} onChange={(v) => setIsPrivate(v === "priv")}
              options={[{ value: "pub", label: "Pública" }, { value: "priv", label: "Privada" }]} />
          </div>
          <div><Label>Precio / bloque (EUR)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>

        <div className="rounded-xl p-3 mb-4" style={{ background: "#EEF1F7" }}>
          <div className="flex items-center justify-between gap-3">
            <Label>¿Hay precios especiales por horario?</Label>
            <Segmented value={hasSpecialPricing ? "si" : "no"} onChange={(v) => setHasSpecialPricing(v === "si")} options={[{ value: "no", label: "No" }, { value: "si", label: "Sí" }]} />
          </div>
          {hasSpecialPricing && (
            <div className="mt-3">
              <PriceRuleEditor rules={newRules} onChange={setNewRules} />
            </div>
          )}
        </div>

        <button onClick={handleAddCourt} style={{ background: COLORS.court, color: COLORS.chalk }} className="px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-1.5 mb-4">
          <Plus size={16} /> Agregar cancha
        </button>

        <div className="space-y-2">
          {courts.map((c) => (
            <CourtCard key={c.id} court={c} onUpdate={(patch) => updateCourt(c.id, patch)} onRemove={() => removeCourt(c.id)} />
          ))}
          {courts.length === 0 && <p className="text-sm text-gray-400 italic">Aún no hay canchas registradas.</p>}
        </div>
      </Card>
      )}

      {/* Configuración de membresías (v2.18.0): antes vivía en su propia pestaña de nivel
         superior para el admin; ahora se administra desde acá, dentro de Mi Club. MembresiasTab
         ya sabe renderizar el modo admin (crear/editar/borrar planes) vs. cliente (comparar y
         suscribirse) según `role` -- acá siempre es "admin", así que actúa como panel de
         configuración con la misma tabla comparativa como vista previa en vivo. */}
      {subTab === "planes" && (
        <MembresiasTab membershipPlans={membershipPlans} club={club} courts={courts} users={users} subscriptions={subscriptions}
          addMembershipPlan={addMembershipPlan} updateMembershipPlan={updateMembershipPlan} removeMembershipPlan={removeMembershipPlan}
          subscribeToPlan={subscribeToPlan} currentUser={currentUser} role="admin"
          coupons={coupons} createCoupon={createCoupon} removeCoupon={removeCoupon} />
      )}
    </div>
  );
}

// Shared by the "add court" form and each existing CourtCard — a small list of
// {startTime, endTime, price} time-window overrides (e.g. tarifa nocturna, fin de semana)
// that courtPriceInfo() checks before falling back to the court's base price. No memberPrice
// per rule anymore (v2.30.0) -- el descuento de socio sale del plan, parejo en cualquier
// horario, no de un segundo precio cargado a mano por cada regla.
function PriceRuleEditor({ rules, onChange }) {
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("22:00");
  const [rulePrice, setRulePrice] = useState(0);

  const addRule = () => {
    if (!from || !to || from >= to) return;
    onChange([...rules, { id: uid("rule"), startTime: from, endTime: to, price: Number(rulePrice) || 0 }]);
    setRulePrice(0);
  };
  const removeRule = (id) => onChange(rules.filter((r) => r.id !== id));

  return (
    <div className="space-y-2">
      {rules.map((r) => (
        <div key={r.id} className="flex items-center justify-between px-2.5 py-2 rounded-lg text-xs" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
          <span>{formatTimeAmPm(r.startTime)}–{formatTimeAmPm(r.endTime)} · {formatMoney(r.price)}</span>
          <button onClick={() => removeRule(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
      ))}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 items-end">
        <div><Label>Desde</Label><input type="time" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>Hasta</Label><input type="time" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><Label>Precio (EUR)</Label><input type="number" min={0} style={inputStyle} value={rulePrice} onChange={(e) => setRulePrice(e.target.value)} /></div>
        <button onClick={addRule} className="py-2.5 rounded-lg text-xs font-bold h-[38px]" style={{ background: COLORS.court, color: "#fff" }}>
          <Plus size={14} className="inline" />
        </button>
      </div>
    </div>
  );
}

// A single court row in the admin's Canchas list — click the pencil to edit its name,
// access, base price and its time-based special-pricing rules in place.
function CourtCard({ court, onUpdate, onRemove }) {
  const [editing, setEditing] = useState(false);
  const rules = court.priceRules || [];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#EEF1F7" }}>
      <div className="flex items-center justify-between px-3 py-2.5 flex-wrap gap-2">
        <span className="flex items-center gap-2 text-sm font-medium flex-wrap">
          {court.isPrivate ? <Lock size={14} color={COLORS.clay} /> : <Unlock size={14} color={COLORS.court} />} {court.name}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: court.isPrivate ? "#FBE3D6" : "#DCEBD5", color: court.isPrivate ? COLORS.clay : COLORS.courtDark }}>
            {court.isPrivate ? "Privada" : "Pública"}
          </span>
          {rules.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: "#FFF1E4", color: COLORS.clay }}>
              <Clock size={9} /> {rules.length} horario{rules.length > 1 ? "s" : ""} especial{rules.length > 1 ? "es" : ""}
            </span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <span className="mono text-xs" style={{ color: "#6B7688" }}>{formatMoney(court.pricePerBlock)}</span>
          <button onClick={() => setEditing((s) => !s)} style={{ color: editing ? COLORS.court : "#9AA6BC" }}><Pencil size={14} /></button>
          <button onClick={onRemove} className="text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
        </div>
      </div>

      {editing && (
        <div className="px-3 pb-3 pt-2 space-y-3" style={{ borderTop: `1px solid ${COLORS.line}`, background: "#fff" }}>
          <div className="grid sm:grid-cols-3 gap-2">
            <div><Label>Nombre</Label><input style={inputStyle} value={court.name} onChange={(e) => onUpdate({ name: e.target.value })} /></div>
            <div>
              <Label>Acceso</Label>
              <Segmented value={court.isPrivate ? "priv" : "pub"} onChange={(v) => onUpdate({ isPrivate: v === "priv" })} options={[{ value: "pub", label: "Pública" }, { value: "priv", label: "Privada" }]} />
            </div>
            <div><Label>Precio / bloque (EUR)</Label><input type="number" min={0} style={inputStyle} value={court.pricePerBlock} onChange={(e) => onUpdate({ pricePerBlock: Number(e.target.value) || 0 })} /></div>
          </div>
          <div>
            <Label>Precios especiales por horario</Label>
            <PriceRuleEditor rules={rules} onChange={(rs) => onUpdate({ priceRules: rs })} />
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   TAB: ESTADÍSTICAS (panel del administrador)
   ========================================================================= */
function StatCard({ label, value, icon: Icon, sub }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EAF0F8" }}>
          <Icon size={18} color={COLORS.court} />
        </div>
        <div className="min-w-0">
          <p className="disp text-xl truncate" style={{ color: COLORS.courtDark }}>{value}</p>
          <p className="text-xs" style={{ color: "#6B7688" }}>{label}</p>
          {sub && <p className="text-[10px] mt-0.5 truncate" style={{ color: "#9AA6BC" }}>{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

function MiniBarChart({ data, color = COLORS.court, money = false }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex items-end gap-1 h-36">
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full rounded-t-md" title={`${d.label}: ${money ? formatMoney(d.value) : d.value}`}
              style={{ height: `${Math.max(3, (d.value / max) * 100)}%`, background: color, opacity: d.value === 0 ? 0.15 : 1 }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        {data.map((d, i) => (
          <span key={i} className="flex-1 mono text-[8px] text-center truncate" style={{ color: "#78829A" }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function HourLineChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 300, h = 90;
  const stepX = data.length > 1 ? w / (data.length - 1) : w;
  const points = data.map((d, i) => `${i * stepX},${h - (d.value / max) * h}`).join(" ");
  const peakIdx = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const everyN = Math.max(1, Math.ceil(data.length / 8));
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-36">
        <polyline points={points} fill="none" stroke={COLORS.clay} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => (
          <circle key={i} cx={i * stepX} cy={h - (d.value / max) * h} r={i === peakIdx ? 4 : 2} fill={i === peakIdx ? COLORS.ball : COLORS.clay} />
        ))}
      </svg>
      <div className="flex mt-1.5">
        {data.map((d, i) => (
          <span key={i} className="flex-1 mono text-[8px] text-center" style={{ color: "#78829A" }}>{i % everyN === 0 ? d.label : ""}</span>
        ))}
      </div>
      {data[peakIdx] && (
        <p className="text-xs mt-3" style={{ color: "#6B7688" }}>
          Hora más concurrida: <b style={{ color: COLORS.courtDark }}>{data[peakIdx].label}</b> con {data[peakIdx].value} reserva(s)
        </p>
      )}
    </div>
  );
}

function HBarList({ data, color = COLORS.court, money = false }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs mb-1"><span className="font-medium truncate pr-2">{d.label}</span><span className="mono shrink-0" style={{ color: "#6B7688" }}>{money ? formatMoney(d.value) : d.value}</span></div>
          <div className="h-2 rounded-full" style={{ background: "#EDEFF4" }}>
            <div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
      {data.length === 0 && <p className="text-xs text-gray-400 italic">Sin datos todavía.</p>}
    </div>
  );
}

// Riesgo de cancelación (v2.32.0): socios pagos ya vencidos o por vencer pronto -- ver
// membershipRisk() en los helpers de analytics. Antes esta información no existía en ningún
// lado; "Vencida" solo se le mostraba al propio socio en su Perfil, el admin no tenía forma de
// saber quién estaba a punto de dejar de pagar sin revisar usuario por usuario.
function MembershipRiskCard({ risk }) {
  const todayMs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime();
  return (
    <Card>
      <SectionTitle sub="Socios con plan pago vencido o que vence en los próximos 7 días -- para darles seguimiento antes de perderlos.">Riesgo de cancelación</SectionTitle>
      {risk.length === 0 ? (
        <p className="text-sm text-gray-400 italic mt-2">Ningún socio vencido ni por vencer en los próximos 7 días. 🎉</p>
      ) : (
        <div className="space-y-1.5 mt-3">
          {risk.map(({ user, plan, expired }) => {
            const days = Math.round((new Date(user.planExpiresAt + "T00:00:00").getTime() - todayMs) / 86400000);
            return (
              <div key={user.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl gap-3" style={{ background: expired ? "#FBEAE3" : "#FBF3E4" }}>
                <span className="min-w-0">
                  <span className="text-sm font-semibold block truncate" style={{ color: COLORS.courtDark }}>{user.name}</span>
                  <span className="text-xs" style={{ color: "#6B7688" }}>{plan.name} · {formatMoney(plan.monthlyPrice)}/mes</span>
                </span>
                <span className="text-xs font-bold text-right shrink-0" style={{ color: expired ? COLORS.clay : "#8A5A16" }}>
                  {expired ? `Vencida hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}` : days === 0 ? "Vence hoy" : `Vence en ${days} día${days === 1 ? "" : "s"}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// Admin-only leaderboard: who spends the most and shows up the most, over a chosen window.
function LoyalClientsCard({ bookings, openPlays, classes, categories, users }) {
  const [period, setPeriod] = useState("all");
  const activity = useMemo(() => buildClientActivity(bookings, openPlays, classes, categories, users), [bookings, openPlays, classes, categories, users]);
  const rows = useMemo(() => rankClientsByActivity(filterActivityByPeriod(activity, period)).slice(0, 10), [activity, period]);

  return (
    <Card>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <SectionTitle sub="Ranking por cantidad de actividades pagadas (reservas, Open Plays, clases y torneo) y dinero dejado en el club.">Clientes más leales</SectionTitle>
        <Segmented value={period} onChange={setPeriod} options={[
          { value: "day", label: "Hoy" }, { value: "month", label: "Este mes" }, { value: "year", label: "Este año" }, { value: "all", label: "Histórico" },
        ]} />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Sin actividad paga registrada en este período.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, idx) => (
            <div key={r.client.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl gap-3" style={{ background: "#EEF1F7" }}>
              <span className="flex items-center gap-2.5 text-sm font-medium min-w-0">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: idx < 3 ? COLORS.ball : COLORS.court, color: idx < 3 ? COLORS.courtDark : "#fff" }}>{idx + 1}</span>
                <span className="truncate">{r.client.name}</span>
              </span>
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-xs" style={{ color: "#6B7688" }}>{r.count} actividad{r.count !== 1 ? "es" : ""}</span>
                <span className="mono text-sm font-bold" style={{ color: COLORS.court }}>{formatMoney(r.usd)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Historial de asistencia (v2.20.0): cada FECHA de un Open Play/Clase cuenta como su propia
// actividad individual -- mismo criterio que ya usa el resto de la app (una fila en
// openPlays/classes por ocurrencia, incluso dentro de una serie recurrente). EventDetail/
// ClassDetail (el modal de Actividades) solo dejan ver fechas futuras/de hoy; esta card junta
// TODAS las fechas ya pasadas (openPlays/classes ya traen el historial completo, sin filtrar,
// desde el componente principal) para poder repasar quién asistió a cuál sesión sin que el
// dato desaparezca al pasar la fecha. Reutiliza AttendeesPanel (definido junto a EventDetail
// más abajo) para el detalle expandible de cada fila -- misma UI, mismos mutators.
function AsistenciaHistorial({ openPlays, classes, users, onRemoveOpenPlayRegistration, onRemoveClassRegistration, onSetOpenPlayAttendance, onSetClassAttendance, onSetOpenPlayPaymentStatus, onSetClassPaymentStatus }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [expandedKey, setExpandedKey] = useState(null);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const opRows = openPlays.map((e) => ({ key: `op-${e.id}`, id: e.id, kind: "open_play", title: e.name, date: e.date, registrations: e.registrations }));
    const clRows = classes.map((e) => ({ key: `cl-${e.id}`, id: e.id, kind: "clase", title: e.academyName, date: e.date, registrations: e.registrations }));
    return [...opRows, ...clRows].filter((r) => r.date <= todayIso).sort((a, b) => b.date.localeCompare(a.date));
  }, [openPlays, classes, todayIso]);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter((r) => !q || r.title.toLowerCase().includes(q));

  return (
    <Card>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <SectionTitle sub='Cada fecha de una actividad -- incluida cada sesión de una serie recurrente -- queda como su propio registro de quién asistió.'>Historial de asistencia</SectionTitle>
      </div>
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
        <input style={{ ...inputStyle, paddingLeft: 32, maxWidth: 340 }} value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Buscar actividad…" />
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Todavía no hay actividades pasadas.</p>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((r) => {
            const attended = r.registrations.filter((x) => x.attended).length;
            const open = expandedKey === r.key;
            return (
              <div key={r.key} className="rounded-xl overflow-hidden" style={{ background: "#EEF1F7" }}>
                <button onClick={() => setExpandedKey(open ? null : r.key)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left">
                  <span className="flex items-center gap-2.5 min-w-0 text-sm">
                    <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0" style={{ background: r.kind === "open_play" ? "#DCEBD5" : "#E4E7FB", color: r.kind === "open_play" ? COLORS.court : "#4C4FBF" }}>
                      {r.kind === "open_play" ? "Open Play" : "Clase"}
                    </span>
                    <span className="font-semibold truncate">{r.title}</span>
                    <span className="text-gray-500 text-xs shrink-0">{formatDateHuman(r.date)}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-xs" style={{ color: "#6B7688" }}>{attended}/{r.registrations.length} asistió</span>
                    <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none" }} />
                  </span>
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-1" style={{ background: "#fff", borderTop: `1px solid ${COLORS.line}` }}>
                    <AttendeesPanel occurrences={[r]} users={users}
                      onRemove={r.kind === "open_play" ? onRemoveOpenPlayRegistration : onRemoveClassRegistration}
                      onSetAttendance={r.kind === "open_play" ? onSetOpenPlayAttendance : onSetClassAttendance}
                      onSetPaymentStatus={r.kind === "open_play" ? onSetOpenPlayPaymentStatus : onSetClassPaymentStatus} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* =========================================================================
   TAB: PAGOS (admin) -- v2.44.5
   Antes verificar un pago suelto significaba entrar torneo por torneo,
   categoría por categoría (Participantes) o actividad por actividad
   (Inscritos de cada Open Play/Clase) -- no había una sola pantalla para
   auditar todo. Esto junta las tres fuentes en una lista plana, UNA FILA
   POR PERSONA (no por equipo): un equipo de dobles se "desarma" en sus dos
   jugadores, cada uno con su propio estado de pago si pagó por separado
   (ver joinTeam, v2.44.2) o compartiendo el de quien creó el equipo si no
   (Buscar jugador / roster del organizador).
   ========================================================================= */
function buildPaymentRows(tournaments, categories, openPlays, classes, setTeamPaymentStatus, setPlayerPaymentStatus, setOpenPlayPaymentStatus, setClassPaymentStatus) {
  const rows = [];
  // Torneos: UNA fila por persona POR TORNEO (v2.59.0, antes una fila por categoría) --
  // InscripcionTab/JoinTeamModal cobran varias categorías juntas en UN solo checkout y
  // REPARTEN ese total entre ellas (nunca lo duplican -- ver el comentario en InscripcionTab:
  // guardar el total completo en cada una inflaría el ingreso real al sumar). Mostrar esas
  // partes como filas sueltas acá ("$17,50" y "$17,50" en vez de "$35,00") hacía parecer que
  // eran DOS pagos distintos, cuando en realidad el socio pagó UNA sola vez -- justo la
  // confusión que este agrupado evita. Se agrupa por (torneo, persona), sumando priceUsd de
  // cada categoría y uniendo sus nombres -- mismo criterio de identidad que
  // buildTournamentParticipants (InscritosTab): userId si existe, si no el nombre normalizado.
  const byTournamentPerson = new Map();
  categories.forEach((cat) => {
    const tournament = tournaments.find((t) => t.id === cat.tournamentId);
    [...(cat.teams || []), ...(cat.waitlist || [])].forEach((team) => {
      (team.players || []).forEach((p, idx) => {
        // "Pago propio" solo existe para el jugador #2 que se unió por su cuenta con el link
        // (players[idx].paymentStatus queda seteado ahí, ver joinTeam) -- el jugador #0
        // siempre usa los campos de nivel de equipo, sea cual sea el modo de inscripción.
        const ownPayment = idx > 0 && p.paymentStatus !== undefined;
        const partner = (team.players || []).find((_, i) => i !== idx);
        const key = `${cat.tournamentId}::${p.userId || `name:${p.name.trim().toLowerCase()}`}`;
        const entry = byTournamentPerson.get(key) || {
          key, name: p.name, subContext: tournament?.name || "", partnerNames: new Set(),
          priceUsd: 0, catNames: [], createdAt: 0, targets: [], // targets: {catId, teamId, playerIdx, ownPayment, paymentStatus, paymentMethod, reference, proofName}
        };
        const createdAt = ownPayment ? p.joinedAt : team.createdAt;
        entry.priceUsd += Number(ownPayment ? p.priceUsd : team.priceUsd) || 0;
        entry.catNames.push(cat.name);
        if (partner) entry.partnerNames.add(partner.name);
        if (createdAt > entry.createdAt) entry.createdAt = createdAt;
        entry.targets.push({
          catId: cat.id, teamId: team.id, playerIdx: idx, ownPayment,
          paymentStatus: ownPayment ? p.paymentStatus : team.paymentStatus,
          paymentMethod: ownPayment ? p.paymentMethod : team.paymentMethod,
          reference: ownPayment ? p.reference : team.reference,
          proofName: ownPayment ? p.proofName : team.proofName,
        });
        byTournamentPerson.set(key, entry);
      });
    });
  });
  byTournamentPerson.forEach((entry) => {
    const pending = entry.targets.filter((t) => t.paymentStatus !== "confirmada");
    // Método/referencia: se muestran solo si TODAS las partes coinciden (lo normal -- un mismo
    // checkout reparte el mismo método/referencia a cada categoría) -- si difieren (categorías
    // pagadas en checkouts separados, quizás por métodos distintos) se omiten en vez de mostrar
    // un dato que solo sería cierto para una parte del total.
    const methods = new Set(entry.targets.map((t) => t.paymentMethod).filter(Boolean));
    const references = new Set(entry.targets.map((t) => t.reference).filter(Boolean));
    // Si algo quedó sin verificar, se prioriza mostrar "Pago por verificar" sobre "Por pagar"
    // -- es el estado más urgente (alguien ya mandó comprobante y está esperando revisión), así
    // nunca se pierde de vista solo porque otra categoría del mismo carrito todavía ni se paga.
    const status = pending.length === 0 ? "confirmada"
      : pending.some((t) => t.paymentStatus === "pendiente_verificacion") ? "pendiente_verificacion" : "pendiente_efectivo";
    rows.push({
      id: `t-${entry.key}`, kind: "torneo", kindLabel: "Torneo",
      name: entry.name, contextName: entry.catNames.join(", "), subContext: entry.subContext,
      partnerName: entry.partnerNames.size > 0 ? [...entry.partnerNames].join(", ") : null,
      priceUsd: entry.priceUsd,
      paymentMethod: methods.size === 1 ? [...methods][0] : null,
      reference: references.size === 1 ? [...references][0] : null,
      paymentStatus: status, createdAt: entry.createdAt,
      // Aplica el nuevo estado a TODO lo que siga sin verificar en el grupo de una sola vez
      // (mismo criterio que InscritosTab/verifyAll) -- nunca toca lo que ya esté "confirmada".
      onSetStatus: (v) => pending.forEach((t) => (t.ownPayment
        ? setPlayerPaymentStatus(t.catId, t.teamId, t.playerIdx, v)
        : setTeamPaymentStatus(t.catId, t.teamId, v))),
    });
  });
  openPlays.forEach((e) => (e.registrations || []).forEach((r) => {
    rows.push({
      id: `op-${e.id}-${r.id}`, kind: "open_play", kindLabel: "Open Play",
      name: r.userName, contextName: e.name, subContext: formatDateHuman(e.date), partnerName: null,
      priceUsd: r.priceUsd, paymentMethod: r.paymentMethod, reference: r.reference, proofName: r.proofName,
      paymentStatus: r.paymentStatus, createdAt: r.createdAt,
      onSetStatus: (v) => setOpenPlayPaymentStatus(e.id, r.id, v),
    });
  }));
  classes.forEach((e) => (e.registrations || []).forEach((r) => {
    rows.push({
      id: `cl-${e.id}-${r.id}`, kind: "clase", kindLabel: "Clase",
      name: r.userName, contextName: e.academyName, subContext: formatDateHuman(e.date), partnerName: null,
      priceUsd: r.priceUsd, paymentMethod: r.paymentMethod, reference: r.reference, proofName: r.proofName,
      paymentStatus: r.paymentStatus, createdAt: r.createdAt,
      onSetStatus: (v) => setClassPaymentStatus(e.id, r.id, v),
    });
  }));
  return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

const PAGOS_KIND_CHIPS = [
  { value: "all", label: "Todas" },
  { value: "torneo", label: "Torneos" },
  { value: "open_play", label: "Open Plays" },
  { value: "clase", label: "Clases" },
];

function PagosTab({ tournaments, categories, openPlays, classes, setTeamPaymentStatus, setPlayerPaymentStatus, setOpenPlayPaymentStatus, setClassPaymentStatus }) {
  const [kindFilter, setKindFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () => buildPaymentRows(tournaments, categories, openPlays, classes, setTeamPaymentStatus, setPlayerPaymentStatus, setOpenPlayPaymentStatus, setClassPaymentStatus),
    [tournaments, categories, openPlays, classes, setTeamPaymentStatus, setPlayerPaymentStatus, setOpenPlayPaymentStatus, setClassPaymentStatus]
  );

  const filtered = rows.filter((r) => {
    if (kindFilter !== "all" && r.kind !== kindFilter) return false;
    if (statusFilter !== "all" && r.paymentStatus !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.contextName.toLowerCase().includes(q);
  });

  const pendingCount = rows.filter((r) => r.paymentStatus !== "confirmada").length;

  return (
    <div className="mt-2 space-y-4">
      <SectionTitle sub="Todas las inscripciones pagas del club -- torneos, Open Plays y clases juntos, una fila por persona.">
        Pagos{pendingCount > 0 && <span className="text-base font-normal ml-2" style={{ color: COLORS.clay }}>· {pendingCount} por revisar</span>}
      </SectionTitle>

      <div className="flex flex-wrap gap-2">
        {PAGOS_KIND_CHIPS.map((c) => (
          <button key={c.value} onClick={() => setKindFilter(c.value)} className="px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ background: kindFilter === c.value ? COLORS.court : "#EAEEF5", color: kindFilter === c.value ? "#fff" : COLORS.ink }}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setStatusFilter("all")} className="px-3 py-1.5 rounded-full text-xs font-bold"
          style={{ background: statusFilter === "all" ? COLORS.courtDark : "#EAEEF5", color: statusFilter === "all" ? "#fff" : COLORS.ink }}>
          Todos los estados
        </button>
        {Object.entries(PAYMENT_STATUS_META).map(([val, meta]) => (
          <button key={val} onClick={() => setStatusFilter(val)} className="px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ background: statusFilter === val ? meta.fg : meta.bg, color: statusFilter === val ? "#fff" : meta.fg }}>
            {meta.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" color="#9AA6BC" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o actividad…" style={{ ...inputStyle, paddingLeft: 38 }} />
      </div>

      <div className="space-y-1.5">
        {filtered.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm flex-wrap" style={{ background: "#EEF1F7" }}>
            <div className="min-w-0">
              <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wide mr-1.5" style={{ background: "#EAEEF5", color: "#6B7688" }}>{r.kindLabel}</span>
              <span className="font-semibold">{r.name}</span>
              {r.partnerName && <span className="text-xs text-gray-500"> · con {r.partnerName}</span>}
              <span className="text-xs text-gray-500 block mt-0.5 truncate">
                {r.contextName}{r.subContext && ` · ${r.subContext}`}
                {r.paymentMethod && ` · ${r.paymentMethod === "movil" ? "Pago Móvil" : "Efectivo"}`}
                {r.reference && ` · ref. ${r.reference}`}
              </span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0 ml-auto">
              {r.priceUsd != null && <span className="mono text-xs font-bold" style={{ color: COLORS.court }}>{formatMoney(r.priceUsd)}</span>}
              <PaymentStatusSelect status={r.paymentStatus} onChange={r.onSetStatus} />
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-sm text-gray-400 italic py-4 text-center">Nadie coincide con este filtro.</p>}
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: USUARIOS (admin) — directorio de todos los que se han registrado en
   la app, con su membresía actual. `planId` en el perfil es la fuente de
   verdad de "qué plan tiene ahora" (lo pone subscribeToPlan); `subscriptions`
   es el historial de altas, no se usa aquí más que para el contador de arriba.
   ========================================================================= */
function UsuariosTab({ users, subscriptions, membershipPlans, setSubscriptionPaymentStatus, setUserRole, currentUser, deleteUserAccount, categories, bookings, openPlays, classes }) {
  const [query, setQuery] = useState("");
  const todayIso = new Date().toISOString().slice(0, 10);

  // Promover/degradar el rol de otro socio (v2.47.0) -- confirmación explícita antes de
  // aplicar, mismo componente ConfirmDeleteModal que usa el resto de la app para acciones
  // delicadas. `roleTarget` es el usuario sobre el que se está por actuar (o null si el
  // diálogo está cerrado); nunca se ofrece este botón sobre la propia fila del admin (ver
  // más abajo), así que acá no hace falta chequear self otra vez.
  const [roleTarget, setRoleTarget] = useState(null);
  const [changingRole, setChangingRole] = useState(false);
  const [roleError, setRoleError] = useState("");

  const confirmRoleChange = async () => {
    if (changingRole || !roleTarget) return;
    setChangingRole(true); setRoleError("");
    const newRole = roleTarget.role === "admin" ? "cliente" : "admin";
    const result = await setUserRole(roleTarget.id, newRole);
    setChangingRole(false);
    if (result?.error) { setRoleError("No se pudo cambiar el rol -- revisa tu conexión e intenta de nuevo."); return; }
    setRoleTarget(null);
  };

  // Eliminar la cuenta de un socio por completo (v2.58.0) -- mismo patrón de confirmación
  // explícita que el cambio de rol arriba. Nunca se ofrece sobre la propia fila (ver más abajo)
  // ni sobre otro admin -- primero hay que quitarle el rol de admin con el botón de arriba
  // (mismo bloqueo que ya aplica deleteUserAccount/api/delete-user.js del lado del servidor,
  // esto es solo la UI reflejándolo). El resumen que se muestra en el popup (qué se borra de
  // verdad vs. qué pago verificado se conserva) sale de buildUserDeletionSummary -- se recalcula
  // cada vez que se abre para que nunca muestre un número viejo.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const deletionSummary = useMemo(
    () => (deleteTarget ? buildUserDeletionSummary(deleteTarget.id, { categories, bookings, subscriptions, openPlays, classes }) : null),
    [deleteTarget, categories, bookings, subscriptions, openPlays, classes]
  );

  const confirmDeleteUser = async () => {
    if (deleting || !deleteTarget) return;
    setDeleting(true); setDeleteError("");
    const result = await deleteUserAccount(deleteTarget.id);
    setDeleting(false);
    if (result?.error) { setDeleteError(result.error); return; }
    setDeleteTarget(null);
  };

  const planFor = (u) => (membershipPlans.find((p) => p.id === u.planId) || membershipPlans[0] || null);

  const clients = users.filter((u) => u.role === "cliente");
  // Mismo criterio que Estadísticas (isActiveMember): un plan pago vencido ya no cuenta como
  // "membresía activa" acá tampoco, para que ambos tabs cuenten lo mismo.
  const totalMembers = clients.filter((u) => isActiveMember(u, planFor(u), todayIso)).length;

  // Suscripciones que todavía no activan el plan del socio (v2.37.0, ver subscribeToPlan) --
  // ordenadas por más antigua primero, para que el admin resuelva las que llevan más tiempo
  // esperando antes que las recién llegadas.
  const pendingSubs = useMemo(() => subscriptions
    .filter((s) => s.paymentStatus !== "confirmada")
    .map((s) => ({ ...s, user: users.find((u) => u.id === s.userId), plan: membershipPlans.find((p) => p.id === s.planId) }))
    .sort((a, b) => a.createdAt - b.createdAt), [subscriptions, users, membershipPlans]);

  const q = query.trim().toLowerCase();
  const filtered = [...users]
    .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone || "").includes(q))
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="mt-2 space-y-6">
      <SectionTitle sub="Todos los que se han registrado en la app, su nivel DUPR, contacto y qué membresía tienen activa.">Usuarios</SectionTitle>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Jugadores registrados" value={clients.length} icon={Users} />
        <StatCard label="Con membresía activa" value={totalMembers} icon={Award} />
        <StatCard label="Suscripciones históricas" value={subscriptions.length} icon={Euro} />
      </div>

      {pendingSubs.length > 0 && (
        <Card>
          <SectionTitle sub="Se activan solas apenas confirmes el pago -- hasta entonces el socio sigue con el plan que ya tenía.">
            Suscripciones pendientes de verificación
          </SectionTitle>
          <div className="space-y-1.5">
            {pendingSubs.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl" style={{ background: "#EEF1F7" }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: COLORS.ink }}>{s.user?.name || "Usuario eliminado"}</p>
                  <p className="text-xs truncate" style={{ color: "#6B7688" }}>
                    {s.plan?.name || "Plan"} · {formatMoney(s.priceUsd)} · {s.paymentMethod === "movil" ? "Pago Móvil" : "Efectivo"}
                    {s.reference ? ` · Ref: ${s.reference}` : ""}
                  </p>
                </div>
                <PaymentStatusSelect status={s.paymentStatus} onChange={(v) => setSubscriptionPaymentStatus(s, v)} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
          <input style={{ ...inputStyle, paddingLeft: 32, maxWidth: 340 }} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, correo o teléfono…" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="py-1.5 pr-3">Jugador</th>
                <th className="py-1.5 pr-3">Contacto</th>
                <th className="py-1.5 pr-3">Zona</th>
                <th className="py-1.5 pr-3">DUPR</th>
                <th className="py-1.5 pr-3">Rol</th>
                <th className="py-1.5 pr-3">Membresía</th>
                <th className="py-1.5 pr-3">Miembro desde</th>
                <th className="py-1.5 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const plan = planFor(u);
                const isPaidPlan = (plan?.monthlyPrice || 0) > 0;
                const isExpired = isPaidPlan && !isActiveMember(u, plan, todayIso);
                const isSelf = u.id === currentUser.id;
                return (
                  <tr key={u.id} className="border-t" style={{ borderColor: COLORS.line }}>
                    <td className="py-2 pr-3 font-semibold">{u.name}</td>
                    <td className="py-2 pr-3 text-gray-500">
                      <div>{u.email}</div>
                      {u.phone && <div className="text-xs">{u.phone}</div>}
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{u.zone || "—"}</td>
                    <td className="py-2 pr-3 mono">{u.duprRating != null ? Number(u.duprRating).toFixed(2) : "—"}</td>
                    <td className="py-2 pr-3">
                      {isSelf ? (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: "#FBEAE3", color: COLORS.clay }}>Admin (tú)</span>
                      ) : (
                        <button onClick={() => setRoleTarget(u)} title="Cambiar rol"
                          className="px-2 py-0.5 rounded-full text-[11px] font-bold hover:opacity-80"
                          style={{ background: u.role === "admin" ? "#FBEAE3" : "#EAF0F8", color: u.role === "admin" ? COLORS.clay : COLORS.court }}>
                          {u.role === "admin" ? "Admin" : "Cliente"}
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: isExpired ? "#FBEAE3" : isPaidPlan ? "#E4F3EC" : "#EDEFF4", color: isExpired ? COLORS.clay : isPaidPlan ? COLORS.court : "#6B7688" }}>
                        {plan?.name || "Sin membresía"}{isExpired ? " (vencida)" : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{u.createdAt ? formatDateHuman(new Date(u.createdAt).toISOString().slice(0, 10)) : "—"}</td>
                    <td className="py-2 pr-3">
                      {/* Nunca sobre uno mismo; sobre otro admin hay que quitarle el rol primero
                         (con el botón de la columna Rol) -- mismo bloqueo que ya aplica
                         api/delete-user.js del lado del servidor. */}
                      {!isSelf && u.role !== "admin" && (
                        <button onClick={() => setDeleteTarget(u)} title="Eliminar usuario" className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-sm text-gray-400 py-4">No hay usuarios que coincidan con la búsqueda.</p>}
        </div>
      </Card>

      {roleTarget && (
        <ConfirmDeleteModal
          title={roleTarget.role === "admin" ? `¿Quitarle el rol de admin a ${roleTarget.name}?` : `¿Hacer admin a ${roleTarget.name}?`}
          message={roleError || (roleTarget.role === "admin"
            ? "Deja de poder entrar a Estadísticas, Usuarios, Pagos y de administrar Torneos/Actividades/Membresías. Se le puede volver a dar en cualquier momento."
            : "Va a poder entrar a TODAS las pestañas de administración -- Estadísticas, Usuarios, Pagos, y crear/editar torneos, Open Plays, clases y membresías. Solo dáselo a alguien de confianza del club.")}
          options={[{
            label: changingRole ? "Cambiando…" : (roleTarget.role === "admin" ? "Quitar admin" : "Hacer admin"),
            variant: "danger", onClick: confirmRoleChange,
          }]}
          onCancel={() => { setRoleTarget(null); setRoleError(""); }} />
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`¿Eliminar a ${deleteTarget.name} permanentemente?`}
          message={deleteError || [
            "No podrá volver a entrar con ese correo -- se borra también su cuenta de acceso, no solo su perfil.",
            deletionSummary.toDelete > 0
              ? `Se borran ${deletionSummary.toDelete} registro${deletionSummary.toDelete === 1 ? "" : "s"} sin verificar (reservas, inscripciones a torneo/Open Play/clase, membresías por pagar o por verificar).`
              : "No tiene ningún registro sin verificar que borrar.",
            deletionSummary.toKeep > 0
              ? `Se conservan ${deletionSummary.toKeep} registro${deletionSummary.toKeep === 1 ? "" : "s"} con pago YA VERIFICADO (${formatMoney(deletionSummary.toKeepUsd)}) como historial del club, sin quedar asociados a su cuenta.`
              : null,
            "Esta acción no se puede deshacer.",
          ].filter(Boolean).join(" ")}
          options={[{ label: deleting ? "Eliminando…" : "Eliminar permanentemente", variant: "danger", onClick: confirmDeleteUser }]}
          onCancel={() => { setDeleteTarget(null); setDeleteError(""); }} />
      )}
    </div>
  );
}

function EstadisticasTab({ bookings, openPlays, classes, subscriptions, membershipPlans, users, club, courts, categories, refreshStats,
  removeOpenPlayRegistration, removeClassRegistration, setOpenPlayAttendance, setClassAttendance, setOpenPlayPaymentStatus, setClassPaymentStatus }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const transactions = useMemo(() => buildTransactions(bookings, openPlays, classes, subscriptions), [bookings, openPlays, classes, subscriptions]);
  const byDay = useMemo(() => groupByDay(transactions, 14), [transactions]);
  const byMonth = useMemo(() => groupByMonth(transactions, 6), [transactions]);
  const byType = useMemo(() => groupByType(transactions), [transactions]);
  const byHour = useMemo(() => groupByHour(bookings, club), [bookings, club]);
  const byZone = useMemo(() => groupByZone(users), [users]);
  const byPlan = useMemo(() => groupByPlan(users, membershipPlans, todayIso), [users, membershipPlans, todayIso]);
  const risk = useMemo(() => membershipRisk(users, membershipPlans, todayIso, 7), [users, membershipPlans, todayIso]);

  const totalRevenue = transactions.reduce((s, t) => s + t.usd, 0);
  // "Activa" ahora exige que planExpiresAt no haya pasado (ver isActiveMember) -- antes un
  // socio que dejó de pagar hace meses seguía contando para siempre, lo que inflaba este
  // número y el MRR de abajo sin que hubiera forma de notarlo desde Estadísticas.
  const totalMembers = users.filter((u) => u.role === "cliente" && isActiveMember(u, membershipPlans.find((p) => p.id === u.planId), todayIso)).length;
  const totalBookings = bookings.filter((b) => b.status !== "cancelada").length;
  const totalClients = users.filter((u) => u.role === "cliente").length;
  const mrr = useMemo(() => computeMRR(users, membershipPlans, todayIso), [users, membershipPlans, todayIso]);
  const arpu = totalMembers > 0 ? mrr / totalMembers : 0;

  // Los datos de este tab se traen una sola vez al abrir la app (ver componente principal) --
  // sin esto, si un socio se activa desde otra sesión (o el admin lo activa y luego navega
  // directo acá sin recargar la página) "Ingresos totales" y compañía se quedan mostrando lo
  // que había al momento de loguearse, no el estado real. Se refresca solo al entrar a este
  // tab, y también hay un botón manual por si el admin quiere confirmar que ve lo último.
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const doRefresh = async () => {
    setRefreshing(true);
    await refreshStats();
    setLastRefreshedAt(Date.now());
    setRefreshing(false);
  };
  useEffect(() => { doRefresh(); }, []);
  const secsAgo = lastRefreshedAt ? Math.round((Date.now() - lastRefreshedAt) / 1000) : null;

  return (
    <div className="mt-2 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <SectionTitle sub="Ingresos, MRR, riesgo de cancelación, horarios pico y de dónde vienen tus jugadores.">Estadísticas del club</SectionTitle>
        <button onClick={doRefresh} disabled={refreshing} className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl shrink-0"
          style={{ background: "#EAF0F8", color: COLORS.court, opacity: refreshing ? 0.6 : 1 }}>
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Actualizando…" : secsAgo != null ? `Actualizado hace ${secsAgo < 5 ? "un instante" : `${secsAgo}s`}` : "Actualizar"}
        </button>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Ingresos totales" value={formatMoney(totalRevenue)} icon={Euro} sub="Histórico, todas las fuentes" />
        <StatCard label="MRR (ingreso mensual recurrente)" value={formatMoney(mrr)} icon={TrendingUp} sub={`${totalMembers} socio${totalMembers === 1 ? "" : "s"} con plan vigente`} />
        <StatCard label="Ingreso promedio por socio" value={formatMoney(arpu)} icon={Wallet} sub="MRR ÷ membresías activas" />
        <StatCard label="Membresías activas" value={totalMembers} icon={Award} sub={risk.length > 0 ? `${risk.length} en riesgo` : undefined} />
        <StatCard label="Reservas totales" value={totalBookings} icon={CalendarClock} />
        <StatCard label="Jugadores registrados" value={totalClients} icon={Users} />
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        <Card>
          <SectionTitle sub="Suma de reservas, Open Plays, clases y membresías, últimos 14 días.">Ingresos por día</SectionTitle>
          <MiniBarChart data={byDay} money />
        </Card>
        <Card>
          <SectionTitle sub="Mismo total, agrupado por mes (últimos 6 meses).">Ingresos por mes</SectionTitle>
          <MiniBarChart data={byMonth} color={COLORS.clay} money />
        </Card>
        <Card>
          <SectionTitle sub="De dónde sale el dinero, histórico.">Ingresos por categoría</SectionTitle>
          <HBarList data={byType} color={COLORS.ball} money />
        </Card>
      </div>

      <Card>
        <SectionTitle sub="Todas las reservas de cancha, agrupadas por bloque horario — identifica los horarios pico del club.">Horas más concurridas</SectionTitle>
        <HourLineChart data={byHour} />
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <SectionTitle sub="Cuántos jugadores tienen cada plan vigente (sin vencer).">Membresías contratadas</SectionTitle>
          <HBarList data={byPlan} color={COLORS.court} />
        </Card>
        <Card>
          <SectionTitle sub="Zona registrada por cada jugador al crear su cuenta (detectada automáticamente o escrita a mano).">Zona de los jugadores</SectionTitle>
          <HBarList data={byZone} color={COLORS.clay} />
        </Card>
      </div>

      <MembershipRiskCard risk={risk} />

      <LoyalClientsCard bookings={bookings} openPlays={openPlays} classes={classes} categories={categories} users={users} />

      <AsistenciaHistorial openPlays={openPlays} classes={classes} users={users}
        onRemoveOpenPlayRegistration={removeOpenPlayRegistration} onRemoveClassRegistration={removeClassRegistration}
        onSetOpenPlayAttendance={setOpenPlayAttendance} onSetClassAttendance={setClassAttendance}
        onSetOpenPlayPaymentStatus={setOpenPlayPaymentStatus} onSetClassPaymentStatus={setClassPaymentStatus} />
    </div>
  );
}

/* =========================================================================
   TAB: CATEGORIAS
   ========================================================================= */
// El admin (quien crea/edita el torneo) ve 6 pestañas: Generalidades, Categorías, Inscritos,
// Duplas, Formatos, Calendario, Resultados. El cliente solo ve su autoservicio (Inscripción,
// con el carrito de checkout) más Calendario/Resultados.
//
// v2.50.0: "Participantes" se renombra "Duplas" y "Pagos" se renombra "Inscritos" y pasa a ir
// ANTES que Duplas -- ahora Duplas es de solo lectura (arma equipos y ve quién está inscrito,
// pero ya no borra a nadie) e Inscritos es el ÚNICO lugar para borrar a alguien del torneo (ver
// InscritosTab/removePersonFromTournament). Antes se podía borrar desde Duplas (entonces
// Participantes) un equipo A LA VEZ, categoría por categoría -- si esa persona estaba anotada
// en más de una categoría, borrarla de una no la borraba de las demás, y seguía apareciendo en
// Pagos como si nada. Centralizar el borrado en un solo lugar, por PERSONA (no por equipo),
// resuelve eso de raíz.
const TORNEO_SUB_ITEMS = [
  { id: "config", label: "Generalidades", roles: ["admin"] },
  { id: "categorias", label: "Categorías", roles: ["admin"] },
  { id: "inscritos", label: "Inscritos", roles: ["admin"] },
  { id: "duplas", label: "Duplas", roles: ["admin"] },
  { id: "formatos", label: "Formatos", roles: ["admin"] },
  // v2.44.3: el admin también puede auto-inscribirse (con checkout real, no el roster manual
  // de Duplas) -- antes esta pestaña ni le aparecía.
  { id: "inscripcion", label: "Inscripción", roles: ["admin", "cliente"] },
  // v2.81.7, a pedido del club: el cliente ya no ve el Calendario del torneo (la grilla
  // cancha por cancha, pensada para mesa técnica/organizador) -- sigue viendo Inscripción,
  // Resultados y Clasificación sin cambios.
  { id: "calendario", label: "Calendario", roles: ["admin"] },
  { id: "resultados", label: "Resultados", roles: ["admin", "cliente"] },
  // v2.77.1: antes había que entrar a Resultados y filtrar categoría por categoría para ver
  // cómo iba cada una -- acá se ven todas juntas de una, sin la carga de marcador de por medio.
  { id: "clasificacion", label: "Clasificación", roles: ["admin", "cliente"] },
];

// Pantalla de aterrizaje de "Torneos"/"Mis Torneos" (ver NAV_ITEMS): el admin gestiona TODOS
// los torneos del club (cada uno con sus propias categorías/participantes/calendario/
// resultados, ver nota de `categories` en el componente principal); el cliente, desde v2.48.1,
// solo ve los publicados en los que YA está inscrito -- antes veía todos los publicados del
// club existieran o no inscripciones suyas, lo cual no calzaba con renombrar esto a "Mis
// Torneos". Se entera de un torneo nuevo por Actividades (donde sí se listan todos, para
// poder inscribirse) y recién aparece acá una vez que su inscripción se guardó de verdad.
// `showForm`/`setShowForm` viven en el componente principal (no acá) para que el botón
// "+ Torneo" de Actividades (EventosTab) pueda abrir este formulario desde afuera al navegar
// -- mismo motivo por el que activeCatId vive arriba de CategoriasTab.
function TournamentsListTab({ tournaments, categories, role, currentUser, onSelect, onCreate, onRemove, showForm, setShowForm }) {
  const isAdmin = role === "admin";
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  // Mismo criterio que InscripcionTab (alreadyIn): busca al usuario actual por userId entre
  // TODOS los jugadores (titulares y los que se unieron después por su cuenta, ver joinTeam)
  // de cualquier categoría de este torneo, en equipos confirmados o en lista de espera --
  // estar en lista de espera ya cuenta como "inscrito" para efectos de "Mis Torneos".
  const isRegisteredIn = (t) => categories.some((c) => c.tournamentId === t.id &&
    [...(c.teams || []), ...(c.waitlist || [])].some((team) => (team.players || []).some((p) => p.userId === currentUser?.id)));

  // Un torneo "draft" (recién creado, todavía sin completar) es invisible para clientes en
  // todos lados -- acá y en Actividades -- hasta que el admin lo publique explícitamente
  // desde Generalidades. El admin sigue viendo todos, con badge, para poder completarlos.
  const visibleTournaments = isAdmin ? tournaments : tournaments.filter((t) => t.status === "published" && isRegisteredIn(t));

  const catCountFor = (tid) => categories.filter((c) => c.tournamentId === tid).length;
  const teamCountFor = (tid) => categories.filter((c) => c.tournamentId === tid).reduce((s, c) => s + c.teams.length, 0);

  const submitCreate = async () => {
    setCreating(true);
    const res = await onCreate(name);
    setCreating(false);
    if (!res?.error) { setShowForm(false); setName(""); }
  };

  return (
    <div className="mt-2 space-y-5">
      {isAdmin && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionTitle sub="Cada torneo tiene sus propias categorías, participantes, calendario y resultados.">Torneos del club</SectionTitle>
            <button onClick={() => setShowForm((s) => !s)} style={{ background: COLORS.clay, color: "#fff" }} className="px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 h-fit">
              <Plus size={16} /> Crear nuevo torneo
            </button>
          </div>
          {showForm && (
            <div className="mt-4 flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[220px]">
                <Label>Nombre del torneo</Label>
                <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Copa Otoño 2026" autoFocus />
              </div>
              <button disabled={creating} onClick={submitCreate} style={{ background: COLORS.court, color: "#fff" }} className="px-4 py-2.5 rounded-xl font-bold text-sm h-fit disabled:opacity-60">
                {creating ? "Creando…" : "Crear"}
              </button>
              <button onClick={() => { setShowForm(false); setName(""); }} className="px-4 py-2.5 rounded-xl font-semibold text-sm h-fit" style={{ background: "#EAEEF5", color: COLORS.ink }}>Cancelar</button>
            </div>
          )}
        </Card>
      )}

      {visibleTournaments.length === 0 && (
        <Card>
          <p className="text-sm text-gray-400">
            {isAdmin ? 'Todavía no hay torneos creados -- pulsa "Crear nuevo torneo" para empezar.'
              : "Todavía no estás inscrito en ningún torneo -- entra a Actividades para ver los que están abiertos."}
          </p>
        </Card>
      )}

      {visibleTournaments.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {visibleTournaments.map((t) => (
            <Card key={t.id}>
              <div className="flex gap-3">
                {/* Imagen del torneo (v2.48.1) -- mismo tratamiento visual que las cards de
                   Actividades (EventListItem): thumbnail a la izquierda, degradado + raqueta
                   si el torneo todavía no tiene imagen (se sube en Generalidades). Antes esta
                   lista no mostraba ninguna imagen aunque el torneo sí la tuviera guardada. */}
                <div className="relative w-16 sm:w-20 rounded-xl overflow-hidden shrink-0"
                  style={!t.image ? { background: `linear-gradient(135deg, ${COLORS.clay}, ${COLORS.courtDark})` } : undefined}>
                  {t.image
                    ? <img src={t.image} alt={t.name} className="w-full h-full object-cover" />
                    : <div className="absolute inset-0 flex items-center justify-center"><RacketIcon size={22} color="rgba(255,255,255,0.85)" /></div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-bold text-base flex items-center gap-2 flex-wrap">
                      {t.name}
                      {isAdmin && t.status !== "published" && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0" style={{ background: "#EAEEF5", color: "#6B7688" }}>Borrador</span>
                      )}
                    </h3>
                    {isAdmin && (
                      <button onClick={() => onRemove(t.id)} title="Borrar torneo (incluye sus categorías, equipos y calendario)"
                        className="text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={16} /></button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-3">
                    {t.startDate && t.endDate ? `${formatDateHuman(t.startDate)} → ${formatDateHuman(t.endDate)}` : "Fechas por definir"}
                  </p>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#EAEEF5", color: COLORS.ink }}>{catCountFor(t.id)} categoría(s)</span>
                    <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: "#EAEEF5", color: COLORS.ink }}>{teamCountFor(t.id)} equipo(s) inscritos</span>
                  </div>
                  <button onClick={() => onSelect(t.id)} style={{ background: COLORS.court, color: "#fff" }} className="px-4 py-2 rounded-xl font-bold text-sm w-full">
                    {isAdmin ? "Editar" : "Ver torneo"}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TorneosSection(props) {
  const { role } = props;
  const visibleSubItems = TORNEO_SUB_ITEMS.filter((it) => it.roles.includes(role));
  // Recordar la sub-pestaña (v2.53.1) -- mismo motivo que `tab`/`activeTournamentId` en el
  // componente principal: actualizar la página a mitad de revisar Inscritos ya no debe
  // mandar de vuelta a Generalidades. `loadCache` es la misma función de nivel de módulo que
  // usa el resto de la app (club/tournaments/tab), no hace falta pasarla por props.
  const [subTab, setSubTab] = useState(() => {
    const cached = loadCache("torneoSubTab", null);
    return cached && visibleSubItems.some((it) => it.id === cached) ? cached : visibleSubItems[0]?.id;
  });
  useEffect(() => { saveCache("torneoSubTab", subTab); }, [subTab]);
  useEffect(() => {
    if (!visibleSubItems.some((it) => it.id === subTab)) setSubTab(visibleSubItems[0]?.id);
  }, [role]);

  const {
    tournament, setTournament, uploadTournamentImage, dates, categories, activeCat, setActiveCatId,
    addCategory, removeCategory, updateCategory, addTeam, removePersonFromCategory, moveSoloRegistration, mergeIntoTeam, splitTeam, setTeamPaymentStatus, setPlayerPaymentStatus, recordPartialPayment,
    generateDraw, closeGroupsAndSeedBracket, removeTeamFromGroup, assignTeamToGroupSlot, suggestedRanking, upsertPlayerRanking,
    setCategoryFormat, courts, matchDuration, breakM, runScheduler, reflowSchedule, scheduleInfo,
    setMatchDuration, setBreakM, occupiedKeys, moveMatch, unlockMatch, clearDaySchedule, reorderColumn, markMatchOnCourt,
    submitScore, currentUser, users, club, setTab, onBackToList, onRemoveTournament,
    pendingCategoryCount, flushPendingCategoryWrites, initialSubTab, onConsumeInitialSubTab, registrationLog,
  } = props;
  const isAdmin = role === "admin";

  // Botón "Inscritos" en la card de Actividades (v2.45.1, ver openTournamentInscritos en
  // PickleballTournamentApp) -- aterriza directo en esta sub-pestaña en vez de "Generalidades"
  // como cualquier otro clic en la card. `initialSubTab` es un valor de un solo uso: se
  // consume apenas se aplica para no pisar un cambio de pestaña posterior del propio usuario.
  useEffect(() => {
    if (initialSubTab && visibleSubItems.some((it) => it.id === initialSubTab)) {
      setSubTab(initialSubTab);
      onConsumeInitialSubTab?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSubTab]);

  return (
    <div>
      {/* El club organiza varios torneos -- esta pantalla siempre es UN torneo puntual
          (TournamentsListTab, el padre, es quien lista todos y deja elegir). "Volver a
          Torneos" regresa a esa lista sin perder los demás torneos ni sus datos. El
          borrado vive acá también (no solo en la tarjeta de la lista) para no obligar al
          admin a volver a la lista primero si llegó directo a editar este torneo desde
          Actividades. */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onBackToList} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#6B7688" }}>
          <ChevronLeft size={14} /> Volver a Torneos
        </button>
        {isAdmin && (
          <button onClick={onRemoveTournament} title="Borrar torneo (incluye sus categorías, equipos y calendario)"
            className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
        )}
      </div>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="disp text-xl md:text-[22px]" style={{ color: COLORS.courtDark }}>{tournament.name}</h2>
        {/* Compartir (v2.43.0) -- visible para admin y cliente por igual, ver mismo comentario
           en EventDetail. Solo tiene sentido si el torneo ya está publicado -- uno en
           borrador no es visible ni con el link en la mano (resolvePublicActivity lo filtra),
           así que compartirlo ahora mandaría un link roto. */}
        {tournament.status === "published" && <ShareButton kind="torneo" id={tournament.id} text={`Mira este torneo: ${tournament.name}`} />}
      </div>

      {/* Aviso de resiliencia sin internet (v2.34.0) -- solo el admin puede generar estos
         cambios pendientes (resultados, calendario, etc.), así que solo a él le hace falta
         verlo. No dice "sin conexión" en general (navigator.onLine no es confiable) -- dice
         justo lo que importa: cuántos cambios reales todavía no llegaron a Supabase. */}
      {isAdmin && pendingCategoryCount > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl mb-4 text-sm" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
          <span className="flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            {pendingCategoryCount} cambio{pendingCategoryCount === 1 ? "" : "s"} de este torneo sin sincronizar todavía -- se guardaron en este teléfono y se suben solos en cuanto vuelva la señal.
          </span>
          <button onClick={flushPendingCategoryWrites} className="font-bold underline shrink-0">Reintentar ahora</button>
        </div>
      )}

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {visibleSubItems.map((it) => (
          <button key={it.id} onClick={() => setSubTab(it.id)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap"
            style={{ background: subTab === it.id ? COLORS.court : "#EAEEF5", color: subTab === it.id ? "#fff" : COLORS.ink }}>
            {it.label}
          </button>
        ))}
      </div>

      {subTab === "config" && role === "admin" && (
        <TorneoTab tournament={tournament} setTournament={setTournament} uploadTournamentImage={uploadTournamentImage} dates={dates} courts={courts}
          club={club} categories={categories} occupiedKeys={occupiedKeys} />
      )}

      {subTab === "categorias" && role === "admin" && (
        <CategoriasTab categories={categories} activeCat={activeCat} setActiveCatId={setActiveCatId}
          addCategory={addCategory} removeCategory={removeCategory} updateCategory={updateCategory} setSubTab={setSubTab} />
      )}

      {subTab === "inscritos" && role === "admin" && (
        <InscritosTab categories={categories} setTeamPaymentStatus={setTeamPaymentStatus} setPlayerPaymentStatus={setPlayerPaymentStatus}
          removePersonFromCategory={removePersonFromCategory} moveSoloRegistration={moveSoloRegistration} recordPartialPayment={recordPartialPayment} registrationLog={registrationLog} />
      )}

      {subTab === "duplas" && role === "admin" && (
        <DuplasTab categories={categories} activeCat={activeCat} setActiveCatId={setActiveCatId}
          addTeam={addTeam} suggestedRanking={suggestedRanking} upsertPlayerRanking={upsertPlayerRanking}
          setTeamPaymentStatus={setTeamPaymentStatus} setPlayerPaymentStatus={setPlayerPaymentStatus}
          mergeIntoTeam={mergeIntoTeam} splitTeam={splitTeam} users={users} />
      )}

      {subTab === "formatos" && role === "admin" && (
        <FormatosTab categories={categories} activeCat={activeCat} setActiveCatId={setActiveCatId}
          generateDraw={generateDraw} closeGroupsAndSeedBracket={closeGroupsAndSeedBracket}
          removeTeamFromGroup={removeTeamFromGroup} assignTeamToGroupSlot={assignTeamToGroupSlot}
          setCategoryFormat={setCategoryFormat} courts={courts} dates={dates} tournament={tournament}
          matchDuration={matchDuration} breakM={breakM} />
      )}

      {subTab === "inscripcion" && (
        <InscripcionTab categories={categories} addTeam={addTeam} suggestedRanking={suggestedRanking}
          role={role} currentUser={currentUser} users={users} club={club} tournament={tournament} setTab={setTab} />
      )}

      {subTab === "calendario" && (
        <CalendarioTab categories={categories} courts={courts} runScheduler={runScheduler} reflowSchedule={reflowSchedule} role={role}
          scheduleInfo={scheduleInfo} tournament={tournament} dates={dates}
          matchDuration={matchDuration} setMatchDuration={setMatchDuration} breakM={breakM} setBreakM={setBreakM}
          occupiedKeys={occupiedKeys} moveMatch={moveMatch} unlockMatch={unlockMatch} clearDaySchedule={clearDaySchedule} reorderColumn={reorderColumn} />
      )}

      {subTab === "resultados" && (
        <ResultadosTab categories={categories} courts={courts} submitScore={submitScore}
          closeGroupsAndSeedBracket={closeGroupsAndSeedBracket} tournament={tournament} dates={dates}
          moveMatch={moveMatch} markMatchOnCourt={markMatchOnCourt} role={role} />
      )}

      {subTab === "clasificacion" && (
        <ClasificacionTab categories={categories} />
      )}
    </div>
  );
}

// Sidebar de categorías compartida entre Categorías/Participantes/Formatos -- las tres
// pestañas navegan la MISMA `activeCat`/`setActiveCatId` (viven en TorneosSection), así que
// elegir una categoría en una se mantiene elegida al pasar a las otras. `onCreateClick` solo
// se pasa desde Categorías -- es la única pestaña donde se crean categorías nuevas.
// Nivel primero y en negrita, después modalidad + género (v2.42.2) -- ej. "Open Dobles
// Masculino". Distinto del orden en que se GUARDA `cat.name` (makeCategoryName arma
// "Modalidad Género Nivel", ese orden no cambia -- ver comentario ahí); esto arma la etiqueta
// de nuevo a partir de modality/gender/level en cada render, así que aplica igual a
// categorías viejas y nuevas sin tocar ningún dato guardado.
function CategoryLabel({ cat }) {
  const modalityLabel = cat.modality === "individual" ? "Individual" : "Dobles";
  return <><b>{cat.level}</b> {modalityLabel} {GENDER_LABELS[cat.gender]}</>;
}

function CategoryPicker({ categories, activeCat, setActiveCatId, onCreateClick, emptyHint }) {
  return (
    <Card>
      <h3 className="font-bold text-sm mb-3">Categorías</h3>
      <div className="space-y-1.5">
        {categories.map((c) => (
          <button key={c.id} onClick={() => setActiveCatId(c.id)}
            className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 group"
            style={{ background: activeCat?.id === c.id ? "#EAF3E6" : "transparent", color: activeCat?.id === c.id ? COLORS.courtDark : COLORS.ink, fontWeight: activeCat?.id === c.id ? 700 : 500 }}>
            {/* v2.60.0: nada de `truncate` acá -- un nombre largo ("Open Dobles Mixto") se
               cortaba a media palabra en el sidebar angosto y quedaba ilegible. Ahora envuelve
               a la línea siguiente en vez de recortarse; min-w-0 en el span deja que el flex
               item se angoste de verdad (si no, un texto largo empuja el ancho del botón en
               vez de partirse). */}
            <span className="min-w-0">
              <CategoryLabel cat={c} />
              {/* v2.81.2, a pedido del club: de un vistazo en el sidebar, sin entrar a cada
                 categoría, saber cuáles ya tienen draw armado y cuáles no. */}
              {c.drawGenerated && (
                <span className="block text-[10px] font-bold mt-0.5" style={{ color: "#1B7A4C" }}>
                  ✓ Draw listo
                </span>
              )}
            </span>
            <ChevronRight size={14} className="opacity-40 group-hover:opacity-100 shrink-0" />
          </button>
        ))}
        {categories.length === 0 && <p className="text-xs text-gray-400 italic px-1">{emptyHint || "Crea tu primera categoría."}</p>}
      </div>
      {/* Antes era un ícono "+" chiquito arriba a la derecha -- fácil de pasar por alto y
         incómodo de tocar en mobile. Un botón de ancho completo abajo es la misma acción,
         mucho más visible (mismo criterio que "Crear nuevo torneo"/"+ Open Play" en otras
         pestañas -- una acción de crear se ve como botón, no como ícono suelto). */}
      {onCreateClick && (
        <button onClick={onCreateClick} className="w-full mt-3 px-3 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5"
          style={{ background: COLORS.court, color: "#fff" }}>
          <Plus size={16} /> Crear categoría
        </button>
      )}
    </Card>
  );
}

// Solo creación/listado/borrado de categorías -- agregar participantes vive en Participantes,
// definir el formato vive en Formatos (antes las tres cosas estaban mezcladas aquí).
// El panel grande (derecha) quedó desaprovechado desde que Participantes se separó en su
// propia pestaña (v2.10.0) -- antes de ese cambio ahí vivía todo (armar equipos, etc.), acá
// solo quedó un resumen de 3 líneas. En vez de crear en el sidebar angosto (donde el
// formulario completo -- modalidad/género/nivel/cupo -- quedaba apretado), "Crear
// categoría" ahora abre el formulario EN ese panel grande, con espacio de sobra.
function CategoriasTab({ categories, activeCat, setActiveCatId, addCategory, removeCategory, updateCategory, setSubTab }) {
  const [showNew, setShowNew] = useState(categories.length === 0);
  const startCreate = () => setShowNew(true);
  const pickCat = (id) => { setShowNew(false); setActiveCatId(id); };

  // Editar cupo mínimo/máximo de una categoría YA creada (v2.62.0) -- a pedido del club, antes
  // ambos números se fijaban una sola vez al crear y no había forma de ajustarlos después sin
  // borrar y recrear la categoría (lo que hubiera borrado a todos los ya inscritos). Reusa
  // updateCategory (mismo mutador genérico que ya persiste el resto de los campos de una
  // categoría) y CategoryCapacityFields (mismos inputs/unidad que "Nueva categoría", ver ahí).
  const [editingCapacity, setEditingCapacity] = useState(false);
  const [editMax, setEditMax] = useState("");
  const [editMin, setEditMin] = useState("");
  const [savingCapacity, setSavingCapacity] = useState(false);
  useEffect(() => { setEditingCapacity(false); }, [activeCat?.id]);
  const startEditCapacity = () => {
    setEditMax(activeCat.maxTeams ?? "");
    setEditMin(activeCat.minTeams ?? "");
    setEditingCapacity(true);
  };
  const saveCapacity = async () => {
    if (savingCapacity) return;
    setSavingCapacity(true);
    await updateCategory(activeCat.id, (c) => {
      c.maxTeams = editMax === "" ? null : Number(editMax);
      c.minTeams = editMin === "" ? null : Number(editMin);
      return c;
    });
    setSavingCapacity(false);
    setEditingCapacity(false);
  };

  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-5 mt-2">
      <div>
        <CategoryPicker categories={categories} activeCat={showNew ? null : activeCat} setActiveCatId={pickCat} onCreateClick={startCreate} />
      </div>

      <div>
        {showNew ? (
          <NewCategoryForm onCreate={(...args) => { addCategory(...args); setShowNew(false); }} onCancel={() => setShowNew(false)} />
        ) : activeCat ? (
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* v2.67.0: min/máx de duplas (o jugadores, en individual) al lado del nombre,
                   a pedido del club -- antes solo se veía editando el cupo con el lápiz. */}
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="disp text-2xl" style={{ color: COLORS.courtDark }}>{activeCat.name}</h3>
                  {(activeCat.minTeams > 0 || activeCat.maxTeams > 0) && (
                    <span className="text-xs font-semibold" style={{ color: "#9AA6BC" }}>
                      ({activeCat.minTeams > 0 ? `mín ${activeCat.minTeams}` : "sin mín"} – {activeCat.maxTeams > 0 ? `máx ${activeCat.maxTeams}` : "sin máx"} {activeCat.modality === "individual" ? "jugadores" : "duplas"})
                    </span>
                  )}
                </div>
                {/* v2.67.0: "X duplas" contando FILAS era incorrecto si alguna está esperando
                   pareja (1 jugador, no una dupla completa todavía) -- ver countCompleteDuplas.
                   Ahora son dos datos separados y honestos: cuántos JUGADORES hay inscritos en
                   total (cuenta a cualquiera, esperando pareja o no) y, aparte, cuántas duplas
                   ya están COMPLETAS de verdad. En individual el segundo badge no aplica (no
                   hay concepto de "pareja" ahí). */}
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: "#EAEEF5", color: COLORS.ink }}>
                    {activeCat.format ? FORMAT_LABELS[activeCat.format] : "Formato por definir"}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: "#EAEEF5", color: COLORS.ink }}>
                    Jugadores inscritos: {countCategoryPlayers(activeCat.teams)}{categoryMaxPlayers(activeCat) ? `/${categoryMaxPlayers(activeCat)}` : ""}
                  </span>
                  {activeCat.modality !== "individual" && (
                    <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: "#EAEEF5", color: COLORS.ink }}>
                      Duplas conformadas: {countCompleteDuplas(activeCat.teams)}{activeCat.maxTeams ? `/${activeCat.maxTeams}` : ""}
                    </span>
                  )}
                  {activeCat.waitlist.length > 0 && (
                    <span className="text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
                      <Hourglass size={11} /> {activeCat.waitlist.length} en lista de espera
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={startEditCapacity} title="Editar cupo mínimo/máximo" className="text-gray-300 hover:text-gray-600"><Pencil size={16} /></button>
                <button onClick={() => removeCategory(activeCat.id)} title="Borrar categoría" className="text-gray-300 hover:text-red-500"><Trash2 size={18} /></button>
              </div>
            </div>

            {editingCapacity && (
              <div className="mt-5 pt-5 space-y-3" style={{ borderTop: `1px solid ${COLORS.line}` }}>
                <CategoryCapacityFields modality={activeCat.modality} maxTeams={editMax} setMaxTeams={setEditMax} minTeams={editMin} setMinTeams={setEditMin} />
                <div className="flex gap-2">
                  <button onClick={saveCapacity} disabled={savingCapacity} style={{ background: COLORS.court, color: "#fff" }} className="px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-60">
                    {savingCapacity ? "Guardando…" : "Guardar cupo"}
                  </button>
                  <button onClick={() => setEditingCapacity(false)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#EAEEF5", color: COLORS.ink }}>Cancelar</button>
                </div>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3 mt-6">
              <button onClick={() => setSubTab?.("duplas")} className="text-left px-4 py-3.5 rounded-xl transition-opacity hover:opacity-90" style={{ background: "#EAF3E6" }}>
                <p className="font-bold text-sm" style={{ color: COLORS.courtDark }}>Duplas →</p>
                <p className="text-xs mt-0.5" style={{ color: "#6B7688" }}>Arma equipos y revisa quién está inscrito.</p>
              </button>
              <button onClick={() => setSubTab?.("formatos")} className="text-left px-4 py-3.5 rounded-xl transition-opacity hover:opacity-90" style={{ background: "#EAF0F8" }}>
                <p className="font-bold text-sm" style={{ color: COLORS.courtDark }}>Formatos →</p>
                <p className="text-xs mt-0.5" style={{ color: "#6B7688" }}>Define cómo se juega esta categoría.</p>
              </button>
            </div>
          </Card>
        ) : (
          <Card><p className="text-sm text-gray-400">Selecciona o crea una categoría para comenzar.</p></Card>
        )}
      </div>
    </div>
  );
}

// Junta las inscripciones de TODAS las categorías de este torneo en una fila POR PERSONA
// (v2.45.1) -- Duplas ya muestra el pago por equipo/categoría; esto responde "cuánto debe
// Fulano en total, en TODO este torneo, y ya pagó todo o falta algo" sin que el admin tenga
// que sumarlo a mano categoría por categoría. También arma `removalTargets` (v2.50.0): TODAS
// las categorías en las que aparece esta persona (pagadas o no, en equipo o en lista de
// espera), para que InscritosTab pueda borrarla de todas de una -- antes el borrado vivía en
// Duplas, UN equipo/categoría a la vez, así que borrar a alguien de una categoría la dejaba
// intacta en las demás (y seguía apareciendo acá, en Pagos, como si nada -- justo el bug que
// esto resuelve).
//
// Dos estados nada más (Por verificar / Verificado), a pedido del club -- ya no los tres de
// siempre (Por pagar / Pago por verificar / Verificado). "Por pagar" y "Pago por verificar"
// se ven acá como el mismo "Por verificar": la columna "Medio de pago" ya distingue si es
// efectivo (nada que verificar todavía, se cobra en la cancha) o Pago Móvil (verificar que
// llegó) -- MANTENER el estado en 3 valores por debajo evita una migración de los 4 checks de
// Postgres que ya existen (bookings/open_play/class/subscriptions) solo para esta pantalla.
// v2.63.0: "pagado" ya no significa solo "confirmada" -- un Pago Móvil "por verificar" es
// plata que la persona YA mandó de su cuenta, solo falta que el admin confirme que llegó. Antes
// esta fila mostraba "$0,00 pagado" para esos casos, lo cual es falso y confundía (parecía que
// nadie había pagado nada). `paidUsd`/`paidBs` ahora suman todo lo que no sea "pendiente_efectivo"
// (ese sí es plata que de verdad no se ha entregado -- se paga en la cancha). `verifiedUsd`
// se queda con el significado viejo (solo "confirmada") para las tarjetas de arriba, que SÍ
// deben seguir mostrando plata YA confirmada, no lo que falta verificar. `priceBs` es el monto
// en bolívares que ya quedó FIJO al momento del checkout (ver InscripcionTab/JoinTeamModal:
// priceBs = pricePerTeam * bsRate DE ESE MOMENTO) -- sumar eso acá es automáticamente el monto
// fijo pedido, nunca se recalcula con la tasa de hoy.
function buildTournamentParticipants(categories) {
  const byPerson = new Map();
  categories.forEach((cat) => {
    const addFrom = (list, inWaitlist) => list.forEach((team) => {
      (team.players || []).forEach((p, idx) => {
        // Mismo criterio que buildPaymentRows/TeamRegistration: el jugador #0 usa los campos
        // de nivel de equipo; el #2 solo tiene los suyos propios si se unió por su cuenta con
        // el link (joinTeam, v2.44.2) -- si no, comparte el pago de quien creó el equipo.
        const ownPayment = idx > 0 && p.paymentStatus !== undefined;
        const src = ownPayment ? p : team;
        const priceUsd = Number(src.priceUsd) || 0;
        const priceBs = Number(src.priceBs) || 0;
        const paymentMethod = src.paymentMethod;
        const paymentStatus = src.paymentStatus;
        const reference = (src.reference) || "";
        const createdAt = (ownPayment ? p.joinedAt : team.createdAt) || 0;
        // v2.80.3 -- pago parcial (ver recordPartialPayment): si esta categoría puntual tiene un
        // `paidUsd`/`paidBs` explícito guardado (menos del precio total), usar ESO en vez de
        // asumir que ya entró el precio completo solo porque el estatus dejó de ser
        // "pendiente_efectivo" -- el criterio viejo (línea de abajo, `priceUsd`/`priceBs`) sigue
        // aplicando tal cual para cualquier registro que nunca haya pasado por ese flujo.
        const paidAmountUsd = src.paidUsd != null ? Number(src.paidUsd) : priceUsd;
        const paidAmountBs = src.paidBs != null ? Number(src.paidBs) : priceBs;
        const key = p.userId || `name:${p.name.trim().toLowerCase()}`;
        const entry = byPerson.get(key) || {
          key, name: p.name, categories: [], totalUsd: 0, paidUsd: 0, paidBs: 0, verifiedUsd: 0,
          methods: new Set(), references: new Set(), lastAt: 0, verifyTargets: [], removalTargets: [],
        };
        entry.categories.push(cat.name);
        entry.totalUsd += priceUsd;
        if (paymentStatus === "confirmada") entry.verifiedUsd += priceUsd;
        if (paymentStatus !== "pendiente_efectivo") { entry.paidUsd += paidAmountUsd; entry.paidBs += paidAmountBs; }
        if (paymentStatus !== "confirmada") entry.verifyTargets.push(ownPayment ? { kind: "player", catId: cat.id, teamId: team.id, playerIdx: idx } : { kind: "team", catId: cat.id, teamId: team.id });
        entry.removalTargets.push({ catId: cat.id, catName: cat.name, teamId: team.id, playerIdx: idx, inWaitlist });
        if (paymentMethod) entry.methods.add(paymentMethod);
        if (reference.trim()) entry.references.add(reference.trim());
        if (createdAt > entry.lastAt) entry.lastAt = createdAt;
        byPerson.set(key, entry);
      });
    });
    addFrom(cat.teams || [], false);
    addFrom(cat.waitlist || [], true);
  });
  return [...byPerson.values()].sort((a, b) => b.lastAt - a.lastAt);
}

const METHOD_LABELS = { movil: "Pago Móvil", efectivo: "Efectivo" };

// Resumen de qué se borra y qué se conserva al eliminar la cuenta de un usuario (v2.58.0, ver
// UsuariosTab/deleteUserAccount) -- recorre todo lo que puede llevar su userId (categorías de
// cualquier torneo, reservas, inscripciones a Open Play/clase, suscripciones de membresía) y
// separa cada registro en dos grupos según su estado de pago: los que YA tienen el pago
// verificado se PRESERVAN (es plata que de verdad entró al club -- borrarla falsearía los
// totales históricos de Estadísticas), todo lo demás (por pagar, por verificar) se borra de
// verdad. Mismo criterio "confirmada" que usa el resto de la app. Puramente informativo -- solo
// arma los números para el popup de confirmación, no borra nada (eso lo hace deleteUserAccount).
function buildUserDeletionSummary(userId, { categories, bookings, subscriptions, openPlays, classes }) {
  let toDelete = 0, toKeep = 0, toKeepUsd = 0;
  const tally = (verified, usd) => { if (verified) { toKeep++; toKeepUsd += Number(usd) || 0; } else { toDelete++; } };

  categories.forEach((cat) => {
    const scan = (list) => list.forEach((team) => {
      (team.players || []).forEach((p, idx) => {
        if (p.userId !== userId) return;
        const ownPayment = idx > 0 && p.paymentStatus !== undefined;
        tally((ownPayment ? p.paymentStatus : team.paymentStatus) === "confirmada", ownPayment ? p.priceUsd : team.priceUsd);
      });
    });
    scan(cat.teams || []); scan(cat.waitlist || []);
  });
  bookings.forEach((b) => { if (b.userId === userId) tally(b.status === "confirmada", b.priceUsd); });
  subscriptions.forEach((s) => { if (s.userId === userId) tally(s.paymentStatus === "confirmada", s.priceUsd); });
  openPlays.forEach((o) => (o.registrations || []).forEach((r) => { if (r.userId === userId) tally(r.paymentStatus === "confirmada", r.priceUsd); }));
  classes.forEach((c) => (c.registrations || []).forEach((r) => { if (r.userId === userId) tally(r.paymentStatus === "confirmada", r.priceUsd); }));

  return { toDelete, toKeep, toKeepUsd };
}

// Todas las inscripciones de torneo de un usuario que TODAVÍA no tienen el pago verificado --
// lo único que deleteUserAccount debe borrar de `categories` antes de eliminar su cuenta (las
// verificadas se dejan intactas a propósito, ver buildUserDeletionSummary arriba). Mismo shape
// {catId, teamId, playerIdx, inWaitlist} que ya consume removePersonFromCategory (ver
// InscritosTab) -- borrar cada entrada reusa exactamente esa misma lógica ya probada (reajuste
// de precio de las categorías que le quedan a la persona, promoción de lista de espera) en vez
// de duplicarla.
function findUnverifiedCategoryEntries(categories, userId) {
  const out = [];
  categories.forEach((cat) => {
    const scan = (list, inWaitlist) => list.forEach((team) => {
      (team.players || []).forEach((p, idx) => {
        if (p.userId !== userId) return;
        const ownPayment = idx > 0 && p.paymentStatus !== undefined;
        const status = ownPayment ? p.paymentStatus : team.paymentStatus;
        if (status === "confirmada") return;
        out.push({ catId: cat.id, catName: cat.name, teamId: team.id, playerIdx: idx, inWaitlist });
      });
    });
    scan(cat.teams || [], false);
    scan(cat.waitlist || [], true);
  });
  return out;
}

// Últimos 4 caracteres de cada referencia distinta que dejó esta persona (v2.63.0) -- alcanza
// para cruzar contra el comprobante real sin tener que mostrar el número completo. Casi
// siempre es una sola (todas sus categorías del mismo carrito comparten el mismo checkout,
// ver InscripcionTab) -- si hay más de una (categorías pagadas en checkouts separados,
// quizás con métodos distintos) se listan todas.
function referenceHint(entry) {
  if (entry.references.size === 0) return "—";
  return [...entry.references].map((r) => `••${r.slice(-4)}`).join(", ");
}

function InscritosTab({ categories, setTeamPaymentStatus, setPlayerPaymentStatus, removePersonFromCategory, moveSoloRegistration, recordPartialPayment, registrationLog }) {
  const [showLog, setShowLog] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | pending | verificado
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");

  const participants = useMemo(() => buildTournamentParticipants(categories), [categories]);
  // Lista de categorías para el dropdown (v2.63.0) -- las que de verdad tienen algún inscrito,
  // no todas las de `categories` (mostrar una vacía en el filtro no ayuda a nadie), en el mismo
  // orden en que ya aparecen en la pestaña Categorías.
  const categoryOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    categories.forEach((c) => { if (!seen.has(c.name) && (c.teams?.length || c.waitlist?.length)) { seen.add(c.name); out.push(c.name); } });
    return out;
  }, [categories]);

  // Verificar (v2.63.0: ahora con confirmación -- antes un solo click aplicaba el cambio de
  // una, sin aviso; antes de eso, ver removeTarget más abajo, que ya lo pedía para borrar).
  // Mismo patrón que removeTarget: `verifyTarget` es la entrada de la tabla, o null si el
  // diálogo está cerrado.
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const confirmVerify = () => {
    if (!verifyTarget || verifying) return;
    setVerifying(true);
    verifyTarget.verifyTargets.forEach((t) => {
      if (t.kind === "team") setTeamPaymentStatus(t.catId, t.teamId, "confirmada");
      else setPlayerPaymentStatus(t.catId, t.teamId, t.playerIdx, "confirmada");
    });
    setVerifying(false);
    setVerifyTarget(null);
  };

  // Borrar a una persona de TODO el torneo (v2.50.0) -- único lugar del admin para hacerlo,
  // ver TORNEO_SUB_ITEMS. Recorre `removalTargets` (armado en buildTournamentParticipants: una
  // entrada por cada categoría/equipo/lista de espera en la que aparece esta persona, pagada o
  // no) y borra uno por uno, esperando cada resultado antes de seguir -- si alguno falla, se
  // avisa cuál para reintentar sin perder lo que sí se borró.
  const [removeTarget, setRemoveTarget] = useState(null); // entry de la tabla, o null si el diálogo está cerrado
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  const confirmRemove = async () => {
    if (!removeTarget || removing) return;
    setRemoving(true); setRemoveError("");
    for (const t of removeTarget.removalTargets) {
      const result = await removePersonFromCategory(t.catId, t.teamId, t.playerIdx, t.inWaitlist);
      if (result?.error) { setRemoving(false); setRemoveError(`No se pudo borrar de "${t.catName}" -- revisa tu conexión e intenta de nuevo (lo que ya se borró queda borrado).`); return; }
    }
    setRemoving(false);
    setRemoveTarget(null);
  };

  // v2.80.0: "Gestionar categorías" -- borrar de UNA categoría puntual, o cambiar de categoría
  // (ver moveSoloRegistration), a diferencia del trash de arriba que borra de TODO el torneo.
  // Guarda solo la `key` (no el objeto `participants[i]` completo) para que el modal siempre
  // muestre datos frescos -- `participants` se recalcula en cada render de este componente, así
  // que buscar por key acá abajo refleja de una cualquier borrado/cambio que se haga DENTRO del
  // propio modal, sin tener que cerrarlo y volver a abrirlo para ver la lista actualizada.
  const [manageKey, setManageKey] = useState(null);
  const manageEntry = manageKey ? participants.find((p) => p.key === manageKey) || null : null;

  const filtered = participants.filter((e) => {
    if (statusFilter === "pending" && e.verifyTargets.length === 0) return false;
    if (statusFilter === "verificado" && e.verifyTargets.length > 0) return false;
    if (categoryFilter !== "all" && !e.categories.includes(categoryFilter)) return false;
    if (methodFilter !== "all" && !e.methods.has(methodFilter)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return e.name.toLowerCase().includes(q) || e.categories.some((c) => c.toLowerCase().includes(q));
  });

  const pendingCount = participants.filter((e) => e.verifyTargets.length > 0).length;

  // Totales del torneo completo (v2.53.0) -- siempre sobre TODOS los inscritos, sin importar
  // el filtro de estatus/búsqueda activo, para que sean un resumen estable arriba de la tabla
  // en vez de moverse cada vez que alguien busca o filtra. "Monto verificado" usa verifiedUsd
  // (solo "confirmada") a propósito -- sigue siendo plata YA revisada, distinto de paidUsd
  // (confirmada + por verificar) que ahora se muestra por fila, ver buildTournamentParticipants.
  const totalProjected = participants.reduce((s, e) => s + e.totalUsd, 0);
  const totalVerified = participants.reduce((s, e) => s + e.verifiedUsd, 0);
  const totalPendingAmount = participants.reduce((s, e) => s + (e.totalUsd - e.verifiedUsd), 0);

  return (
    <div className="mt-2 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <SectionTitle>
          Inscritos del torneo{pendingCount > 0 && <span className="text-base font-normal ml-2" style={{ color: COLORS.clay }}>· {pendingCount} por revisar</span>}
        </SectionTitle>
        {/* v2.80.6 -- respaldo a prueba de borrones (ver logRegistration/migración
           registration_log): un registro de SOLO AGREGAR, separado de `categories`, de cada
           inscripción apenas ocurre. Nace del incidente Nicolás Merchán/Camila Sangster --
           esto deja comparar "quién se inscribió alguna vez" contra lo que se ve arriba, para
           notar si algo desapareció sin que nadie lo haya borrado a mano. */}
        <button onClick={() => setShowLog((v) => !v)} className="text-xs font-semibold underline" style={{ color: "#6B7688" }}>
          {showLog ? "Ocultar" : "Ver"} historial de inscripciones (respaldo)
        </button>
      </div>

      {showLog && (
        <div className="rounded-xl p-3 max-h-64 overflow-y-auto" style={{ background: "#F5F6F9" }}>
          <p className="text-xs mb-2" style={{ color: "#6B7688" }}>
            Cada inscripción queda anotada aquí apenas ocurre y nunca se sobreescribe -- si alguien de esta lista no aparece arriba, algo se perdió y hay que investigar.
          </p>
          {(registrationLog || []).length === 0 ? (
            <p className="text-xs italic text-gray-400">Sin registros todavía.</p>
          ) : (
            <div className="space-y-1">
              {registrationLog.map((r) => (
                <div key={r.id} className="text-xs flex items-center justify-between gap-2 flex-wrap py-1" style={{ borderBottom: "1px solid #E4E8F0" }}>
                  <span><strong>{r.player_names}</strong> -- {r.category_name}</span>
                  <span style={{ color: "#9AA6BC" }}>{new Date(r.created_at).toLocaleString("es-VE")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Jugadores inscritos" value={participants.length} icon={Users} />
        <StatCard label="Monto proyectado" value={formatMoney(totalProjected)} icon={Euro} />
        <StatCard label="Monto verificado" value={formatMoney(totalVerified)} icon={CheckCircle2} />
        <StatCard label="Por verificar" value={formatMoney(totalPendingAmount)} icon={Hourglass} />
      </div>

      <div className="flex flex-wrap gap-2">
        {[{ v: "all", l: "Todos" }, { v: "pending", l: "Por verificar" }, { v: "verificado", l: "Verificado" }].map((o) => (
          <button key={o.v} onClick={() => setStatusFilter(o.v)} className="px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ background: statusFilter === o.v ? COLORS.court : "#EAEEF5", color: statusFilter === o.v ? "#fff" : COLORS.ink }}>
            {o.l}
          </button>
        ))}
      </div>
      {/* v2.63.0: filtros nuevos, aparte del estatus de arriba -- por categoría y por medio de
         pago, como dropdown en vez de pastillas (demasiadas categorías para eso). */}
      <div className="flex flex-wrap gap-2">
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }} className="text-xs font-semibold">
          <option value="all">Todas las categorías</option>
          {categoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} style={{ ...inputStyle, width: "auto" }} className="text-xs font-semibold">
          <option value="all">Todos los medios de pago</option>
          {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" color="#9AA6BC" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o categoría…" style={{ ...inputStyle, paddingLeft: 38 }} />
      </div>

      <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${COLORS.line}` }}>
        <table className="w-full text-sm" style={{ minWidth: 900 }}>
          <thead>
            <tr className="text-left text-[11px] text-gray-400 uppercase" style={{ background: "#F4F6FA" }}>
              <th className="py-2.5 px-3">#</th>
              <th className="py-2.5 px-3">Nombre y apellido</th>
              <th className="py-2.5 px-3">Categorías</th>
              <th className="py-2.5 px-3">Monto a pagar</th>
              <th className="py-2.5 px-3">Monto pagado</th>
              <th className="py-2.5 px-3">Comprobante</th>
              <th className="py-2.5 px-3">Fecha</th>
              <th className="py-2.5 px-3">Medio de pago</th>
              <th className="py-2.5 px-3">Estatus</th>
              <th className="py-2.5 px-3"></th>
              <th className="py-2.5 px-3"></th>
              <th className="py-2.5 px-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const pending = e.verifyTargets.length > 0;
              const methodLabel = e.methods.size === 0 ? "—" : [...e.methods].map((m) => METHOD_LABELS[m] || m).join(" / ");
              return (
                <tr key={e.key} className="border-t" style={{ borderColor: COLORS.line }}>
                  <td className="py-2.5 px-3 mono text-gray-400">{i + 1}</td>
                  <td className="py-2.5 px-3 font-semibold whitespace-nowrap">{e.name}</td>
                  {/* v2.63.0: title = tooltip nativo del navegador al pasar el mouse, con los
                     nombres de las categorías -- no hace falta un componente de tooltip propio
                     para esto. */}
                  <td className="py-2.5 px-3 text-center" title={e.categories.join(", ")} style={{ cursor: "help" }}>{e.categories.length}</td>
                  <td className="py-2.5 px-3 mono">{formatMoney(e.totalUsd)}</td>
                  <td className="py-2.5 px-3 mono">
                    {formatMoney(e.paidUsd)}
                    {e.paidBs > 0 && <span className="block text-[13px] text-gray-500">≈ {formatMoney(e.paidBs, "Bs. ")}</span>}
                  </td>
                  <td className="py-2.5 px-3 mono text-sm text-gray-700 whitespace-nowrap">{referenceHint(e)}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-gray-500">{e.lastAt ? formatDateHuman(new Date(e.lastAt).toISOString().slice(0, 10)) : "—"}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap text-gray-500">{methodLabel}</td>
                  <td className="py-2.5 px-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap" style={{ background: pending ? "#FBF3E4" : "#DCEBD5", color: pending ? "#8A5A16" : COLORS.courtDark }}>
                      {pending ? "Por verificar" : "Verificado"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    {pending && (
                      <button onClick={() => setVerifyTarget(e)} className="px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap" style={{ background: COLORS.court, color: "#fff" }}>
                        Verificar
                      </button>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <button onClick={() => setManageKey(e.key)} title="Gestionar sus categorías (quitar de una puntual, o cambiarla)" className="text-gray-300 hover:text-blue-600"><Settings2 size={14} /></button>
                  </td>
                  <td className="py-2.5 px-3">
                    <button onClick={() => setRemoveTarget(e)} title="Eliminar de todo el torneo" className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-sm text-gray-400 italic py-6 text-center">Nadie coincide con este filtro.</p>}
      </div>

      {verifyTarget && (
        <ConfirmDeleteModal
          title={`¿Confirmar el pago de ${verifyTarget.name}?`}
          message={`Se marca como verificado ${verifyTarget.verifyTargets.length === 1 ? "lo que le falta" : `las ${verifyTarget.verifyTargets.length} categorías`} por confirmar -- ${formatMoney(verifyTarget.totalUsd - verifyTarget.verifiedUsd)}. Revisa el comprobante (${referenceHint(verifyTarget)}) antes de confirmar.`}
          options={[{ label: verifying ? "Confirmando…" : "Verificar pago", variant: "danger", onClick: confirmVerify }]}
          onCancel={() => setVerifyTarget(null)} />
      )}

      {removeTarget && (
        <ConfirmDeleteModal
          title={`¿Eliminar a ${removeTarget.name} de este torneo?`}
          message={removeError || `Se le borra de ${removeTarget.categories.length === 1 ? "su única categoría" : "sus " + removeTarget.categories.length + " categorías"}: ${removeTarget.categories.join(", ")}.${removeTarget.verifiedUsd > 0 ? ` ⚠ Incluye ${formatMoney(removeTarget.verifiedUsd)} YA VERIFICADOS que se pierden sin dejar rastro.` : ""} Esta acción no se puede deshacer.`}
          options={[{ label: removing ? "Eliminando…" : "Eliminar", variant: "danger", onClick: confirmRemove }]}
          onCancel={() => { setRemoveTarget(null); setRemoveError(""); }} />
      )}

      {manageEntry && (
        <ManageCategoriesModal entry={manageEntry} categories={categories}
          removePersonFromCategory={removePersonFromCategory} moveSoloRegistration={moveSoloRegistration}
          setTeamPaymentStatus={setTeamPaymentStatus} setPlayerPaymentStatus={setPlayerPaymentStatus} recordPartialPayment={recordPartialPayment}
          onClose={() => setManageKey(null)} />
      )}
    </div>
  );
}

// "Gestionar categorías" (v2.80.0) -- acciones más finas que el trash de arriba (que borra a la
// persona de TODO el torneo de una): quitarla de UNA categoría puntual, o cambiarla de
// categoría si todavía está esperando pareja (moveSoloRegistration ya rechaza el intento si la
// dupla ya está completa -- el mensaje de error de la propia función se muestra tal cual). Cada
// fila de `entry.removalTargets` es una categoría/equipo distinto; los dos sub-formularios
// (mover / quitar) son mutuamente excluyentes y viven expandidos DEBAJO de su propia fila, no en
// un modal aparte, para no apilar confirmaciones una encima de otra.
function ManageCategoriesModal({ entry, categories, removePersonFromCategory, moveSoloRegistration, setTeamPaymentStatus, setPlayerPaymentStatus, recordPartialPayment, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmIdx, setConfirmIdx] = useState(null);
  const [moveIdx, setMoveIdx] = useState(null);
  const [moveToCatId, setMoveToCatId] = useState("");
  const [verifyIdx, setVerifyIdx] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payBs, setPayBs] = useState("");
  const [payMethod, setPayMethod] = useState("movil");
  const [payRef, setPayRef] = useState("");

  const teamFor = (t) => {
    const cat = categories.find((c) => c.id === t.catId);
    if (!cat) return null;
    return [...(cat.teams || []), ...(cat.waitlist || [])].find((team) => team.id === t.teamId) || null;
  };
  const isSolo = (t) => (teamFor(t)?.players?.length || 0) === 1;
  // v2.80.1 -- ver incidente: quitar a alguien de una categoría con pago YA VERIFICADO
  // borraba ese pago (monto, referencia, comprobante) sin ningún aviso, junto con el resto
  // del equipo. `paymentFor` calcula el monto/estatus real de ESTE jugador puntual (mismo
  // criterio "ownPayment" que buildTournamentParticipants: el jugador #0 usa los campos del
  // equipo, uno que se unió después por su cuenta con joinTeam tiene los suyos propios) para
  // poder advertir ANTES de borrar, no descubrirlo después como pasó con Flor Monttalti. La
  // misma función arma "Verificar este pago" (v2.80.2): el botón "Verificar" de Inscritos
  // confirma TODO lo pendiente de la persona de una (ver confirmVerify) -- si tiene dos
  // categorías con estados reales distintos (una transferencia de verdad, otra efectivo que
  // todavía no llega), ese botón confirmaría las dos juntas por error. Acá se puede verificar
  // una categoría puntual sin tocar las demás.
  const paymentFor = (t) => {
    const team = teamFor(t);
    if (!team) return null;
    const player = team.players?.[t.playerIdx];
    const ownPayment = t.playerIdx > 0 && player?.paymentStatus !== undefined;
    const src = ownPayment ? player : team;
    const priceUsd = Number(src.priceUsd) || 0;
    // v2.80.4 -- si ya se guardó un pago parcial antes (recordPartialPayment), `paidUsd` es lo
    // que DE VERDAD entró; si nunca se tocó este registro, no hay forma de saber si el precio
    // completo llegó a pagarse de verdad -- se muestra el precio como referencia, pero ver el
    // aviso en el formulario (v2.80.4) para no repetir el error de asumirlo sin más.
    return {
      ownPayment,
      paymentStatus: src.paymentStatus,
      priceUsd,
      paidUsd: src.paidUsd != null ? Number(src.paidUsd) : priceUsd,
      paidBs: src.paidBs != null ? Number(src.paidBs) : null,
      paymentMethod: src.paymentMethod,
      reference: src.reference || "",
      hasExplicitPaid: src.paidUsd != null,
    };
  };
  // v2.80.3 -- "Verificar este pago" deja editar el MONTO antes de guardar (no siempre es el
  // precio completo, ver recordPartialPayment/caso Flor Monttalti: pagó $15 de una categoría de
  // $20). v2.80.4 -- ya NO se esconde una vez "confirmada": el botón grande "Verificar" de la
  // tabla de Inscritos (confirmVerify, fuera de este modal) sigue existiendo y confirma el
  // precio COMPLETO sin preguntar el monto -- si alguien lo usa por error en vez de este
  // formulario (pasó de verdad con Flor: quedó "confirmada" $20 en efectivo sin que ella hubiera
  // pagado eso), acá tiene que poder CORREGIRLO, no solo registrar un pago nuevo. Por eso el
  // botón pasa a llamarse "Editar pago" cuando ya hay algo guardado, precarga lo que haya (el
  // monto ya pagado si existe, si no el precio completo tal como venía) y deja guardar de nuevo
  // -- recordPartialPayment sobreescribe el estatus según el monto que se guarde ahora, así que
  // corrige un "confirmada" equivocado igual que registraría uno nuevo.
  const openVerify = (t, idx) => {
    const pay = paymentFor(t);
    setConfirmIdx(null); setMoveIdx(null); setError("");
    if (verifyIdx === idx) { setVerifyIdx(null); return; }
    setVerifyIdx(idx);
    setPayAmount(pay ? String(pay.paidUsd) : "");
    setPayBs(pay && pay.paidBs != null ? String(pay.paidBs) : "");
    setPayMethod((pay && pay.paymentMethod) || "movil");
    setPayRef((pay && pay.reference) || "");
  };
  const doVerify = async (t) => {
    if (!payAmount || Number(payAmount) <= 0) { setError("Ingresa el monto que de verdad pagó."); return; }
    setBusy(true); setError("");
    const result = await recordPartialPayment(t.catId, t.teamId, t.playerIdx, {
      paidUsd: Number(payAmount), paidBs: Number(payBs) || 0, paymentMethod: payMethod, reference: payRef,
    });
    setBusy(false);
    if (result?.error) { setError(result.error); return; }
    setVerifyIdx(null);
  };
  const destOptions = (t) => {
    const originCat = categories.find((c) => c.id === t.catId);
    // No se ofrece una categoría donde ya está inscrita -- moveSoloRegistration la rechaza
    // igual, esto evita que el admin la elija para nada y se tope con ese error después.
    return categories.filter((c) => c.tournamentId === originCat?.tournamentId && c.id !== t.catId && !entry.categories.includes(c.name));
  };

  const doRemove = async (t) => {
    setBusy(true); setError("");
    const result = await removePersonFromCategory(t.catId, t.teamId, t.playerIdx, t.inWaitlist);
    setBusy(false);
    if (result?.error) { setError(result.error); return; }
    setConfirmIdx(null);
  };
  const doMove = async (t) => {
    if (!moveToCatId) return;
    setBusy(true); setError("");
    const result = await moveSoloRegistration(t.catId, t.teamId, moveToCatId);
    setBusy(false);
    if (result?.error) { setError(result.error); return; }
    setMoveIdx(null); setMoveToCatId("");
  };

  return (
    <Modal onClose={onClose} maxWidth={540}>
      <div className="p-5">
        <p className="font-bold text-sm" style={{ color: COLORS.courtDark }}>Categorías de {entry.name}</p>
        <p className="text-xs mt-1 mb-4" style={{ color: "#6B7688" }}>Quítala de una categoría puntual, o cámbiala de categoría si todavía está esperando pareja.</p>
        {error && <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "#FCE9E4", color: "#B23A1B" }}>{error}</p>}
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {entry.removalTargets.map((t, idx) => {
            const pay = paymentFor(t);
            return (
            <div key={`${t.catId}_${t.teamId}_${t.playerIdx}`} className="rounded-lg p-3" style={{ background: "#F5F6F9" }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold">{t.catName}{t.inWaitlist ? " (lista de espera)" : ""}</span>
                <div className="flex items-center gap-3 shrink-0">
                  {pay && (
                    <button onClick={() => openVerify(t, idx)} disabled={busy}
                      className="text-xs font-semibold underline" style={{ color: "#1B7A4C" }}>
                      {pay.paymentStatus === "confirmada" ? "Editar este pago" : "Verificar este pago"}
                    </button>
                  )}
                  {isSolo(t) && (
                    <button onClick={() => { setMoveIdx(moveIdx === idx ? null : idx); setConfirmIdx(null); setVerifyIdx(null); setError(""); }} disabled={busy}
                      className="text-xs font-semibold underline" style={{ color: COLORS.court }}>
                      Cambiar de categoría
                    </button>
                  )}
                  <button onClick={() => { setConfirmIdx(confirmIdx === idx ? null : idx); setMoveIdx(null); setVerifyIdx(null); setError(""); }} disabled={busy}
                    className="text-xs font-semibold underline" style={{ color: COLORS.clay }}>
                    Quitar de esta categoría
                  </button>
                </div>
              </div>
              {verifyIdx === idx && pay && (
                <div className="mt-2.5 p-2.5 rounded-lg space-y-2" style={{ background: "#EAF5EE" }}>
                  <p className="text-xs" style={{ color: "#1B7A4C" }}>
                    Precio de esta categoría: {formatMoney(pay.priceUsd)}{pay.paymentStatus === "confirmada" ? " -- YA está marcada verificada; corrige el monto de abajo si no es el correcto." : ""}. Escribe el monto que DE VERDAD pagó (puede ser menos que el precio) -- si no cubre el precio completo, se queda "por verificar"; si lo cubre, queda verificada.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div>
                      <Label>Monto pagado (USD)</Label>
                      <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} style={{ ...inputStyle, width: 110 }} className="text-xs" />
                    </div>
                    <div>
                      <Label>Monto pagado (Bs, opcional)</Label>
                      <input type="number" step="0.01" value={payBs} onChange={(e) => setPayBs(e.target.value)} placeholder="—" style={{ ...inputStyle, width: 120 }} className="text-xs" />
                    </div>
                    <div>
                      <Label>Medio</Label>
                      <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={{ ...inputStyle, width: "auto" }} className="text-xs">
                        <option value="movil">Pago Móvil</option>
                        <option value="efectivo">Efectivo</option>
                      </select>
                    </div>
                    <div>
                      <Label>Referencia</Label>
                      <input type="text" value={payRef} onChange={(e) => setPayRef(e.target.value)} style={{ ...inputStyle, width: 110 }} className="text-xs" />
                    </div>
                  </div>
                  <button onClick={() => doVerify(t)} disabled={busy} style={{ background: "#1B7A4C", color: "#fff", opacity: busy ? 0.6 : 1 }} className="px-3 py-1.5 rounded-lg text-xs font-bold">
                    {busy ? "Guardando…" : "Guardar pago"}
                  </button>
                </div>
              )}
              {moveIdx === idx && (
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <select value={moveToCatId} onChange={(ev) => setMoveToCatId(ev.target.value)} style={{ ...inputStyle, width: "auto" }} className="text-xs">
                    <option value="">Elige la categoría correcta…</option>
                    {destOptions(t).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button onClick={() => doMove(t)} disabled={busy || !moveToCatId}
                    style={{ background: COLORS.court, color: "#fff", opacity: (busy || !moveToCatId) ? 0.5 : 1 }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold">
                    {busy ? "Moviendo…" : "Confirmar"}
                  </button>
                </div>
              )}
              {confirmIdx === idx && (() => {
                const pay = paymentFor(t);
                const isVerified = pay?.paymentStatus === "confirmada";
                return (
                  <div className="mt-2.5 flex flex-col gap-2">
                    {isVerified && (
                      <p className="text-xs font-bold px-2.5 py-2 rounded-lg" style={{ background: "#FCE9E4", color: "#B23A1B" }}>
                        ⚠ Esta categoría tiene un pago YA VERIFICADO de {formatMoney(pay.priceUsd)} -- al quitarla, ese pago se borra sin dejar rastro (no se puede recuperar). Solo continúa si el reembolso o el cambio ya está resuelto por fuera.
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs" style={{ color: "#6B7688" }}>¿Seguro que quieres quitarla de "{t.catName}"?</span>
                      <button onClick={() => doRemove(t)} disabled={busy} style={{ background: COLORS.clay, color: "#fff" }} className="px-3 py-1.5 rounded-lg text-xs font-bold">
                        {busy ? "Quitando…" : isVerified ? "Sí, quitar y perder el pago verificado" : "Sí, quitar"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
            );
          })}
          {entry.removalTargets.length === 0 && <p className="text-xs text-gray-400 italic">Ya no está en ninguna categoría de este torneo.</p>}
        </div>
        <button onClick={onClose} className="w-full mt-4 py-2 rounded-xl font-semibold text-sm" style={{ color: "#6B7688" }}>Cerrar</button>
      </div>
    </Modal>
  );
}

// Arma equipos y revisa quién está inscrito -- de solo lectura desde v2.50.0 (ya no borra, ver
// comentario en TORNEO_SUB_ITEMS): el borrado vive únicamente en Inscritos.
function DuplasTab({ categories, activeCat, setActiveCatId, addTeam, suggestedRanking, upsertPlayerRanking, setTeamPaymentStatus, setPlayerPaymentStatus, mergeIntoTeam, splitTeam, users }) {
  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-5 mt-2">
      <CategoryPicker categories={categories} activeCat={activeCat} setActiveCatId={setActiveCatId}
        emptyHint="Crea una categoría primero en la pestaña Categorías." />
      <div>
        {activeCat ? (
          <TeamRegistration cat={activeCat} addTeam={addTeam}
            suggestedRanking={suggestedRanking} upsertPlayerRanking={upsertPlayerRanking} setTeamPaymentStatus={setTeamPaymentStatus}
            setPlayerPaymentStatus={setPlayerPaymentStatus} mergeIntoTeam={mergeIntoTeam} splitTeam={splitTeam} users={users} />
        ) : (
          <Card><p className="text-sm text-gray-400">Selecciona una categoría para ver o agregar sus duplas.</p></Card>
        )}
      </div>
    </div>
  );
}

// Formato de competencia por categoría -- recomendación (FormatAdvisor) mientras no tiene
// formato, luego armar/ver el draw (DrawSetup/DrawPreview). Antes vivía mezclado dentro de
// Categorías; misma lógica, solo movida a su propia pestaña.
function FormatosTab({ categories, activeCat, setActiveCatId, generateDraw, closeGroupsAndSeedBracket, removeTeamFromGroup, assignTeamToGroupSlot, setCategoryFormat, courts, dates, tournament, matchDuration, breakM }) {
  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-5 mt-2">
      <CategoryPicker categories={categories} activeCat={activeCat} setActiveCatId={setActiveCatId}
        emptyHint="Crea una categoría primero en la pestaña Categorías." />
      <div>
        {activeCat ? (
          <div className="space-y-5">
            {!activeCat.format ? (
              <FormatAdvisor cat={activeCat} categories={categories} courts={courts} dates={dates} tournament={tournament}
                matchDuration={matchDuration} breakM={breakM} onSelect={(f) => setCategoryFormat(activeCat.id, f)} />
            ) : (
              <>
                <DrawSetup cat={activeCat} generateDraw={generateDraw} onChangeFormat={() => setCategoryFormat(activeCat.id, null)} />
                {activeCat.drawGenerated && <DrawPreview cat={activeCat} closeGroupsAndSeedBracket={closeGroupsAndSeedBracket} removeTeamFromGroup={removeTeamFromGroup} assignTeamToGroupSlot={assignTeamToGroupSlot} />}
              </>
            )}
          </div>
        ) : (
          <Card><p className="text-sm text-gray-400">Selecciona una categoría para definir su formato.</p></Card>
        )}
      </div>
    </div>
  );
}

/* Segmented control used across the category-creation wizard. An option can carry
   `disabled: true` (e.g. "Mixto" once la modalidad es Individual, ver NewCategoryForm) --
   se ve atenuada y no dispara onChange, en vez de dejar armar una combinación inválida. */
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={o.disabled} onClick={() => !o.disabled && onChange(o.value)}
          className="px-3.5 py-2 rounded-xl text-sm font-semibold transition-all disabled:cursor-not-allowed"
          style={{
            background: value === o.value ? COLORS.court : "#EAEEF5",
            color: value === o.value ? COLORS.chalk : (o.disabled ? "#B7BFCE" : COLORS.ink),
            opacity: o.disabled ? 0.6 : 1,
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Campos de cupo mínimo/máximo compartidos entre "Nueva categoría" y "Editar cupo" (v2.62.0) --
// misma unidad que categoryMaxPlayers (duplas en dobles, jugadores en individual, ver su
// comentario) y mismo texto de ayuda en los dos lados para no explicarlo dos veces distinto.
// El mínimo es solo de referencia -- no bloquea ninguna inscripción, es para que el admin sepa
// cuántas hacen falta para que la categoría se juegue (no hay ninguna lógica automática todavía
// que la cancele/avise si no llega).
function CategoryCapacityFields({ modality, maxTeams, setMaxTeams, minTeams, setMinTeams }) {
  const unit = modality === "individual" ? "jugadores" : "duplas";
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <Label>Cupo mínimo de {unit} (opcional)</Label>
          <input type="number" min={0} style={inputStyle} value={minTeams} onChange={(e) => setMinTeams(e.target.value)} placeholder="Sin mínimo" />
        </div>
        <div>
          <Label>Cupo máximo de {unit} (opcional)</Label>
          <input type="number" min={modality === "individual" ? 1 : 2} style={inputStyle} value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} placeholder="Sin límite" />
        </div>
      </div>
      <p className="text-xs -mt-3" style={{ color: "#6B7688" }}>
        {modality === "individual"
          ? "Cada cupo es para 1 jugador."
          : `Cada cupo es para 1 dupla (2 jugadores)${maxTeams ? ` -- ${maxTeams} duplas = ${Number(maxTeams) * 2} jugadores en total` : ""}.`}
        {" "}Al llenarse el máximo, los siguientes inscritos entran a una lista de espera y suben automáticamente si alguien se retira.
        {minTeams ? ` El mínimo es solo de referencia -- no bloquea inscripciones.` : ""}
      </p>
    </>
  );
}

function NewCategoryForm({ onCreate, onCancel }) {
  const [modality, setModality] = useState("dobles");
  const [gender, setGender] = useState("mixto");
  const [level, setLevel] = useState(LEVEL_OPTIONS[2]);
  const [maxTeams, setMaxTeams] = useState("");
  const [minTeams, setMinTeams] = useState("");
  const previewName = makeCategoryName(modality, gender, level);

  // "Mixto" es un género de pareja (un hombre + una mujer por equipo) -- no existe en
  // Individual, donde cada jugador compite solo. Cambiar a Individual con "Mixto" ya
  // elegido lo corrige solo a Masculino en vez de dejar armar esa combinación inválida.
  const changeModality = (m) => {
    setModality(m);
    if (m === "individual" && gender === "mixto") setGender("masculino");
  };

  return (
    <Card>
      <SectionTitle sub="Elige modalidad, género y nivel -- el nombre se arma solo con esos tres datos.">Nueva categoría</SectionTitle>
      <div className="space-y-5 max-w-xl">
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <Label>1. Modalidad</Label>
            <Segmented value={modality} onChange={changeModality}
              options={[{ value: "individual", label: "Individual" }, { value: "dobles", label: "Dobles" }]} />
          </div>
          <div>
            <Label>2. Género</Label>
            <Segmented value={gender} onChange={setGender}
              options={[{ value: "masculino", label: "Masculino" }, { value: "femenino", label: "Femenino" }, { value: "mixto", label: "Mixto", disabled: modality === "individual" }, { value: "libre", label: "Libre" }]} />
            {gender === "libre" && (
              <p className="text-xs text-gray-400 mt-1.5">Sin restricción de género -- duplas masculinas, femeninas y mixtas compiten todas juntas en esta misma categoría.</p>
            )}
          </div>
        </div>
        <div>
          <Label>3. Nivel de habilidad</Label>
          <select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <CategoryCapacityFields modality={modality} maxTeams={maxTeams} setMaxTeams={setMaxTeams} minTeams={minTeams} setMinTeams={setMinTeams} />

        <div className="text-sm px-4 py-3 rounded-xl" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
          Nombre automático: <b>{previewName}</b>
        </div>
        <p className="text-xs" style={{ color: "#6B7688" }}>El formato del torneo se elige más adelante, una vez que sepas cuántos equipos se inscribieron — la app te dará una recomendación.</p>
        <div className="flex gap-2 pt-1">
          <button onClick={() => onCreate(modality, gender, level, maxTeams, minTeams)}
            style={{ background: COLORS.court, color: COLORS.chalk }}
            className="px-6 py-2.5 rounded-xl font-bold text-sm">Crear categoría</button>
          <button onClick={onCancel} className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#EAEEF5", color: COLORS.ink }}>Cancelar</button>
        </div>
      </div>
    </Card>
  );
}


/* Player-name field para el roster del organizador (TeamRegistration) -- el ranking se sigue
   calculando solo, de una (suggestedRanking, sin campo ni botón para editarlo, v2.42.3), pero
   ya NO se muestra un recuadro aparte por cada jugador mientras se escribe (v2.65.0, a pedido
   del club: ese "Ranking: Sin historial (0)" repetido dos veces era puro ruido visual en este
   formulario -- el ranking sigue viéndose una vez guardado el equipo, junto al nombre en la
   lista de abajo). */
function PlayerField({ label, name, setName }) {
  return (
    <div>
      <Label>{label}</Label>
      <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
    </div>
  );
}

// Sigue creando equipos (walk-ins anotados a mano) y mostrando el estado de pago, pero ya NO
// borra a nadie (v2.50.0) -- ni equipo ni lista de espera; el borrado se centralizó en
// Inscritos (InscritosTab), por PERSONA y de una vez en todas sus categorías, no por equipo
// suelto acá. Ver el comentario en TORNEO_SUB_ITEMS para el porqué.
function TeamRegistration({ cat, addTeam, suggestedRanking, mergeIntoTeam, splitTeam, users }) {
  const isDoubles = cat.modality !== "individual";
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [error, setError] = useState("");
  const full = categoryIsFull(cat); // v2.57.0 -- cupo real en jugadores, no en filas (ver categoryIsFull)

  // Ahora espera el resultado real de addTeam (v2.44.4) -- antes disparaba y limpiaba los
  // campos de una, sin chequear si el guardado en Supabase de verdad llegó a pasar.
  const submit = async () => {
    if (!p1.trim()) return;
    if (isDoubles && !p2.trim()) return;
    setError("");
    const players = [{ name: p1.trim(), ranking: suggestedRanking(p1) || 0 }];
    if (isDoubles) players.push({ name: p2.trim(), ranking: suggestedRanking(p2) || 0 });
    const result = await addTeam(cat.id, players);
    if (result?.error) { setError("No se pudo guardar -- revisa tu conexión e intenta de nuevo."); return; }
    setP1(""); setP2("");
  };

  // Emparejar a mano dos inscripciones sueltas "esperando pareja" (v2.66.0) -- ver el
  // comentario de mergeIntoTeam en el componente principal para el porqué. `pairTarget` es la
  // pareja elegida (o null si el popup de confirmación está cerrado); `compatiblePartners`
  // descarta como opción a cualquiera del mismo género en categorías mixtas (mismo criterio de
  // "si no se conoce el género, no se filtra" que ya usa el resto de la app) -- mergeIntoTeam
  // vuelve a chequear esto igual del lado del guardado, esto es solo para no mostrar una opción
  // que de todos modos va a fallar.
  const compatiblePartners = (t) => {
    const candidates = (cat.teams || []).filter((o) => o.id !== t.id && (o.players || []).length === 1);
    if (cat.gender !== "mixto") return candidates;
    const myGender = users?.find((u) => u.id === t.players[0]?.userId)?.gender;
    if (!myGender) return candidates;
    return candidates.filter((o) => {
      const otherGender = users?.find((u) => u.id === o.players[0]?.userId)?.gender;
      return !otherGender || otherGender !== myGender;
    });
  };
  const [pairTarget, setPairTarget] = useState(null); // { catId, targetId, targetName, sourceId, sourceName }
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState("");
  const confirmPair = async () => {
    if (!pairTarget || pairing) return;
    setPairing(true); setPairError("");
    const result = await mergeIntoTeam(pairTarget.catId, pairTarget.targetId, pairTarget.sourceId);
    setPairing(false);
    if (result?.error) { setPairError(result.error); return; }
    setPairTarget(null);
  };

  // Desemparejar -- inverso de "Emparejar con...", ver splitTeam en el componente principal
  // para el porqué y las condiciones (solo si el segundo jugador tiene su propio pago
  // guardado). `splitTarget` es la dupla a separar (o null si el popup está cerrado).
  const [splitTarget, setSplitTarget] = useState(null); // { catId, teamId, name1, name2 }
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState("");
  const confirmSplit = async () => {
    if (!splitTarget || splitting) return;
    setSplitting(true); setSplitError("");
    const result = await splitTeam(splitTarget.catId, splitTarget.teamId);
    setSplitting(false);
    if (result?.error) { setSplitError(result.error); return; }
    setSplitTarget(null);
  };

  return (
    <Card>
      {/* v2.65.0: nombre de la categoría chiquito arriba del título -- antes, con varias
         categorías del mismo nivel/modalidad abiertas a la vez, "Duplas inscritas" a secas no
         dejaba claro cuál se estaba viendo sin mirar el sidebar de al lado. */}
      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#9AA6BC" }}>{cat.name}</p>
      <SectionTitle sub="El nombre del equipo se arma solo con los nombres de los jugadores. El ranking sale automático del historial de la app.">
        {isDoubles ? "Duplas inscritas" : "Jugadores inscritos"} {cat.maxTeams ? `-- ${categoryCountLabel(cat)}` : ""}
      </SectionTitle>

      <div className={`grid gap-2 items-start mb-4 ${isDoubles ? "md:grid-cols-[1fr_1fr_auto]" : "md:grid-cols-[1fr_auto]"}`}>
        <PlayerField label={isDoubles ? "Jugador 1" : "Jugador"} name={p1} setName={setP1} />
        {isDoubles && <PlayerField label="Jugador 2" name={p2} setName={setP2} />}
        <button onClick={submit} style={{ background: COLORS.court, color: COLORS.chalk }} className="px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-1 h-[38px] self-end">
          <Plus size={16} /> {full ? "Añadir (espera)" : "Añadir"}
        </button>
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
          <AlertTriangle size={12} className="shrink-0" /> {error}
        </div>
      )}

      {full && (
        <div className="text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
          <Hourglass size={12} /> Cupo lleno — los nuevos equipos entran a la lista de espera y suben automáticamente si alguien se retira.
        </div>
      )}

      <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
        {(cat.teams || []).map((t) => {
          // "Esperando pareja" (v2.44.2) -- un equipo de dobles (ver InscripcionTab/
          // JoinTeamModal, ya no se elige pareja al inscribirse desde v2.51.0) arranca siempre
          // con un solo jugador; el segundo llega más tarde por su propio link, pagando su
          // propia inscripción por separado -- ese pago vive en `players[1].paymentStatus`,
          // NUNCA en `t.paymentStatus` (eso sigue siendo solo lo que pagó quien creó el
          // equipo). Mientras falte, se muestra un aviso en vez de fingir que hay un segundo
          // jugador con nombre "—".
          const isDoublesTeam = cat.modality !== "individual";
          const waitingPartner = isDoublesTeam && (t.players || []).length < 2;
          // v2.65.0: sin la línea de detalle de pago (método/fecha/monto/referencia) debajo de
          // cada dupla -- a pedido del club, era puro ruido visual acá; para revisar un pago de
          // verdad sigue estando Inscritos/Pagos, con más contexto. Alcanza con saber de un
          // vistazo quién falta: el nombre de quien todavía no tiene el pago confirmado se
          // pinta en rojo, el de quien sí en el color normal -- cada jugador puede tener su
          // PROPIO estado (players[1] con pago propio, ver comentario arriba); si no, comparte
          // el de t.paymentStatus (equipo completo anotado a mano, o el titular del equipo).
          const statusFor = (p, idx) => (idx === 1 && p.paymentStatus !== undefined ? p.paymentStatus : t.paymentStatus);
          return (
            <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm flex-wrap" style={{ background: "#EEF1F7" }}>
              <div className="min-w-0">
                {(t.players || []).map((p, idx) => (
                  <span key={idx} className="font-semibold" style={{ color: statusFor(p, idx) === "confirmada" ? COLORS.ink : COLORS.clay }}>
                    {idx > 0 ? " · " : ""}{p.name} ({p.ranking || 0})
                  </span>
                ))}
                {waitingPartner && (
                  <span className="text-[10px] font-bold ml-2 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
                    <Hourglass size={9} /> Esperando pareja
                  </span>
                )}
                {waitingPartner && mergeIntoTeam && compatiblePartners(t).length > 0 && (
                  <select value="" onChange={(e) => {
                    const source = compatiblePartners(t).find((o) => o.id === e.target.value);
                    if (source) setPairTarget({ catId: cat.id, targetId: t.id, targetName: t.players[0].name, sourceId: source.id, sourceName: source.players[0].name });
                  }} className="ml-2 text-[11px] font-semibold rounded-full pl-2 pr-1 py-0.5" style={{ background: "#EAF0F8", color: COLORS.courtDark, border: "none" }}>
                    <option value="">Emparejar con…</option>
                    {compatiblePartners(t).map((o) => <option key={o.id} value={o.id}>{o.players[0].name}</option>)}
                  </select>
                )}
                {/* v2.66.1: inverso de "Emparejar con..." -- solo si el segundo jugador tiene
                   pago propio guardado (ver splitTeam), si no no hay nada que separar de
                   verdad. */}
                {splitTeam && (t.players || []).length === 2 && t.players[1]?.paymentStatus !== undefined && (
                  <button onClick={() => setSplitTarget({ catId: cat.id, teamId: t.id, name1: t.players[0].name, name2: t.players[1].name })}
                    className="ml-2 text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ background: "#FBEAE3", color: COLORS.clay, border: "none" }}>
                    Desemparejar
                  </button>
                )}
              </div>
              <span className="mono text-xs px-2 py-0.5 rounded-full shrink-0" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>Σ {teamRankSum(t)}</span>
            </div>
          );
        })}
        {(cat.teams || []).length === 0 && <p className="text-xs text-gray-400 italic">Sin equipos todavía.</p>}
      </div>
      <p className="text-[11px] mt-2" style={{ color: "#9AA6BC" }}>
        <span style={{ color: COLORS.clay }}>●</span> Rojo = pago sin confirmar todavía. Para verificarlo o cambiar su estado, ve a Inscritos o Pagos.
      </p>

      {(cat.waitlist || []).length > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: COLORS.line }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: "#8A5A16" }}>
            <Hourglass size={12} /> Lista de espera ({cat.waitlist.length})
          </p>
          <div className="space-y-1.5">
            {(cat.waitlist || []).map((t, i) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "#FBF3E4" }}>
                <span><span className="mono text-xs mr-2" style={{ color: "#8A5A16" }}>#{i + 1}</span>{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {pairTarget && (
        <ConfirmDeleteModal
          title={`¿Emparejar a ${pairTarget.targetName} con ${pairTarget.sourceName}?`}
          message={pairError || "Quedan como una sola dupla -- cada quien conserva su propio pago, no se toca nada de lo que ya pagaron. Si te equivocas, puedes deshacerlo después con \"Desemparejar\"."}
          options={[{ label: pairing ? "Emparejando…" : "Emparejar", variant: "danger", onClick: confirmPair }]}
          onCancel={() => { setPairTarget(null); setPairError(""); }} />
      )}

      {splitTarget && (
        <ConfirmDeleteModal
          title={`¿Separar a ${splitTarget.name1} de ${splitTarget.name2}?`}
          message={splitError || `Vuelven a quedar como dos inscripciones sueltas, cada uno "esperando pareja" -- ninguno pierde su pago.`}
          options={[{ label: splitting ? "Separando…" : "Desemparejar", variant: "danger", onClick: confirmSplit }]}
          onCancel={() => { setSplitTarget(null); setSplitError(""); }} />
      )}
    </Card>
  );
}

function FormatAdvisor({ cat, categories, courts, dates, tournament, matchDuration, breakM, onSelect }) {
  const n = cat.teams.length;
  const rec = n >= 2 ? recommendFormat(cat, categories, courts, dates, tournament, matchDuration, breakM) : null;

  const CANDIDATES = [
    { format: "eliminatoria", label: "Eliminación directa", desc: "Cada partido elimina. La opción más rápida cuando hay poco tiempo." },
    { format: "doble_eliminacion", label: "Doble Eliminación", desc: "Da una segunda oportunidad: repechaje hasta el 3er lugar." },
    { format: "grupos", label: "Fase de grupos", desc: "Todos juegan varios partidos garantizados, sin playoff final." },
    { format: "grupos_eliminatoria", label: "Grupos + Eliminatoria", desc: "El más equilibrado: fase de grupos y luego cuadro final." },
    { format: "liga", label: "Liga (todos contra todos)", desc: "La más justa, pero exige muchos partidos — solo con poco tiempo o pocos equipos." },
  ];

  return (
    <Card>
      <SectionTitle sub="La app recomienda un formato según los equipos inscritos, el tiempo disponible en el calendario y el nivel de esta categoría frente a las demás del torneo.">
        ¿Qué formato usar en {cat.name}?
      </SectionTitle>

      {n < 2 ? (
        <p className="text-sm text-gray-400">Registra al menos 2 equipos en esta categoría para recibir una recomendación de formato.</p>
      ) : (
        <>
          <div className="rounded-xl p-4 mb-4" style={{ background: COLORS.courtDark }}>
            <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "#93A8C9" }}>Recomendación</p>
            <p className="disp text-lg" style={{ color: COLORS.ball }}>{FORMAT_LABELS[rec.format]}</p>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: "#D6E1F0" }}>
              Con {n} equipos inscritos, el calendario configurado da para ≈{Math.round(rec.capacity)} partidos en todo el torneo
              {rec.othersDemand > 0 ? `, de los cuales ≈${Math.round(rec.othersDemand)} ya están comprometidos por otras categorías` : ""}.
              Nivel de esta categoría: <b>{cat.level}</b> — a mayor nivel, más prioridad recibe sobre el tiempo disponible frente a categorías de nivel más bajo.
              Este formato necesita ≈{rec.matches} partidos, dentro del margen disponible para {cat.name}.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-2.5">
            {CANDIDATES.map((c) => {
              const est = estimateMatches(c.format, n);
              const isRec = rec.format === c.format;
              const fitsBudget = est <= Math.max(1, rec.capacity - rec.othersDemand);
              return (
                <button key={c.format} onClick={() => onSelect(c.format)} type="button"
                  className="text-left p-3 rounded-xl relative"
                  style={{ border: `2px solid ${isRec ? COLORS.ball : COLORS.line}`, background: isRec ? "#FFF1E4" : "#fff" }}>
                  {isRec && (
                    <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: COLORS.ball, color: COLORS.courtDark }}>
                      SUGERIDO
                    </span>
                  )}
                  <p className="text-sm font-bold pr-16" style={{ color: COLORS.courtDark }}>{c.label}</p>
                  <p className="text-xs mt-1" style={{ color: "#6B7688" }}>{c.desc}</p>
                  <p className="text-[10px] mt-2" style={{ color: fitsBudget ? COLORS.court : "#B23A1B" }}>
                    ≈ {est} partido(s) {!fitsBudget && "· exige más tiempo del disponible"}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      )}

      {n >= 2 && (
        <p className="text-xs mt-4" style={{ color: "#6B7688" }}>También puedes elegir cualquier formato manualmente arriba — la recomendación es solo un punto de partida.</p>
      )}
    </Card>
  );
}

function DrawSetup({ cat, generateDraw, onChangeFormat }) {
  const [seedMode, setSeedMode] = useState("ranking");
  const [bestOf, setBestOf] = useState(3);
  const [bracketSize, setBracketSize] = useState(4);
  const [numGroups, setNumGroups] = useState(2);
  // v2.81.6, a pedido del club: una vez que el draw ya está armado, esta tarjeta de
  // configuración (sembrado/sets/tamaño de cuadro/vista previa) ocupaba media pantalla antes de
  // llegar al draw en sí -- normalmente ya no hace falta tocarla. Colapsada por default apenas
  // hay draw, con un link "Editar formato" para volver a abrirla si hace falta regenerar. Se
  // reinicia al cambiar de categoría (efecto de abajo) y se vuelve a colapsar sola justo
  // después de generar/regenerar (ver el onClick del botón, más abajo).
  const [expanded, setExpanded] = useState(!cat.drawGenerated);
  useEffect(() => { setExpanded(!cat.drawGenerated); }, [cat.id]);

  const teamCount = cat.teams.length;
  const preview = cat.format === "grupos_eliminatoria" && teamCount >= 2
    ? computeGroupDistribution(teamCount, nextPow2(Number(bracketSize)))
    : null;

  const canGenerate =
    (cat.format === "eliminatoria" && teamCount >= 2) ||
    (cat.format === "doble_eliminacion" && teamCount >= 2) ||
    (cat.format === "liga" && teamCount >= 2) ||
    (cat.format === "grupos" && teamCount >= Number(numGroups) * 2) ||
    (cat.format === "grupos_eliminatoria" && teamCount >= nextPow2(Number(bracketSize)));

  return (
    <Card>
      <div className="flex items-center justify-between" style={{ marginBottom: expanded ? 4 : 0 }}>
        <SectionTitle sub={expanded ? "Define cómo se sembrarán los equipos y arma el draw de esta categoría." : undefined}>
          Configurar draw · {FORMAT_LABELS[cat.format]}
        </SectionTitle>
        <div className="flex items-center gap-3 shrink-0">
          {cat.drawGenerated && (
            <button onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold" style={{ color: COLORS.court }}>
              {expanded ? "Ocultar" : "Editar formato"}
            </button>
          )}
          <button onClick={onChangeFormat} className="text-xs font-semibold" style={{ color: COLORS.clay }}>Cambiar formato</button>
        </div>
      </div>
      {expanded && (
      <>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label>Modo de sembrado</Label>
          <div className="flex gap-2">
            <button onClick={() => setSeedMode("ranking")} className="flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
              style={{ background: seedMode === "ranking" ? COLORS.court : "#EAEEF5", color: seedMode === "ranking" ? COLORS.chalk : COLORS.ink }}>
              <ArrowUpDown size={14} /> Por ranking
            </button>
            <button onClick={() => setSeedMode("random")} className="flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
              style={{ background: seedMode === "random" ? COLORS.court : "#EAEEF5", color: seedMode === "random" ? COLORS.chalk : COLORS.ink }}>
              <Shuffle size={14} /> Aleatorio
            </button>
          </div>
        </div>
        <div>
          <Label>Sets por partido (mejor de)</Label>
          <select style={inputStyle} value={bestOf} onChange={(e) => setBestOf(Number(e.target.value))}>
            <option value={1}>1 set</option>
            <option value={3}>3 sets</option>
            <option value={5}>5 sets</option>
          </select>
        </div>

        {cat.format === "grupos_eliminatoria" && (
          <div className="md:col-span-2">
            <Label>¿Con cuántos equipos quieres empezar la eliminatoria?</Label>
            <select style={inputStyle} value={bracketSize} onChange={(e) => setBracketSize(e.target.value)}>
              {[2, 4, 8, 16, 32].map((n) => <option key={n} value={n}>{n} equipos</option>)}
            </select>
            {preview && (
              <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: "#EAF0F8" }}>
                <p className="font-semibold mb-1" style={{ color: COLORS.courtDark }}>
                  Con {teamCount} equipos inscritos, la app formará automáticamente:
                </p>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {preview.map((g, i) => (
                    <span key={i} className="px-2 py-1 rounded-lg" style={{ background: "#FFF", border: `1px solid ${COLORS.line}` }}>
                      Grupo {String.fromCharCode(65 + i)}: {g.size} equipos → clasifican {g.qualifiers}
                    </span>
                  ))}
                </div>
                <p className="text-gray-500 mt-2">Total clasificados a eliminatoria: {preview.reduce((s, g) => s + g.qualifiers, 0)} de {nextPow2(Number(bracketSize))} deseados.</p>
              </div>
            )}
          </div>
        )}

        {cat.format === "grupos" && (
          <div>
            <Label>Cantidad de grupos</Label>
            <input type="number" min={1} style={inputStyle} value={numGroups} onChange={(e) => setNumGroups(e.target.value)} />
          </div>
        )}

        {cat.format === "doble_eliminacion" && (
          <div className="md:col-span-2 text-xs px-3 py-2.5 rounded-xl" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
            Llave A (ganadores): eliminación directa — solo un equipo invicto puede ser campeón.
            Llave B (repechaje): recibe a cada equipo que pierde en la Llave A y juega únicamente para definir el 3er lugar; quien pierde en la Llave B queda eliminado.
          </div>
        )}
      </div>

      <button
        disabled={!canGenerate}
        onClick={() => { generateDraw(cat.id, { seedMode, bestOf, bracketSize: nextPow2(Number(bracketSize)), numGroups }); setExpanded(false); }}
        style={{ background: canGenerate ? COLORS.clay : "#E5E5E5", color: canGenerate ? "#fff" : "#999" }}
        className="mt-5 px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2">
        <Swords size={16} /> {cat.drawGenerated ? "Regenerar draw" : "Generar draw"}
      </button>
      {!canGenerate && <p className="text-xs text-red-400 mt-2">Necesitas más equipos inscritos para este formato/tamaño de cuadro.</p>}
      </>
      )}
    </Card>
  );
}

// v2.81.0 -- editar la composición de un grupo YA generado (quitar una dupla dejando el cupo
// vacío, o llenar un cupo vacío con una dupla sin grupo). Ver removeTeamFromGroup/
// assignTeamToGroupSlot en el componente principal para qué pasa con los partidos al hacerlo.
// Solo mientras el grupo sigue abierto (`!cat.groupsClosed`) -- una vez cerrado, la eliminatoria
// ya se armó a partir de esas posiciones, cambiar quién jugó ya no tiene sentido ahí.
function DrawPreview({ cat, closeGroupsAndSeedBracket, removeTeamFromGroup, assignTeamToGroupSlot }) {
  const teamName = (id) => cat.teams.find((t) => t.id === id)?.name || "?";
  const isDouble = cat.format === "doble_eliminacion";
  const canEditGroups = !cat.groupsClosed && cat.groups.length > 0;
  const [confirmRemove, setConfirmRemove] = useState(null); // { groupId, teamId } | null
  const [pickSlot, setPickSlot] = useState(null); // { groupId, slotIndex } | null
  const [pickTeamId, setPickTeamId] = useState("");

  // Duplas de la categoría que no están en NINGÚN grupo todavía (recién quedaron sin cupo por
  // "Quitar", o nunca se les asignó uno) -- estas son las candidatas para llenar un hueco vacío.
  const assignedIds = new Set(cat.groups.flatMap((g) => g.teamIds.filter(Boolean)));
  const unassignedTeams = cat.teams.filter((t) => !assignedIds.has(t.id));

  // Si algún partido de este grupo con esta dupla YA tiene marcador cargado, avisar que se
  // pierde ese resultado -- removeTeamFromGroup los borra sin más.
  const hasResult = (groupId, teamId) => cat.matches.some((m) => m.groupId === groupId && (m.teamAId === teamId || m.teamBId === teamId) && m.winnerId);

  const doRemove = (groupId, teamId) => { removeTeamFromGroup(cat.id, groupId, teamId); setConfirmRemove(null); };
  const doAssign = (groupId, slotIndex) => {
    if (!pickTeamId) return;
    assignTeamToGroupSlot(cat.id, groupId, slotIndex, pickTeamId);
    setPickSlot(null); setPickTeamId("");
  };

  return (
    <Card>
      {/* v2.81.6, a pedido del club: se ve de un vistazo a cuántos sets se juega esta
         categoría, sin tener que abrir "Editar formato" para revisarlo. */}
      <SectionTitle sub={cat.bestOf ? `Mejor de ${cat.bestOf} set${cat.bestOf === 1 ? "" : "s"} por partido.` : undefined}>
        Draw generado
      </SectionTitle>
      {cat.groups.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          {cat.groups.map((g) => (
            <div key={g.id} className="rounded-xl p-3" style={{ background: "#EEF1F7" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">{g.name}</span>
                <span className="text-xs text-gray-500">clasifican {g.qualifiers}</span>
              </div>
              <ul className="text-sm space-y-1">
                {g.teamIds.map((tid, idx) => {
                  if (tid) {
                    const removing = confirmRemove?.groupId === g.id && confirmRemove?.teamId === tid;
                    return (
                      <li key={`${g.id}_${idx}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span>• {teamName(tid)}</span>
                          {canEditGroups && (
                            <button onClick={() => { setConfirmRemove(removing ? null : { groupId: g.id, teamId: tid }); setPickSlot(null); }}
                              className="text-[11px] font-semibold underline shrink-0" style={{ color: COLORS.clay }}>
                              Quitar
                            </button>
                          )}
                        </div>
                        {removing && (
                          <div className="mt-1 mb-1.5 p-2 rounded-lg text-[11px]" style={{ background: "#FCE9E4", color: "#B23A1B" }}>
                            {hasResult(g.id, tid) && <p className="font-bold mb-1">⚠ Ya hay un resultado cargado con esta dupla en este grupo -- se pierde al quitarla.</p>}
                            <p className="mb-1.5">El cupo queda vacío para asignar otra dupla. ¿Seguro?</p>
                            <button onClick={() => doRemove(g.id, tid)} className="px-2.5 py-1 rounded-lg font-bold" style={{ background: COLORS.clay, color: "#fff" }}>Sí, quitar</button>
                          </div>
                        )}
                      </li>
                    );
                  }
                  // Cupo vacío -- clic para elegir una dupla sin grupo asignado.
                  const picking = pickSlot?.groupId === g.id && pickSlot?.slotIndex === idx;
                  return (
                    <li key={`${g.id}_${idx}`}>
                      <button onClick={() => { setPickSlot(picking ? null : { groupId: g.id, slotIndex: idx }); setPickTeamId(""); setConfirmRemove(null); }}
                        className="italic text-left w-full" style={{ color: canEditGroups ? COLORS.court : "#9AA6BC" }} disabled={!canEditGroups}>
                        • — cupo vacío {canEditGroups && "(clic para asignar)"} —
                      </button>
                      {picking && (
                        <div className="mt-1 mb-1.5 p-2 rounded-lg flex items-center gap-2 flex-wrap" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
                          {unassignedTeams.length === 0 ? (
                            <span className="text-[11px] text-gray-400 italic">No hay ninguna dupla sin grupo asignado en esta categoría.</span>
                          ) : (
                            <>
                              <select value={pickTeamId} onChange={(e) => setPickTeamId(e.target.value)} style={{ ...inputStyle, width: "auto" }} className="text-xs">
                                <option value="">Elige una dupla…</option>
                                {unassignedTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                              <button onClick={() => doAssign(g.id, idx)} disabled={!pickTeamId}
                                style={{ background: COLORS.court, color: "#fff", opacity: pickTeamId ? 1 : 0.5 }} className="px-2.5 py-1 rounded-lg text-xs font-bold">
                                Asignar
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {cat.format === "grupos_eliminatoria" && !cat.groupsClosed && (() => {
        // v2.81.0 -- un cupo vacío (ver removeTeamFromGroup) no se puede editar más una vez
        // cerrada la fase (canEditGroups se apaga con groupsClosed) -- si se cierra con un
        // hueco sin llenar, quedaría atascado para siempre como "Por definir" en la
        // eliminatoria. Mejor bloquear el cierre hasta que todos los cupos estén asignados.
        const hasEmptySlot = cat.groups.some((g) => g.teamIds.some((tid) => !tid));
        return (
          <>
            <button onClick={() => closeGroupsAndSeedBracket(cat.id)} disabled={hasEmptySlot}
              style={{ background: hasEmptySlot ? "#E5E5E5" : COLORS.court, color: hasEmptySlot ? "#999" : COLORS.chalk }}
              className="mb-2 px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5">
              <CheckCircle2 size={15} /> Cerrar fase de grupos y armar eliminatoria
            </button>
            {hasEmptySlot && <p className="text-xs mb-5" style={{ color: COLORS.clay }}>Hay un cupo vacío sin asignar -- llénalo arriba antes de cerrar la fase de grupos.</p>}
            <p className="text-xs text-amber-600 mb-5">Carga primero todos los resultados de grupos en la pestaña "Resultados" y luego cierra la fase para definir el cuadro final.</p>
          </>
        );
      })()}

      {isDouble && <DoubleEliminationView cat={cat} />}
      {!isDouble && cat.matches.some((m) => m.phase === "bracket") && <BracketView cat={cat} teamName={teamName} />}
    </Card>
  );
}

function roundLabel(rn, total) {
  const remaining = total - rn + 1;
  if (remaining === 1) return "Final";
  if (remaining === 2) return "Semifinal";
  if (remaining === 3) return "Cuartos de final";
  return `Ronda ${rn}`;
}

function MatchCard({ m, highlight }) {
  return (
    <div className="rounded-lg p-2.5 text-xs" style={{ border: `1px solid ${COLORS.line}`, background: m.winnerId ? "#EEF1F7" : "#fff" }}>
      <div className={`flex justify-between px-1.5 py-1 rounded ${m.winnerId === m.teamAId ? "font-bold" : ""}`} style={{ background: m.winnerId === m.teamAId ? (highlight || "#DCEBD5") : "transparent" }}>
        <span>{m.teamALabel || "Por definir"}</span>
      </div>
      <div className={`flex justify-between px-1.5 py-1 rounded mt-0.5 ${m.winnerId === m.teamBId ? "font-bold" : ""}`} style={{ background: m.winnerId === m.teamBId ? (highlight || "#DCEBD5") : "transparent" }}>
        <span>{m.teamBLabel || "Por definir"}</span>
      </div>
    </div>
  );
}

function BracketView({ cat }) {
  const rounds = {};
  cat.matches.filter((m) => m.phase === "bracket").forEach((m) => { (rounds[m.round] = rounds[m.round] || []).push(m); });
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {roundNums.map((rn) => (
        <div key={rn} className="min-w-[210px] flex flex-col gap-3 justify-center">
          <p className="text-xs font-bold text-center uppercase" style={{ color: COLORS.court }}>{roundLabel(rn, roundNums.length)}</p>
          {rounds[rn].map((m) => <MatchCard key={m.id} m={m} />)}
        </div>
      ))}
    </div>
  );
}

function DoubleEliminationView({ cat }) {
  const wrByRound = {}, lbByRound = {};
  cat.matches.forEach((m) => {
    if (m.phase === "bracket_wr") (wrByRound[m.round] = wrByRound[m.round] || []).push(m);
    if (m.phase === "bracket_lb") (lbByRound[m.round] = lbByRound[m.round] || []).push(m);
  });
  const wrRounds = Object.keys(wrByRound).map(Number).sort((a, b) => a - b);
  const lbRounds = Object.keys(lbByRound).map(Number).sort((a, b) => a - b);
  const podium = computePodium(cat);

  return (
    <div className="space-y-6">
      {(podium.first || podium.third) && (
        <div className="rounded-2xl p-4 flex flex-wrap gap-4" style={{ background: COLORS.courtDark }}>
          {podium.first && <PodiumSlot place={1} label={podium.first} />}
          {podium.second && <PodiumSlot place={2} label={podium.second} />}
          {podium.third && <PodiumSlot place={3} label={podium.third} />}
          {podium.fourth && <PodiumSlot place={4} label={podium.fourth} />}
        </div>
      )}

      <div>
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: COLORS.court }}>Llave A · Ganadores (define 1° y 2°)</p>
        <div className="flex gap-4 overflow-x-auto pb-2">
          {wrRounds.map((rn) => (
            <div key={rn} className="min-w-[210px] flex flex-col gap-3 justify-center">
              <p className="text-[10px] text-center uppercase" style={{ color: "#6B7688" }}>{roundLabel(rn, wrRounds.length)}</p>
              {wrByRound[rn].map((m) => <MatchCard key={m.id} m={m} />)}
            </div>
          ))}
        </div>
      </div>

      {lbRounds.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: COLORS.clay }}>Llave B · Repechaje (define 3er lugar)</p>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {lbRounds.map((rn) => (
              <div key={rn} className="min-w-[210px] flex flex-col gap-3 justify-center">
                <p className="text-[10px] text-center uppercase" style={{ color: "#6B7688" }}>Ronda B{rn}</p>
                {lbByRound[rn].map((m) => <MatchCard key={m.id} m={m} highlight="#FBE3D6" />)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PodiumSlot({ place, label }) {
  const colors = { 1: COLORS.ball, 2: "#C7D0DE", 3: COLORS.clay, 4: "#4E6180" };
  const titles = { 1: "Campeón", 2: "2° lugar", 3: "3er lugar", 4: "4° lugar" };
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: colors[place] }}>
        {place === 1 ? <Trophy size={16} color={COLORS.courtDark} /> : <Medal size={15} color={COLORS.courtDark} />}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide" style={{ color: "#A9C0DC" }}>{titles[place]}</p>
        <p className="text-sm font-bold" style={{ color: COLORS.chalk }}>{label}</p>
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: CALENDARIO
   ========================================================================= */
// v2.69.0: rediseño completo de Calendario -- reemplaza el asistente modal de una sola vez
// (SchedulerWizardModal, retirado) por un tablero "cancha por cancha" (una columna por
// cancha, así se ve de un vistazo si algo choca) más un panel "Planificar" siempre visible
// que arma el `plan` de buildSchedule para UN día a la vez: categorías + rondas (fase de
// grupos, cuartos, semis, final...) + canchas + orden. Cada partido que Planificar ubica
// queda `locked` (ver buildSchedule/plan.lockAfterSchedule) -- planificar el domingo nunca
// reordena lo que ya se dejó listo el sábado. "Editar manualmente" (tap-origen → tap-destino)
// se conserva igual que antes, solo que ahora se dispara desde una tarjeta del tablero.
function PlanificarPanel({ categories, tournamentCourts, selectedDay, tournament, matchDuration, breakM, occupiedKeys, runScheduler, clearDaySchedule, catColorMap }) {
  const catsWithDraw = categories.filter((c) => c.drawGenerated);
  const [catIds, setCatIds] = useState([]); // orden de selección = orden para "Por categoría completa"
  const [roundKeys, setRoundKeys] = useState({}); // { [catId]: Set(roundKey) }
  const [courtIds, setCourtIds] = useState(() => tournamentCourts.map((c) => c.id));
  // v2.81.5, a pedido del club: hora de inicio propia por cancha para esta corrida puntual --
  // ej. arrancar con 2 canchas a las 9am y sumar las otras 2 a las 10am. Vacío/sin tocar =
  // usa la hora general del torneo (tournament.dailyStart), como siempre.
  const [courtStartTimes, setCourtStartTimes] = useState({});
  const setCourtStart = (courtId, value) => setCourtStartTimes((prev) => ({ ...prev, [courtId]: value }));
  const [mode, setMode] = useState("mixed");
  const [reschedule, setReschedule] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const toggleCat = (cat) => {
    setCatIds((prev) => {
      if (prev.includes(cat.id)) {
        setRoundKeys((rk) => { const next = { ...rk }; delete next[cat.id]; return next; });
        return prev.filter((id) => id !== cat.id);
      }
      // Al marcar una categoría se le prenden TODAS sus rondas de una -- lo más común es
      // planificar la categoría entera; quien quiera solo una ronda puntual la desmarca acá.
      setRoundKeys((rk) => ({ ...rk, [cat.id]: new Set(roundOptionsForCategory(cat).map((o) => o.key)) }));
      return [...prev, cat.id];
    });
  };
  const toggleRound = (catId, key) => {
    setRoundKeys((rk) => {
      const cur = new Set(rk[catId] || []);
      cur.has(key) ? cur.delete(key) : cur.add(key);
      return { ...rk, [catId]: cur };
    });
  };
  const toggleCourt = (id) => setCourtIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const moveCat = (idx, dir) => {
    setCatIds((prev) => {
      const next = [...prev]; const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const plan = useMemo(() => ({
    mode, categoryOrder: catIds, categoryIds: catIds, roundKeys, courtIds, reschedule, lockAfterSchedule: true, courtStartTimes,
  }), [mode, catIds, roundKeys, courtIds, reschedule, courtStartTimes]);

  const scheduleCourts = courtIds.length ? tournamentCourts.filter((c) => courtIds.includes(c.id)) : tournamentCourts;
  const preview = useMemo(
    () => selectedDay && catIds.length
      ? previewSchedule(categories, scheduleCourts, [selectedDay], tournament.dailyStart, tournament.dailyEnd, matchDuration, breakM, occupiedKeys, plan)
      : { queued: 0, scheduled: 0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, selectedDay, matchDuration, breakM, occupiedKeys, plan]
  );
  const alreadyPlanned = useMemo(() => {
    if (!catIds.length) return 0;
    let n = 0;
    categories.forEach((c) => {
      if (!catIds.includes(c.id)) return;
      c.matches.forEach((m) => { if (m.locked && m.day === selectedDay && roundSetHas(roundKeys[c.id], roundKeyOf(m))) n++; });
    });
    return n;
  }, [categories, catIds, roundKeys, selectedDay]);
  const handlePlanificar = () => {
    if (!selectedDay || preview.queued === 0) return;
    runScheduler(plan, [selectedDay]);
  };

  return (
    <Card>
      <SectionTitle sub="Arma el horario de un día a la vez: elige categorías, qué rondas de cada una y con qué canchas. Lo que quede planificado no se toca al planificar otro día.">Planificar</SectionTitle>

      <div className="mt-3">
        <Label>Categorías</Label>
        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
          {catsWithDraw.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg cursor-pointer" style={{ background: catIds.includes(c.id) ? "#EAF0F8" : "transparent" }}>
              <input type="checkbox" checked={catIds.includes(c.id)} onChange={() => toggleCat(c)} />
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: (catColorMap[c.id] || CATEGORY_PALETTE[0]).text }}></span>
              {c.name}
            </label>
          ))}
          {catsWithDraw.length === 0 && <p className="text-xs text-gray-400">Ninguna categoría tiene draw generado todavía (pestaña Formatos).</p>}
        </div>
      </div>

      {catIds.length > 0 && (
        <div className="mt-3">
          <Label>Rondas</Label>
          <div className="max-h-48 overflow-y-auto space-y-2.5 pr-1">
            {catIds.map((catId) => {
              const cat = catsWithDraw.find((c) => c.id === catId);
              if (!cat) return null;
              const opts = roundOptionsForCategory(cat);
              return (
                <div key={catId}>
                  {catIds.length > 1 && <p className="text-[11px] font-bold mb-1" style={{ color: COLORS.courtDark }}>{cat.name}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {opts.map((o) => {
                      const active = roundKeys[catId]?.has(o.key);
                      return (
                        <button key={o.key} type="button" onClick={() => toggleRound(catId, o.key)}
                          className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
                          style={{ background: active ? COLORS.court : "#EAEEF5", color: active ? "#fff" : COLORS.ink }}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3">
        <Label>Canchas</Label>
        <div className="flex flex-wrap gap-1.5">
          {tournamentCourts.map((c) => (
            <button key={c.id} type="button" onClick={() => toggleCourt(c.id)}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={{ background: courtIds.includes(c.id) ? COLORS.court : "#EAEEF5", color: courtIds.includes(c.id) ? "#fff" : COLORS.ink }}>
              {c.name}
            </button>
          ))}
        </div>
        {/* v2.81.5, a pedido del club: hora de inicio propia por cancha para esta corrida --
           ej. 2 canchas desde las 9am, las otras 2 se suman a las 10am. Solo se muestra el
           input para canchas ya elegidas arriba; vacío = usa la hora general del torneo. */}
        {courtIds.length > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-[11px]" style={{ color: "#9AA6BC" }}>Hora de inicio por cancha (opcional -- vacío usa {formatTimeAmPm(tournament.dailyStart)})</p>
            {tournamentCourts.filter((c) => courtIds.includes(c.id)).map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="text-[11px] w-16 shrink-0">{c.name}</span>
                <input type="time" value={courtStartTimes[c.id] || ""} onChange={(e) => setCourtStart(c.id, e.target.value)}
                  style={{ ...inputStyle, padding: "4px 8px", width: "auto" }} className="text-xs" />
                {courtStartTimes[c.id] && (
                  <button type="button" onClick={() => setCourtStart(c.id, "")} className="text-[11px] underline" style={{ color: "#9AA6BC" }}>quitar</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {catIds.length > 1 && (
        <div className="mt-3">
          <Label>¿Simultáneas o una primero que otra?</Label>
          <div className="flex gap-1.5 mb-2">
            <button type="button" onClick={() => setMode("mixed")} className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{ background: mode === "mixed" ? COLORS.court : "#EAEEF5", color: mode === "mixed" ? "#fff" : COLORS.ink }}>Simultáneas (mezcladas)</button>
            <button type="button" onClick={() => setMode("byCategory")} className="flex-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
              style={{ background: mode === "byCategory" ? COLORS.court : "#EAEEF5", color: mode === "byCategory" ? "#fff" : COLORS.ink }}>Una, luego la otra</button>
          </div>
          {mode === "byCategory" && (
            <div className="space-y-1">
              {catIds.map((id, idx) => {
                const cat = catsWithDraw.find((c) => c.id === id);
                return (
                  <div key={id} className="flex items-center justify-between px-2 py-1 rounded-lg text-xs" style={{ background: "#F5F6F9" }}>
                    <span>{idx + 1}. {cat?.name}</span>
                    <div className="flex gap-0.5">
                      <button type="button" disabled={idx === 0} onClick={() => moveCat(idx, -1)} className="p-0.5 rounded disabled:opacity-30" style={{ color: COLORS.court }}><ChevronUp size={14} /></button>
                      <button type="button" disabled={idx === catIds.length - 1} onClick={() => moveCat(idx, 1)} className="p-0.5 rounded disabled:opacity-30" style={{ color: COLORS.court }}><ChevronDown size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {alreadyPlanned > 0 && (
        <label className="flex items-start gap-2 text-xs mt-3 px-2.5 py-2 rounded-lg cursor-pointer" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
          <input type="checkbox" checked={reschedule} onChange={(e) => setReschedule(e.target.checked)} className="mt-0.5" />
          <span>{alreadyPlanned} partido(s) de esta selección ya tienen horario ese día. Volver a mezclarlos en vez de dejarlos como están.</span>
        </label>
      )}

      <button onClick={handlePlanificar} disabled={!selectedDay || preview.queued === 0}
        style={{ background: COLORS.clay, color: "#fff", opacity: (!selectedDay || preview.queued === 0) ? 0.5 : 1 }}
        className="w-full mt-4 px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2">
        <Clock size={16} /> {preview.scheduled}/{preview.queued} Planificar
      </button>

      {confirmClear ? (
        <div className="mt-2 text-xs px-3 py-2.5 rounded-lg" style={{ background: "#FCE9E4", color: "#B23A1B" }}>
          <p className="font-semibold mb-2">¿Vaciar TODO el horario de {selectedDay ? formatDateHuman(selectedDay) : "este día"}? Incluye lo fijado a mano.</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmClear(false)} className="px-3 py-1.5 rounded-lg font-semibold" style={{ background: "#fff" }}>Cancelar</button>
            <button onClick={() => { clearDaySchedule(selectedDay); setConfirmClear(false); }} className="px-3 py-1.5 rounded-lg font-bold" style={{ background: "#B23A1B", color: "#fff" }}>Sí, vaciar</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmClear(true)} disabled={!selectedDay}
          className="w-full mt-2 px-4 py-2 rounded-xl font-semibold text-xs" style={{ background: "#EAEEF5", color: COLORS.ink }}>
          Limpiar este día
        </button>
      )}
    </Card>
  );
}

// v2.81.8, a pedido del club: antes esto guardaba en la base con CADA tecla que se escribía en
// los inputs (setMatchDuration/setBreakM llaman a updateTournament directo) -- valores a medio
// escribir (ej. borrar "35" para escribir "40" pasa por un "" o un "4" intermedio) se
// guardaban de verdad un instante, visibles para cualquier otro dispositivo mirando en ese
// momento. Ahora hay un borrador local que no se guarda solo -- "Guardar duración" lo aplica
// de una (deshabilitado si no hay ningún cambio pendiente), y "Reprogramar horarios ya
// agendados" (aparte, con su propia confirmación) es quien de verdad retoca los partidos ya
// puestos en el tablero -- ver reflowSchedule en el componente principal para qué hace y qué
// NO toca. El borrador se resetea solo si se cambia de torneo (tournamentId), nunca porque
// matchDuration/breakM cambien por su cuenta (evita perder lo que el admin esté escribiendo).
function DuracionPartidosCard({ matchDuration, setMatchDuration, breakM, setBreakM, reflowSchedule, tournamentId }) {
  const [draftDuration, setDraftDuration] = useState(matchDuration);
  const [draftBreak, setDraftBreak] = useState(breakM);
  useEffect(() => { setDraftDuration(matchDuration); setDraftBreak(breakM); }, [tournamentId]);
  const isDirty = Number(draftDuration) !== Number(matchDuration) || Number(draftBreak) !== Number(breakM);
  const [confirmReflow, setConfirmReflow] = useState(false);
  const [reflowing, setReflowing] = useState(false);
  const doReflow = async () => {
    setReflowing(true);
    await reflowSchedule();
    setReflowing(false);
    setConfirmReflow(false);
  };
  return (
    <Card>
      <SectionTitle sub="Duración de cada partido e intervalo entre partidos. Puedes ajustarlos antes o después de planificar.">Duración de partidos</SectionTitle>
      <div className="grid sm:grid-cols-3 gap-3 items-end">
        <div>
          <Label>Duración aproximada por partido (min)</Label>
          <input type="number" min={10} style={inputStyle} value={draftDuration} onChange={(e) => setDraftDuration(e.target.value)} />
        </div>
        <div>
          <Label>Intervalo entre partidos (min)</Label>
          <input type="number" min={0} style={inputStyle} value={draftBreak} onChange={(e) => setDraftBreak(e.target.value)} />
        </div>
        <div className="text-xs px-3 py-2.5 rounded-lg h-fit" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
          Cada franja por cancha: {Number(draftDuration) + Number(draftBreak)} min
        </div>
      </div>
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <button onClick={() => { setMatchDuration(draftDuration); setBreakM(draftBreak); }} disabled={!isDirty}
          style={{ background: isDirty ? COLORS.court : "#E5E5E5", color: isDirty ? "#fff" : "#999" }}
          className="px-4 py-2 rounded-xl text-sm font-semibold">
          Guardar duración
        </button>
        {!confirmReflow ? (
          <button onClick={() => setConfirmReflow(true)} className="text-xs font-semibold underline" style={{ color: COLORS.clay }}>
            Reprogramar horarios ya agendados
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs" style={{ color: "#6B7688" }}>Recalcula la hora de cada partido YA agendado (mismo orden, misma cancha) para que queden pegados uno detrás de otro con esta duración -- sin tocar los fijados a mano. ¿Seguro?</span>
            <button onClick={doReflow} disabled={reflowing} style={{ background: COLORS.clay, color: "#fff", opacity: reflowing ? 0.6 : 1 }} className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0">
              {reflowing ? "Reprogramando…" : "Sí, reprogramar"}
            </button>
          </div>
        )}
      </div>
      {isDirty && <p className="text-xs mt-2" style={{ color: "#8A5A16" }}>Tienes cambios sin guardar -- dale a "Guardar duración" primero.</p>}
    </Card>
  );
}

function CalendarioTab({ categories, courts, runScheduler, reflowSchedule, scheduleInfo, tournament, dates, matchDuration, setMatchDuration, breakM, setBreakM, occupiedKeys, moveMatch, unlockMatch, clearDaySchedule, reorderColumn, role }) {
  const isAdmin = role === "admin";
  // "Editar manualmente": modo tap-origen → tap-destino para reprogramar un partido ya
  // agendado. `selectedMatch` es el partido "origen" elegido; `moveTarget` el destino en
  // edición en el formulario; `moveError` el motivo si `checkMoveConflict` lo rechaza.
  const [moveMode, setMoveMode] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [moveTarget, setMoveTarget] = useState({ day: "", time: "", courtId: "" });
  const [moveError, setMoveError] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const day = dates.includes(selectedDay) ? selectedDay : (dates[0] || "");
  // v2.75.2: el panel de la derecha alterna entre el formulario de Planificar y la lista de
  // tarjetas "Sin programar" (arrastrables directo a una cancha) -- son dos vistas del mismo
  // espacio, no dos secciones separadas, igual que en la app de referencia que mostró el club.
  const [rightPanelTab, setRightPanelTab] = useState("planificar");

  // Generalidades deja acotar el torneo a un subconjunto de canchas del club -- el tablero
  // solo debe mostrar columnas de esas, igual criterio que runScheduler.
  const tournamentCourts = tournament.courtIds?.length ? courts.filter((c) => tournament.courtIds.includes(c.id)) : courts;

  const allMatches = categories.flatMap((c) => c.matches.map((m) => ({ ...m, catName: c.name })));
  const scheduled = allMatches.filter((m) => m.day);
  // Partidos SIN horario asignado (v2.74.4) -- buildSchedule() deja `day/time/courtId` en null
  // cuando la cola se queda sin franjas (ver "capacityExceeded"/"unscheduledGroup" ahí), y ese
  // partido no vuelve a aparecer en NINGÚN lado del tablero -- ni siquiera el aviso de "quedaron
  // X sin ubicar" sobrevive un refresh de página, porque vive en `scheduleInfo` (estado
  // efímero, se resetea solo). Se calcula acá directo de `categories` (dato real, persistente)
  // en vez de depender de ese estado, para que la lista JAMÁS desaparezca mientras el partido
  // siga sin horario -- incluida una ronda que todavía no se ha planificado ni una sola vez.
  const unscheduledMatches = allMatches.filter((m) => !m.day && !isByeMatch(m));
  const conflicts = useMemo(() => findScheduleConflicts(categories), [categories]);
  // Un color pastel distinto por categoría (v2.70.0) -- mismo mapa para el tablero y para el
  // panel Planificar, así el punto de color junto a una categoría en Planificar es EL MISMO
  // color que sus tarjetas en el tablero.
  const catColorMap = useMemo(() => buildCategoryColorMap(categories), [categories]);

  // Franjas horarias válidas del día (mismo cálculo que usa buildSchedule para generarlas) --
  // lista de opciones para el selector de "Hora" del destino manual, y también las filas que
  // dibuja el tablero cancha por cancha.
  const timeSlotOptions = useMemo(() => {
    const opts = [];
    const startM = timeToMinutes(tournament.dailyStart), endM = timeToMinutes(tournament.dailyEnd);
    let t = startM;
    while (t + Number(matchDuration) <= endM) { opts.push(minutesToTime(t)); t += Number(matchDuration) + Number(breakM); }
    // v2.75.0: buildSchedule() ahora puede agendar partidos MÁS ALLÁ de dailyEnd (empuja el
    // día en vez de dejarlos sin ubicar, ver isOvertimeMatch) -- si esa franja no sigue
    // apareciendo acá, el partido queda invisible en el tablero de nuevo, el mismo problema
    // que ya se corrigió para los que no tenían NINGÚN horario.
    const maxUsedMin = scheduled.reduce((max, m) => Math.max(max, timeToMinutes(m.time)), -1);
    while (maxUsedMin >= t) { opts.push(minutesToTime(t)); t += Number(matchDuration) + Number(breakM); }
    return opts;
  }, [tournament.dailyStart, tournament.dailyEnd, matchDuration, breakM, scheduled]);

  const catById = {}; categories.forEach((c) => catById[c.id] = c);
  const teamLabel = (m, side) => {
    const cat = catById[m.categoryId];
    if (side === "A") return m.teamALabel || cat.teams.find((t) => t.id === m.teamAId)?.name || "Por definir";
    return m.teamBLabel || cat.teams.find((t) => t.id === m.teamBId)?.name || "Por definir";
  };
  const roundTag = (m) => {
    const cat = catById[m.categoryId];
    if (!cat) return "";
    if (m.phase === "group") return "Grupos";
    if (m.phase === "bracket") {
      const total = new Set(cat.matches.filter((x) => x.phase === "bracket").map((x) => x.round)).size;
      return roundLabel(m.round, total);
    }
    if (m.phase === "bracket_wr") return `Llave A R${m.round + 1}`;
    if (m.phase === "bracket_lb") return `Llave B R${m.round + 1}`;
    return "";
  };
  // Etiqueta de color por GRUPO (no por categoría -- esa ya tinta toda la tarjeta, ver
  // catColorMap) -- así, con varios grupos en paralelo el mismo día, se distingue de un
  // vistazo "Grupo A" de "Grupo B" sin tener que leer los nombres de los jugadores.
  const groupTag = (m) => {
    if (m.phase !== "group" || !m.groupId) return null;
    const cat = catById[m.categoryId];
    if (!cat) return null;
    const idx = cat.groups.findIndex((g) => g.id === m.groupId);
    const g = cat.groups[idx];
    if (!g) return null;
    return { name: g.name, color: CATEGORY_PALETTE[idx % CATEGORY_PALETTE.length] };
  };

  const dayMatchesByCourt = {};
  scheduled.filter((m) => m.day === day).forEach((m) => {
    (dayMatchesByCourt[m.courtId] = dayMatchesByCourt[m.courtId] || []).push(m);
  });

  // Ícono rojo de choque por partido (v2.71.0) -- mismo cálculo que ya usaba el aviso de texto
  // de arriba (`conflicts`, de findScheduleConflicts), solo que acá se indexa por matchId para
  // poder marcar la tarjeta puntual en el tablero, no solo listarlo aparte. El texto del
  // tooltip nombra con quién choca, no solo que choca.
  const conflictByMatch = useMemo(() => {
    const map = {};
    conflicts.forEach((group) => {
      group.forEach((e) => {
        const others = group.filter((x) => x.matchId !== e.matchId).map((x) => `${x.playerName} (${x.catName})`);
        map[e.matchId] = `${e.playerName} ya tiene otro partido a esta hora: ${others.join(", ")}.`;
      });
    });
    return map;
  }, [conflicts]);

  // Aviso flotante para arrastrar-y-soltar (v2.71.0) -- rojo si el movimiento se bloqueó de
  // verdad (cancha físicamente ocupada), ámbar si se permitió pero choca un jugador (mismo
  // caso que marca el ícono en la tarjeta, solo que este aviso es lo primero que se ve apenas
  // sueltas). Se borra solo a los 5s para no quedar pegado en pantalla.
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Arrastrar-y-soltar (v2.73.0) -- nativo del navegador (HTML5 drag & drop), sin librería
  // nueva. El id del partido viaja en `dataTransfer` (el mecanismo real de HTML5 DnD para
  // pasar el "payload" de un drag), NO en un estado de React: un estado leído desde el closure
  // del onDrop puede quedar viejo si React todavía no volvió a renderizar entre el dragstart y
  // el drop. `dataTransfer` no tiene ese problema: el navegador lo entrega tal cual se guardó.
  //
  // v2.73.0: dentro de la MISMA cancha, soltar ya no es "intercambiar con uno solo" -- empuja a
  // TODOS los que quedaban entre el horario viejo y el nuevo un puesto para abrirle campo
  // (reorderWithinColumn/reorderColumn), y mientras arrastras se ve en vivo (las franjas de en
  // medio se corren con una transición CSS antes de soltar siquiera, ver ROW_H/dragFrom/overPos
  // más abajo). v2.74.x: entre canchas DISTINTAS pasó lo mismo -- el intercambio simple
  // (swapMatches) desordenaba toda la cancha destino de un solo golpe cuando el club lo probó
  // en la práctica, así que ahora también empuja en cadena, repartido entre las DOS canchas
  // (reorderAcrossColumns): la de origen cierra el hueco que deja, la de destino le abre campo.
  // `draggingId` sigue siendo aparte de `dragFrom`/`overPos` porque a él le toca la tarjeta
  // agarrada (atenuarla); estos dos le toca a las franjas de en medio (correrse).
  const [draggingId, setDraggingId] = useState(null);
  const [dragFrom, setDragFrom] = useState(null); // { courtId, index }
  const [overPos, setOverPos] = useState(null);   // { courtId, index }
  const ROW_H = 152; // alto fijo de CADA franja (vacía u ocupada) -- ver el <div style={{height:ROW_H}}> de cada una. Tiene que ser el mismo para las dos o la vista previa de "empujar" queda descuadrada. Incluye el margen vertical (ROW_GAP) entre tarjetas -- la tarjeta visible vive DENTRO de esta franja, no ocupa toda su altura. Tiene que caber el partido más alto posible (con las DOS franjas de aviso -- choque Y fuera de horario, v2.75.0 -- juntas) + el margen o el contenido se corta -- medido en vivo: 95px sin ningún aviso, 119px con uno solo, ~139px estimado con los dos (antes de sumarle ROW_GAP).
  const ROW_GAP = 8; // separación visual entre una tarjeta y la siguiente -- mitad arriba, mitad abajo de cada franja (padding del wrapper, no de la tarjeta).

  const dragMatch = (m, index) => (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", m.id);
    setDraggingId(m.id);
    setDragFrom({ courtId: m.courtId, index });
  };
  // Arrastrar desde la lista "Sin programar" (v2.75.2) -- a diferencia de dragMatch, este
  // partido nunca tuvo cancha/horario, así que no hay `dragFrom` que empujar en cadena (por
  // eso null): previewShift y el resaltado "isOver" de cruce de cancha ya manejan un
  // dragFrom nulo sin romperse, tal cual estaban escritos para el caso entre-canchas.
  const dragUnscheduledMatch = (m) => (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", m.id);
    setDraggingId(m.id);
    setDragFrom(null);
  };
  const dragEnd = () => { setDraggingId(null); setDragFrom(null); setOverPos(null); };
  // v2.74.2: los handlers de drag&drop viven en la CANCHA entera (un solo listener por
  // columna), no en cada fila -- antes cada fila tenía su propio onDragOver/onDragEnter/onDrop,
  // pero la vista previa de "empuje" (previewShift) mueve las filas con CSS transform sin
  // sacarlas del flujo normal del documento, así que la fila que se corre hacia arriba queda
  // pintada ENCIMA de la fila de origen (con z-index) pero el hueco que deja atrás no lo cubre
  // nadie -- ahí no hay ningún elemento con onDragOver, así que soltar justo en esa franja
  // vacía no dispara ningún drop y el navegador simplemente termina el arrastre sin cambiar
  // nada (el "vuelve a lo que estaba" que reportó el club). Calculando el índice a partir de la
  // posición Y del cursor dentro de la columna, en cambio, toda la columna es un solo target
  // continuo sin huecos -- no importa sobre qué fila esté pintado algo en ese instante.
  const indexFromClientY = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = Math.floor((e.clientY - rect.top) / ROW_H);
    return Math.max(0, Math.min(timeSlotOptions.length - 1, raw));
  };

  // Reordena DENTRO de una cancha: mueve el contenido del índice `from` al índice `to` (como
  // un array.splice) y reparte el MISMO conjunto de horarios de esa cancha entre lo que quedó
  // movido -- así "1-4" cae exactamente donde soltaste y todo lo que estaba entre medio se
  // corrió un puesto, ni un hueco de más ni de menos.
  const reorderWithinColumn = (court, byTimeForCourt, from, to) => {
    if (from === to) return;
    const slots = timeSlotOptions.map((t) => byTimeForCourt[t] || null);
    const [moved] = slots.splice(from, 1);
    slots.splice(to, 0, moved);
    const updates = [];
    slots.forEach((m, i) => {
      if (m && m.time !== timeSlotOptions[i]) updates.push({ categoryId: m.categoryId, matchId: m.id, day, time: timeSlotOptions[i], courtId: court.id });
    });
    if (updates.length) reorderColumn(updates);
  };

  // Lo mismo que reorderWithinColumn pero repartido entre DOS canchas (v2.74.x) -- la de
  // origen cierra el hueco que deja el partido movido (todo lo de después se corre un puesto
  // hacia arriba, nadie queda flotando a mitad del día sin motivo) y la de destino le abre
  // campo empujando hacia abajo todo lo que había desde el puesto elegido hasta el próximo
  // hueco libre.
  //
  // v2.74.3: con un torneo de verdad (varias categorías compartiendo las mismas 4 canchas todo
  // el día) casi nunca hay un hueco libre más abajo en la cancha destino -- exigirlo hacía que
  // esta función rechazara CASI todos los movimientos entre canchas, justo lo que se estaba
  // probando. Si no hay hueco, el partido que quedaría "sin casa" al final de la cancha
  // destino se manda al puesto que el movimiento acaba de dejar libre en la cancha ORIGEN --
  // como un intercambio en cadena entre las dos puntas, nadie se queda sin horario ese día.
  const reorderAcrossColumns = (m, sourceCourtId, sourceIndex, destCourt, destIndex) => {
    const sourceByTime = {};
    (dayMatchesByCourt[sourceCourtId] || []).forEach((x) => { sourceByTime[x.time] = x; });
    const sourceSlots = timeSlotOptions.map((t) => sourceByTime[t] || null);
    sourceSlots.splice(sourceIndex, 1);
    sourceSlots.push(null); // el último puesto de origen queda libre -- ver `bumped` abajo

    const destByTime = {};
    (dayMatchesByCourt[destCourt.id] || []).forEach((x) => { destByTime[x.time] = x; });
    const destSlots = timeSlotOptions.map((t) => destByTime[t] || null);
    let freeAt = -1;
    for (let i = destIndex; i < destSlots.length; i++) { if (!destSlots[i]) { freeAt = i; break; } }

    let bumped = null;
    if (freeAt === -1) {
      bumped = destSlots[destSlots.length - 1];
      freeAt = destSlots.length - 1;
    }
    for (let i = freeAt; i > destIndex; i--) destSlots[i] = destSlots[i - 1];
    destSlots[destIndex] = m;

    if (bumped) {
      const sourceFreeIndex = sourceSlots.length - 1;
      if (sourceSlots[sourceFreeIndex]) return { ok: false }; // no debería pasar nunca, defensivo
      sourceSlots[sourceFreeIndex] = bumped;
    }

    const updates = [];
    sourceSlots.forEach((x, i) => {
      if (x && (x.time !== timeSlotOptions[i] || x.courtId !== sourceCourtId)) updates.push({ categoryId: x.categoryId, matchId: x.id, day, time: timeSlotOptions[i], courtId: sourceCourtId });
    });
    destSlots.forEach((x, i) => {
      if (!x) return;
      if (x.id === m.id || x.time !== timeSlotOptions[i] || x.courtId !== destCourt.id) {
        updates.push({ categoryId: x.categoryId, matchId: x.id, day, time: timeSlotOptions[i], courtId: destCourt.id });
      }
    });
    return { ok: true, updates };
  };

  // Soltar un partido que viene de "Sin programar" (v2.75.2) -- nunca tuvo cancha ni horario,
  // así que no hay columna de origen que cerrar (a diferencia de reorderAcrossColumns): solo
  // hace falta abrirle campo en la columna DESTINO, empujando hacia abajo lo que había desde
  // el puesto elegido. Si no queda ningún hueco libre, se extiende el día un puesto más (mismo
  // criterio que buildSchedule -- nunca se deja sin ubicar, ver isOvertimeMatch) en vez de
  // rechazar el movimiento.
  const placeUnscheduledMatch = (m, destCourt, destIndex) => {
    const destByTime = {};
    (dayMatchesByCourt[destCourt.id] || []).forEach((x) => { destByTime[x.time] = x; });
    const destSlots = timeSlotOptions.map((t) => destByTime[t] || null);
    const destTimes = [...timeSlotOptions];
    let freeAt = -1;
    for (let i = destIndex; i < destSlots.length; i++) { if (!destSlots[i]) { freeAt = i; break; } }
    if (freeAt === -1) {
      const lastMin = timeToMinutes(destTimes[destTimes.length - 1]);
      destTimes.push(minutesToTime(lastMin + Number(matchDuration) + Number(breakM)));
      destSlots.push(null);
      freeAt = destSlots.length - 1;
    }
    for (let i = freeAt; i > destIndex; i--) destSlots[i] = destSlots[i - 1];
    destSlots[destIndex] = m;

    const updates = [];
    destSlots.forEach((x, i) => {
      if (!x) return;
      if (x.id === m.id || x.time !== destTimes[i] || x.courtId !== destCourt.id) {
        updates.push({ categoryId: x.categoryId, matchId: x.id, day, time: destTimes[i], courtId: destCourt.id });
      }
    });
    reorderColumn(updates);
  };

  // Un solo par dragOver/drop por COLUMNA (ver comentario de indexFromClientY arriba) -- el
  // índice de destino se calcula de la posición Y del cursor, no de sobre qué fila cayó el
  // evento.
  const columnDragEnter = (e) => e.preventDefault(); // idem dragover -- el navegador decide si acepta drop apenas entra, antes del primer dragover
  const columnDragOver = (court) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverPos({ courtId: court.id, index: indexFromClientY(e) });
  };
  const dropOnColumn = (court, byTimeForCourt) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Limpiar acá mismo, no solo esperar a onDragEnd (v2.75.3) -- cuando el partido soltado
    // viene de "Sin programar", el drop lo saca de esa lista y lo mete en el tablero en el
    // mismo tick: React desmonta la tarjeta que se estaba arrastrando ANTES de que el
    // navegador llegue a dispararle su propio dragend, así que ese evento nunca corre y
    // `draggingId` se queda pegado en ese partido para siempre -- lo que sea que renderice con
    // ese id (ahora ya en el tablero) queda atenuado (opacity 0.35) para siempre, aunque nadie
    // lo esté arrastrando. Limpiando el estado apenas se procesa el drop, sin depender de que
    // el navegador avise, esto no puede volver a pasar.
    setOverPos(null); setDraggingId(null); setDragFrom(null);
    const matchId = e.dataTransfer.getData("text/plain");
    if (!matchId || !isAdmin) return;
    const m = allMatches.find((x) => x.id === matchId); // allMatches, no `scheduled` -- este drop también recibe partidos de "Sin programar", que no tienen día todavía
    if (!m) return;
    const index = indexFromClientY(e);
    if (!m.day || !m.courtId) {
      // Viene de "Sin programar" -- nunca tuvo cancha, no hay columna de origen que cerrar.
      placeUnscheduledMatch(m, court, index);
      return;
    }
    const fromIndex = timeSlotOptions.indexOf(m.time);
    if (m.courtId === court.id) {
      // Misma cancha -- empujar en cadena (dragFrom ya trae el índice de origen; por las
      // dudas se recalcula acá también, dataTransfer es la única fuente de verdad real).
      reorderWithinColumn(court, byTimeForCourt, fromIndex, index);
      return;
    }
    // Cancha distinta -- empuja en cadena en las dos, ver reorderAcrossColumns arriba.
    const res = reorderAcrossColumns(m, m.courtId, fromIndex, court, index);
    if (!res.ok) { setNotice({ type: "error", text: "No se pudo mover el partido -- intenta de nuevo." }); return; }
    reorderColumn(res.updates);
    setNotice(null);
  };
  // Cuánto se debe "correr" (arriba/abajo) la franja `index` de ESTA cancha mientras el
  // arrastre está en curso -- solo aplica dentro de la cancha de origen; cruzando canchas no
  // hay cadena que empujar, cada una se queda quieta hasta que sueltes.
  const previewShift = (courtId, index) => {
    if (!dragFrom || !overPos || dragFrom.courtId !== courtId || overPos.courtId !== courtId) return 0;
    const { index: fi } = dragFrom, oi = overPos.index;
    if (fi < oi && index > fi && index <= oi) return -1;
    if (fi > oi && index >= oi && index < fi) return 1;
    return 0;
  };

  const selectMatch = (m) => { setSelectedMatch(m); setMoveTarget({ day: m.day, time: m.time, courtId: m.courtId }); setMoveError(""); };
  const cancelMove = () => { setSelectedMatch(null); setMoveError(""); };
  const confirmMove = () => {
    if (!moveTarget.day || !moveTarget.time || !moveTarget.courtId) { setMoveError("Completa día, hora y cancha destino."); return; }
    const res = checkMoveConflict(selectedMatch, moveTarget, categories, occupiedKeys);
    if (!res.ok) { setMoveError(res.reason); return; }
    moveMatch(selectedMatch.categoryId, selectedMatch.id, moveTarget);
    setSelectedMatch(null); setMoveError("");
    if (res.warning) setNotice({ type: "warning", text: res.warning });
  };

  return (
    <div className="mt-2 space-y-5">
      {isAdmin && <DuracionPartidosCard matchDuration={matchDuration} setMatchDuration={setMatchDuration} breakM={breakM} setBreakM={setBreakM} reflowSchedule={reflowSchedule} tournamentId={tournament.id} />}

      {isAdmin && unscheduledMatches.length > 0 && (
        <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: "#FCE9E4", color: "#B23A1B", border: "1px solid #F0AE9B" }}>
          <p className="font-bold flex items-center gap-1.5">
            <AlertTriangle size={14} /> {unscheduledMatches.length} partido(s) sin horario asignado -- no aparecen en el tablero de ningún día. Usa Planificar para ubicarlos.
          </p>
          <ul className="mt-1.5 space-y-1 max-h-40 overflow-y-auto">
            {unscheduledMatches.map((m) => {
              const grp = groupTag(m);
              return (
                <li key={m.id} className="flex items-center gap-1.5 flex-wrap">
                  <span className="shrink-0 px-1.5 py-0.5 rounded font-extrabold" style={{ background: "#B23A1B", color: "#fff", fontSize: 9, letterSpacing: 0.3 }}>SIN HORARIO</span>
                  <span><b>{m.catName}</b> · {grp ? grp.name : roundTag(m)} — {teamLabel(m, "A")} vs {teamLabel(m, "B")}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dates.length === 0 ? (
        <Card><p className="text-sm text-gray-400">Define fecha de inicio y fin del torneo en Generalidades primero.</p></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {dates.map((d) => (
              <button key={d} onClick={() => setSelectedDay(d)} className="px-3.5 py-2 rounded-xl text-sm font-bold"
                style={{ background: d === day ? COLORS.court : "#EAEEF5", color: d === day ? "#fff" : COLORS.ink }}>
                {formatDateHuman(d)}
              </button>
            ))}
          </div>

          {scheduleInfo?.start && scheduleInfo?.end && (
            <div className="flex flex-wrap gap-3">
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
                Última corrida: {formatDateHuman(scheduleInfo.start.day)} {formatTimeAmPm(scheduleInfo.start.time)} → {formatDateHuman(scheduleInfo.end.day)} {formatTimeAmPm(scheduleInfo.end.time)}
              </div>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: "#FCE9E4", color: "#B23A1B" }}>
              <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={14} /> {conflicts.length} jugador(es) con dos partidos al mismo horario</p>
              <ul className="mt-1.5 space-y-0.5">
                {conflicts.map((entries, i) => (
                  <li key={i}>
                    <b>{entries[0].playerName}</b> — {formatDateHuman(entries[0].day)} {formatTimeAmPm(entries[0].time)}: {entries.map((e) => e.catName).join(" y ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isAdmin && moveMode && (
            <div className="text-xs px-3 py-2.5 rounded-lg" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
              Modo edición activo: toca un partido del tablero para elegir a dónde moverlo.
            </div>
          )}

          {isAdmin && moveMode && selectedMatch && (
            <Card>
              <SectionTitle sub="Se valida que la cancha esté libre y que ningún jugador tenga otro partido a esa hora antes de confirmar.">
                Moviendo: {teamLabel(selectedMatch, "A")} vs {teamLabel(selectedMatch, "B")}
              </SectionTitle>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Día</Label>
                  <select style={inputStyle} value={moveTarget.day} onChange={(e) => setMoveTarget((t) => ({ ...t, day: e.target.value }))}>
                    {dates.map((d) => <option key={d} value={d}>{formatDateHuman(d)}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Hora</Label>
                  <select style={inputStyle} value={moveTarget.time} onChange={(e) => setMoveTarget((t) => ({ ...t, time: e.target.value }))}>
                    {timeSlotOptions.map((t) => <option key={t} value={t}>{formatTimeAmPm(t)}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Cancha</Label>
                  <select style={inputStyle} value={moveTarget.courtId} onChange={(e) => setMoveTarget((t) => ({ ...t, courtId: e.target.value }))}>
                    {tournamentCourts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              {moveError && (
                <div className="mt-3 text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FCE9E4", color: "#B23A1B" }}>
                  <AlertTriangle size={14} /> {moveError}
                </div>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={cancelMove} className="px-4 py-2.5 rounded-xl font-semibold text-sm" style={{ background: "#EAEEF5", color: COLORS.ink }}>Cancelar</button>
                <button onClick={confirmMove} style={{ background: COLORS.clay, color: "#fff" }} className="px-5 py-2.5 rounded-xl font-bold text-sm">Confirmar movimiento</button>
              </div>
            </Card>
          )}

          <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
            <Card>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <SectionTitle sub="Una columna por cancha -- compara horarios uno al lado del otro para detectar choques.">Cancha por cancha — {formatDateHuman(day)}</SectionTitle>
                {isAdmin && scheduled.some((m) => m.day === day) && (
                  <button onClick={() => { setMoveMode((v) => !v); cancelMove(); }}
                    style={{ background: moveMode ? COLORS.court : "#EAEEF5", color: moveMode ? "#fff" : COLORS.ink }}
                    className="px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 h-fit shrink-0">
                    <Pencil size={13} /> {moveMode ? "Saliendo de edición" : "Editar manualmente"}
                  </button>
                )}
              </div>
              {notice && (
                <div className="mb-3 text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5"
                  style={{ background: notice.type === "error" ? "#FCE9E4" : "#FBF3E4", color: notice.type === "error" ? "#B23A1B" : "#8A5A16" }}>
                  <AlertTriangle size={14} /> {notice.text}
                </div>
              )}
              {isAdmin && tournamentCourts.length > 0 && (
                <p className="text-[11px] text-gray-400 mb-2">En computador puedes arrastrar un partido: empuja a los demás para abrirle campo, tanto dentro de la misma cancha como al soltarlo en otra. En el teléfono usa "Editar manualmente".</p>
              )}
              {tournamentCourts.length === 0 ? (
                <p className="text-sm text-gray-400">Agrega al menos una cancha en Club (o en Generalidades del torneo).</p>
              ) : (
                <div className="overflow-x-auto pb-1">
                  <style>{`
                    @keyframes conflictPulse { 0%, 100% { box-shadow: 0 0 0 3px rgba(211,36,42,0.55); } 50% { box-shadow: 0 0 0 6px rgba(211,36,42,0.15); } }
                    .match-conflict { animation: conflictPulse 1.1s ease-in-out infinite; }
                  `}</style>
                  <div className="flex gap-2.5" style={{ width: "max-content" }}>
                    {tournamentCourts.map((court) => {
                      const byTime = {};
                      (dayMatchesByCourt[court.id] || []).forEach((m) => { byTime[m.time] = m; });
                      return (
                        <div key={court.id} className="shrink-0" style={{ width: 200 }}>
                          <div className="rounded-t-xl px-3 py-2 font-bold text-sm text-center" style={{ background: COLORS.court, color: "#fff" }}>{court.name}</div>
                          <div className="rounded-b-xl"
                            onDragEnter={isAdmin ? columnDragEnter : undefined}
                            onDragOver={isAdmin ? columnDragOver(court) : undefined}
                            onDrop={isAdmin ? dropOnColumn(court, byTime) : undefined}
                            style={{ border: `1px solid ${COLORS.line}`, borderTop: "none", overflow: "hidden" }}>
                            {timeSlotOptions.map((t, index) => {
                              const m = byTime[t];
                              const shift = previewShift(court.id, index);
                              const rowStyle = {
                                height: ROW_H, transition: "transform 150ms ease",
                                transform: shift ? `translateY(${shift * ROW_H}px)` : "translateY(0)",
                                position: "relative", zIndex: shift ? 3 : undefined,
                                padding: `${ROW_GAP / 2}px 6px`, // la tarjeta visible vive adentro de este padding -- así queda separada de la próxima franja
                              };
                              if (!m) {
                                // Casilla vacía -- se resalta con un anillo azul apenas el arrastre pasa
                                // por encima (solo tiene sentido cruzando de cancha; dentro de la misma
                                // cancha el que se ve es el empuje de `previewShift`, ver arriba).
                                const isOver = overPos?.courtId === court.id && overPos?.index === index && dragFrom?.courtId !== court.id;
                                return (
                                  <div key={t} style={rowStyle}>
                                    <div className="h-full rounded-lg flex items-center px-2 border border-dashed"
                                      style={{ borderColor: isOver ? "#1B5FA0" : COLORS.line, background: isOver ? "#DCEEFB" : "#fff", boxShadow: isOver ? "inset 0 0 0 2px #1B5FA0" : "none" }}>
                                      <span className="text-[9px] text-gray-300 mono">{formatTimeAmPm(t)}</span>
                                    </div>
                                  </div>
                                );
                              }
                              const isSelected = selectedMatch?.id === m.id;
                              const clickable = isAdmin && moveMode;
                              const cc = catColorMap[m.categoryId] || CATEGORY_PALETTE[0];
                              const conflictMsg = conflictByMatch[m.id];
                              const isOvertime = isOvertimeMatch(m, tournament);
                              const grp = groupTag(m);
                              const isDragging = draggingId === m.id;
                              const isOver = overPos?.courtId === court.id && overPos?.index === index && dragFrom?.courtId !== court.id;
                              return (
                                <div key={m.id} draggable={isAdmin}
                                  onDragStart={isAdmin ? dragMatch(m, index) : undefined}
                                  onDragEnd={isAdmin ? dragEnd : undefined}
                                  onClick={clickable ? () => selectMatch(m) : undefined}
                                  style={{
                                    ...rowStyle,
                                    cursor: isAdmin ? (clickable ? "pointer" : "grab") : "default",
                                    userSelect: isAdmin ? "none" : undefined, // si el navegador arranca una selección de texto en vez del drag nativo (mousedown justo sobre el nombre de un jugador), el drop se rechaza con el cursor de "no permitido" -- ver incidente v2.73.2
                                  }}>
                                  <div className={`h-full p-2 text-xs rounded-lg overflow-hidden ${conflictMsg ? "match-conflict" : ""}`}
                                    style={{
                                      background: conflictMsg ? "#FDEAEA" : (isSelected ? "#FBF3E4" : cc.bg),
                                      opacity: isDragging ? 0.35 : 1,
                                      boxShadow: isOver ? "0 4px 12px rgba(22,50,92,0.35), inset 0 0 0 2px #1B5FA0"
                                        : conflictMsg ? undefined // lo pone la animación conflictPulse
                                        : "0 1px 3px rgba(22,50,92,0.12)",
                                    }}>
                                    {conflictMsg && (
                                      <div title={conflictMsg} className="flex items-center gap-1 mb-1 px-1.5 py-0.5 rounded font-extrabold"
                                        style={{ background: "#D3242A", color: "#fff", fontSize: 9, letterSpacing: 0.3 }}>
                                        <AlertCircle size={12} /> CHOQUE DE HORARIO
                                      </div>
                                    )}
                                    {isOvertime && (
                                      <div title={`Este partido empieza después de las ${formatTimeAmPm(tournament.dailyEnd)}, la hora de cierre configurada en Generalidades.`}
                                        className="flex items-center gap-1 mb-1 px-1.5 py-0.5 rounded font-extrabold"
                                        style={{ background: "#C97A1B", color: "#fff", fontSize: 9, letterSpacing: 0.3 }}>
                                        <AlertTriangle size={12} /> FUERA DE TU FRANJA DE HORARIO
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between gap-1">
                                      <span className="font-bold mono">{formatTimeAmPm(m.time)}</span>
                                      <div className="flex items-center gap-1 shrink-0">
                                        {isAdmin && m.locked && (
                                          <button type="button" onClick={(e) => { e.stopPropagation(); unlockMatch(m.categoryId, m.id); }}
                                            title="Fijado -- clic para liberar" style={{ color: COLORS.clay }}>
                                            <Lock size={11} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-[9px] uppercase font-bold tracking-wide truncate" style={{ color: cc.text }}>{m.catName}{grp ? "" : ` · ${roundTag(m)}`}</span>
                                      {grp && (
                                        <span className="shrink-0 px-1.5 rounded-full font-extrabold" style={{ fontSize: 8, lineHeight: "13px", letterSpacing: 0.3, background: grp.color.text, color: "#fff" }}>{grp.name}</span>
                                      )}
                                    </div>
                                    <div className="font-medium leading-tight mt-0.5 truncate">{teamLabel(m, "A")}</div>
                                    <div className="text-gray-400 text-[10px] leading-tight">vs</div>
                                    <div className="font-medium leading-tight truncate">{teamLabel(m, "B")}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            {isAdmin && (
              <div>
                <div className="flex gap-1.5 mb-2">
                  <button type="button" onClick={() => setRightPanelTab("planificar")}
                    className="flex-1 px-3 py-2 rounded-xl text-sm font-bold"
                    style={{ background: rightPanelTab === "planificar" ? COLORS.court : "#EAEEF5", color: rightPanelTab === "planificar" ? "#fff" : COLORS.ink }}>
                    Planificar
                  </button>
                  <button type="button" onClick={() => setRightPanelTab("sinProgramar")}
                    className="flex-1 px-3 py-2 rounded-xl text-sm font-bold"
                    style={{ background: rightPanelTab === "sinProgramar" ? COLORS.court : "#EAEEF5", color: rightPanelTab === "sinProgramar" ? "#fff" : COLORS.ink }}>
                    Sin programar {unscheduledMatches.length > 0 ? `(${unscheduledMatches.length})` : ""}
                  </button>
                </div>
                {rightPanelTab === "planificar" ? (
                  <PlanificarPanel categories={categories} tournamentCourts={tournamentCourts} selectedDay={day}
                    tournament={tournament} matchDuration={matchDuration} breakM={breakM} occupiedKeys={occupiedKeys}
                    runScheduler={runScheduler} clearDaySchedule={clearDaySchedule} catColorMap={catColorMap} />
                ) : (
                  <Card>
                    <SectionTitle sub="Arrastra cualquiera de estas tarjetas directo a una casilla del tablero -- misma cancha o cualquier otra -- para darle horario. Ninguna se pierde de vista hasta que quede agendada.">
                      Sin programar
                    </SectionTitle>
                    {unscheduledMatches.length === 0 ? (
                      <p className="text-sm text-gray-400 mt-2">Ninguno -- todos los partidos ya tienen horario en algún día.</p>
                    ) : (
                      <div className="mt-3 space-y-2 max-h-[520px] overflow-y-auto pr-1">
                        {unscheduledMatches.map((m) => {
                          const cc = catColorMap[m.categoryId] || CATEGORY_PALETTE[0];
                          const grp = groupTag(m);
                          const isDragging = draggingId === m.id;
                          return (
                            <div key={m.id} draggable
                              onDragStart={dragUnscheduledMatch(m)}
                              onDragEnd={dragEnd}
                              className="p-2 text-xs rounded-lg cursor-grab"
                              style={{ background: cc.bg, opacity: isDragging ? 0.35 : 1, boxShadow: "0 1px 3px rgba(22,50,92,0.12)" }}>
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] uppercase font-bold tracking-wide truncate" style={{ color: cc.text }}>{m.catName}{grp ? "" : ` · ${roundTag(m)}`}</span>
                                {grp && (
                                  <span className="shrink-0 px-1.5 rounded-full font-extrabold" style={{ fontSize: 8, lineHeight: "13px", letterSpacing: 0.3, background: grp.color.text, color: "#fff" }}>{grp.name}</span>
                                )}
                              </div>
                              <div className="font-medium leading-tight mt-0.5 truncate">{teamLabel(m, "A")}</div>
                              <div className="text-gray-400 text-[10px] leading-tight">vs</div>
                              <div className="font-medium leading-tight truncate">{teamLabel(m, "B")}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Card>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================================
   TAB: INSCRIPCIÓN (autoservicio de jugadores)
   ========================================================================= */
// Selector de "¿para quién es esta inscripción?" -- solo lo ve el admin (v2.46.0). Deja elegir
// entre inscribirse a sí mismo, buscar a un socio ya registrado en la app, o anotar a un
// invitado sin cuenta con solo su nombre -- las tres opciones
// terminan pasando por el MISMO checkout real (categorías, pareja, método de pago) que usaría
// esa persona si se inscribiera sola. El roster manual y sin cobro de Participantes
// (TeamRegistration) sigue existiendo aparte para anotar rápido sin pasar por checkout.
function RegistrantPicker({ users, currentUser, onChange }) {
  const [mode, setMode] = useState("yo"); // yo | buscar | invitado
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [guestName, setGuestName] = useState("");

  const results = mode === "buscar" && !selectedUser && query.trim().length > 0
    ? users.filter((u) => u.id !== currentUser.id &&
        (u.name.toLowerCase().includes(query.trim().toLowerCase()) || u.email.toLowerCase().includes(query.trim().toLowerCase())))
        .slice(0, 6)
    : [];

  useEffect(() => {
    if (mode === "yo") onChange({ userId: currentUser.id, name: currentUser.name, gender: currentUser.gender });
    else if (mode === "buscar" && selectedUser) onChange({ userId: selectedUser.id, name: selectedUser.name, gender: selectedUser.gender });
    else if (mode === "invitado" && guestName.trim()) onChange({ name: guestName.trim() });
    else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedUser, guestName]);

  const pickUser = (u) => { setSelectedUser(u); setQuery(u.name); };
  const clearUser = () => { setSelectedUser(null); setQuery(""); };
  const switchMode = (m) => { setMode(m); setSelectedUser(null); setQuery(""); setGuestName(""); };

  return (
    <Card className="mb-4">
      <Label>¿Para quién es esta inscripción?</Label>
      <div className="flex gap-1.5 mb-2 flex-wrap mt-1.5">
        {[["yo", "Yo mismo"], ["buscar", "Buscar socio"], ["invitado", "Invitado sin cuenta"]].map(([m, l]) => (
          <button key={m} type="button" onClick={() => switchMode(m)} className="px-3 py-1 rounded-lg text-[11px] font-bold"
            style={{ background: mode === m ? COLORS.court : "#EAEEF5", color: mode === m ? "#fff" : COLORS.ink }}>{l}</button>
        ))}
      </div>
      {mode === "buscar" && (
        selectedUser ? (
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl" style={{ background: "#DCEBD5" }}>
            <span className="text-sm font-semibold flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: COLORS.court, color: "#fff" }}>{selectedUser.name.charAt(0).toUpperCase()}</span>
              {selectedUser.name} <span className="text-xs font-normal text-gray-500">· {selectedUser.email}</span>
            </span>
            <button onClick={clearUser} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
          </div>
        ) : (
          <div className="relative">
            <input style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca por nombre o correo…" autoFocus />
            {results.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-lg" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
                {results.map((u) => (
                  <button key={u.id} type="button" onClick={() => pickUser(u)} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2" style={{ background: "#fff" }}>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: COLORS.court, color: "#fff" }}>{u.name.charAt(0).toUpperCase()}</span>
                    <span className="truncate">{u.name}<span className="text-gray-400"> · {u.email}</span></span>
                  </button>
                ))}
              </div>
            )}
            {query.trim().length > 0 && results.length === 0 && (
              <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>Nadie coincide -- usa "Invitado sin cuenta" si todavía no tiene cuenta en la app.</p>
            )}
          </div>
        )
      )}
      {mode === "invitado" && (
        <input style={inputStyle} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Nombre del invitado" autoFocus />
      )}
    </Card>
  );
}

// Inscripción real por checkout -- antes solo para que el cliente se inscribiera a sí mismo
// (v2.44.3 le sumó al admin la misma pestaña, pero también solo para sí mismo); v2.46.0 le
// agrega al admin el RegistrantPicker de arriba para inscribir a cualquier socio o invitado por
// el mismo checkout real (categorías, pareja, método de pago) que usaría esa persona sola. El
// editor de roster manual y sin cobro sigue viviendo aparte, en Participantes (TeamRegistration).
function InscripcionTab({ categories, addTeam, suggestedRanking, currentUser, users, club, tournament, setTab, role }) {
  const isAdmin = role === "admin";
  // El cliente siempre se inscribe a sí mismo -- solo el admin ve el selector de arriba, así
  // que solo para él arranca sin elegir (null) hasta que pique una opción.
  const [registrant, setRegistrant] = useState(isAdmin ? null : { userId: currentUser.id, name: currentUser.name, gender: currentUser.gender });
  const isSelf = !!registrant && registrant.userId === currentUser.id;

  // ---- Player self-registration: only categories still open to the person being registered
  // (y que correspondan a su género -- 'mixto' y 'libre' son visibles para cualquiera), no
  // free-text name for themselves, a searched/invited partner for doubles, and a real checkout
  // step. Si no se conoce el género (perfil incompleto, o invitado sin cuenta) no se puede
  // filtrar -- se muestran todas. ----
  const eligible = registrant ? categories.filter((c) => {
    const drawStarted = c.matches && c.matches.length > 0;
    if (drawStarted) return false;
    const alreadyIn = [...c.teams, ...c.waitlist].some((t) => t.players.some((p) =>
      registrant.userId ? p.userId === registrant.userId : p.name.trim().toLowerCase() === registrant.name.trim().toLowerCase()));
    if (alreadyIn) return false;
    if (registrant.gender && c.gender !== "mixto" && c.gender !== "libre" && c.gender !== registrant.gender) return false;
    return true;
  }) : [];

  // Categorías de dobles en las que el registrant YA es TITULAR de un cupo "esperando pareja"
  // (v2.64.0) -- antes el único lugar para conseguir el link de invitar pareja era el popup de
  // éxito justo después de pagar (ver `done` más abajo); si se cerraba sin compartirlo, o el
  // checkout había sido en otra sesión/dispositivo, no quedaba forma de recuperarlo -- ni
  // siquiera el admin podía regenerarlo a mano. Esta sección deja reenviar ese link en
  // cualquier momento. Solo cuenta si es TITULAR (players[0]) -- alguien que se unió como
  // players[1] no tiene cupo propio que ofrecer, ya está completo.
  const myPendingTeams = useMemo(() => {
    if (!registrant) return [];
    const out = [];
    categories.forEach((c) => {
      if (c.modality === "individual") return;
      (c.teams || []).forEach((t) => {
        if ((t.players || []).length !== 1) return;
        const creator = t.players[0];
        const isMine = registrant.userId ? creator.userId === registrant.userId : creator.name.trim().toLowerCase() === registrant.name.trim().toLowerCase();
        if (isMine) out.push({ catId: c.id, catName: c.name, teamId: t.id });
      });
    });
    return out;
  }, [categories, registrant]);

  // ---- Carrito de inscripción: el jugador marca TODAS las categorías en las que quiere
  // participar (no una a la vez) y un solo pago cubre todo el carrito. Ya no se elige pareja
  // acá (v2.51.0) -- toda categoría de dobles arranca "esperando pareja"; el botón de invitar
  // por WhatsApp para completarla vive en el popup de éxito, después de pagar (ver el bloque
  // `done` más abajo). Antes había un picker de pareja (buscar socio/invitar después) en cada
  // card mientras se elegían categorías -- se sentía como un paso de más antes de llegar a
  // pagar, y quitar ese paso deja el checkout más simple: elige, paga, comparte. ----
  const [selectedIds, setSelectedIds] = useState([]);
  const [myRanking, setMyRanking] = useState(registrant ? suggestedRanking(registrant.name) || "" : "");
  const [showCheckout, setShowCheckout] = useState(false);
  const [done, setDone] = useState(null); // { names, pendingTeams: [{catId, catName, teamId}], registrantName, isSelf } de la última confirmación

  // Si el admin cambia a quién está inscribiendo, refresca el ranking sugerido -- si se
  // quedara el de la persona anterior, se guardaría un ranking equivocado en el nuevo equipo.
  useEffect(() => {
    setMyRanking(registrant ? suggestedRanking(registrant.name) || "" : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrant?.name]);

  const selectedCats = eligible.filter((c) => selectedIds.includes(c.id));
  // Cuántas categorías de este torneo tiene YA el registrant, de un checkout anterior y
  // separado (v2.56.0) -- si ya pagó su 1ra categoría en algún momento, este carrito nuevo no
  // debe volver a cobrarle el precio de 1ra categoría (ver tournamentRegPriceFrom).
  const alreadyRegisteredCount = registrant ? countRegisteredCategories(categories, tournament.id, registrant) : 0;
  // Precio TOTAL del carrito según cuántas categorías se eligieron de una, sumado a lo que ya
  // tiene inscrito de antes -- cada una suma su propio precio marginal (ver
  // tournamentRegPriceFrom, v2.56.0, antes tournamentRegPrice sin memoria de checkouts
  // pasados). pricePerTeam reparte ese total en partes iguales entre los equipos que se van a
  // crear, para que la suma de priceUsd guardada en cada equipo dé el total real cobrado
  // (buildClientActivity() suma priceUsd por jugador para las estadísticas del club -- si acá
  // se guardara el total completo en cada equipo, esa suma inflaría el ingreso real del
  // carrito por la cantidad de categorías elegidas).
  const total = selectedCats.length > 0 ? tournamentRegPriceFrom(tournament, alreadyRegisteredCount, selectedCats.length) : 0;
  const pricePerTeam = selectedCats.length > 0 ? total / selectedCats.length : 0;
  const canProceed = selectedCats.length > 0;

  const toggleCat = (id) => {
    setDone(null);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  // Agrupar por NIVEL (v2.51.0) -- antes una lista plana de cards, una por categoría (nivel +
  // modalidad + género ya mezclados). Ahora primero se elige el nivel (ej. "Open /
  // Profesional", "Master (+50)") con un botón, y debajo se despliegan las modalidades
  // disponibles en ESE nivel (ej. "Dobles Mixto", "Dobles Masculino") -- inscribirse en varias
  // categorías del mismo nivel ya no repite el paso de elegirlo, y de paso el checkout se
  // siente guiado en vez de una lista larga de un tirón.
  const levelGroups = useMemo(() => {
    const byLevel = new Map();
    eligible.forEach((c) => {
      if (!byLevel.has(c.level)) byLevel.set(c.level, []);
      byLevel.get(c.level).push(c);
    });
    return [...byLevel.entries()];
  }, [eligible]);
  const [expandedLevels, setExpandedLevels] = useState([]);
  const toggleLevel = (level) => setExpandedLevels((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]));

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  // v2.44.4: espera de verdad a que cada equipo se GUARDE (addTeam ahora es async y confirma
  // contra Supabase) antes de decir "¡Listo!" -- antes esto asumía éxito apenas se llamaba a
  // addTeam, así que un guardado que fallara en silencio (sin internet un instante, error del
  // servidor) igual mostraba la inscripción como confirmada. Así fue como al menos un socio
  // real quedó convencido de estar inscrito sin que el equipo llegara nunca a la base de datos
  // -- el aviso de "sin sincronizar" que hubiera delatado el problema es admin-only, el
  // jugador nunca lo ve.
  const confirm = async (checkout) => {
    if (confirming) return;
    setConfirming(true); setConfirmError("");
    // Toda categoría de dobles arranca "esperando pareja" (v2.51.0 -- ya no se elige acá, ver
    // comentario más arriba) -- se ofrece compartir el link DESPUÉS de esta pantalla (bloque
    // `done` más abajo), nunca antes: mostrarlo en medio del checkout era un punto de fuga
    // (algo más en qué pensar antes de pagar).
    const pendingTeams = [];
    const failedCatNames = [];
    for (const c of selectedCats) {
      const players = [{ name: registrant.name, ranking: Number(myRanking) || 0, ...(registrant.userId ? { userId: registrant.userId } : {}) }];
      // priceUsd/priceBs se pisan por categoría -- el checkout trae el TOTAL del carrito (para
      // mostrarlo), pero cada equipo debe quedar con su parte proporcional. userId queda el de
      // la persona registrada (registrant), NUNCA el del admin que hizo el checkout -- es lo
      // que usa buildClientActivity() para atribuirle el pago a ella, no a quien lo cobró.
      const result = await addTeam(c.id, players, { ...checkout, priceUsd: pricePerTeam, priceBs: pricePerTeam * (Number(club.bsPerUsd) || 0), ...(registrant.userId ? { userId: registrant.userId } : {}) });
      if (result.error) { failedCatNames.push(c.name); continue; }
      if (c.modality !== "individual") pendingTeams.push({ catId: c.id, catName: c.name, teamId: result.teamId });
    }
    setConfirming(false);
    if (failedCatNames.length > 0) {
      // No se cierra el checkout ni se limpia la selección -- así puede reintentar sin tener
      // que volver a elegir categorías/método de pago de cero.
      setConfirmError(`No se pudo confirmar ${isSelf ? "tu" : "la"} inscripción en: ${failedCatNames.join(", ")}. Revisa tu conexión e intenta de nuevo -- no se guardó nada para esas categorías.`);
      return;
    }
    // El popup se queda abierto mostrando el éxito (v2.49.1) -- antes se cerraba de una y el
    // aviso "¡Listo!" + el botón de invitar pareja aparecían en la página, debajo de la lista
    // de categorías, lo que era fácil perderse de vista al cerrarse el modal encima. Ahora
    // `done` decide qué muestra el modal (ver más abajo): el formulario de checkout, o el
    // éxito -- se cierra de verdad recién cuando el jugador toca "Cerrar".
    setDone({ names: selectedCats.map((c) => c.name), pendingTeams, registrantName: registrant.name, isSelf });
    setSelectedIds([]);
  };
  const closeCheckout = () => { setShowCheckout(false); setDone(null); setConfirmError(""); };

  if (categories.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Todavía no hay categorías abiertas para inscripción.</p></Card>;
  }

  return (
    <div className="mt-2 max-w-3xl">
      {isAdmin && <RegistrantPicker users={users} currentUser={currentUser} onChange={setRegistrant} />}

      {/* v2.64.0: reenviar el link de invitar pareja en cualquier momento -- ver comentario de
         myPendingTeams más arriba. Va ANTES de "Categorías abiertas" a propósito: si ya tiene
         un cupo esperando pareja, resolver eso es más urgente que ver qué más puede inscribir. */}
      {myPendingTeams.length > 0 && (
        <Card className="mb-5">
          <p className="font-bold text-sm mb-1" style={{ color: COLORS.courtDark }}>
            {isSelf ? "Todavía esperando pareja" : `${registrant.name} todavía espera pareja`}
          </p>
          <p className="text-xs mb-3" style={{ color: "#6B7688" }}>
            {myPendingTeams.length === 1 ? "Esta categoría" : "Estas categorías"} ya está{myPendingTeams.length === 1 ? "" : "n"} pagada{myPendingTeams.length === 1 ? "" : "s"} -- comparte el link cuando quieras, se puede reenviar las veces que haga falta.
          </p>
          <div className="space-y-2">
            {myPendingTeams.map((pt) => {
              const waMessage = isSelf
                ? `Te invité a jugar ${pt.catName} conmigo en ${tournament.name} -- únete y confirma tu cupo acá:\n${joinTeamUrl(pt.catId, pt.teamId)}`
                : `${registrant.name} te invitó a jugar ${pt.catName} en ${tournament.name} -- únete y confirma tu cupo acá:\n${joinTeamUrl(pt.catId, pt.teamId)}`;
              return (
                <a key={pt.teamId} href={`https://wa.me/?text=${encodeURIComponent(waMessage)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#25D366", color: "#fff" }}>
                  <Share2 size={14} /> {isSelf ? `Invitar a tu pareja en ${pt.catName}` : `Compartir invitación a pareja en ${pt.catName}`}
                </a>
              );
            })}
          </div>
        </Card>
      )}

      <SectionTitle sub="Elige el nivel y después la modalidad -- puedes marcar varias, se pagan juntas en un solo checkout.">
        Categorías abiertas
      </SectionTitle>

      {/* Precio acumulado por categorías elegidas juntas -- cada una SUMA su propio precio
         marginal (v2.33.0, ver tournamentRegPrice), ya no es un precio de bundle fijo. Se
         muestra antes de la lista para que el jugador sepa el trato de entrada, ya que las
         tarjetas de abajo ya no llevan un precio fijo por categoría (depende de cuántas se
         elijan juntas). v2.56.0: si el registrant ya tiene categorías de un checkout anterior
         (alreadyRegisteredCount > 0), estos montos ya arrancan en precio de "categoría
         adicional" en vez de volver a mostrar el precio de 1ra categoría -- mismo
         tournamentRegPriceFrom que usa el total real del carrito, así el aviso nunca promete un
         precio que el checkout no va a cobrar. */}
      {[1, 2, 3].some((n) => tournamentRegPriceFrom(tournament, alreadyRegisteredCount, n) > 0) && (
        <div className="mb-4">
          {alreadyRegisteredCount > 0 && (
            <p className="text-[11px] mb-1.5 font-semibold" style={{ color: COLORS.courtDark }}>
              Ya estás inscrito en {alreadyRegisteredCount} categoría{alreadyRegisteredCount === 1 ? "" : "s"} de este torneo -- lo que agregues ahora paga precio de categoría adicional.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].map((n) => {
              const price = tournamentRegPriceFrom(tournament, alreadyRegisteredCount, n);
              if (!price) return null;
              return (
                <span key={n} className="text-xs px-3 py-1.5 rounded-full font-semibold" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
                  {n} categoría{n === 1 ? "" : "s"}: <b>{formatMoney(price)}</b>
                </span>
              );
            })}
          </div>
          {tournamentTierPrice(tournament, 2) > 0 && (
            <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>Cada categoría adicional suma {formatMoney(tournamentTierPrice(tournament, 2))} más.</p>
          )}
        </div>
      )}

      {isSelf && !currentUser.gender && (
        <button onClick={() => setTab?.("perfil")} className="w-full text-left text-[11px] font-semibold px-3 py-2.5 rounded-xl mb-4 flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
          <AlertTriangle size={12} className="shrink-0" /> Completa tu género en Perfil para ver solo tus categorías — por ahora se muestran todas.
        </button>
      )}

      <div className="space-y-3" style={{ paddingBottom: selectedIds.length > 0 ? 96 : 0 }}>
        {levelGroups.map(([level, cats]) => {
          const isExpanded = expandedLevels.includes(level);
          const selectedCount = cats.filter((c) => selectedIds.includes(c.id)).length;
          return (
            <div key={level} className="rounded-2xl overflow-hidden" style={{ border: `1.5px solid ${selectedCount > 0 ? COLORS.court : COLORS.line}` }}>
              <button type="button" onClick={() => toggleLevel(level)} className="w-full flex items-center justify-between gap-3 p-4 text-left" style={{ background: selectedCount > 0 ? "#F3F8F1" : COLORS.card }}>
                <span className="font-bold text-sm" style={{ color: COLORS.courtDark }}>{level}</span>
                <span className="flex items-center gap-2 shrink-0">
                  {selectedCount > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: COLORS.court, color: "#fff" }}>
                      {selectedCount} elegida{selectedCount === 1 ? "" : "s"}
                    </span>
                  )}
                  <ChevronDown size={16} color="#6B7688" style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                </span>
              </button>
              {isExpanded && (
                <div className="px-3 pb-3 space-y-1.5" style={{ borderTop: `1px solid ${COLORS.line}` }}>
                  {cats.map((c) => {
                    const isFull = categoryIsFull(c); // v2.57.0 -- cupo real en jugadores, no en filas
                    const isSelected = selectedIds.includes(c.id);
                    return (
                      <button key={c.id} type="button" onClick={() => toggleCat(c.id)}
                        className="w-full text-left px-3.5 py-3 mt-1.5 rounded-xl flex items-center gap-3"
                        style={{ background: isSelected ? "#EAF3E6" : "#F7F8FA", border: `1.5px solid ${isSelected ? COLORS.court : "transparent"}` }}>
                        <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: isSelected ? COLORS.court : "#fff", border: `1.5px solid ${isSelected ? COLORS.court : COLORS.line}` }}>
                          {isSelected && <Check size={12} color="#fff" strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold" style={{ color: COLORS.ink }}>{c.modality === "individual" ? "Individual" : "Dobles"} {GENDER_LABELS[c.gender]}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: "#6B7688" }}>
                            {categoryCountLabel(c)}{isFull ? " · Lista de espera" : ""}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {levelGroups.length === 0 && (
          <p className="text-xs text-gray-400 italic px-1">
            {registrant
              ? "No hay categorías disponibles en este momento -- ya está inscrito/a en todas las abiertas, o su calendario ya fue generado."
              : "Elige arriba para quién es esta inscripción antes de ver las categorías disponibles."}
          </p>
        )}
      </div>

      {/* Barra de carrito, siempre visible mientras haya algo seleccionado -- fixed, no
         sticky, para que no se pierda al scrollear la lista. bottom-16 en mobile deja
         libre el MobileNav; md:left-64 deja libre el Sidebar de desktop. */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-16 md:bottom-5 left-0 md:left-64 right-0 z-40 px-4 md:px-10 flex justify-center pointer-events-none">
          <div className="w-full max-w-3xl rounded-2xl px-4 md:px-5 py-3.5 flex items-center justify-between gap-3 pointer-events-auto" style={{ background: COLORS.courtDark, boxShadow: "0 16px 40px -12px rgba(15,23,32,.5)" }}>
            <div className="min-w-0">
              <p className="text-[11px]" style={{ color: "#93A8C9" }}>{selectedCats.length} categoría{selectedCats.length === 1 ? "" : "s"} seleccionada{selectedCats.length === 1 ? "" : "s"}</p>
              <p className="disp text-xl leading-tight" style={{ color: COLORS.ball }}>{formatMoney(total)}</p>
            </div>
            <button disabled={!canProceed} onClick={() => setShowCheckout(true)}
              style={{ background: canProceed ? COLORS.clay : "rgba(255,255,255,0.1)", color: canProceed ? "#fff" : "#5B6B85" }}
              className="px-5 py-2.5 rounded-xl font-bold text-sm shrink-0 flex items-center gap-1.5">
              Continuar <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {showCheckout && (
        <Modal onClose={closeCheckout}>
          <Card>
            {done ? (
              // Éxito (v2.49.1) -- se queda DENTRO del mismo popup en vez de cerrarlo y avisar
              // en la página de atrás; el botón de invitar pareja vive acá mismo, justo donde
              // el jugador ya está mirando, en vez de un paso más allá que se puede perder de
              // vista. Ver comentario en confirm() para el porqué del cambio.
              <>
                <div className="flex items-center gap-2 mb-3"><CheckCircle2 size={20} color={COLORS.court} /><p className="disp text-lg" style={{ color: COLORS.courtDark }}>¡Listo!</p></div>
                <p className="text-sm mb-1" style={{ color: "#6B7688" }}>
                  {done.isSelf
                    ? <>Quedaste inscrito en: <strong>{done.names.join(", ")}</strong>.</>
                    : <>Se registró a <strong>{done.registrantName}</strong> en: <strong>{done.names.join(", ")}</strong>.</>}
                </p>
                {/* Compartir con la pareja (v2.44.2) -- recién ACÁ, después de que el checkout
                   ya terminó, nunca antes: la persona ya pagó lo suyo y este es un paso
                   opcional de remate, no algo que pueda hacerla dudar a mitad de pago. Un botón
                   por cada categoría que quedó "esperando pareja". Texto distinto si fue el
                   admin quien inscribió a otra persona (v2.46.0) -- "te invité...conmigo" no
                   tendría sentido ahí. */}
                {done.pendingTeams.length > 0 && (
                  <div className="space-y-2 mt-3 mb-1">
                    {done.pendingTeams.map((pt) => {
                      const waMessage = done.isSelf
                        ? `Te invité a jugar ${pt.catName} conmigo en ${tournament.name} -- únete y confirma tu cupo acá:\n${joinTeamUrl(pt.catId, pt.teamId)}`
                        : `${done.registrantName} te invitó a jugar ${pt.catName} en ${tournament.name} -- únete y confirma tu cupo acá:\n${joinTeamUrl(pt.catId, pt.teamId)}`;
                      return (
                        <a key={pt.teamId} href={`https://wa.me/?text=${encodeURIComponent(waMessage)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#25D366", color: "#fff" }}>
                          <Share2 size={14} /> {done.isSelf ? `Invitar a tu pareja en ${pt.catName}` : `Compartir invitación a pareja en ${pt.catName}`}
                        </a>
                      );
                    })}
                  </div>
                )}
                <button onClick={closeCheckout} className="w-full py-2.5 rounded-xl text-sm font-bold mt-3" style={{ background: COLORS.court, color: "#fff" }}>Cerrar</button>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="disp text-lg" style={{ color: COLORS.courtDark }}>Confirmar inscripción</p>
                    <p className="text-xs mt-1" style={{ color: "#6B7688" }}>{selectedCats.length} categoría{selectedCats.length === 1 ? "" : "s"}</p>
                  </div>
                  <button onClick={closeCheckout} className="text-gray-300 hover:text-gray-600"><X size={18} /></button>
                </div>

                <div className="space-y-1.5 mb-4">
                  {/* Precio marginal por línea (v2.44.1): la 1ra categoría marcada muestra el
                     precio de tier 1, cualquier otra el de tier 2 ("categoría adicional") --
                     mismo criterio que tournamentRegPrice, así el jugador ve exactamente cómo
                     se arma la suma antes de pagar. */}
                  {selectedCats.map((c, i) => {
                    const isFull = categoryIsFull(c); // v2.57.0 -- cupo real en jugadores, no en filas
                    // v2.56.0: si ya tenía categorías de un checkout anterior (alreadyRegisteredCount),
                    // esta línea es la (alreadyRegisteredCount+i+1)-ésima de verdad -- solo la
                    // primerísima categoría de todas (nunca tuvo ninguna antes) paga tier 1, el
                    // resto paga tier 2 ("categoría adicional"), igual que tournamentRegPriceFrom.
                    const tierPrice = tournamentTierPrice(tournament, Math.min(2, alreadyRegisteredCount + i + 1));
                    return (
                      <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm" style={{ background: "#EEF1F7" }}>
                        <div className="min-w-0">
                          {/* v2.60.0: sin `truncate` en el nombre -- con un badge "Lista de
                             espera" pegado al lado, truncar cortaba el badge a media palabra.
                             Deja que el nombre haga wrap en vez de recortarse. */}
                          <p className="font-semibold" style={{ color: COLORS.ink }}>
                            <CategoryLabel cat={c} />{isFull && <span className="text-[9px] font-bold ml-1.5 px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ background: "#FBF3E4", color: "#8A5A16" }}>Lista de espera</span>}
                          </p>
                          {c.modality !== "individual" && (
                            <p className="text-[11px]" style={{ color: "#6B7688" }}>Dobles -- invitas a tu pareja después de pagar</p>
                          )}
                        </div>
                        <span className="mono text-xs font-bold shrink-0" style={{ color: "#6B7688" }}>{i === 0 ? formatMoney(tierPrice) : `+${formatMoney(tierPrice)}`}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-bold" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>
                    <span>Total ({selectedCats.length} categoría{selectedCats.length === 1 ? "" : "s"})</span>
                    <span className="mono">{formatMoney(total)}</span>
                  </div>
                </div>

                {confirmError && (
                  <p className="text-xs font-semibold mb-3 px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
                    <AlertTriangle size={13} className="shrink-0" /> {confirmError}
                  </p>
                )}
                {confirming && (
                  <p className="text-xs font-semibold mb-3" style={{ color: "#6B7688" }}>Confirmando la inscripción…</p>
                )}
                <CheckoutPanel title={`Pago de ${selectedCats.length} categoría${selectedCats.length === 1 ? "" : "s"}`} baseUsd={total} discountPct={0} club={club} defaultName={registrant.name} requireName={false}
                  onConfirm={confirm} onCancel={closeCheckout} confirmLabel={confirming ? "Confirmando…" : "Confirmar inscripción"} />
              </>
            )}
          </Card>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================================
   TAB: RESULTADOS
   ========================================================================= */
// Orden cronológico compartido por Resultados y Calendario: día+hora, luego cancha (según
// el orden en Club) -- así ambas pestañas listan los partidos en el mismo orden.
function chronoSort(matches, courtOrder) {
  return [...matches].sort((a, b) => {
    if (!a.day && !b.day) return 0;
    if (!a.day) return 1;
    if (!b.day) return -1;
    const byTime = (a.day + a.time).localeCompare(b.day + b.time);
    if (byTime !== 0) return byTime;
    return (courtOrder[a.courtId] ?? 0) - (courtOrder[b.courtId] ?? 0);
  });
}

// Número de partido único por día (v2.79.0, a pedido del club) -- el MISMO número tiene que
// verse en la planilla impresa que llevan los supervisores de cancha, en la lista "Cargar
// resultados" y en "En cancha ahora", sea cual sea la categoría que se esté mirando en
// pantalla en ese momento. Por eso NO se numera 1..N sobre la lista ya filtrada de cada vista
// (eso le daría un número distinto al mismo partido según si se está viendo "Todas" o una sola
// categoría) -- se numera UNA vez sobre TODOS los partidos jugables del día (todas las
// categorías juntas, mismo chronoSort que ya usa el tablero de Calendario) y cada vista busca
// el número de cada partido puntual en este mapa en vez de recontar desde cero.
function buildMatchIndex(categories, courts, day) {
  const courtOrder = {}; courts.forEach((c, i) => { courtOrder[c.id] = i; });
  const todays = categories.flatMap((c) => c.matches.filter((m) => !isByeMatch(m) && m.day === day));
  const sorted = chronoSort(todays, courtOrder);
  const map = new Map();
  sorted.forEach((m, i) => map.set(m.id, i + 1));
  return map;
}

// Mismo criterio de normalización que playersOf() dentro de buildSchedule -- nombre recortado
// y en minúscula, para que comparar jugadores entre partidos no falle por mayúsculas/espacios.
function matchPlayerNames(m, cat) {
  const a = cat.teams.find((t) => t.id === m.teamAId);
  const b = cat.teams.find((t) => t.id === m.teamBId);
  return [
    ...(a ? a.players.map((p) => p.name.trim().toLowerCase()) : []),
    ...(b ? b.players.map((p) => p.name.trim().toLowerCase()) : []),
  ];
}

// "Mesa técnica" (v2.78.0, a pedido del club) -- para cada cancha, calcula quién está jugando
// AHORA MISMO y a quién llamar apenas se libere, sin arriesgarse a llamar a alguien que sigue
// en otra cancha. No hay ningún reloj en vivo en esta app -- "en cancha ahora" se deduce de los
// datos que ya existen: es, para cada cancha, el partido de HOY sin resultado más temprano
// (`winnerId` nulo) según el horario ya planificado. Mientras esa suposición se sostenga (los
// partidos de una cancha se juegan en el orden en que se planificaron, uno detrás de otro,
// que es como de verdad opera el club), no hace falta agregar ningún campo nuevo a `matches`.
//
// "Ocupados" es la unión de jugadores de TODOS los partidos "en cancha ahora" (cualquier
// cancha). El siguiente turno de cada cancha es, primero, SU PROPIO próximo partido en cola --
// pero si ese choca con alguien ocupado, se lo salta y busca en la cola COMPLETA de hoy (de
// cualquier cancha, ver `pool`) el más próximo en el orden original sin choques -- ese
// préstamo es el "ajuste de cancha" que pidió el club. Cada partido se reclama (`claimed`) en
// cuanto se le asigna a una cancha para que dos canchas nunca se disputen el mismo próximo
// turno en la misma pasada.
function computeNextCalls(categories, courts, day) {
  const todays = categories.flatMap((c) => c.matches
    .filter((m) => !isByeMatch(m) && m.day === day && m.teamAId && m.teamBId)
    .map((m) => ({ ...m, __cat: c })));

  const byCourt = {};
  todays.forEach((m) => { (byCourt[m.courtId] = byCourt[m.courtId] || []).push(m); });
  Object.values(byCourt).forEach((list) => list.sort((a, b) => a.time.localeCompare(b.time)));

  const currentByCourt = {};
  Object.entries(byCourt).forEach(([courtId, list]) => {
    const current = list.find((m) => !m.winnerId);
    if (current) currentByCourt[courtId] = current;
  });

  const busy = new Set();
  Object.values(currentByCourt).forEach((m) => matchPlayerNames(m, m.__cat).forEach((p) => busy.add(p)));

  const currentIds = new Set(Object.values(currentByCourt).map((m) => m.id));
  const courtOrder = {}; courts.forEach((c, i) => (courtOrder[c.id] = i));
  const pool = chronoSort(todays.filter((m) => !m.winnerId && !currentIds.has(m.id)), courtOrder);
  const claimed = new Set();

  return courts.map((court) => {
    const current = currentByCourt[court.id] || null;
    // A los jugadores del partido actual de ESTA cancha no hay que tratarlos como "ocupados"
    // para elegir el siguiente de esta misma cancha -- son justo los que están a punto de
    // quedar libres apenas se cargue este resultado.
    const busyForThisCourt = new Set(busy);
    if (current) matchPlayerNames(current, current.__cat).forEach((p) => busyForThisCourt.delete(p));

    const own = (byCourt[court.id] || []).find((m) => !m.winnerId && m.id !== current?.id);
    let next = null;
    if (own && !claimed.has(own.id) && matchPlayerNames(own, own.__cat).every((p) => !busyForThisCourt.has(p))) {
      next = own;
    } else {
      next = pool.find((m) => !claimed.has(m.id) && matchPlayerNames(m, m.__cat).every((p) => !busyForThisCourt.has(p))) || null;
    }
    if (next) claimed.add(next.id);
    return { court, current, next, borrowed: !!(next && next.courtId !== court.id) };
  });
}

// v2.77.1: vista de solo lectura con las clasificaciones de TODAS las categorías a la vez --
// antes había que entrar a Resultados y filtrar categoría por categoría para ver una tabla de
// posiciones o un cuadro de eliminación puntual. Reutiliza StandingsTable/BracketView/
// DoubleEliminationView tal cual (mismo cálculo de pie que ya usa Resultados, computeStandings
// sobre `cat.matches`), sin la carga de marcador ni el botón de "cerrar fase de grupos" -- eso
// sigue viviendo en Resultados, esto es solo para mirar cómo va cada categoría de un vistazo.
function ClasificacionTab({ categories }) {
  if (categories.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Crea una categoría primero.</p></Card>;
  }

  const withDraw = sortCategoriesByLevel(categories).filter((c) => c.drawGenerated);

  if (withDraw.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Todavía ninguna categoría tiene un draw generado -- las clasificaciones aparecen acá apenas empiecen los partidos.</p></Card>;
  }

  return (
    <div className="mt-2 space-y-5">
      {withDraw.map((cat) => {
        const isDouble = cat.format === "doble_eliminacion";
        const hasSingleBracket = cat.matches.some((m) => m.phase === "bracket");
        return (
          <Card key={cat.id}>
            <SectionTitle>{cat.name}</SectionTitle>
            {cat.groups.length > 0 && (
              <div className="space-y-4 mt-2">
                {cat.groups.map((g) => (
                  <div key={g.id}>
                    <p className="text-sm font-bold mb-1.5" style={{ color: COLORS.courtDark }}>{g.name}</p>
                    <StandingsTable rows={computeStandings(cat.teams, g.teamIds, cat.matches.filter((m) => m.groupId === g.id))} qualifiers={g.qualifiers} />
                  </div>
                ))}
              </div>
            )}
            {isDouble && (
              <div className="mt-4">
                <p className="text-sm font-bold mb-1.5" style={{ color: COLORS.courtDark }}>Cuadro de eliminación</p>
                <DoubleEliminationView cat={cat} />
              </div>
            )}
            {!isDouble && hasSingleBracket && (
              <div className="mt-4">
                <p className="text-sm font-bold mb-1.5" style={{ color: COLORS.courtDark }}>Cuadro de eliminación</p>
                <BracketView cat={cat} />
              </div>
            )}
            {cat.groups.length === 0 && !isDouble && !hasSingleBracket && (
              <p className="text-xs text-gray-400 italic mt-2">Sin partidos agendados todavía.</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function ResultadosTab({ categories, courts, submitScore, closeGroupsAndSeedBracket, tournament, dates, moveMatch, markMatchOnCourt, role }) {
  const isAdmin = role === "admin";
  // Por defecto "Todas" -- la cola combinada y cronológica de partidos por cargar, igual
  // que pide el usuario ("ordenados cronológicamente exactamente igual que el calendario").
  // Filtrar a una categoría puntual (con sus tablas/bracket) sigue disponible como antes.
  const [catId, setCatId] = useState("all");
  // v2.77.0: filtro por día, mismo patrón que CalendarioTab -- "Cargar resultados" mezclaba
  // todos los días del torneo en una sola lista larga; el club pidió poder ver un día a la vez,
  // igual que ya se puede en Calendario.
  const [selectedDay, setSelectedDay] = useState("");
  const day = dates.includes(selectedDay) ? selectedDay : (dates[0] || "");
  // v2.68.0: planillas descargables -- ver PrintScoreSheets. `printing` solo controla que el
  // bloque imprimible exista en el DOM (se monta al pulsar el botón, se desmonta solo al
  // cerrar el diálogo de impresión vía el evento "afterprint").
  const [printing, setPrinting] = useState(false);
  const cat = catId === "all" ? null : categories.find((c) => c.id === catId) || null;
  const courtOrder = {}; courts.forEach((c, i) => { courtOrder[c.id] = i; });
  const courtById = {}; courts.forEach((c) => (courtById[c.id] = c));
  // Mismo mapa de colores por categoría que usa el tablero de Calendario (misma `categories`,
  // mismo orden -- ver buildCategoryColorMap) para que la etiqueta de acá pegue con el color
  // que el club ya asocia a esa categoría en el calendario.
  const catColorMap = useMemo(() => buildCategoryColorMap(categories), [categories]);
  // v2.78.0: "mesa técnica" -- siempre sobre TODAS las categorías del día (no respeta el chip
  // de categoría activo), porque las canchas se comparten entre categorías y el llamado tiene
  // que tener en cuenta a todo el mundo, no solo a la categoría que se está mirando ahora mismo.
  const nextCalls = useMemo(() => computeNextCalls(categories, courts, day), [categories, courts, day]);
  // v2.79.0: número de partido único por día, igual en la planilla impresa, en esta lista y en
  // "En cancha ahora" -- ver buildMatchIndex.
  const matchIndex = useMemo(() => buildMatchIndex(categories, courts, day), [categories, courts, day]);

  if (categories.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Crea una categoría primero.</p></Card>;
  }

  // v2.77.0: categorías ordenadas por nivel (mismo orden que LEVEL_OPTIONS) y luego por
  // modalidad/género -- antes salían en el orden en que se crearon, "sueltas" sin ningún
  // criterio visible.
  const sortedCategories = sortCategoriesByLevel(categories);

  const catChips = (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => setCatId("all")} className="px-3 py-1.5 rounded-full text-xs font-semibold"
        style={{ background: catId === "all" ? COLORS.court : "#EAEEF5", color: catId === "all" ? "#fff" : COLORS.ink }}>Todas</button>
      {sortedCategories.map((c) => (
        <button key={c.id} onClick={() => setCatId(c.id)} className="px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: catId === c.id ? COLORS.court : "#EAEEF5", color: catId === c.id ? "#fff" : COLORS.ink }}>{c.name}</button>
      ))}
    </div>
  );

  const dayTabs = dates.length > 0 && (
    <div className="flex flex-wrap gap-2">
      {dates.map((d) => (
        <button key={d} onClick={() => setSelectedDay(d)} className="px-3.5 py-2 rounded-xl text-sm font-bold"
          style={{ background: d === day ? COLORS.court : "#EAEEF5", color: d === day ? "#fff" : COLORS.ink }}>
          {formatDateHuman(d)}
        </button>
      ))}
    </div>
  );

  // v2.78.0/v2.78.1/v2.78.2: panel "En cancha ahora" (se llamó "Próximos a llamar" hasta
  // v2.78.1, pero lo grande y prominente de cada fila es el partido ACTIVO, no el siguiente --
  // el club lo notó, el título quedaba al revés de lo que en realidad se ve primero) -- una
  // fila por cancha, siempre visible arriba de la lista. `borrowed` marca un partido que se le
  // "prestó" a esta cancha desde la cola de otra (ver computeNextCalls) -- confirmar el ajuste
  // reasigna la cancha DE VERDAD (moveMatch), tomando el horario del partido que se está por
  // liberar en esta cancha (`current`) para no chocar con lo que ya tenga planificado esta
  // cancha más adelante.
  //
  // v2.78.1: el partido "en juego" se carga ACÁ MISMO -- se reusa MatchRow tal cual (mismo
  // formulario de sets, mismo submitScore) en vez de duplicar esa lógica. v2.78.3: arranca
  // cerrado igual que en la lista de abajo (a pedido del club, que prefiere presionar "Cargar
  // marcador" a propósito antes de ver los campos de sets) -- se sacó el `defaultOpen` que
  // lo abría solo. Guardar ese resultado le pone winnerId al partido, `categories` cambia, nextCalls se
  // recalcula solo (useMemo de arriba) y el que seguía sube a "en juego" -- sin ningún estado
  // propio de este panel que haya que empujar a mano. El siguiente partido se ve chico y
  // atenuado (opacity), a propósito, para que no compita visualmente con el que sí hay que
  // jugar ahora.
  const teamLabelOf = (m, side) => {
    const cat = m.__cat;
    if (side === "A") return m.teamALabel || cat.teams.find((t) => t.id === m.teamAId)?.name || "Por definir";
    return m.teamBLabel || cat.teams.find((t) => t.id === m.teamBId)?.name || "Por definir";
  };
  const nextCallsPanel = day && (
    <Card>
      <SectionTitle sub="Carga acá mismo el resultado del partido activo de cada cancha -- apenas lo guardes, la cancha pasa sola al que sigue (chico y en gris, debajo de cada uno).">En cancha ahora</SectionTitle>
      <div className="space-y-3 mt-2">
        {nextCalls.map(({ court, current, next, borrowed }) => (
          <div key={court.id} className="rounded-lg p-2.5" style={{ background: "#F5F6F9" }}>
            <p className="text-xs font-extrabold uppercase tracking-wide mb-1.5" style={{ color: COLORS.courtDark }}>{court.name}</p>
            {current && !current.checkedIn ? (
              // v2.79.1: recién promovido, todavía sin confirmar que los jugadores entraron a
              // la cancha -- se resalta distinto (ámbar, no el crema normal de MatchRow) y el
              // botón dice "En cancha" en vez de "Cargar marcador" para que a mesa técnica no
              // se le olvide anunciarlo y verificar antes de darlo por "en juego" de verdad.
              <div className="rounded-xl p-3" style={{ background: "#FBF3E4", border: `1px solid ${COLORS.line}` }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-sm flex items-center flex-wrap gap-x-2 gap-y-1">
                    {matchIndex.get(current.id) != null && <span className="mono text-xs font-extrabold" style={{ color: COLORS.court }}>#{matchIndex.get(current.id)}</span>}
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wide" style={{ background: (catColorMap[current.__cat.id] || CATEGORY_PALETTE[0]).bg, color: (catColorMap[current.__cat.id] || CATEGORY_PALETTE[0]).text }}>{catBadgeLabel(current.__cat)}</span>
                    <span className="mono text-xs text-gray-400">{formatTimeAmPm(current.time)} · {courtById[current.courtId]?.name}</span>
                    <span>{teamLabelOf(current, "A")}<span className="text-gray-400 mx-1.5">vs</span>{teamLabelOf(current, "B")}</span>
                  </div>
                  {isAdmin && (
                    <button onClick={() => markMatchOnCourt(current.__cat.id, current.id)}
                      style={{ background: "#C97A1B", color: "#fff" }} className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0">
                      En cancha
                    </button>
                  )}
                </div>
              </div>
            ) : current ? (
              <MatchRow key={current.id} m={current} cat={current.__cat} catColor={catColorMap[current.__cat.id]} courtById={courtById}
                matchNumber={matchIndex.get(current.id)}
                teamName={(id) => current.__cat.teams.find((t) => t.id === id)?.name || "?"} bestOf={current.__cat.bestOf}
                onSubmit={(sets) => submitScore(current.__cat.id, current.id, sets)} />
            ) : (
              <p className="text-xs text-gray-400 italic">Cancha libre ahora mismo.</p>
            )}
            {next ? (
              <div className="mt-1.5 pl-0.5" style={{ opacity: 0.55 }}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px]">Sigue: #{matchIndex.get(next.id)} -- {teamLabelOf(next, "A")} vs {teamLabelOf(next, "B")}</span>
                  {borrowed && (
                    <span className="text-[8px] font-extrabold px-1 py-0.5 rounded-full uppercase tracking-wide" style={{ background: "#FBF3E4", color: "#8A5A16" }}>Ajuste</span>
                  )}
                </div>
                {borrowed && <p className="text-[10px]">Estaba en {courts.find((c) => c.id === next.courtId)?.name}</p>}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 italic mt-1.5">Sin partidos pendientes.</p>
            )}
            {next && borrowed && isAdmin && (
              <button
                onClick={() => moveMatch(next.__cat.id, next.id, { day, time: current ? current.time : next.time, courtId: court.id })}
                style={{ color: COLORS.court }} className="text-[11px] font-bold underline mt-1">
                Confirmar cambio de cancha
              </button>
            )}
          </div>
        ))}
        {nextCalls.length === 0 && <p className="text-xs text-gray-400 italic">Este torneo no tiene canchas asignadas.</p>}
      </div>
    </Card>
  );

  // Botón compartido por las dos vistas (Todas / una categoría) -- descarga justo los
  // partidos que se están viendo en pantalla en ese momento (respeta el filtro activo, día
  // incluido -- v2.77.0: antes bajaba TODOS los días juntos en una sola planilla).
  const downloadButton = (printMatches) => (
    <button onClick={() => setPrinting(true)} disabled={printMatches.length === 0}
      style={{ background: "#fff", color: COLORS.court, border: `1.5px solid ${COLORS.court}`, opacity: printMatches.length === 0 ? 0.4 : 1 }}
      className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5">
      <Download size={13} /> Descargar planillas
    </button>
  );

  const printTitle = tournament?.name && day ? `${tournament.name} -- ${formatDateHuman(day)}` : (tournament?.name || "Torneo");

  if (catId === "all") {
    const allPlayable = chronoSort(categories.flatMap((c) => c.matches.filter((m) => !isByeMatch(m) && m.day === day).map((m) => ({ ...m, __cat: c }))), courtOrder);
    return (
      <div className="mt-2 space-y-5">
        {dayTabs}
        {nextCallsPanel}
        <div className="flex items-center justify-between flex-wrap gap-2">
          {catChips}
          {downloadButton(allPlayable)}
        </div>
        <Card>
          <SectionTitle sub={`Partidos jugables de ${day ? formatDateHuman(day) : "este torneo"}, ordenados cronológicamente igual que el Calendario. Los BYE no se muestran porque no se juegan.`}>Cargar resultados</SectionTitle>
          <div className="space-y-3">
            {allPlayable.map((m) => (
              <MatchRow key={m.id} m={m} cat={m.__cat} catName={catBadgeLabel(m.__cat)} catColor={catColorMap[m.__cat.id]} courtById={courtById}
                matchNumber={matchIndex.get(m.id)}
                teamName={(id) => m.__cat.teams.find((t) => t.id === id)?.name || "?"} bestOf={m.__cat.bestOf}
                onSubmit={(sets) => submitScore(m.__cat.id, m.id, sets)} />
            ))}
            {allPlayable.length === 0 && <p className="text-xs text-gray-400 italic">{day ? "No hay partidos programados para este día." : "Genera primero el draw de alguna categoría."}</p>}
          </div>
        </Card>
        {printing && (
          <PrintScoreSheets matches={allPlayable} courtById={courtById} tournamentName={printTitle} matchIndex={matchIndex}
            onClose={() => setPrinting(false)} />
        )}
      </div>
    );
  }

  if (!cat) return <Card className="mt-2"><p className="text-sm text-gray-400">Categoría no encontrada.</p></Card>;

  const teamName = (id) => cat.teams.find((t) => t.id === id)?.name || "?";
  const playableMatches = chronoSort(cat.matches.filter((m) => !isByeMatch(m) && m.day === day), courtOrder);
  const printMatches = playableMatches.map((m) => ({ ...m, __cat: cat }));
  const isDouble = cat.format === "doble_eliminacion";
  const hasSingleBracket = cat.matches.some((m) => m.phase === "bracket");

  return (
    <div className="mt-2 space-y-5">
      {dayTabs}
      {nextCallsPanel}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {catChips}
        {downloadButton(printMatches)}
      </div>

      {cat.groups.map((g) => (
        <Card key={g.id}>
          <SectionTitle>{g.name} — Tabla de posiciones</SectionTitle>
          <StandingsTable rows={computeStandings(cat.teams, g.teamIds, cat.matches.filter((m) => m.groupId === g.id))} qualifiers={g.qualifiers} />
        </Card>
      ))}

      {cat.format === "grupos_eliminatoria" && !cat.groupsClosed && (
        <button onClick={() => closeGroupsAndSeedBracket(cat.id)}
          style={{ background: COLORS.court, color: COLORS.chalk }}
          className="px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5">
          <CheckCircle2 size={15} /> Cerrar fase de grupos y armar eliminatoria
        </button>
      )}

      {isDouble && (
        <Card>
          <SectionTitle sub="Clasificación en vivo de la Llave A y la Llave B.">Cuadro de eliminación</SectionTitle>
          <DoubleEliminationView cat={cat} />
        </Card>
      )}

      {!isDouble && hasSingleBracket && (
        <Card>
          <SectionTitle sub="Clasificación en vivo del cuadro de eliminación.">Cuadro de eliminación</SectionTitle>
          <BracketView cat={cat} />
        </Card>
      )}

      <Card>
        <SectionTitle sub={`Selecciona un partido y carga el marcador (se admite más de un set). Partidos de ${day ? formatDateHuman(day) : "este torneo"} -- los BYE no se muestran porque no se juegan.`}>Cargar resultados</SectionTitle>
        <div className="space-y-3">
          {playableMatches.map((m) => (
            <MatchRow key={m.id} m={m} cat={cat} catColor={catColorMap[cat.id]} courtById={courtById} teamName={teamName} bestOf={cat.bestOf}
              matchNumber={matchIndex.get(m.id)}
              onSubmit={(sets) => submitScore(cat.id, m.id, sets)} />
          ))}
          {playableMatches.length === 0 && <p className="text-xs text-gray-400 italic">{day ? "No hay partidos programados para este día." : "Genera primero el draw de esta categoría."}</p>}
        </div>
      </Card>
      {printing && (
        <PrintScoreSheets matches={printMatches} courtById={courtById} tournamentName={printTitle} matchIndex={matchIndex}
          onClose={() => setPrinting(false)} />
      )}
    </div>
  );
}

// Planillas de resultados en papel (v2.68.0) -- "descargar" acá es imprimir: se abre el
// diálogo de impresión del navegador y desde ahí el admin elige "Guardar como PDF" (o
// imprimirlas de verdad para llevarlas a cancha). Se prefirió esto a generar un PDF de
// verdad porque no hace falta sumar ninguna librería nueva al proyecto (nada de jsPDF) y
// funciona sin conexión, igual que el resto del flujo de Torneo -- ver la nota de
// resiliencia sin internet en loadCache/saveCache más arriba en el archivo.
//
// El truco de CSS es el clásico "ocultar todo menos el bloque a imprimir": en @media print
// TODO se vuelve invisible excepto #print-sheets y sus hijos, que además se reposicionan a
// pantalla completa -- así no hace falta desmontar el resto de la app (sidebar, tabs, etc.)
// para imprimir solo esto. El bloque completo (botones, tabs...) tiene la clase
// "no-print" como refuerzo, aunque con el truco de visibility ya alcanzaría solo.
// v2.76.1: rediseñada a pedido del club, siguiendo el formato de una planilla de otra liga que
// mandaron de ejemplo -- una fila compacta por partido (hora, cancha, equipos, categoría/fase)
// en vez de una tarjeta grande por partido, con dos agregados propios: un número de índice
// corrido al principio de cada fila (la referencia no traía ninguno) y, en el bloque de
// puntaje del medio, tantos pares de casillas como sets tenga que jugarse ESE partido según
// `bestOf` de su categoría (la referencia siempre traía dos casillas fijas, sin importar el
// formato) -- así una casilla por set le sirve a cualquier categoría, sea al mejor de 1, 3 o 5.
// Código corto de categoría para la planilla impresa (v2.76.3, a pedido del club) -- el nombre
// completo ("Dobles Masculino Open") no cabía sin ensanchar la columna, así que se abrevia a
// "nivel-modalidad+género" (ej. "O-DM", "+50-DF", "3.5-DMX"). Los niveles numéricos (3.0...5.0+)
// ya son cortos y pasan tal cual; "Open" y "Master (+50)" son los dos que de verdad hacía
// falta acortar.
const CATEGORY_LEVEL_CODES = { "Principiante": "P", "Open": "O", "Master (+50)": "+50" };
const CATEGORY_GENDER_CODES = { masculino: "M", femenino: "F", mixto: "MX", libre: "L" };
function categoryCode(cat) {
  const levelCode = CATEGORY_LEVEL_CODES[cat.level] ?? cat.level;
  const modalityCode = cat.modality === "individual" ? "I" : "D";
  const genderCode = CATEGORY_GENDER_CODES[cat.gender] ?? "";
  return `${levelCode}-${modalityCode}${genderCode}`;
}

// Mismo criterio que el roundTag de CalendarioTab, pero como función suelta -- PrintScoreSheets
// vive fuera de ese componente y ya trae la categoría de cada partido pegada en `m.__cat`.
function printRoundTag(m) {
  const cat = m.__cat;
  if (!cat) return "";
  if (m.phase === "group") return "Grupos";
  if (m.phase === "bracket") {
    const total = new Set(cat.matches.filter((x) => x.phase === "bracket").map((x) => x.round)).size;
    return roundLabel(m.round, total);
  }
  if (m.phase === "bracket_wr") return `Llave A R${m.round + 1}`;
  if (m.phase === "bracket_lb") return `Llave B R${m.round + 1}`;
  return "";
}

function PrintScoreSheets({ matches, courtById, tournamentName, onClose, matchIndex }) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 80);
    const onAfterPrint = () => onClose();
    window.addEventListener("afterprint", onAfterPrint);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", onAfterPrint); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="print-sheets" className="no-print">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-sheets, #print-sheets * { visibility: visible; }
          #print-sheets { position: absolute; left: 0; top: 0; width: 100%; padding: 16px; }
          .print-sheet-row { break-inside: avoid; page-break-inside: avoid; }
          .print-sheet-table thead { display: table-header-group; }
        }
        @media screen { #print-sheets { display: none; } }
      `}</style>
      <p className="text-lg font-bold">{tournamentName || "Torneo"}</p>
      <p className="text-xs text-gray-500 mb-4">Programa de partidos -- generado el {formatDateFull(new Date().toISOString().slice(0, 10))}</p>
      <table className="print-sheet-table w-full text-xs" style={{ borderCollapse: "collapse", tableLayout: "fixed" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #000" }}>
            <th className="text-left font-semibold pb-1 pr-2" style={{ width: "3%", whiteSpace: "nowrap" }}>#</th>
            <th className="text-left font-semibold pb-1 pr-2" style={{ width: "8%", whiteSpace: "nowrap" }}>Hora</th>
            <th className="text-left font-semibold pb-1 pr-2" style={{ width: "10%", whiteSpace: "nowrap" }}>Cancha</th>
            <th className="text-right font-semibold pb-1 pr-2" style={{ width: "20%", whiteSpace: "nowrap" }}>Equipo A</th>
            <th className="text-center font-semibold pb-1 px-1" style={{ width: "15%", whiteSpace: "nowrap" }}>Sets</th>
            <th className="text-left font-semibold pb-1 pl-2" style={{ width: "20%", whiteSpace: "nowrap" }}>Equipo B</th>
            <th className="text-left font-semibold pb-1 pl-2" style={{ width: "24%", whiteSpace: "nowrap" }}>Categoría · Fase</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => {
            const labelA = m.teamALabel || m.__cat.teams.find((t) => t.id === m.teamAId)?.name || "Por definir";
            const labelB = m.teamBLabel || m.__cat.teams.find((t) => t.id === m.teamBId)?.name || "Por definir";
            const linesA = labelA.split(" / ");
            const linesB = labelB.split(" / ");
            const bestOf = m.__cat.bestOf || 3;
            const court = courtById[m.courtId]?.name || "Por definir";
            const when = m.day ? formatTimeAmPm(m.time) : "Por definir";
            const ellipsis = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
            // v2.79.0: número del día entero (buildMatchIndex), no i+1 -- si esto imprime SOLO
            // una categoría, cada partido conserva el mismo número que tendría en la planilla
            // de "Todas", en vez de renumerarse 1..N sobre el subconjunto filtrado. `matchIndex`
            // es opcional (nadie más que ResultadosTab lo manda hoy) -- sin él, cae de vuelta a
            // i+1 para no romper si algún día se llama esto desde otro lado.
            const number = matchIndex ? matchIndex.get(m.id) : i + 1;
            return (
              <tr key={m.id} className="print-sheet-row" style={{ borderBottom: "1px solid #000" }}>
                <td className="py-1 pr-2 font-semibold">{number}</td>
                <td className="py-1 pr-2 mono" style={ellipsis}>{when}</td>
                <td className="py-1 pr-2" style={ellipsis}>{court}</td>
                <td className="py-1 pr-2 text-right font-semibold" style={{ lineHeight: "10px" }}>
                  {linesA.map((line, li) => <div key={li} style={{ ...ellipsis, fontSize: 9 }}>{line}</div>)}
                </td>
                <td className="py-1 px-1">
                  <div className="flex justify-center gap-1" style={{ height: 18 }}>
                    {Array.from({ length: bestOf }, (_, s) => (
                      <div key={s} className="flex" style={{ border: "1px solid #000", borderRadius: 3, flex: "1 1 0", maxWidth: 40 }} title={`Set ${s + 1}`}>
                        <div style={{ flex: 1, borderRight: "1px solid #000" }}></div>
                        <div style={{ flex: 1 }}></div>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="py-1 pl-2 font-semibold" style={{ lineHeight: "10px" }}>
                  {linesB.map((line, li) => <div key={li} style={{ ...ellipsis, fontSize: 9 }}>{line}</div>)}
                </td>
                <td className="py-1 pl-2 text-gray-600" style={ellipsis}>{categoryCode(m.__cat)} · {printRoundTag(m)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StandingsTable({ rows, qualifiers }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-400 uppercase">
            <th className="py-1.5 pr-3">#</th><th className="py-1.5 pr-3">Equipo</th>
            <th className="py-1.5 pr-3 text-center">PJ</th><th className="py-1.5 pr-3 text-center">PG</th><th className="py-1.5 pr-3 text-center">PP</th>
            <th className="py-1.5 pr-3 text-center">Sets</th><th className="py-1.5 pr-3 text-center">Puntos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.teamId} style={{ background: i < qualifiers ? "#EAF3E6" : "transparent" }} className="border-t" >
              <td className="py-2 pr-3 font-bold" style={{ borderColor: COLORS.line }}>{i + 1}</td>
              <td className="py-2 pr-3 font-medium">{r.name}{i < qualifiers && <CheckCircle2 size={12} className="inline ml-1.5 mb-0.5" color={COLORS.court} />}</td>
              <td className="py-2 pr-3 text-center">{r.pj}</td>
              <td className="py-2 pr-3 text-center">{r.pg}</td>
              <td className="py-2 pr-3 text-center">{r.pp}</td>
              <td className="py-2 pr-3 text-center mono">{r.setsF}-{r.setsC}</td>
              <td className="py-2 pr-3 text-center mono">{r.ptsF}-{r.ptsC}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-xs text-gray-400 italic py-2">Sin partidos jugados aún.</p>}
    </div>
  );
}

function MatchRow({ m, cat, catName, catColor, courtById, teamName, bestOf, onSubmit, matchNumber }) {
  const [open, setOpen] = useState(false);
  const setsNeeded = Math.ceil(bestOf / 2);
  const [sets, setSets] = useState(m.sets.length ? m.sets : Array.from({ length: bestOf }, () => ({ a: "", b: "" })));

  const labelA = m.teamALabel || teamName(m.teamAId) || "Por definir";
  const labelB = m.teamBLabel || teamName(m.teamBId) || "Por definir";
  const playable = m.teamAId && m.teamBId;
  const cc = catColor || CATEGORY_PALETTE[0];

  const save = () => {
    const cleaned = sets.filter((s) => s.a !== "" && s.b !== "");
    if (cleaned.length === 0) return;
    onSubmit(cleaned);
    setOpen(false);
  };

  return (
    // v2.77.0: fondo naranja pastel (mismo "durazno" de CATEGORY_PALETTE) cuando ya tiene
    // resultado cargado -- antes era un azul apagado, poco visible como "ya está listo".
    <div className="rounded-xl p-3" style={{ background: m.winnerId ? "#FDEBD9" : "#FAFAF7", border: `1px solid ${COLORS.line}` }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        {/* v2.77.0: orden pedido -- hora, cancha, nombre de los jugadores (antes esos datos
            iban al final, después de los equipos). La etiqueta de categoría es aparte, con el
            mismo color que ya usa esa categoría en el tablero de Calendario. */}
        <div className="text-sm flex items-center flex-wrap gap-x-2 gap-y-1">
          {/* v2.79.0: mismo número que trae la planilla impresa para este partido (ver
              buildMatchIndex) -- para que el supervisor de cancha, con el papel en la mano,
              pueda ubicar acá el partido correcto sin tener que leer nombres. */}
          {matchNumber != null && <span className="mono text-xs font-extrabold" style={{ color: COLORS.court }}>#{matchNumber}</span>}
          {catName && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full uppercase tracking-wide align-middle" style={{ background: cc.bg, color: cc.text }}>{catName}</span>}
          {m.day && <span className="mono text-xs text-gray-400">{formatTimeAmPm(m.time)} · {courtById[m.courtId]?.name}</span>}
          <span>
            <span className={m.winnerId === m.teamAId ? "font-bold" : ""}>{labelA}</span>
            <span className="text-gray-400 mx-1.5">vs</span>
            <span className={m.winnerId === m.teamBId ? "font-bold" : ""}>{labelB}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {m.winnerId && <span className="text-xs mono px-2 py-0.5 rounded-full" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>
            {(m.sets || []).map((s) => `${s.a}-${s.b}`).join(", ")}
          </span>}
          <button disabled={!playable} onClick={() => setOpen((o) => !o)}
            style={{ opacity: playable ? 1 : 0.4 }} className="text-xs font-semibold flex items-center gap-1" >
            {m.winnerId ? "Editar" : "Cargar marcador"} <ChevronDown size={13} className={open ? "rotate-180" : ""} />
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: COLORS.line }}>
          {sets.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-14 text-gray-400 text-xs">Set {i + 1}</span>
              <input type="number" style={{ ...inputStyle, width: 70 }} value={s.a}
                onChange={(e) => setSets((arr) => arr.map((x, j) => j === i ? { ...x, a: e.target.value } : x))} placeholder={labelA.slice(0, 6)} />
              <span className="text-gray-300">–</span>
              <input type="number" style={{ ...inputStyle, width: 70 }} value={s.b}
                onChange={(e) => setSets((arr) => arr.map((x, j) => j === i ? { ...x, b: e.target.value } : x))} placeholder={labelB.slice(0, 6)} />
            </div>
          ))}
          <p className="text-xs text-gray-400">Se necesitan {setsNeeded} sets ganados para cerrar el partido (mejor de {bestOf}).</p>
          <button onClick={save} style={{ background: COLORS.court, color: "#fff" }} className="px-4 py-1.5 rounded-lg text-xs font-bold">Guardar resultado</button>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   CHECKOUT — dual-currency (USD + Bs at the club's BCV-referenced rate),
   Pago Móvil (requires proof) or cash. Reused by Reservas, Eventos y Membresías.
   ========================================================================= */
function CheckoutPanel({ title, baseUsd, discountPct = 0, club, requireName = true, defaultName = "", onConfirm, onCancel, confirmLabel = "Confirmar" }) {
  const [userName, setUserName] = useState(defaultName);
  const [method, setMethod] = useState("movil");
  const [reference, setReference] = useState("");
  const [proofName, setProofName] = useState("");

  const discounted = Number(baseUsd) * (1 - (Number(discountPct) || 0) / 100);
  const bs = discounted * (Number(club.bsPerUsd) || 0);
  // Totalmente gratis (100% de descuento, o un bloque gratis del plan pasado como baseUsd=0,
  // v2.30.0) -- no hay nada que pagar, así que no tiene sentido pedir método de pago,
  // referencia ni comprobante. Antes esto igual mostraba "$0.00" y exigía subir un
  // comprobante para pagar cero dólares.
  const isFree = discounted <= 0;
  const canConfirm = (!requireName || userName.trim()) && (isFree || method === "efectivo" || (reference.trim() && proofName));

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    setProofName(f ? f.name : "");
  };

  const submit = () => {
    if (!canConfirm) return;
    onConfirm({ userName: userName.trim() || "Invitado", paymentMethod: isFree ? null : method, reference: isFree ? "" : reference.trim(), proofName: isFree ? "" : proofName, priceUsd: discounted, priceBs: bs });
  };

  return (
    <div className="rounded-xl p-4 mt-3" style={{ background: "#EEF1F7", border: `1px solid ${COLORS.line}` }}>
      <p className="text-sm font-bold mb-3" style={{ color: COLORS.courtDark }}>{title}</p>

      <div className="rounded-lg p-3 mb-3" style={{ background: COLORS.courtDark }}>
        <span className="text-xs" style={{ color: "#A9C0DC" }}>{isFree ? "Este cupo es gratis para ti" : discountPct > 0 ? `Precio con ${discountPct}% de descuento por membresía` : "Total a pagar"}</span>
        <div className="flex items-baseline gap-3 mt-1 flex-wrap">
          <span className="disp text-2xl" style={{ color: COLORS.ball }}>{isFree ? "Gratis" : formatMoney(discounted)}</span>
          {!isFree && <span className="mono text-sm" style={{ color: "#D6E1F0" }}>≈ {formatMoney(bs, "Bs. ")}</span>}
        </div>
        {!isFree && discountPct > 0 && baseUsd > 0 && <p className="text-[10px] mt-1 line-through" style={{ color: "#55677E" }}>{formatMoney(baseUsd)} sin membresía</p>}
        {!isFree && <p className="text-[10px] mt-1.5" style={{ color: "#4E6180" }}>Bs calculado a {formatMoney(club.bsPerUsd, "Bs. ")}/USD (referencia EUR BCV)</p>}
      </div>

      {requireName && (
        <div className="mb-3"><Label>Tu nombre</Label><input style={inputStyle} value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Nombre y apellido" /></div>
      )}

      {/* Gratis de verdad (v2.30.1) -- nada que pagar, así que no tiene sentido pedir método de
         pago, referencia ni comprobante. Antes esto se calculaba bien (canConfirm/submit ya no
         exigían nada) pero la sección seguía DIBUJÁNDOSE completa igual, pidiendo un
         comprobante "obligatorio" para pagar $0 -- solo se había arreglado la validación, no
         la UI. */}
      {isFree ? (
        <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>
          <Check size={14} strokeWidth={3} /> No hay nada que pagar -- solo confirma para reservar.
        </div>
      ) : (
        <>
          <Label>Método de pago</Label>
          <Segmented value={method} onChange={setMethod} options={[{ value: "movil", label: "Pago Móvil" }, { value: "efectivo", label: "Efectivo" }]} />

          {method === "movil" ? (
            <div className="mt-3 space-y-2.5">
              <div className="mono text-[11px] px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
                <Smartphone size={13} color={COLORS.court} /> {club.pagoMovil.banco} · {club.pagoMovil.telefono} · {club.pagoMovil.cedula}
              </div>
              <div><Label>N° de referencia</Label><input style={inputStyle} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Últimos dígitos de la operación" /></div>
              <div>
                <Label>Comprobante de pago (obligatorio)</Label>
                <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer" style={{ border: `1.5px dashed ${COLORS.line}`, color: proofName ? COLORS.court : "#6B7688" }}>
                  <Upload size={14} /> {proofName || "Subir captura del pago"}
                  <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
                </label>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
              <Banknote size={13} /> Pagas en efectivo directamente en el club, antes de tu turno.
            </div>
          )}
        </>
      )}

      <div className="flex gap-2 mt-4">
        <button disabled={!canConfirm} onClick={submit} style={{ background: canConfirm ? COLORS.clay : "#E5E5E5", color: canConfirm ? "#fff" : "#999" }} className="flex-1 py-2.5 rounded-xl font-bold text-sm">{confirmLabel}</button>
        {onCancel && <button onClick={onCancel} className="px-4 rounded-xl text-sm text-gray-400">Cancelar</button>}
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: RESERVAS
   ========================================================================= */
function ReservasTab({ club, courts, occupiedKeys, bookings, createBooking, cancelBooking, currentUser, currentPlan, categories, openPlays, classes, role }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayIso);
  const [selectedTime, setSelectedTime] = useState(null);
  const [courtId, setCourtId] = useState(null);
  const blocks = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes);
  const court = courts.find((c) => c.id === courtId) || null;

  // Ventana de reserva del plan (v2.27.0): hasta cuántas horas por adelantado puede reservar
  // cancha alguien con este plan (currentPlan ya viene resuelta según vigencia real -- ver
  // comentario en el componente principal). El admin nunca queda bloqueado por esto -- es un
  // beneficio de plan, no una regla operativa del club -- pero SÍ aplica "nunca en el pasado"
  // para todos, admin incluido: eso no es un beneficio, es una regla de integridad de datos.
  const now = Date.now();
  const bookingWindowHours = currentPlan?.bookingWindowHours ?? 48;
  const windowDeadlineMs = now + bookingWindowHours * 3600000;
  const maxDateIso = new Date(windowDeadlineMs).toISOString().slice(0, 10);
  const blockTimestamp = (timeMin) => new Date(date + "T00:00:00").getTime() + timeMin * 60000;
  // Motivo (independiente de la cancha) por el que un bloque no se puede reservar todavía --
  // null si cae dentro de lo permitido. Se evalúa ANTES que occupiedKeys porque no depende de
  // qué cancha se mire: un bloque ya pasado o fuera de la ventana del plan no es "reservable"
  // sin importar si alguien más lo tiene o no.
  const globalBlockReason = (timeMin) => {
    if (blockTimestamp(timeMin) < now) return { kind: "Ya pasó", label: "" };
    if (role !== "admin" && blockTimestamp(timeMin) > windowDeadlineMs) {
      return { kind: "Fuera de tu ventana", label: `Tu plan reserva hasta ${formatDateHuman(maxDateIso)}` };
    }
    return null;
  };

  // Qué ocupa un bloque puntual -- ya se usaba para contar canchas disponibles, pero el
  // detalle (kind/label) nunca se mostraba en ningún lado. Ahora también resuelve reservas
  // sueltas (antes se perdían en el fallback genérico "Reservado" sin nombre) para que el
  // admin pueda ver quién/qué ocupa cualquier bloque, incluso los que están llenos (v2.24.0).
  const occupant = (cid, timeMin) => {
    const blocked = globalBlockReason(timeMin);
    if (blocked) return blocked;
    if (!occupiedKeys.has(blockKey(cid, date, timeMin))) return null;
    for (const cat of categories) {
      const m = cat.matches.find((mm) => mm.courtId === cid && mm.day === date && !isByeMatch(mm) && timeToMinutes(mm.time) === timeMin);
      if (m) return { kind: "Torneo", label: cat.name };
    }
    const op = openPlays.find((e) => e.occupiedBlocks.some((b) => b.courtId === cid && b.date === date && b.timeMin === timeMin));
    if (op) return { kind: "Open Play", label: op.name };
    const cls = classes.find((e) => e.occupiedBlocks.some((b) => b.courtId === cid && b.date === date && b.timeMin === timeMin));
    if (cls) return { kind: "Clase", label: cls.academyName };
    const booking = bookings.find((b) => b.status !== "cancelada" && b.courtId === cid && b.date === date && b.timeMin === timeMin);
    if (booking) return { kind: "Reserva", label: booking.userName };
    return { kind: "Ocupado", label: "" };
  };

  const availableCourtsAt = (timeMin) => courts.filter((c) => !occupant(c.id, timeMin));

  const lockedPrivate = court && court.isPrivate && !currentPlan?.privateCourtAccess;
  const isMember = !!currentPlan && currentPlan.monthlyPrice > 0;
  // % de descuento sobre el precio base de cancha para socios de este plan (v2.30.0) -- vive
  // en el plan, no en cada cancha, así que cambiar el plan cambia el precio real al instante
  // en vez de depender de que alguien actualice el memberPrice de cada cancha a mano.
  const courtDiscountPct = isMember ? (currentPlan?.courtDiscountPct ?? 0) : 0;

  // Bloques de cancha completamente gratis por mes de plan (v2.30.0) -- "* Disfrutable en
  // bloques de horarios fríos (De 8 a 5pm) y en días de NO torneos, sujeto a disponibilidad",
  // tal como lo anuncia la tabla de Membresías. Se cuenta en caliente (reservas activas de
  // este mes calendario marcadas free_block=true) en vez de un contador aparte -- cancelar una
  // reserva gratis libera el cupo solo.
  const OFF_PEAK_START = timeToMinutes("08:00"), OFF_PEAK_END = timeToMinutes("17:00");
  const isOffPeakBlock = (timeMin) => timeMin >= OFF_PEAK_START && timeMin < OFF_PEAK_END;
  const isTournamentDay = (d) => categories.some((c) => c.matches.some((m) => m.day === d && !isByeMatch(m)));
  const freeBlocksPerMonth = currentPlan?.freeBlocksPerMonth ?? 0;
  const monthKey = date.slice(0, 7);
  const freeBlocksUsedThisMonth = bookings.filter((b) => b.userId === currentUser.id && b.freeBlock && b.status !== "cancelada" && b.date.slice(0, 7) === monthKey).length;
  const freeBlocksLeft = Math.max(0, freeBlocksPerMonth - freeBlocksUsedThisMonth);
  const canUseFreeBlock = (timeMin) => isMember && freeBlocksLeft > 0 && isOffPeakBlock(timeMin) && !isTournamentDay(date);

  // El calendario de Reservas es para crear reservas nuevas -- nunca tiene sentido navegarlo
  // antes de hoy (admin incluido: el historial de reservas ya se ve más abajo en "Todas las
  // reservas", sin tener que mover este calendario). El tope superior (maxDateIso) sí es un
  // beneficio de plan, por eso no aplica al admin.
  const shiftDate = (delta) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    let next = d.toISOString().slice(0, 10);
    if (next < todayIso) next = todayIso;
    if (role !== "admin" && next > maxDateIso) next = maxDateIso;
    setDate(next);
    setSelectedTime(null);
    setCourtId(null);
  };

  const pickTime = (t) => {
    setSelectedTime(t);
    setCourtId(null);
  };

  const confirm = (checkout) => {
    createBooking({ courtId: court.id, date, timeMin: selectedTime, blockMinutes: club.blockMinutes, userId: currentUser.id, freeBlock: canUseFreeBlock(selectedTime), ...checkout });
    setSelectedTime(null);
    setCourtId(null);
  };

  const activeBookings = bookings.filter((b) => b.status !== "cancelada").sort((a, b) => (a.date + a.timeMin) - (b.date + b.timeMin));
  const visibleBookings = role === "admin" ? activeBookings : activeBookings.filter((b) => b.userName === currentUser.name);

  if (courts.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Configura al menos una cancha en la sección Club.</p></Card>;
  }

  return (
    <div className="mt-2 space-y-5">
      <Card>
        <SectionTitle sub="Elige una fecha y un horario, luego una cancha disponible.">Reservar cancha</SectionTitle>

        <div className="max-w-sm mb-5">
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: COLORS.court }}>{formatDateFull(date)}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDate(-1)} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EAEEF5" }}>
              <ChevronLeft size={16} color={COLORS.courtDark} />
            </button>
            <input type="date" min={todayIso} max={role === "admin" ? undefined : maxDateIso}
              style={{ ...inputStyle, textAlign: "center", fontWeight: 700 }} value={date}
              onChange={(e) => { setDate(e.target.value); setSelectedTime(null); setCourtId(null); }} />
            <button onClick={() => shiftDate(1)} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EAEEF5" }}>
              <ChevronRight size={16} color={COLORS.courtDark} />
            </button>
          </div>
          {role !== "admin" && (
            <p className="text-[11px] mt-2" style={{ color: "#6B7688" }}>
              Tu plan{currentPlan?.name ? ` (${currentPlan.name})` : ""} permite reservar con hasta <b>{formatBookingWindow(bookingWindowHours)}</b> de anticipación -- hasta el {formatDateHuman(maxDateIso)}.
            </p>
          )}
          {/* Contador de bloques gratis del mes, siempre visible (antes solo aparecía dentro
              del modal al elegir horario) -- así el socio ve su cupo sin tener que primero
              tocar un horario. Mismo cálculo en caliente que canUseFreeBlock (v2.31.1). */}
          {role !== "admin" && isMember && freeBlocksPerMonth > 0 && (
            <p className="text-[11px] mt-1 font-semibold" style={{ color: freeBlocksLeft > 0 ? COLORS.court : "#8A5A16" }}>
              {freeBlocksLeft > 0
                ? `Te quedan ${freeBlocksLeft} de ${freeBlocksPerMonth} bloques de reserva gratis este mes.`
                : `Ya usaste tus ${freeBlocksPerMonth} bloques de reserva gratis de este mes.`}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {blocks.map((t) => {
            const available = availableCourtsAt(t);
            const occ = available.length === 0;
            const isSel = selectedTime === t;
            // Motivo específico cuando no hay nada que reservar -- "Ya pasó" y "Fuera de tu
            // ventana" son iguales para las 4 canchas (no dependen de cuál), así que basta con
            // mirar la primera para saber cuál de los dos es (o si de verdad está "Ocupado"
            // por otra cosa). v2.27.0.
            const reason = occ ? occupant(courts[0]?.id, t)?.kind || "Ocupado" : null;
            // El admin puede tocar CUALQUIER horario, incluso sin canchas libres -- necesita
            // poder ver qué actividad ocupa cada cancha (el modal de abajo se encarga de
            // mostrarlo). El cliente sigue sin poder tocar un horario donde no hay nada que
            // reservar (v2.24.0).
            const clickable = role === "admin" || !occ;
            return (
              <button key={t} onClick={() => clickable && pickTime(t)} disabled={!clickable}
                title={
                  !occ ? `${available.length} cancha${available.length === 1 ? "" : "s"} disponible${available.length === 1 ? "" : "s"}`
                    : role === "admin" && reason === "Ocupado" ? "Ocupado — toca para ver qué está reservado" : reason
                }
                className="rounded-xl py-2.5 px-1.5 text-center transition-all"
                style={{
                  background: occ ? "#EDEEF2" : isSel ? COLORS.court : "#fff",
                  border: `1.5px solid ${occ ? "transparent" : isSel ? COLORS.court : COLORS.line}`,
                  cursor: clickable ? "pointer" : "not-allowed",
                }}>
                <p className="mono text-sm font-bold" style={{ color: occ ? "#9AA6BC" : isSel ? "#fff" : COLORS.courtDark }}>{minutesToAmPm(t)}</p>
                <p className="text-[9px] mt-0.5 font-bold uppercase tracking-wide" style={{ color: occ ? "#9AA6BC" : isSel ? "#DCEBD5" : "#78829A" }}>
                  {occ ? (reason === "Fuera de tu ventana" ? "Fuera" : reason) : `${available.length} cancha${available.length === 1 ? "" : "s"}`}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-4 mt-4 text-[11px]" style={{ color: "#6B7688" }}>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: "#fff", border: `1.5px solid ${COLORS.line}` }} /> Disponible</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: "#EDEEF2" }} /> Ocupado</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: COLORS.court }} /> Seleccionado</span>
        </div>
      </Card>

      {/* Antes "canchas disponibles" y "confirmar" se apilaban como cards debajo del horario,
         empujando al usuario a hacer scroll para llegar al checkout. Ahora es un solo modal:
         primero elegir cancha, luego (mismo panel) confirmar -- "Cancelar" en el checkout
         vuelve a la lista de canchas en vez de cerrar todo, igual que ya hacía EventDetail. */}
      {selectedTime !== null && (
        <Modal onClose={() => { setSelectedTime(null); setCourtId(null); }}>
          <Card>
            <div className="flex items-start justify-between gap-3 mb-1">
              <SectionTitle sub={court ? undefined : role === "admin" ? "Toca una cancha disponible para reservar, o revisa qué ocupa las demás." : "Toca una cancha para continuar."}>
                {court ? `Confirmar ${court.name}` : "Canchas"} · {minutesToAmPm(selectedTime)} ({formatDateHuman(date)})
              </SectionTitle>
              <button onClick={() => { setSelectedTime(null); setCourtId(null); }} className="text-gray-300 hover:text-gray-600 shrink-0"><X size={18} /></button>
            </div>

            {!court ? (
              <>
                {/* El cliente solo ve canchas libres (nada que mirar en una ocupada). El admin
                   ve TODAS -- las ocupadas quedan como una etiqueta informativa (kind + quién/
                   qué la tiene) en vez de un botón, para poder revisar cualquier horario lleno
                   sin exponerle esa info a un cliente (v2.24.0). */}
                <div className="flex flex-wrap gap-2">
                  {(role === "admin" ? courts : availableCourtsAt(selectedTime)).map((c) => {
                    const occ = role === "admin" ? occupant(c.id, selectedTime) : null;
                    if (occ) {
                      return (
                        <div key={c.id} title={`${occ.kind}${occ.label ? ": " + occ.label : ""}`}
                          className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
                          {c.isPrivate && <Lock size={12} />} {c.name}
                          <span className="text-[10px] font-semibold opacity-80 truncate max-w-[140px]">{occ.kind}{occ.label ? ` · ${occ.label}` : ""}</span>
                        </div>
                      );
                    }
                    const base = courtPriceInfo(c, selectedTime);
                    const useFreeBlock = canUseFreeBlock(selectedTime);
                    const shownPrice = useFreeBlock ? 0 : (isMember ? base * (1 - courtDiscountPct / 100) : base);
                    return (
                      <button key={c.id} onClick={() => setCourtId(c.id)}
                        className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1.5"
                        style={{ background: "#EAEEF5", color: COLORS.ink }}>
                        {c.isPrivate && <Lock size={12} />} {c.name}
                        <span className="text-[10px] font-semibold opacity-80">{shownPrice > 0 ? formatMoney(shownPrice) : "Gratis"}</span>
                      </button>
                    );
                  })}
                </div>
                {role !== "admin" && availableCourtsAt(selectedTime).length === 0 && <p className="text-xs text-gray-400 italic">No hay canchas disponibles para este horario.</p>}
                {/* Bloques gratis del plan (v2.30.0) -- solo aplica fuera de horario pico y en
                   días sin torneo, tal como lo anuncia Membresías; se muestra acá (antes de
                   elegir cancha) para que quede claro por qué el precio de abajo puede salir
                   en $0 sin haber tocado nada todavía. */}
                {isMember && freeBlocksPerMonth > 0 && (
                  <p className="text-[11px] mt-3" style={{ color: canUseFreeBlock(selectedTime) ? COLORS.court : "#8A5A16" }}>
                    {canUseFreeBlock(selectedTime)
                      ? `¡Este horario cuenta como bloque gratis! Te quedan ${freeBlocksLeft} de ${freeBlocksPerMonth} este mes.`
                      : freeBlocksLeft === 0
                        ? `Ya usaste tus ${freeBlocksPerMonth} bloques gratis de este mes.`
                        : `Bloques gratis (${freeBlocksLeft} disponibles) solo aplican de 8am a 5pm en días sin torneo.`}
                  </p>
                )}
              </>
            ) : lockedPrivate ? (
              <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
                <Lock size={13} /> Esta cancha es privada — necesitas una membresía con acceso a canchas privadas. Revisa la sección Membresías.
              </div>
            ) : (
              <CheckoutPanel title={`${club.blockMinutes} min en ${court.name}${canUseFreeBlock(selectedTime) ? " · Bloque gratis de tu plan" : ""}`}
                baseUsd={canUseFreeBlock(selectedTime) ? 0 : courtPriceInfo(court, selectedTime)}
                discountPct={canUseFreeBlock(selectedTime) ? 0 : courtDiscountPct}
                club={club} defaultName={currentUser.name}
                onConfirm={confirm} onCancel={() => setCourtId(null)} confirmLabel="Confirmar reserva" />
            )}
          </Card>
        </Modal>
      )}

      <Card>
        <SectionTitle>{role === "admin" ? "Todas las reservas" : "Mis reservas"}</SectionTitle>
        <div className="space-y-1.5">
          {visibleBookings.map((b) => {
            const c = courts.find((cc) => cc.id === b.courtId);
            return (
              <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "#EEF1F7" }}>
                <div>
                  <span className="font-semibold">{c?.name}</span>
                  <span className="text-gray-500 ml-2 text-xs">{formatDateHuman(b.date)} · {minutesToAmPm(b.timeMin)} · {b.userName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{ background: b.status === "confirmada" ? "#DCEBD5" : "#FBF3E4", color: b.status === "confirmada" ? COLORS.courtDark : "#8A5A16" }}>
                    {b.status === "pendiente_verificacion" ? "Pago por verificar" : b.status === "pendiente_efectivo" ? "Paga en el club" : "Confirmada"}
                  </span>
                  <button onClick={() => cancelBooking(b.id)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
                </div>
              </div>
            );
          })}
          {visibleBookings.length === 0 && <p className="text-xs text-gray-400 italic">Aún no hay reservas.</p>}
        </div>
      </Card>
    </div>
  );
}

/* =========================================================================
   TAB: EVENTOS (Open Plays, Torneos, Clases)
   ========================================================================= */
function MultiCourtSelect({ courts, value, onChange }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {courts.map((c) => (
        <button key={c.id} type="button" onClick={() => toggle(c.id)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: value.includes(c.id) ? COLORS.court : "#EAEEF5", color: value.includes(c.id) ? "#fff" : COLORS.ink }}>
          {c.name}
        </button>
      ))}
      {courts.length === 0 && <p className="text-xs text-gray-400 italic">Configura canchas primero en la sección Club.</p>}
    </div>
  );
}

// Aviso de choque de horario (v2.24.0) -- compartido por OpenPlayForm/ClaseForm. `conflicts`
// es la lista granular de {courtId, date, timeMin} de findBlockConflicts; acá se agrupa por
// cancha (fechas únicas, máximo 3 a la vista + contador) para que el mensaje no se vuelva una
// lista gigante cuando el choque cae en varias fechas de una serie recurrente.
function ScheduleConflictWarning({ conflicts, courts }) {
  if (!conflicts.length) return null;
  const byCourtDates = new Map();
  conflicts.forEach((c) => {
    if (!byCourtDates.has(c.courtId)) byCourtDates.set(c.courtId, new Set());
    byCourtDates.get(c.courtId).add(c.date);
  });
  return (
    <div className="text-xs px-3 py-2.5 rounded-lg flex items-start gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-bold">Ese horario ya está ocupado -- ajusta cancha, fecha u hora para poder guardar.</p>
        <ul className="mt-1 space-y-0.5">
          {[...byCourtDates.entries()].map(([courtId, datesSet]) => {
            const dates = [...datesSet].sort();
            const court = courts.find((c) => c.id === courtId);
            return (
              <li key={courtId}>
                {court?.name || "Cancha"}: {dates.slice(0, 3).map((d) => formatDateHuman(d)).join(", ")}{dates.length > 3 ? ` +${dates.length - 3} más` : ""}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// `initial` presente = editar (una ocurrencia puntual, o los campos compartidos de una serie
// entera si `hideDate` viene true -- ahí la fecha no se muestra porque cada ocurrencia
// conserva la suya, ver updateOpenPlaySeries). Sin `initial` = crear, comportamiento
// original. `onSubmit` reemplaza al viejo `onCreate` -- mismo contrato (async, devuelve
// {error} o {}), el nombre ahora es genérico porque también se usa para guardar una edición.
function OpenPlayForm({ courts, onSubmit, onCancel, initial = null, hideDate = false, club, occupiedKeys, ignoreBlocks = [], seriesDates = [] }) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [imageBlob, setImageBlob] = useState(null);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [level, setLevel] = useState(initial?.level ?? "Todos");
  const [price, setPrice] = useState(initial?.price ?? 5);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [courtIds, setCourtIds] = useState(initial?.courtIds ?? []);
  const [date, setDate] = useState(initial?.date ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "18:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "20:00");
  const [capacity, setCapacity] = useState(initial?.capacity ?? 8);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurUntil, setRecurUntil] = useState("");

  const [imageError, setImageError] = useState("");
  // Se sube a Supabase Storage como Blob directo (ver addOpenPlay) y una serie recurrente
  // reutiliza la misma URL en todas sus ocurrencias -- por eso aquí solo hace falta un Blob
  // liviano, no un data URL. El reescalado/recompresión vive en resizeImageToBlob() (helper
  // compartido con el flyer de Torneo, ver TorneoTab) -- ver esa función para el porqué de
  // canvas.toBlob() en vez de toDataURL()/FileReader.readAsDataURL.
  const handleImage = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageError(""); setImageProcessing(true);
    try {
      setImageBlob(await resizeImageToBlob(f));
    } catch (err) {
      setImageError(err.message);
    }
    setImageProcessing(false);
  };

  // Choque de horario (v2.24.0): las fechas a validar son las de la serie existente cuando se
  // edita toda una serie (hideDate -- cada ocurrencia conserva su propia fecha, no se
  // recalculan acá), o las que resultarían de expandir date/recurUntil en cualquier otro caso
  // (crear, recurrente o no; editar una sola ocurrencia). `ignoreBlocks` excluye los bloques
  // que ya son de esta misma actividad, para no marcarla en conflicto consigo misma.
  const ignoreKeySet = useMemo(() => new Set(ignoreBlocks.map((b) => blockKey(b.courtId, b.date, b.timeMin))), [ignoreBlocks]);
  const occurrenceDates = useMemo(
    () => (hideDate ? seriesDates : expandWeeklyDates(date, isRecurring ? recurUntil : null)),
    [hideDate, seriesDates, date, isRecurring, recurUntil]
  );
  const conflicts = useMemo(
    () => (occupiedKeys ? findBlockConflicts(club, courtIds, occurrenceDates, startTime, endTime, occupiedKeys, ignoreKeySet) : []),
    [club, occupiedKeys, courtIds, occurrenceDates, startTime, endTime, ignoreKeySet]
  );

  const canSave = name.trim() && courtIds.length > 0 && (hideDate || date) && startTime < endTime && Number(capacity) > 0
    && (!isRecurring || (recurUntil && recurUntil >= date)) && conflicts.length === 0;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setError(""); setSubmitting(true);
    const result = await onSubmit({ name: name.trim(), imageBlob, level, price: Number(price) || 0, capacity: Number(capacity) || 0, description, courtIds, date, startTime, endTime, recurrence: isRecurring ? { until: recurUntil } : null });
    setSubmitting(false);
    if (result?.error) setError(result.error);
  };

  return (
    <Card className="mt-3">
      <h4 className="font-bold text-sm mb-4">{isEdit ? (hideDate ? "Editar serie de Open Play" : "Editar Open Play") : "Nuevo Open Play"}</h4>
      <div className="space-y-3">
        <div><Label>Nombre de la actividad</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jueves de DUPR" /></div>
        <div>
          <Label>Imagen (opcional)</Label>
          <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer" style={{ border: `1.5px dashed ${COLORS.line}`, color: imageBlob ? COLORS.court : "#6B7688" }}>
            <ImageIcon size={14} /> {imageProcessing ? "Procesando imagen…" : imageBlob ? "Imagen nueva cargada" : initial?.image ? "Imagen actual -- toca para cambiarla" : "Subir imagen"}
            <input type="file" accept="image/*" className="hidden" onChange={handleImage} disabled={imageProcessing} />
          </label>
          {imageError && <p className="text-[11px] mt-1 font-semibold" style={{ color: "#B23A1B" }}>{imageError}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nivel recomendado</Label>
            <select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="Todos">Todos</option>
              {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div><Label>Precio (EUR)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Cupos (quorum máximo)</Label><input type="number" min={1} style={inputStyle} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        </div>
        {/* El precio de socio ya no se carga por actividad (v2.30.0) -- sale solo del %
           de descuento en Open Play que definas en Membresías para cada plan, así que
           cambiar el plan cambia el precio real acá sin tener que volver a editar esto. */}
        <p className="text-[11px]" style={{ color: "#6B7688" }}>
          El precio de socio lo define cada plan (Membresías → % de descuento en Open Play), no esta actividad.
        </p>
        <div><Label>Descripción</Label><textarea style={{ ...inputStyle, minHeight: 70 }} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><Label>Canchas a utilizar</Label><MultiCourtSelect courts={courts} value={courtIds} onChange={setCourtIds} /></div>
        <div className="grid grid-cols-3 gap-3">
          {!hideDate && (
            <div>
              <Label>Fecha {isRecurring ? "del primer evento" : ""}</Label>
              <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
              {date && <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>{formatDateFull(date)}</p>}
            </div>
          )}
          <div><Label>Desde</Label><input type="time" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div><Label>Hasta</Label><input type="time" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        {hideDate && <p className="text-xs" style={{ color: "#6B7688" }}>Estás editando toda la serie -- la fecha de cada ocurrencia no cambia, solo estos campos compartidos.</p>}
        <p className="text-xs" style={{ color: "#6B7688" }}>Los bloques de horario de las canchas elegidas quedan reservados automáticamente para esta actividad — nadie más podrá reservarlos.</p>

        {!isEdit && (
        <div className="rounded-xl p-3" style={{ background: "#EEF1F7" }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Evento recurrente (semanal)</Label>
              <p className="text-[11px]" style={{ color: "#6B7688" }}>Ej: "Jueves de DUPR" cada jueves a la misma hora.</p>
            </div>
            <Segmented value={isRecurring ? "si" : "no"} onChange={(v) => setIsRecurring(v === "si")} options={[{ value: "no", label: "No" }, { value: "si", label: "Sí" }]} />
          </div>
          {isRecurring && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold" style={{ color: COLORS.court }}>
                {date ? `Se repetirá cada ${weekdayLabel(date)}, empezando el ${formatDateFull(date)}.` : "Elige primero la fecha del primer evento."}
              </p>
              <div>
                <Label>Repetir hasta (inclusive)</Label>
                <input type="date" min={date || undefined} style={inputStyle} value={recurUntil} onChange={(e) => setRecurUntil(e.target.value)} />
                {recurUntil && recurUntil >= date && (
                  <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>Última fecha: {formatDateFull(recurUntil)}</p>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        <ScheduleConflictWarning conflicts={conflicts} courts={courts} />
        {error && <p className="text-xs font-semibold" style={{ color: "#B23A1B" }}>{error}</p>}

        <div className="flex gap-2 pt-1">
          <button disabled={!canSave || submitting || imageProcessing} onClick={submit}
            style={{ background: canSave && !submitting && !imageProcessing ? COLORS.court : "#E5E5E5", color: canSave && !submitting && !imageProcessing ? COLORS.chalk : "#999" }} className="flex-1 py-2 rounded-xl font-semibold text-sm">
            {submitting ? "Guardando…" : imageProcessing ? "Procesando imagen…" : isEdit ? "Guardar cambios" : isRecurring ? "Crear serie recurrente" : "Crear Open Play"}
          </button>
          <button onClick={onCancel} className="px-3 rounded-xl text-sm text-gray-400">Cancelar</button>
        </div>
      </div>
    </Card>
  );
}

function ClaseForm({ courts, onSubmit, onCancel, initial = null, hideDate = false, club, occupiedKeys, ignoreBlocks = [], seriesDates = [] }) {
  const isEdit = !!initial;
  const [academyName, setAcademyName] = useState(initial?.academyName ?? "");
  const [level, setLevel] = useState(initial?.level ?? "Todos");
  const [price, setPrice] = useState(initial?.price ?? 15);
  const [memberPrice, setMemberPrice] = useState(initial?.memberPrice ?? 15);
  const [courtIds, setCourtIds] = useState(initial?.courtIds ?? []);
  const [date, setDate] = useState(initial?.date ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "17:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "18:00");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurUntil, setRecurUntil] = useState("");

  // Mismo criterio de choque de horario que OpenPlayForm (v2.24.0) -- ver ese comentario.
  const ignoreKeySet = useMemo(() => new Set(ignoreBlocks.map((b) => blockKey(b.courtId, b.date, b.timeMin))), [ignoreBlocks]);
  const occurrenceDates = useMemo(
    () => (hideDate ? seriesDates : expandWeeklyDates(date, isRecurring ? recurUntil : null)),
    [hideDate, seriesDates, date, isRecurring, recurUntil]
  );
  const conflicts = useMemo(
    () => (occupiedKeys ? findBlockConflicts(club, courtIds, occurrenceDates, startTime, endTime, occupiedKeys, ignoreKeySet) : []),
    [club, occupiedKeys, courtIds, occurrenceDates, startTime, endTime, ignoreKeySet]
  );

  const canSave = academyName.trim() && courtIds.length > 0 && (hideDate || date) && startTime < endTime
    && (!isRecurring || (recurUntil && recurUntil >= date)) && conflicts.length === 0;

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setError(""); setSubmitting(true);
    const result = await onSubmit({ academyName: academyName.trim(), level, price: Number(price) || 0, memberPrice: Number(memberPrice) || 0, courtIds, date, startTime, endTime, recurrence: isRecurring ? { until: recurUntil } : null });
    setSubmitting(false);
    if (result?.error) setError(result.error);
  };

  return (
    <Card className="mt-3">
      <h4 className="font-bold text-sm mb-4">{isEdit ? (hideDate ? "Editar serie de clases" : "Editar Clase") : "Nueva Clase"}</h4>
      <div className="space-y-3">
        <div><Label>Nombre de la Academia</Label><input style={inputStyle} value={academyName} onChange={(e) => setAcademyName(e.target.value)} placeholder="Academia PickleUp" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nivel recomendado</Label>
            <select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="Todos">Todos</option>
              {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div><Label>Precio sin membresía (EUR)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>
        <div><Label>Precio con membresía (EUR)</Label><input type="number" min={0} style={inputStyle} value={memberPrice} onChange={(e) => setMemberPrice(e.target.value)} /></div>
        <div><Label>Canchas a utilizar</Label><MultiCourtSelect courts={courts} value={courtIds} onChange={setCourtIds} /></div>
        <div className="grid grid-cols-3 gap-3">
          {!hideDate && (
            <div>
              <Label>Fecha</Label>
              <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
              {date && <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>{formatDateFull(date)}</p>}
            </div>
          )}
          <div><Label>Desde</Label><input type="time" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div><Label>Hasta</Label><input type="time" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        {hideDate && <p className="text-xs" style={{ color: "#6B7688" }}>Estás editando toda la serie -- la fecha de cada ocurrencia no cambia, solo estos campos compartidos.</p>}

        {!isEdit && (
        <div className="rounded-xl p-3" style={{ background: "#EEF1F7" }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Clase recurrente (semanal)</Label>
              <p className="text-[11px]" style={{ color: "#6B7688" }}>Ej: clase cada lunes a la misma hora.</p>
            </div>
            <Segmented value={isRecurring ? "si" : "no"} onChange={(v) => setIsRecurring(v === "si")} options={[{ value: "no", label: "No" }, { value: "si", label: "Sí" }]} />
          </div>
          {isRecurring && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold" style={{ color: COLORS.court }}>
                {date ? `Se repetirá cada ${weekdayLabel(date)}, empezando el ${formatDateFull(date)}.` : "Elige primero la fecha de la primera clase."}
              </p>
              <div>
                <Label>Repetir hasta (inclusive)</Label>
                <input type="date" min={date || undefined} style={inputStyle} value={recurUntil} onChange={(e) => setRecurUntil(e.target.value)} />
                {recurUntil && recurUntil >= date && (
                  <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>Última fecha: {formatDateFull(recurUntil)}</p>
                )}
              </div>
              <p className="text-[11px]" style={{ color: "#6B7688" }}>Para una clase con dos días fijos por semana (ej. lunes y miércoles), crea dos series recurrentes — una por cada día.</p>
            </div>
          )}
        </div>
        )}

        <ScheduleConflictWarning conflicts={conflicts} courts={courts} />
        {error && <p className="text-xs font-semibold" style={{ color: "#B23A1B" }}>{error}</p>}

        <div className="flex gap-2 pt-1">
          <button disabled={!canSave || submitting} onClick={submit}
            style={{ background: canSave && !submitting ? COLORS.court : "#E5E5E5", color: canSave && !submitting ? COLORS.chalk : "#999" }} className="flex-1 py-2 rounded-xl font-semibold text-sm">
            {submitting ? "Guardando…" : isEdit ? "Guardar cambios" : isRecurring ? "Crear serie recurrente" : "Crear Clase"}
          </button>
          <button onClick={onCancel} className="px-3 rounded-xl text-sm text-gray-400">Cancelar</button>
        </div>
      </div>
    </Card>
  );
}

// Lucide doesn't ship a pickleball/racket glyph, so this stand-in follows the same 24×24
// stroke-based convention (round caps/joins) as the imported lucide icons above, for use as
// the client-facing placeholder thumbnail on event cards that have no uploaded image.
function RacketIcon({ size = 24, color = "currentColor", strokeWidth = 2, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="5" y="2" width="12" height="14.5" rx="6" />
      <line x1="11" y1="16.5" x2="11" y2="21.5" />
      <line x1="8" y1="21.5" x2="14" y2="21.5" />
      <circle cx="8.7" cy="7.5" r="0.6" fill={color} stroke="none" />
      <circle cx="13.3" cy="7.5" r="0.6" fill={color} stroke="none" />
      <circle cx="11" cy="10.8" r="0.6" fill={color} stroke="none" />
    </svg>
  );
}

// Compact list-row card for the Eventos browser (search + kind filter chips above). Unlike the
// old poster-grid layout, this keeps the essentials scannable in one row: thumbnail, kind badge,
// name, price, a short description, when it happens, and how many spots are left/taken.
// STATUS_META: las 3 pestañas de estado (v2.31.0) -- cada actividad cae en exactamente una,
// calculado contra la hora actual (ver classifyItemStatus). "en_curso" existe como pestaña
// propia justo para que no se pierda entre las próximas -- es la que el admin necesita
// encontrar rápido mientras la actividad está pasando.
const STATUS_META = {
  proxima: { label: "Próximas" },
  en_curso: { label: "En curso" },
  pasada: { label: "Pasadas" },
};
// Lunes primero (v2.31.0) -- mismo `value` que usa WEEKDAY_OPTIONS (Date#getDay(): 0=domingo
// … 6=sábado), solo que acá con la letra sola para el selector compacto estilo HabitNow.
const WEEKDAY_LETTERS = [
  { value: 1, label: "L" }, { value: 2, label: "M" }, { value: 3, label: "X" }, { value: 4, label: "J" },
  { value: 5, label: "V" }, { value: 6, label: "S" }, { value: 0, label: "D" },
];

function EventListItem({ kind, shareId, title, description, date, startTime, endTime, price, image, recurring, meta, status, onClick, onEdit, onPagos, onInscribir, ctaLabel }) {
  const kindMeta = {
    open_play: { label: "Open Play", color: COLORS.court, cta: "Inscribirme" },
    // "Ver torneo" es el default (admin: la card lo lleva a Generalidades, no a inscribirse) --
    // EventosTab pisa esto con ctaLabel="Inscribirme" para el cliente (v2.48.1), que aterriza
    // directo en la sub-pestaña Inscripción (ver TorneosSection: es la primera que ve, ya que
    // Generalidades/Categorías/etc. son admin-only).
    torneo: { label: "Torneo", color: COLORS.clay, cta: "Ver torneo" },
    clase: { label: "Clase", color: COLORS.courtDark, cta: "Inscribirme" },
  }[kind];

  return (
    // v2.31.0: pasó de <button> a <div role="button"> -- el botón de editar del admin necesita
    // ser un <button> real anidado adentro (stopPropagation para no disparar también el click
    // de la card), y un <button> dentro de otro <button> es HTML inválido.
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      className="w-full text-left rounded-2xl overflow-hidden flex gap-3 cursor-pointer"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, boxShadow: "0 1px 2px rgba(20,30,25,.04), 0 10px 24px -18px rgba(20,30,25,.22)" }}>
      <div className="relative w-20 sm:w-24 shrink-0"
        style={!image ? { background: `linear-gradient(135deg, ${kindMeta.color}, ${COLORS.courtDark})` } : undefined}>
        {image
          ? <img src={image} alt={title} className="w-full h-full object-cover" />
          : <div className="absolute inset-0 flex items-center justify-center"><RacketIcon size={30} color="rgba(255,255,255,0.85)" /></div>}
        {recurring && (
          <span className="absolute bottom-1 left-1 right-1 text-center text-[8px] font-extrabold px-1 py-0.5 rounded-full uppercase tracking-wide flex items-center justify-center gap-0.5"
            style={{ background: "rgba(255,255,255,0.92)", color: COLORS.courtDark }}>
            <Repeat size={8} /> Recurrente
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col py-3 pr-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ background: `${kindMeta.color}1A`, color: kindMeta.color }}>{kindMeta.label}</span>
            {status === "en_curso" && (
              <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide ml-1 inline-flex items-center gap-1" style={{ background: "#FBE3D6", color: COLORS.clay }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.clay }} /> En curso
              </span>
            )}
            <p className="disp text-[15px] leading-tight mt-1 truncate" style={{ color: COLORS.courtDark }}>{title}</p>
          </div>
          {/* Editar directo desde la card (v2.31.0) -- en el flujo normal del flex, al lado
             del precio, en vez de flotar encima con position:absolute (chocaba visualmente
             con el precio, que también vive en esta misma esquina). */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Compartir directo desde la card (v2.43.1) -- antes solo vivía adentro del
               detalle (EventDetail/ClassDetail/TorneosSection), un paso más para llegar. Va
               primero, antes de "Editar", porque es lo único de este grupo que también ve un
               cliente -- shareId puede faltar por una fracción de segundo mientras carga (no
               debería, pero mejor no reventar si algún día un item llega sin él). */}
            {shareId && (
              <ShareButton kind={kind} id={shareId} iconSize={11}
                text={kind === "torneo" ? `Mira este torneo: ${title}` : kind === "clase" ? `Mira esta clase: ${title}` : `Mira este Open Play: ${title}`}
                className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#EAEEF5", color: COLORS.court }} />
            )}
            {/* Atajo a "quién pagó" (v2.45.1) -- solo torneos por ahora, ver openTournamentInscritos.
               Open Play/Clase ya tienen su propia pestaña "Inscritos" con lo mismo adentro del
               detalle, así que no hace falta duplicar el atajo acá para esos dos. */}
            {onPagos && (
              <button onClick={(e) => { e.stopPropagation(); onPagos(); }} title="Inscritos y pagos"
                className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#EAEEF5", color: COLORS.court }}>
                <Wallet size={11} />
              </button>
            )}
            {onEdit && (
              <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Editar"
                className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "#EAEEF5", color: COLORS.court }}>
                <Pencil size={11} />
              </button>
            )}
            <span className="mono text-sm font-extrabold" style={{ color: COLORS.court }}>{price}</span>
          </div>
        </div>
        {description && <p className="text-xs mt-1 line-clamp-2" style={{ color: "#6B7688" }}>{description}</p>}
        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px]" style={{ color: "#6B7688" }}>
          <span className="flex items-center gap-1"><Calendar size={11} /> {date ? formatDateHuman(date) : "Por definir"}</span>
          {startTime && <span className="flex items-center gap-1"><Clock size={11} /> {formatTimeAmPm(startTime)}{endTime ? `–${formatTimeAmPm(endTime)}` : ""}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 mt-auto pt-2">
          {meta && <span className="text-[11px] font-bold" style={{ color: meta.full ? COLORS.clay : COLORS.court }}>{meta.text}</span>}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {/* Botón real "Inscribir" (v2.47.1) -- antes era un icono chiquito entre Compartir/
               Pagos/Editar; ahora es un botón de verdad, mismo estilo pill que el CTA de la
               card ("Ver torneo"), para que se note igual de claro. Salta directo a la
               sub-pestaña Inscripción del torneo, con el RegistrantPicker (yo mismo/socio/
               invitado) listo para usar -- antes había que entrar a Torneos, elegir el torneo y
               buscar la sub-pestaña a mano. Solo torneos: Open Play/Clase ya inscriben desde su
               propia card ("Inscribirme", el CTA de siempre). */}
            {onInscribir && (
              <button onClick={(e) => { e.stopPropagation(); onInscribir(); }}
                className="text-[11px] font-bold px-3 py-1 rounded-full" style={{ background: COLORS.court, color: "#fff" }}>
                Inscribir
              </button>
            )}
            <span className="text-[11px] font-bold px-3 py-1 rounded-full" style={{ background: COLORS.ball, color: "#fff" }}>{ctaLabel || kindMeta.cta}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Sub-nav del admin dentro de EventDetail/ClassDetail (v2.19.0) -- reemplaza el bloque
// único que antes mezclaba la lista completa de fechas con los controles de edición. "Fechas"
// solo aparece si hay más de una ocurrencia (serie recurrente); "Inscritos" siempre, para ver
// y gestionar quién se anotó. Mismo patrón visual (píldoras) que TORNEO_SUB_ITEMS, pero sin
// nada de brackets/formato de juego -- estas actividades son más livianas que un torneo.
function EventAdminTabs({ tab, setTab, showFechas }) {
  const items = [{ id: "resumen", label: "Resumen" }, ...(showFechas ? [{ id: "fechas", label: "Fechas" }] : []), { id: "inscritos", label: "Inscritos" }];
  return (
    <div className="flex gap-2 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
      {items.map((it) => (
        <button key={it.id} onClick={() => setTab(it.id)}
          className="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap"
          style={{ background: tab === it.id ? COLORS.court : "#EAEEF5", color: tab === it.id ? "#fff" : COLORS.ink }}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// Badge de solo lectura con el estado de pago (PAYMENT_STATUS_META) -- usado donde no hace
// falta poder cambiarlo (ej. resumen de un equipo sin control de admin a la vista).
function PaymentStatusBadge({ status }) {
  const meta = PAYMENT_STATUS_META[status] || PAYMENT_STATUS_META.pendiente_efectivo;
  return <span className="text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>;
}
// Mismo badge pero editable -- un <select> nativo estilizado como la píldora de estado, para
// que el admin cambie entre "Por pagar" / "Pago por verificar" / "Pago verificado" con un
// solo control en vez de tres botones. La verificación automática por correo queda pendiente
// para una fase aparte -- por ahora el admin es quien confirma "Pago verificado" a mano.
function PaymentStatusSelect({ status, onChange }) {
  const meta = PAYMENT_STATUS_META[status] || PAYMENT_STATUS_META.pendiente_efectivo;
  return (
    <select value={status || "pendiente_efectivo"} onChange={(ev) => onChange(ev.target.value)}
      className="text-[10px] font-bold rounded-full pl-2 pr-1 py-0.5 border-0 outline-none appearance-none cursor-pointer"
      style={{ background: meta.bg, color: meta.fg }}>
      {Object.entries(PAYMENT_STATUS_META).map(([val, m]) => <option key={val} value={val}>{m.label}</option>)}
    </select>
  );
}

// Pestaña "Inscritos": lista quién se anotó, agrupada por fecha cuando hay varias ocurrencias.
// Resuelve teléfono/correo buscando al inscrito en `users` por userId -- un invitado sin
// cuenta (userId null, InscripcionAdminForm-style) solo trae el nombre capturado al pagar.
function AttendeesPanel({ occurrences, users, onRemove, onSetAttendance, onSetPaymentStatus }) {
  const withPeople = occurrences.filter((o) => o.registrations.length > 0);
  if (withPeople.length === 0) {
    return <p className="text-sm text-gray-400 italic py-1">Todavía nadie se ha inscrito.</p>;
  }
  return (
    <div className="space-y-4">
      {withPeople.map((o) => (
        <div key={o.id}>
          {occurrences.length > 1 && (
            <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1.5" style={{ color: "#6B7688" }}>
              {formatDateHuman(o.date)} · {o.registrations.length} inscrito{o.registrations.length === 1 ? "" : "s"}
            </p>
          )}
          <div className="space-y-1.5">
            {o.registrations.map((r) => {
              const user = users.find((u) => u.id === r.userId);
              const contact = user?.phone || user?.email || "Sin cuenta";
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm flex-wrap" style={{ background: "#EEF1F7" }}>
                  <label className="flex items-center gap-2.5 min-w-0 cursor-pointer">
                    <input type="checkbox" checked={r.attended} onChange={(ev) => onSetAttendance?.(o.id, r.id, ev.target.checked)} style={{ accentColor: COLORS.court }} />
                    <span className="min-w-0">
                      <span className="font-semibold block truncate">{r.userName}</span>
                      <span className="text-xs text-gray-500 block truncate">
                        {contact} · {r.paymentMethod === "movil" ? "Pago Móvil" : "Efectivo"} · {r.createdAt ? formatDateHuman(new Date(r.createdAt).toISOString().slice(0, 10)) : "—"}
                        {r.paymentMethod === "movil" && r.reference && ` · ref. ${r.reference}`}
                        {r.paymentMethod === "movil" && (r.proofName ? " · comprobante" : " · sin comprobante")}
                      </span>
                    </span>
                  </label>
                  <div className="flex items-center gap-2.5 shrink-0 ml-auto">
                    {r.priceUsd != null && <span className="mono text-xs font-bold" style={{ color: COLORS.court }}>{formatMoney(r.priceUsd)}</span>}
                    {onSetPaymentStatus ? <PaymentStatusSelect status={r.paymentStatus} onChange={(v) => onSetPaymentStatus(o.id, r.id, v)} /> : <PaymentStatusBadge status={r.paymentStatus} />}
                    {onRemove && <button onClick={() => onRemove(o.id, r.id)} title="Quitar inscripción" className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// Inscripción rápida por el admin (v2.40.0) -- el primer día de actividades, exigirle a cada
// inscrito el checkout completo (referencia, comprobante...) es una traba a la conversión que
// no hace falta: el admin puede ir llenando el cupo él mismo desde la pestaña "Inscritos",
// sin más dato que el nombre y el precio. Reutiliza registerForOpenPlay/registerForClass tal
// cual -- arranca "Por pagar" (mismo criterio que TeamRegistration en torneos) y el admin
// verifica el pago después, en la cancha, con el mismo PaymentStatusSelect que ya usa la
// lista de inscritos. Búsqueda de socio opcional (mismo patrón que RegistrantPicker) solo para
// asociar userId -- el precio SIEMPRE lo escribe el admin a mano, porque acá no sabemos qué
// plan tiene el socio elegido para calcularle el descuento solo.
function WalkInRegistration({ users, basePrice, club, onAdd }) {
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [price, setPrice] = useState(String(basePrice ?? 0));
  const [saving, setSaving] = useState(false);

  const results = !selectedUser && query.trim().length > 0
    ? users.filter((u) => u.role !== "admin" &&
        (u.name.toLowerCase().includes(query.trim().toLowerCase()) || u.email.toLowerCase().includes(query.trim().toLowerCase())))
        .slice(0, 6)
    : [];

  // Aviso de posible duplicado (v2.40.1) -- si el admin escribió el nombre completo de un
  // socio real pero NO lo seleccionó de la lista (typeó de más rápido que lo que tardó en
  // aparecer el dropdown, o ni lo miró), la inscripción quedaría "sin cuenta" por accidente
  // cuando en realidad esa persona sí tiene una. Coincidencia exacta de nombre (no solo
  // "incluye", como en `results`) para no molestar con falsos positivos por substring.
  const exactMatch = !selectedUser && query.trim().length > 0
    ? users.find((u) => u.role !== "admin" && u.name.trim().toLowerCase() === query.trim().toLowerCase())
    : null;

  const pickUser = (u) => { setSelectedUser(u); setQuery(u.name); };
  const clearUser = () => { setSelectedUser(null); setQuery(""); };

  const canAdd = query.trim().length > 0 && price.trim() !== "" && !isNaN(Number(price)) && Number(price) >= 0;

  const submit = async () => {
    if (!canAdd || saving) return;
    setSaving(true);
    const priceUsd = Number(price);
    await onAdd({
      userName: query.trim(), userId: selectedUser?.id, paymentMethod: "efectivo",
      reference: "", proofName: "", priceUsd, priceBs: priceUsd * (Number(club.bsPerUsd) || 0),
    });
    setSaving(false);
    setQuery(""); setSelectedUser(null); setPrice(String(basePrice ?? 0));
  };

  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: "#F4F6FA", border: `1px dashed ${COLORS.line}` }}>
      <p className="text-xs font-bold mb-2 flex items-center gap-1.5" style={{ color: COLORS.courtDark }}><UserPlus size={13} /> Agregar inscrito (admin)</p>
      <div className="flex gap-2 flex-wrap items-start">
        <div className="relative flex-1 min-w-[160px]">
          {selectedUser ? (
            <div className="flex items-center justify-between px-3 py-2 rounded-xl" style={{ background: "#DCEBD5" }}>
              <span className="text-sm font-semibold truncate">{selectedUser.name} <span className="text-xs font-normal text-gray-500">· {selectedUser.email}</span></span>
              <button onClick={clearUser} className="text-gray-400 hover:text-red-500 shrink-0"><X size={13} /></button>
            </div>
          ) : (
            <>
              <input style={inputStyle} value={query} onChange={(ev) => setQuery(ev.target.value)} placeholder="Nombre del inscrito (o busca un socio)" />
              {results.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl overflow-hidden shadow-lg" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
                  {results.map((u) => (
                    <button key={u.id} type="button" onClick={() => pickUser(u)} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2" style={{ background: "#fff" }}>
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: COLORS.court, color: "#fff" }}>{u.name.charAt(0).toUpperCase()}</span>
                      <span className="truncate">{u.name}<span className="text-gray-400"> · {u.email}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <input type="number" min="0" step="0.5" style={{ ...inputStyle, width: 90 }} value={price} onChange={(ev) => setPrice(ev.target.value)} placeholder="Precio" />
        <button disabled={!canAdd || saving} onClick={submit} style={{ background: canAdd && !saving ? COLORS.court : "#E5E5E5", color: canAdd && !saving ? "#fff" : "#999" }} className="px-3 py-2 rounded-xl text-sm font-bold shrink-0">
          {saving ? "..." : "Agregar"}
        </button>
      </div>
      {exactMatch && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs mt-2 flex-wrap" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
          <span className="flex items-center gap-1.5"><AlertTriangle size={13} className="shrink-0" /> Ya existe un socio llamado "{exactMatch.name}" ({exactMatch.email}). ¿Es la misma persona?</span>
          <button type="button" onClick={() => pickUser(exactMatch)} className="font-bold underline shrink-0">Sí, es él/ella</button>
        </div>
      )}
      <p className="text-[10px] mt-1.5" style={{ color: "#6B7688" }}>Arranca "Por pagar" -- confirma el pago en la lista de abajo cuando llegue a la cancha. Si es socio con descuento, ajusta el precio antes de agregar.</p>
    </div>
  );
}

// `occurrences` is every future/today entry that shares e's recurringGroupId (or just [e]
// for a one-off event). When there's more than one, the panel lists each date so the member
// picks which session to check out for, instead of forcing a single date on a recurring series.
function EventDetail({ e, occurrences, courts, club, currentPlan, currentUser, users, onRegister, onRemove, onRemoveSeries, onEdit, onEditSeries, onRemoveRegistration, onSetAttendance, onSetPaymentStatus, onClose, isAdmin }) {
  const courtNames = e.courtIds.map((id) => courts.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
  const isSeries = occurrences.length > 1;
  const isMember = !!currentPlan && currentPlan.monthlyPrice > 0;
  // Ventana de reserva del plan (v2.27.0) -- "cancha o cualquier actividad", así que también
  // limita hasta cuándo se puede inscribir a un Open Play. El admin nunca queda bloqueado.
  const bookingWindowDeadlineMs = Date.now() + (currentPlan?.bookingWindowHours ?? 48) * 3600000;
  const outOfWindow = (occ) => !isAdmin && new Date(occ.date + "T00:00:00").getTime() + timeToMinutes(occ.startTime) * 60000 > bookingWindowDeadlineMs;
  // Un cliente se inscribe directo en la ocurrencia más próxima (occurrences[0] === e, ya
  // vienen filtradas/ordenadas desde EventosTab) -- mismo checkout de un paso que un evento
  // único, sin lista de fechas para elegir. El admin ve, además, sus propias pestañas
  // (Resumen/Fechas/Inscritos) -- la lista completa de fechas la sigue necesitando para poder
  // borrar una fecha puntual de la serie sin borrar toda la serie.
  const showDateList = isSeries && isAdmin;
  const [checkoutId, setCheckoutId] = useState(showDateList ? null : e.id);
  const checkoutTarget = occurrences.find((o) => o.id === checkoutId);
  const [adminTab, setAdminTab] = useState("resumen");
  // Pestaña Inscritos: arranca en `e` -- la ocurrencia próxima que ya representa esta tarjeta
  // ("la fecha publicada") -- y deja elegir otra fecha de la serie desde el selector.
  const [attendeesDateId, setAttendeesDateId] = useState(e.id);
  // Confirmación antes de borrar (v2.36.0) -- null (nada), {mode:"series"} (el botón de
  // arriba en una serie: hay que elegir entre solo esta fecha o toda la serie) o
  // {mode:"single", id, label} (un borrado sin ambigüedad -- el botón de arriba cuando NO es
  // serie, o cualquier fila puntual de "Fechas").
  const [confirmDelete, setConfirmDelete] = useState(null);

  return (
    <Card>
      {/* Miniatura + nombre en mayúscula sostenida (v2.25.0) -- antes el título era texto
         normal del mismo peso que el resto de la ficha, se perdía frente al monto/checkout de
         abajo. La miniatura usa la imagen subida al crear el Open Play si hay una; si no, un
         ícono de respaldo con el color de acento de la actividad, para que nunca quede un
         hueco vacío donde iría la imagen. */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          {e.image ? (
            <img src={e.image} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: COLORS.court }}>
              <PartyPopper size={24} color="#fff" />
            </div>
          )}
          <div className="min-w-0">
            <p className="disp text-lg font-extrabold uppercase tracking-wide leading-tight" style={{ color: COLORS.courtDark }}>{e.name}</p>
            <p className="text-xs mt-1" style={{ color: "#6B7688" }}>
              Nivel {e.level} · {formatTimeAmPm(e.startTime)}–{formatTimeAmPm(e.endTime)} · {courtNames}
              {showDateList ? (
                <> · <span style={{ color: COLORS.court, fontWeight: 700 }}>Recurrente, cada {weekdayLabel(e.date)}</span></>
              ) : (
                <> · {formatDateHuman(e.date)}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Compartir (v2.43.0) -- visible para admin y cliente por igual, a diferencia de
             los botones de editar/borrar que le siguen. La clave del link es la de la serie
             (recurringGroupId||e.id), igual que `selected.key` en EventosTab, para que un
             evento recurrente comparta un solo link estable sin importar qué fecha esté "al
             frente" ese día. */}
          <ShareButton kind="open_play" id={e.recurringGroupId || e.id} text={`Mira este Open Play: ${e.name}`} />
          {isSeries && onEditSeries && <button onClick={onEditSeries} title="Editar toda la serie" className="text-gray-300 hover:text-gray-600"><Pencil size={16} /></button>}
          {!isSeries && onEdit && <button onClick={() => onEdit(e)} title="Editar" className="text-gray-300 hover:text-gray-600"><Pencil size={16} /></button>}
          {/* Un solo botón de borrar sin importar si es serie o no (v2.36.0) -- antes una
             serie SOLO ofrecía "borrar toda la serie" desde acá arriba (borrar una fecha
             puntual quedaba escondido en la pestaña "Fechas", más abajo). Ahora siempre
             pregunta primero, y si es recurrente, deja elegir entre las dos opciones en el
             mismo popup. */}
          {(onRemove || onRemoveSeries) && (
            <button onClick={() => setConfirmDelete(isSeries ? { mode: "series" } : { mode: "single", id: e.id, label: e.name })}
              className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
          )}
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600"><X size={18} /></button>
        </div>
      </div>
      {e.description && <p className="text-sm mb-3" style={{ color: "#3D4A5C" }}>{e.description}</p>}

      {isAdmin && <EventAdminTabs tab={adminTab} setTab={setAdminTab} showFechas={showDateList} />}

      {(!isAdmin || adminTab === "resumen") && (
        <p className="text-xs mb-4" style={{ color: "#6B7688" }}>
          {showDateList
            ? `${occurrences.length} fecha${occurrences.length === 1 ? "" : "s"} próxima${occurrences.length === 1 ? "" : "s"} · ${occurrences.reduce((s, o) => s + o.registrations.length, 0)} inscrito(s) en total. Usa "Fechas" para ver o editar cada sesión.`
            : e.capacity
              ? (e.registrations.length >= e.capacity ? "Cupo lleno" : `${Math.max(0, e.capacity - e.registrations.length)} cupo${(e.capacity - e.registrations.length) === 1 ? "" : "s"} disponible${(e.capacity - e.registrations.length) === 1 ? "" : "s"} de ${e.capacity}`)
              : `${e.registrations.length} inscrito(s)`}
        </p>
      )}

      {isAdmin && adminTab === "fechas" && showDateList && (
        <div className="space-y-1.5 mb-4">
          {occurrences.map((o) => {
            const slotsLeft = e.capacity ? Math.max(0, e.capacity - o.registrations.length) : null;
            const isFull = slotsLeft === 0;
            return (
              <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: checkoutId === o.id ? "#DCEBD5" : "#EEF1F7" }}>
                <span>{formatDateHuman(o.date)} <span className="text-gray-500 text-xs">
                  · {slotsLeft !== null ? (isFull ? "Cupo lleno" : `${slotsLeft} cupo${slotsLeft === 1 ? "" : "s"} disponible${slotsLeft === 1 ? "" : "s"}`) : `${o.registrations.length} inscrito(s)`}
                </span></span>
                <div className="flex items-center gap-2">
                  {onEdit && <button onClick={() => onEdit(o)} title="Editar esta fecha" className="text-gray-300 hover:text-gray-600"><Pencil size={13} /></button>}
                  {onRemove && <button onClick={() => setConfirmDelete({ mode: "single", id: o.id, label: formatDateHuman(o.date) })} title="Eliminar esta fecha" className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>}
                  <button disabled={isFull} onClick={() => setCheckoutId(o.id)} className="text-xs font-bold px-2.5 py-1 rounded-lg"
                    style={{
                      background: isFull ? "#EDEEF2" : checkoutId === o.id ? COLORS.court : "#fff",
                      color: isFull ? "#9AA6BC" : checkoutId === o.id ? "#fff" : COLORS.court,
                      border: `1.5px solid ${isFull ? "transparent" : COLORS.court}`, cursor: isFull ? "not-allowed" : "pointer",
                    }}>
                    {isFull ? "Lleno" : checkoutId === o.id ? "Seleccionada" : "Elegir"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && adminTab === "inscritos" && (
        <div className="mb-4">
          {isSeries && (
            <div className="mb-3">
              <Label>Fecha</Label>
              <select style={inputStyle} value={attendeesDateId} onChange={(ev) => setAttendeesDateId(ev.target.value)}>
                {occurrences.map((o) => (
                  <option key={o.id} value={o.id}>{formatDateHuman(o.date)} · {o.registrations.length} inscrito{o.registrations.length === 1 ? "" : "s"}</option>
                ))}
              </select>
            </div>
          )}
          <WalkInRegistration users={users} basePrice={e.price} club={club} onAdd={(reg) => onRegister(attendeesDateId, reg)} />
          <AttendeesPanel occurrences={isSeries ? occurrences.filter((o) => o.id === attendeesDateId) : occurrences} users={users} onRemove={onRemoveRegistration} onSetAttendance={onSetAttendance} onSetPaymentStatus={onSetPaymentStatus} />
        </div>
      )}

      {checkoutTarget && (
        (checkoutTarget.capacity && checkoutTarget.registrations.length >= checkoutTarget.capacity) ? (
          <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
            <AlertTriangle size={13} /> Este cupo está lleno — ya se alcanzó el quorum máximo.
          </div>
        ) : outOfWindow(checkoutTarget) ? (
          <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
            <AlertTriangle size={13} /> Tu plan{currentPlan?.name ? ` (${currentPlan.name})` : ""} permite inscribirte con hasta {formatBookingWindow(currentPlan?.bookingWindowHours ?? 48)} de anticipación -- todavía no se abre para esta fecha.
          </div>
        ) : (
          <CheckoutPanel title={`Inscripción a ${e.name}${isSeries ? ` · ${formatDateHuman(checkoutTarget.date)}` : ""}`} baseUsd={e.price} discountPct={isMember ? (currentPlan?.openPlayDiscountPct ?? 0) : 0} club={club} defaultName={currentUser.name}
            onConfirm={(checkout) => onRegister(checkoutTarget.id, { ...checkout, userId: currentUser.id })} onCancel={onClose} confirmLabel="Confirmar inscripción" />
        )
      )}

      {confirmDelete?.mode === "series" && (
        <ConfirmDeleteModal
          title="¿Qué quieres eliminar?"
          message={`"${e.name}" es una actividad recurrente, cada ${weekdayLabel(e.date)}.`}
          options={[
            { label: `Solo esta fecha (${formatDateHuman(e.date)})`, variant: "danger", onClick: () => onRemove(e.id) },
            { label: "Toda la serie (todas las fechas)", variant: "danger", onClick: () => onRemoveSeries() },
          ]}
          onCancel={() => setConfirmDelete(null)} />
      )}
      {confirmDelete?.mode === "single" && (
        <ConfirmDeleteModal
          title="¿Eliminar esta actividad?"
          message={`"${confirmDelete.label}" se borrará por completo. Esta acción no se puede deshacer.`}
          options={[{ label: "Eliminar", variant: "danger", onClick: () => onRemove(confirmDelete.id) }]}
          onCancel={() => setConfirmDelete(null)} />
      )}
    </Card>
  );
}

function ClassDetail({ e, occurrences, courts, club, currentPlan, currentUser, users, onRegister, onRemove, onRemoveSeries, onEdit, onEditSeries, onRemoveRegistration, onSetAttendance, onSetPaymentStatus, onClose, isAdmin }) {
  const courtNames = e.courtIds.map((id) => courts.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
  const isSeries = occurrences.length > 1;
  const isMember = !!currentPlan && currentPlan.monthlyPrice > 0;
  // Ventana de reserva del plan (v2.27.0) -- ver mismo comentario en EventDetail.
  const bookingWindowDeadlineMs = Date.now() + (currentPlan?.bookingWindowHours ?? 48) * 3600000;
  const outOfWindow = (occ) => !isAdmin && new Date(occ.date + "T00:00:00").getTime() + timeToMinutes(occ.startTime) * 60000 > bookingWindowDeadlineMs;
  // Mismo criterio que EventDetail: cliente se inscribe directo en la ocurrencia más
  // próxima, sin elegir fecha; admin ve además sus pestañas propias.
  const showDateList = isSeries && isAdmin;
  const [checkoutId, setCheckoutId] = useState(showDateList ? null : e.id);
  const checkoutTarget = occurrences.find((o) => o.id === checkoutId);
  const [adminTab, setAdminTab] = useState("resumen");
  // Mismo criterio que EventDetail: arranca en la ocurrencia próxima ("la fecha publicada").
  const [attendeesDateId, setAttendeesDateId] = useState(e.id);
  // Confirmación antes de borrar -- ver mismo comentario en EventDetail.
  const [confirmDelete, setConfirmDelete] = useState(null);

  return (
    <Card>
      {/* Mismo tratamiento de miniatura + nombre en mayúscula sostenida que EventDetail
         (v2.25.0) -- las clases no tienen imagen propia todavía, así que siempre usan el
         ícono de respaldo (con el color de acento de clases, distinto al de Open Play). */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0" style={{ background: COLORS.clay }}>
            <GraduationCap size={24} color="#fff" />
          </div>
          <div className="min-w-0">
            <p className="disp text-lg font-extrabold uppercase tracking-wide leading-tight" style={{ color: COLORS.courtDark }}>{e.academyName}</p>
            <p className="text-xs mt-1" style={{ color: "#6B7688" }}>
              Nivel {e.level} · {formatTimeAmPm(e.startTime)}–{formatTimeAmPm(e.endTime)} · {courtNames}
              {showDateList ? (
                <> · <span style={{ color: COLORS.court, fontWeight: 700 }}>Recurrente, cada {weekdayLabel(e.date)}</span></>
              ) : (
                <> · {formatDateHuman(e.date)}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Compartir -- ver mismo comentario en EventDetail. */}
          <ShareButton kind="clase" id={e.recurringGroupId || e.id} text={`Mira esta clase con ${e.academyName}`} />
          {isSeries && onEditSeries && <button onClick={onEditSeries} title="Editar toda la serie" className="text-gray-300 hover:text-gray-600"><Pencil size={16} /></button>}
          {!isSeries && onEdit && <button onClick={() => onEdit(e)} title="Editar" className="text-gray-300 hover:text-gray-600"><Pencil size={16} /></button>}
          {/* Un solo botón de borrar sin importar si es serie o no -- ver mismo comentario en
             EventDetail. */}
          {(onRemove || onRemoveSeries) && (
            <button onClick={() => setConfirmDelete(isSeries ? { mode: "series" } : { mode: "single", id: e.id, label: e.academyName })}
              className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
          )}
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600"><X size={18} /></button>
        </div>
      </div>

      {isAdmin && <EventAdminTabs tab={adminTab} setTab={setAdminTab} showFechas={showDateList} />}

      {(!isAdmin || adminTab === "resumen") && (
        <p className="text-xs mb-4" style={{ color: "#6B7688" }}>
          {showDateList
            ? `${occurrences.length} fecha${occurrences.length === 1 ? "" : "s"} próxima${occurrences.length === 1 ? "" : "s"} · ${occurrences.reduce((s, o) => s + o.registrations.length, 0)} inscrito(s) en total. Usa "Fechas" para ver o editar cada sesión.`
            : `${e.registrations.length} inscrito(s)`}
        </p>
      )}

      {isAdmin && adminTab === "fechas" && showDateList && (
        <div className="space-y-1.5 mb-4">
          {occurrences.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: checkoutId === o.id ? "#DCEBD5" : "#EEF1F7" }}>
              <span>{formatDateHuman(o.date)} <span className="text-gray-500 text-xs">· {o.registrations.length} inscrito(s)</span></span>
              <div className="flex items-center gap-2">
                {onEdit && <button onClick={() => onEdit(o)} title="Editar esta fecha" className="text-gray-300 hover:text-gray-600"><Pencil size={13} /></button>}
                {onRemove && <button onClick={() => setConfirmDelete({ mode: "single", id: o.id, label: formatDateHuman(o.date) })} title="Eliminar esta fecha" className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>}
                <button onClick={() => setCheckoutId(o.id)} className="text-xs font-bold px-2.5 py-1 rounded-lg"
                  style={{ background: checkoutId === o.id ? COLORS.court : "#fff", color: checkoutId === o.id ? "#fff" : COLORS.court, border: `1.5px solid ${COLORS.court}` }}>
                  {checkoutId === o.id ? "Seleccionada" : "Elegir"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isAdmin && adminTab === "inscritos" && (
        <div className="mb-4">
          {isSeries && (
            <div className="mb-3">
              <Label>Fecha</Label>
              <select style={inputStyle} value={attendeesDateId} onChange={(ev) => setAttendeesDateId(ev.target.value)}>
                {occurrences.map((o) => (
                  <option key={o.id} value={o.id}>{formatDateHuman(o.date)} · {o.registrations.length} inscrito{o.registrations.length === 1 ? "" : "s"}</option>
                ))}
              </select>
            </div>
          )}
          <WalkInRegistration users={users} basePrice={e.price} club={club} onAdd={(reg) => onRegister(attendeesDateId, reg)} />
          <AttendeesPanel occurrences={isSeries ? occurrences.filter((o) => o.id === attendeesDateId) : occurrences} users={users} onRemove={onRemoveRegistration} onSetAttendance={onSetAttendance} onSetPaymentStatus={onSetPaymentStatus} />
        </div>
      )}

      {checkoutTarget && (
        outOfWindow(checkoutTarget) ? (
          <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
            <AlertTriangle size={13} /> Tu plan{currentPlan?.name ? ` (${currentPlan.name})` : ""} permite inscribirte con hasta {formatBookingWindow(currentPlan?.bookingWindowHours ?? 48)} de anticipación -- todavía no se abre para esta fecha.
          </div>
        ) : (
          <CheckoutPanel title={`Cupo en clase con ${e.academyName}${isSeries ? ` · ${formatDateHuman(checkoutTarget.date)}` : ""}`} baseUsd={e.price} discountPct={isMember ? memberDiscountPct(e.price, e.memberPrice) : 0} club={club} defaultName={currentUser.name}
            onConfirm={(checkout) => onRegister(checkoutTarget.id, { ...checkout, userId: currentUser.id })} onCancel={onClose} confirmLabel="Confirmar cupo" />
        )
      )}

      {confirmDelete?.mode === "series" && (
        <ConfirmDeleteModal
          title="¿Qué quieres eliminar?"
          message={`"${e.academyName}" es una actividad recurrente, cada ${weekdayLabel(e.date)}.`}
          options={[
            { label: `Solo esta fecha (${formatDateHuman(e.date)})`, variant: "danger", onClick: () => onRemove(e.id) },
            { label: "Toda la serie (todas las fechas)", variant: "danger", onClick: () => onRemoveSeries() },
          ]}
          onCancel={() => setConfirmDelete(null)} />
      )}
      {confirmDelete?.mode === "single" && (
        <ConfirmDeleteModal
          title="¿Eliminar esta actividad?"
          message={`"${confirmDelete.label}" se borrará por completo. Esta acción no se puede deshacer.`}
          options={[{ label: "Eliminar", variant: "danger", onClick: () => onRemove(confirmDelete.id) }]}
          onCancel={() => setConfirmDelete(null)} />
      )}
    </Card>
  );
}

const EVENT_FILTER_CHIPS = [
  { value: "all", label: "Todas" },
  { value: "open_play", label: "Open Plays" },
  { value: "clase", label: "Clases" },
  { value: "torneo", label: "Torneos" },
];

function EventosTab({ club, courts, openPlays, classes, addOpenPlay, addClass, updateOpenPlay, updateOpenPlaySeries, updateClass, updateClassSeries, removeOpenPlay, removeClass, removeOpenPlaySeries, removeClassSeries, registerForOpenPlay, registerForClass, removeOpenPlayRegistration, removeClassRegistration, setOpenPlayAttendance, setClassAttendance, setOpenPlayPaymentStatus, setClassPaymentStatus, users, currentUser, currentPlan, tournaments, categories, occupiedKeys, setTab, openTournament, openTournamentInscritos, openTournamentInscripcion, onCreateTournament, role, autoOpen }) {
  const [showOpenPlayForm, setShowOpenPlayForm] = useState(false);
  const [showClaseForm, setShowClaseForm] = useState(false);
  const [selected, setSelected] = useState(null);
  // Abre el detalle solo (v2.43.0) cuando se llega desde un link compartido (`autoOpen`, ver
  // PickleballTournamentApp) -- una vez, con un ref en vez de limpiar `autoOpen` desde el
  // padre, porque el padre ya usó ese mismo valor para decidir tab/activeTournamentId y no
  // vale la pena duplicar el "ya lo consumí" en dos componentes.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpenedRef.current) return;
    const exists = autoOpen.kind === "open_play"
      ? openPlays.some((e) => (e.recurringGroupId || e.id) === autoOpen.id)
      : classes.some((e) => (e.recurringGroupId || e.id) === autoOpen.id);
    if (exists) { setSelected({ kind: autoOpen.kind, key: autoOpen.id }); autoOpenedRef.current = true; }
  }, [autoOpen, openPlays, classes]);
  // { data, isSeries } del Open Play/Clase que se está editando ahora mismo -- data trae
  // todos los campos de OpenPlayForm/ClaseForm (una ocurrencia puntual, o la representante
  // de la serie si isSeries). null = no hay edición en curso (se ve EventDetail/ClassDetail
  // normal dentro del modal).
  const [editingOpenPlay, setEditingOpenPlay] = useState(null);
  const [editingClass, setEditingClass] = useState(null);
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState("all");
  // Pestaña de estado (v2.31.0) -- por defecto "Próximas", que es lo que casi siempre se
  // quiere ver; "En curso" y "Pasadas" están a un toque, no enterradas dentro de "Próximas".
  const [statusFilter, setStatusFilter] = useState("proxima");
  // Selector de día de la semana estilo HabitNow (v2.31.0) -- null = sin filtrar. Un solo día
  // a la vez, togglea si se toca el mismo de nuevo.
  const [weekdayFilter, setWeekdayFilter] = useState(null);
  const isAdmin = role === "admin";
  const todayIso = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  // Próxima / en curso / pasada (v2.31.0), calculado contra `now` -- un torneo usa su rango
  // completo (date..endDate), Open Play/Clase su única fecha. Sin fecha cargada (torneo recién
  // creado) cuenta como "próxima" -- no hay forma de saber que ya pasó.
  const classifyItemStatus = (it) => {
    if (!it.date) return "proxima";
    const startTs = new Date(it.date + "T00:00:00").getTime() + timeToMinutes(it.startTime || "00:00") * 60000;
    const endDateStr = it.endDate || it.date;
    const endTs = new Date(endDateStr + "T00:00:00").getTime() + timeToMinutes(it.endTime || it.startTime || "23:59") * 60000;
    if (now < startTs) return "proxima";
    if (now <= endTs) return "en_curso";
    return "pasada";
  };
  // Un torneo puede caer en un día de la semana que ni siquiera es su fecha de inicio -- se
  // revisa todo su rango (date..endDate) en vez de solo el primer día.
  const matchesWeekday = (it) => {
    if (weekdayFilter == null) return true;
    if (!it.date) return false;
    if (it.endDate && it.endDate !== it.date) {
      let d = new Date(it.date + "T00:00:00");
      const end = new Date(it.endDate + "T00:00:00");
      while (d <= end) {
        if (d.getDay() === weekdayFilter) return true;
        d.setDate(d.getDate() + 1);
      }
      return false;
    }
    return new Date(it.date + "T00:00:00").getDay() === weekdayFilter;
  };

  const noEvents = openPlays.length === 0 && classes.length === 0 && tournaments.every((t) => t.status !== "published");

  // Recurring Open Plays are stored as one entry per occurrence (sharing a recurringGroupId)
  // so registrations/court blocks stay per-date. Group them back into one card per series —
  // showing the next upcoming date — instead of flooding the list with every future week.
  const openPlaySeries = useMemo(() => {
    const groups = {};
    openPlays.forEach((e) => {
      const key = e.recurringGroupId || e.id;
      (groups[key] = groups[key] || []).push(e);
    });
    return Object.values(groups).map((list) => [...list].sort((a, b) => a.date.localeCompare(b.date)));
  }, [openPlays]);

  const seriesForKey = (key) => openPlaySeries.find((list) => (list[0].recurringGroupId || list[0].id) === key);

  // Same grouping as openPlaySeries above, mirrored for recurring Classes.
  const classSeries = useMemo(() => {
    const groups = {};
    classes.forEach((e) => {
      const key = e.recurringGroupId || e.id;
      (groups[key] = groups[key] || []).push(e);
    });
    return Object.values(groups).map((list) => [...list].sort((a, b) => a.date.localeCompare(b.date)));
  }, [classes]);

  const classSeriesForKey = (key) => classSeries.find((list) => (list[0].recurringGroupId || list[0].id) === key);

  // Un socio activo (cualquier plan pago) ve el precio de miembro directo en la tarjeta de la
  // lista -- "Gratis" si esa actividad es de cortesía para su plan -- en vez del precio base
  // que ve un no-socio. Antes la tarjeta siempre mostraba rep.price sin importar quién mirara
  // (v2.29.0): un miembro solo veía su precio real al entrar al detalle, no antes.
  const isMember = !!currentPlan && currentPlan.monthlyPrice > 0;
  // Open Play usa el % del plan (v2.30.0, mismo criterio que EventDetail) -- Clases todavía
  // no tiene un descuento de plan real, así que se queda con su memberPrice de siempre.
  const displayPrice = (rep, kind) => {
    const usd = !isMember ? rep.price
      : kind === "open_play" ? rep.price * (1 - (currentPlan?.openPlayDiscountPct ?? 0) / 100)
        : (rep.memberPrice ?? rep.price);
    return usd > 0 ? formatMoney(usd) : "Gratis";
  };

  // One flat, browsable list mixing Open Plays, Clases and the tournament — this is what
  // feeds the search box and the "Disponibles ahora / Open Plays / Clases / Torneos" chips.
  const listItems = useMemo(() => {
    const items = [];
    openPlaySeries.forEach((list) => {
      const key = list[0].recurringGroupId || list[0].id;
      const rep = list.find((o) => o.date >= todayIso) || list[list.length - 1];
      const isSeries = list.length > 1;
      const slotsLeft = rep.capacity ? Math.max(0, rep.capacity - rep.registrations.length) : null;
      items.push({
        key: `op-${key}`, shareId: key, kind: "open_play", title: rep.name,
        description: rep.description || `Nivel ${rep.level}`,
        date: rep.date, startTime: rep.startTime, endTime: rep.endTime,
        price: displayPrice(rep, "open_play"), image: rep.image, recurring: isSeries,
        meta: slotsLeft !== null
          ? { text: slotsLeft > 0 ? `${slotsLeft} cupo${slotsLeft === 1 ? "" : "s"} disponible${slotsLeft === 1 ? "" : "s"}` : "Cupo lleno", full: slotsLeft === 0 }
          : { text: `${rep.registrations.length} inscrito(s)` },
        onClick: () => setSelected({ kind: "open_play", key }),
        // Botón de editar directo en la card (v2.31.0) -- va a la serie completa si es
        // recurrente (mismo criterio que "editar toda la serie" dentro del detalle), o a esta
        // única ocurrencia si no. Abre el modal ya en modo edición, sin pasar primero por el
        // detalle.
        onEdit: isAdmin ? () => { setSelected({ kind: "open_play", key }); setEditingOpenPlay({ data: rep, isSeries }); } : null,
      });
    });
    classSeries.forEach((list) => {
      const key = list[0].recurringGroupId || list[0].id;
      const rep = list.find((c) => c.date >= todayIso) || list[list.length - 1];
      const isSeries = list.length > 1;
      items.push({
        key: `cl-${key}`, shareId: key, kind: "clase", title: rep.academyName, description: `Nivel ${rep.level}`,
        date: rep.date, startTime: rep.startTime, endTime: rep.endTime,
        price: displayPrice(rep, "clase"), image: null, recurring: isSeries,
        meta: { text: `${rep.registrations.length} inscrito(s)` },
        onClick: () => setSelected({ kind: "clase", key }),
        onEdit: isAdmin ? () => { setSelected({ kind: "clase", key }); setEditingClass({ data: rep, isSeries }); } : null,
      });
    });
    // El club organiza varios torneos a la vez -- una tarjeta por cada uno, igual que Open
    // Plays/Clases (antes esto era una sola tarjeta fija para el único torneo que existía).
    // Un torneo "draft" (recién creado, solo con nombre) nunca aparece acá, ni para admin --
    // Actividades es "lo que está en vivo", el borrador se gestiona desde la lista de
    // Torneos hasta que se publique (v2.16.0).
    tournaments.filter((t) => t.status === "published").forEach((t) => {
      const tCats = categories.filter((c) => c.tournamentId === t.id);
      // v2.81.1 -- a pedido del club: "equipos inscritos" contaba FILAS de equipo, no personas
      // -- una dupla "esperando pareja" (un solo jugador, ver countCategoryPlayers) contaba
      // igual que una ya completa, subestimando cuánta gente de verdad se anotó. Esto cuenta
      // JUGADORES reales (mismo criterio que categoryCountLabel/categoryIsFull en el resto de
      // la app), no filas.
      const registrationCount = tCats.reduce((s, c) => s + countCategoryPlayers(c.teams), 0);
      // Antes esto era un solo booleano (¿hay algún equipo inscrito?) que confundía "sin
      // categorías todavía" con "hay categorías pero nadie se anotó aún" -- distinguir los
      // dos casos importa más ahora que hay varias tarjetas de torneo a la vez.
      const noCatsYet = tCats.length === 0;
      // Precio de inscripción (v2.33.0): antes decía "Ver detalles", sin ninguna cifra, a
      // diferencia de Open Play/Clase que sí muestran su precio en la card. Se usa el precio
      // de la 1ra categoría (tournamentRegPrice con catCount=1) como entrada -- "Desde" porque
      // sumar más categorías en el mismo carrito cuesta más, nunca menos (ver
      // tournamentRegPrice/InscripcionTab).
      const entryPrice = tournamentRegPrice(t, 1);
      items.push({
        key: `t-${t.id}`, shareId: t.id, kind: "torneo", title: t.name || "Torneo del club",
        description: noCatsYet ? "Sin categorías aún." : `${tCats.length} categoría(s) abiertas.`,
        // endDate (v2.31.0): un torneo dura varios días -- clasificarlo "próxima/en curso/
        // pasada" o filtrarlo por día de la semana necesita el rango completo, no solo el
        // primer día.
        date: t.startDate, endDate: t.endDate, startTime: t.dailyStart, endTime: t.dailyEnd,
        price: entryPrice > 0 ? `Desde ${formatMoney(entryPrice)}` : "Gratis", image: t.image || null, recurring: false,
        meta: { text: noCatsYet ? "Sin categorías aún" : `${registrationCount} inscripción${registrationCount === 1 ? "" : "es"}` },
        onClick: () => openTournament(t.id),
        // "Editar" un torneo YA es abrirlo -- Generalidades es la pantalla de edición del
        // admin, no hace falta un modo edición aparte como Open Play/Clase.
        onEdit: isAdmin ? () => openTournament(t.id) : null,
        // Atajo directo a "quién pagó" (v2.45.1, renombrada "Inscritos" en v2.50.0) -- sin
        // esto, verificar un pago suelto de torneo significaba abrir el torneo y buscar la
        // sub-pestaña a mano.
        onPagos: isAdmin ? () => openTournamentInscritos(t.id) : null,
        // Atajo directo a "inscribir a alguien" (v2.47.0) -- mismo criterio que onPagos, pero
        // aterriza en la sub-pestaña Inscripción en vez de Pagos.
        onInscribir: isAdmin ? () => openTournamentInscripcion(t.id) : null,
        // "Inscribirme" en vez de "Ver torneo" para el cliente (v2.48.1) -- clickear la card
        // ya lo lleva directo a Inscripción (ver comentario en EventListItem), así que el CTA
        // debe decir lo que de verdad va a pasar. El admin conserva "Ver torneo" -- para él
        // clickear la card abre Generalidades, y ya tiene "Inscribir" aparte como botón real.
        ctaLabel: isAdmin ? null : "Inscribirme",
      });
    });
    return items;
  }, [openPlaySeries, classSeries, tournaments, categories, todayIso, openTournament, isMember, currentPlan, isAdmin]);

  // Punto en la pestaña "En curso" cuando hay algo pasando ahora mismo (v2.31.0), sin importar
  // qué pestaña esté activa -- para que un admin parado en "Próximas" no deje de notar que
  // algo ya arrancó, sin tener que cambiarle la pestaña por defecto a todo el mundo.
  const hasEnCurso = listItems.some((it) => classifyItemStatus(it) === "en_curso");

  const filteredItems = listItems
    .filter((it) => {
      if (filterKind !== "all" && it.kind !== filterKind) return false;
      if (classifyItemStatus(it) !== statusFilter) return false;
      if (!matchesWeekday(it)) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return it.title.toLowerCase().includes(q) || (it.description || "").toLowerCase().includes(q);
    })
    // Cronológico (v2.31.0): más próxima primero en Próximas/En curso; más reciente primero
    // (orden inverso) en Pasadas, como un historial -- ver más lo último que pasó antes que
    // algo de hace meses.
    .sort((a, b) => {
      const ats = a.date ? new Date(a.date + "T00:00:00").getTime() + timeToMinutes(a.startTime || "00:00") * 60000 : Infinity;
      const bts = b.date ? new Date(b.date + "T00:00:00").getTime() + timeToMinutes(b.startTime || "00:00") * 60000 : Infinity;
      return statusFilter === "pasada" ? bts - ats : ats - bts;
    });

  return (
    <div>
      {/* Mismo patrón que TorneosSection: nada de margen extra arriba de los chips. En mobile,
         para quien no es admin, esta fila entera queda oculta (no solo el título) -- así no
         deja un hueco fantasma como el título-oculto-pero-fila-visible de antes. Para admin
         se mantiene visible en todo tamaño porque los botones de crear sí hacen falta. */}
      <div className={`items-center justify-between flex-wrap gap-3 mb-5 ${isAdmin ? "flex" : "hidden md:flex"}`}>
        <div className="hidden md:block">
          <SectionTitle sub="Toda la actividad programada del club: Open Plays, Torneos y Clases.">Actividades</SectionTitle>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={() => { setShowOpenPlayForm((s) => !s); setShowClaseForm(false); }} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.court, color: "#fff" }}><Plus size={14} /> Open Play</button>
            <button onClick={() => { setShowClaseForm((s) => !s); setShowOpenPlayForm(false); }} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.courtDark, color: "#fff" }}><Plus size={14} /> Clase</button>
            {/* A diferencia de Open Play/Clase, el formulario de creación no vive acá --
               TournamentsListTab (pestaña Torneos) ya lo tiene. Este botón solo navega ahí
               y le pide que lo abra de una, en vez de duplicar el formulario en dos lugares. */}
            <button onClick={onCreateTournament} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.clay, color: "#fff" }}><Plus size={14} /> Torneo</button>
          </div>
        )}
      </div>

      {/* onSubmit espera el resultado real de Supabase -- el formulario solo se cierra si la
         operación tuvo éxito; si falla (ej. imagen muy pesada en una serie larga), se queda
         abierto y OpenPlayForm/ClaseForm muestran el error en vez de perder los datos. */}
      {isAdmin && showOpenPlayForm && (
        <div className="mb-5">
          <OpenPlayForm courts={courts} club={club} occupiedKeys={occupiedKeys} onSubmit={async (d) => { const r = await addOpenPlay(d); if (!r?.error) setShowOpenPlayForm(false); return r; }} onCancel={() => setShowOpenPlayForm(false)} />
        </div>
      )}
      {isAdmin && showClaseForm && (
        <div className="mb-5">
          <ClaseForm courts={courts} club={club} occupiedKeys={occupiedKeys} onSubmit={async (d) => { const r = await addClass(d); if (!r?.error) setShowClaseForm(false); return r; }} onCancel={() => setShowClaseForm(false)} />
        </div>
      )}

      {/* Selector de día de la semana estilo HabitNow (v2.31.0) -- un toque filtra a ese día
         (recurrente que cae ahí, evento puntual de esa fecha, o torneo que pasa por ese día
         en su rango); tocar el mismo día lo destoggle. */}
      <div className="flex gap-1.5 mb-3">
        {WEEKDAY_LETTERS.map((d) => (
          <button key={d.value} onClick={() => setWeekdayFilter((w) => (w === d.value ? null : d.value))}
            className="w-9 h-9 rounded-full text-xs font-bold flex items-center justify-center shrink-0"
            style={{ background: weekdayFilter === d.value ? COLORS.courtDark : "#EAEEF5", color: weekdayFilter === d.value ? "#fff" : COLORS.ink }}>
            {d.label}
          </button>
        ))}
        {weekdayFilter != null && (
          <button onClick={() => setWeekdayFilter(null)} title="Quitar filtro de día" className="text-gray-300 hover:text-red-500 shrink-0 self-center ml-1">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Pestañas de estado (v2.31.0) -- Próxima/En curso/Pasada, partición estricta (cada
         actividad cae en una sola) calculada contra la hora actual en cada render. */}
      <div className="flex gap-2 mb-3">
        {Object.entries(STATUS_META).map(([value, meta]) => (
          <button key={value} onClick={() => setStatusFilter(value)}
            className="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1.5"
            style={{ background: statusFilter === value ? COLORS.court : "#EAEEF5", color: statusFilter === value ? "#fff" : COLORS.ink }}>
            {meta.label}
            {value === "en_curso" && hasEnCurso && statusFilter !== "en_curso" && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: COLORS.clay }} />
            )}
          </button>
        ))}
      </div>

      {/* Chips antes que el buscador, con el mismo mb-5 (y cero margen arriba) que usa
         TorneosSection para sus propios chips de sub-navegación. */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
        {EVENT_FILTER_CHIPS.map((f) => (
          <button key={f.value} onClick={() => setFilterKind(f.value)}
            className="px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap shrink-0"
            style={{ background: filterKind === f.value ? COLORS.ball : "#EAEEF5", color: filterKind === f.value ? "#fff" : COLORS.ink }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Buscador + resultados agrupados con su propio espaciado más chico, para que la
         primera card quede pegada al buscador en vez del gap grande del resto de la página. */}
      <div className="space-y-2">
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" color="#9AA6BC" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar actividades, clubes…" style={{ ...inputStyle, paddingLeft: 38 }} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filteredItems.map((it) => (
            <EventListItem key={it.key} kind={it.kind} shareId={it.shareId} title={it.title} description={it.description}
              date={it.date} startTime={it.startTime} endTime={it.endTime} price={it.price} image={it.image}
              recurring={it.recurring} meta={it.meta} status={classifyItemStatus(it)} onClick={it.onClick} onEdit={it.onEdit} onPagos={it.onPagos} onInscribir={it.onInscribir} ctaLabel={it.ctaLabel} />
          ))}
        </div>

        {noEvents && <p className="text-xs text-gray-400 italic">Aún no hay Open Plays ni clases programadas.</p>}
        {!noEvents && filteredItems.length === 0 && (
          <p className="text-xs text-gray-400 italic">Ninguna actividad coincide con la búsqueda o los filtros.</p>
        )}
      </div>

      {selected?.kind === "open_play" && (() => {
        const list = seriesForKey(selected.key);
        if (!list) return null;
        const occurrences = list.filter((o) => o.date >= todayIso);
        const e = occurrences[0] || list[list.length - 1];
        const isSeries = (occurrences.length ? occurrences : list).length > 1;
        const closeAll = () => { setSelected(null); setEditingOpenPlay(null); };
        return (
          <Modal onClose={closeAll}>
            {editingOpenPlay ? (
              <OpenPlayForm courts={courts} initial={editingOpenPlay.data} hideDate={editingOpenPlay.isSeries}
                club={club} occupiedKeys={occupiedKeys}
                ignoreBlocks={editingOpenPlay.isSeries ? list.flatMap((o) => o.occupiedBlocks) : editingOpenPlay.data.occupiedBlocks}
                seriesDates={editingOpenPlay.isSeries ? list.map((o) => o.date) : []}
                onSubmit={async (d) => {
                  const r = editingOpenPlay.isSeries
                    ? await updateOpenPlaySeries(editingOpenPlay.data.recurringGroupId, d)
                    : await updateOpenPlay(editingOpenPlay.data.id, d);
                  if (!r?.error) closeAll();
                  return r;
                }}
                onCancel={() => setEditingOpenPlay(null)} />
            ) : (
              <EventDetail e={e} occurrences={occurrences.length ? occurrences : [e]} courts={courts} club={club} currentPlan={currentPlan} currentUser={currentUser} isAdmin={isAdmin} users={users}
                onRegister={(occurrenceId, checkout) => { registerForOpenPlay(occurrenceId, checkout); setSelected(null); }}
                onRemove={isAdmin ? (occurrenceId) => { removeOpenPlay(occurrenceId); setSelected(null); } : null}
                onRemoveSeries={isAdmin && e.recurringGroupId ? () => { removeOpenPlaySeries(e.recurringGroupId); setSelected(null); } : null}
                onEdit={isAdmin ? (occurrence) => setEditingOpenPlay({ data: occurrence, isSeries: false }) : null}
                onEditSeries={isAdmin && isSeries && e.recurringGroupId ? () => setEditingOpenPlay({ data: e, isSeries: true }) : null}
                onRemoveRegistration={isAdmin ? removeOpenPlayRegistration : null}
                onSetAttendance={isAdmin ? setOpenPlayAttendance : null}
                onSetPaymentStatus={isAdmin ? setOpenPlayPaymentStatus : null}
                onClose={closeAll} />
            )}
          </Modal>
        );
      })()}

      {selected?.kind === "clase" && (() => {
        const list = classSeriesForKey(selected.key);
        if (!list) return null;
        const occurrences = list.filter((c) => c.date >= todayIso);
        const e = occurrences[0] || list[list.length - 1];
        const isSeries = (occurrences.length ? occurrences : list).length > 1;
        const closeAll = () => { setSelected(null); setEditingClass(null); };
        return (
          <Modal onClose={closeAll}>
            {editingClass ? (
              <ClaseForm courts={courts} initial={editingClass.data} hideDate={editingClass.isSeries}
                club={club} occupiedKeys={occupiedKeys}
                ignoreBlocks={editingClass.isSeries ? list.flatMap((o) => o.occupiedBlocks) : editingClass.data.occupiedBlocks}
                seriesDates={editingClass.isSeries ? list.map((o) => o.date) : []}
                onSubmit={async (d) => {
                  const r = editingClass.isSeries
                    ? await updateClassSeries(editingClass.data.recurringGroupId, d)
                    : await updateClass(editingClass.data.id, d);
                  if (!r?.error) closeAll();
                  return r;
                }}
                onCancel={() => setEditingClass(null)} />
            ) : (
              <ClassDetail e={e} occurrences={occurrences.length ? occurrences : [e]} courts={courts} club={club} currentPlan={currentPlan} currentUser={currentUser} isAdmin={isAdmin} users={users}
                onRegister={(occurrenceId, checkout) => { registerForClass(occurrenceId, checkout); setSelected(null); }}
                onRemove={isAdmin ? (occurrenceId) => { removeClass(occurrenceId); setSelected(null); } : null}
                onRemoveSeries={isAdmin && e.recurringGroupId ? () => { removeClassSeries(e.recurringGroupId); setSelected(null); } : null}
                onEdit={isAdmin ? (occurrence) => setEditingClass({ data: occurrence, isSeries: false }) : null}
                onEditSeries={isAdmin && isSeries && e.recurringGroupId ? () => setEditingClass({ data: e, isSeries: true }) : null}
                onRemoveRegistration={isAdmin ? removeClassRegistration : null}
                onSetAttendance={isAdmin ? setClassAttendance : null}
                onSetPaymentStatus={isAdmin ? setClassPaymentStatus : null}
                onClose={closeAll} />
            )}
          </Modal>
        );
      })()}
    </div>
  );
}

/* =========================================================================
   TAB: MEMBRESÍAS
   ========================================================================= */
// Used both to create a new plan and to edit an existing one (pass `initial`).
// The rate card is a free-form list of benefit line items (court booking, Open Plays,
// league days, drills, free reservation blocks, booking window…) shown in the comparison
// table below — it's the plan's advertised rate sheet, independent of what's actually
// bookable yet. `value` is free text (v2.22.0) so it can hold "$5.00", "4/mes", "5 días" or
// "100% (Gratis)" alike -- not every benefit is a USD price.
function MembershipPlanForm({ initial, basePlan, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [monthlyPrice, setMonthlyPrice] = useState(initial?.monthlyPrice ?? 30);
  const [privateCourtAccess, setPrivateCourtAccess] = useState(initial?.privateCourtAccess ?? true);
  const [maxMembers, setMaxMembers] = useState(initial?.maxMembers ?? "");
  const [bookingWindowHours, setBookingWindowHours] = useState(initial?.bookingWindowHours ?? 48);
  // Descuentos que SÍ se aplican de verdad en el checkout (v2.30.0) -- ver comentario largo
  // en mapPlanRow. Antes esto vivía como un memberPrice suelto por cancha/Open Play, sin
  // ninguna conexión con lo que el plan promete acá.
  const [courtDiscountPct, setCourtDiscountPct] = useState(initial?.courtDiscountPct ?? 0);
  const [openPlayDiscountPct, setOpenPlayDiscountPct] = useState(initial?.openPlayDiscountPct ?? 0);
  const [freeBlocksPerMonth, setFreeBlocksPerMonth] = useState(initial?.freeBlocksPerMonth ?? 0);
  const [description, setDescription] = useState(initial?.description || "");
  const [rateCard, setRateCard] = useState(initial?.rateCard || []);
  const [rateLabel, setRateLabel] = useState("");
  const [ratePriceUsd, setRatePriceUsd] = useState("");
  const [rateDiscountPct, setRateDiscountPct] = useState("");

  // Este plan ES "Sin plan" (el precio real de cada concepto vive acá) o es un plan pago (cada
  // concepto guarda un % de descuento sobre lo que Sin plan cobra por lo mismo) -- v2.38.0.
  // Reactivo al campo de arriba: si el admin cambia el precio mensual mientras arma el
  // formulario, el editor del tarifario cambia de modo al toque.
  const isBasePlan = Number(monthlyPrice) === 0;
  // Conceptos de Sin plan que este plan pago todavía no tiene agregados -- son las únicas
  // opciones válidas para el selector de abajo, porque sin un precio base no hay de dónde
  // calcular el descuento.
  const availableBaseItems = (basePlan?.rateCard || []).filter((bi) => !rateCard.some((r) => r.label === bi.label));
  const selectedBaseItem = (basePlan?.rateCard || []).find((bi) => bi.label === rateLabel);
  const previewDiscounted = selectedBaseItem ? rateItemDiscountedPrice(rateDiscountPct, selectedBaseItem.priceUsd) : null;

  const addRate = () => {
    if (!rateLabel.trim()) return;
    if (isBasePlan) {
      if (ratePriceUsd === "") return;
      setRateCard((rc) => [...rc, { id: uid("rate"), label: rateLabel.trim(), priceUsd: Number(ratePriceUsd) || 0 }]);
      setRateLabel(""); setRatePriceUsd("");
    } else {
      if (!selectedBaseItem) return;
      setRateCard((rc) => [...rc, { id: uid("rate"), label: rateLabel, discountPct: Math.min(100, Math.max(0, Number(rateDiscountPct) || 0)) }]);
      setRateLabel(""); setRateDiscountPct("");
    }
  };
  const removeRate = (id) => setRateCard((rc) => rc.filter((r) => r.id !== id));

  return (
    <Card>
      <h4 className="font-bold text-sm mb-4">{initial ? `Editar ${initial.name}` : "Nuevo plan de membresía"}</h4>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>Nombre</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Precio mensual (EUR)</Label><input type="number" min={0} style={inputStyle} value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} /></div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div>
          <Label>Acceso a canchas privadas</Label>
          <Segmented value={privateCourtAccess ? "si" : "no"} onChange={(v) => setPrivateCourtAccess(v === "si")} options={[{ value: "si", label: "Sí" }, { value: "no", label: "No" }]} />
        </div>
        <div>
          <Label>Cupos máximos (opcional)</Label>
          <input type="number" min={0} style={inputStyle} value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} placeholder="Sin límite" />
        </div>
      </div>
      <div className="mt-3">
        <Label>Ventana de reserva (horas de anticipación)</Label>
        <input type="number" min={1} style={inputStyle} value={bookingWindowHours} onChange={(e) => setBookingWindowHours(e.target.value)} />
        <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>
          Hasta cuánto tiempo por adelantado puede reservar cancha o inscribirse en Open Plays/Clases alguien con este plan -- ahora mismo: <b>{formatBookingWindow(bookingWindowHours)}</b>.
        </p>
      </div>

      {/* Beneficios que SÍ se aplican solos en el checkout (v2.30.0) -- editar esto acá
         cambia el precio real de cualquier cancha/Open Play al instante, sin tener que ir a
         tocar cada cancha o cada actividad una por una. */}
      <div className="grid sm:grid-cols-3 gap-3 mt-3">
        <div>
          <Label>Descuento en canchas (%)</Label>
          <input type="number" min={0} max={100} style={inputStyle} value={courtDiscountPct} onChange={(e) => setCourtDiscountPct(e.target.value)} />
        </div>
        <div>
          <Label>Descuento en Open Play (%)</Label>
          <input type="number" min={0} max={100} style={inputStyle} value={openPlayDiscountPct} onChange={(e) => setOpenPlayDiscountPct(e.target.value)} />
        </div>
        <div>
          <Label>Bloques de cancha gratis / mes</Label>
          <input type="number" min={0} style={inputStyle} value={freeBlocksPerMonth} onChange={(e) => setFreeBlocksPerMonth(e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>
        Los bloques gratis solo aplican en horario frío (8am–5pm) y en días sin torneo, sujeto a disponibilidad -- ese límite no se puede desactivar acá.
      </p>

      <div className="mt-3"><Label>Descripción</Label><textarea style={{ ...inputStyle, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></div>

      <div className="mt-4">
        <Label>Tarifario (se muestra en la comparativa de planes)</Label>
        <p className="text-[11px] -mt-1 mb-2" style={{ color: "#6B7688" }}>
          {isBasePlan
            ? "Este es el plan base -- el precio que cargues acá es el que ven quienes no tienen membresía, y del que salen los descuentos de los planes pagos."
            : "Cada concepto se calcula solo, como % de descuento sobre lo que cobra Sin plan -- si mañana cambia ese precio base, esto se actualiza sin tener que volver a tocarlo."}
        </p>
        <div className="space-y-1.5 mb-2">
          {rateCard.map((r) => {
            const baseItem = (basePlan?.rateCard || []).find((bi) => bi.label === r.label);
            const discounted = isBasePlan ? null : rateItemDiscountedPrice(r.discountPct, baseItem?.priceUsd);
            return (
              <div key={r.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs" style={{ background: "#EEF1F7" }}>
                <span>{r.label}</span>
                <div className="flex items-center gap-2">
                  <span className="mono font-bold">
                    {isBasePlan
                      ? formatMoney(r.priceUsd)
                      : discounted == null ? "—" : `${r.discountPct}% off → ${discounted <= 0 ? "Gratis" : formatMoney(discounted)}`}
                  </span>
                  <button onClick={() => removeRate(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              </div>
            );
          })}
        </div>
        {isBasePlan ? (
          <div className="grid grid-cols-[2fr_1fr_auto] gap-2 items-end">
            <div><Label>Concepto</Label><input style={inputStyle} value={rateLabel} onChange={(e) => setRateLabel(e.target.value)} placeholder="Precio Liga Propia" /></div>
            <div><Label>Precio (EUR)</Label><input type="number" min={0} style={inputStyle} value={ratePriceUsd} onChange={(e) => setRatePriceUsd(e.target.value)} placeholder="8.00" /></div>
            <button onClick={addRate} disabled={!rateLabel.trim() || ratePriceUsd === ""} className="px-3 py-2.5 rounded-xl text-xs font-bold h-[38px]" style={{ background: rateLabel.trim() && ratePriceUsd !== "" ? COLORS.court : "#E5E5E5", color: rateLabel.trim() && ratePriceUsd !== "" ? "#fff" : "#999" }}>
              <Plus size={14} />
            </button>
          </div>
        ) : !basePlan ? (
          <p className="text-xs italic" style={{ color: "#B23A1B" }}>Crea primero el plan "Sin plan" (precio €0) -- de ahí sale el precio base de cada concepto.</p>
        ) : availableBaseItems.length === 0 ? (
          <p className="text-xs italic" style={{ color: "#6B7688" }}>Ya agregaste todos los conceptos de Sin plan. Para uno nuevo, agrégalo primero allá.</p>
        ) : (
          <>
            <div className="grid grid-cols-[2fr_1fr_auto] gap-2 items-end">
              <div>
                <Label>Concepto</Label>
                <select style={inputStyle} value={rateLabel} onChange={(e) => setRateLabel(e.target.value)}>
                  <option value="">Elige uno de Sin plan…</option>
                  {availableBaseItems.map((bi) => <option key={bi.label} value={bi.label}>{bi.label} ({formatMoney(bi.priceUsd)})</option>)}
                </select>
              </div>
              <div><Label>Descuento (%)</Label><input type="number" min={0} max={100} style={inputStyle} value={rateDiscountPct} onChange={(e) => setRateDiscountPct(e.target.value)} /></div>
              <button onClick={addRate} disabled={!selectedBaseItem} className="px-3 py-2.5 rounded-xl text-xs font-bold h-[38px]" style={{ background: selectedBaseItem ? COLORS.court : "#E5E5E5", color: selectedBaseItem ? "#fff" : "#999" }}>
                <Plus size={14} />
              </button>
            </div>
            {selectedBaseItem && (
              <p className="text-[11px] mt-1.5" style={{ color: "#6B7688" }}>
                Sin plan cobra <b>{formatMoney(selectedBaseItem.priceUsd)}</b> por esto -- con {Number(rateDiscountPct) || 0}% de descuento, este plan quedaría en{" "}
                <b style={{ color: COLORS.court }}>{previewDiscounted <= 0 ? "Gratis" : formatMoney(previewDiscounted)}</b>.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2 pt-4">
        <button disabled={!name.trim()} onClick={() => onSave({
          name: name.trim(), monthlyPrice: Number(monthlyPrice) || 0, privateCourtAccess,
          maxMembers: maxMembers === "" ? null : Number(maxMembers), bookingWindowHours: Number(bookingWindowHours) || 48,
          courtDiscountPct: Math.min(100, Math.max(0, Number(courtDiscountPct) || 0)),
          openPlayDiscountPct: Math.min(100, Math.max(0, Number(openPlayDiscountPct) || 0)),
          freeBlocksPerMonth: Math.max(0, Number(freeBlocksPerMonth) || 0),
          description, rateCard,
        })}
          style={{ background: name.trim() ? COLORS.court : "#E5E5E5", color: name.trim() ? COLORS.chalk : "#999" }} className="flex-1 py-2 rounded-xl font-semibold text-sm">{initial ? "Guardar cambios" : "Crear plan"}</button>
        <button onClick={onCancel} className="px-3 rounded-xl text-sm text-gray-400">Cancelar</button>
      </div>
    </Card>
  );
}

function ComparisonRow({ label, plans, render, isBool, highlight }) {
  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      <td className="px-4 py-3.5 text-xs font-bold" style={{ color: "#D6E1F0" }}>{label}</td>
      {plans.map((p, idx) => {
        const val = render(p);
        return (
          <td key={p.id} className="px-3 py-3.5 text-center">
            {isBool ? (
              val ? <Check size={16} color={COLORS.ball} className="inline" strokeWidth={3} /> : <span style={{ color: "#3F5062" }}>—</span>
            ) : (
              <span className={highlight ? "mono text-base font-extrabold" : "mono text-sm font-bold"} style={{ color: idx === 0 ? COLORS.ball : idx === 1 ? "#F2B84B" : "#E4E7DE" }}>{val}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// Tarjeta de un plan para mobile (v2.22.0) -- MembresiasTab usaba una sola tabla comparativa
// para todo, que en mobile se volvía scroll lateral (3 columnas no caben en una pantalla de
// teléfono). Debajo de `md` se cambia a esto: una card completa por plan, apiladas, sin
// scroll horizontal -- mismos datos que la tabla (mismo `rateLabels`, mismo `planState`),
// simplemente reformateados como lista vertical de beneficio→valor en vez de columnas.
function PlanCard({ plan, idx, rateLabels, basePlan, courts, blockLabel, state, isAdmin, onCheckout, onEdit, onDelete }) {
  const { badge, isCurrent, isExpired, pending, locked, isFull, slotsLeft } = state;
  const accent = idx === 0 ? COLORS.ball : idx === 1 ? "#F2B84B" : "#E4E7DE";
  const blockedForNew = isFull && !isCurrent;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: `1.5px solid ${badge ? accent : "rgba(255,255,255,0.10)"}` }}>
      <div className="px-5 pt-5 pb-5" style={{ background: idx === 0 ? "rgba(255,106,26,0.14)" : idx === 1 ? "rgba(242,184,75,0.10)" : "rgba(255,255,255,0.03)" }}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-sm font-extrabold uppercase tracking-wide" style={{ color: accent }}>{plan.name}</p>
          {badge && <span className="shrink-0 text-[9px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: badge.color, color: badge.text }}>{badge.label}</span>}
        </div>
        <p className="disp text-3xl leading-none" style={{ color: COLORS.chalk }}>
          {plan.monthlyPrice > 0 ? formatMoney(plan.monthlyPrice) : "Gratis"}
          {plan.monthlyPrice > 0 && <span className="text-xs font-normal ml-1.5" style={{ color: "#A9C0DC" }}>/mes</span>}
        </p>
        {plan.maxMembers != null && (
          <p className="text-xs mt-2 font-semibold" style={{ color: isFull ? "#F2A65A" : "#A9C0DC" }}>
            {isFull ? "Cupo lleno" : `${slotsLeft} de ${plan.maxMembers} cupos disponibles`}
          </p>
        )}
        {!isAdmin ? (
          // "Sin plan" no es un plan de verdad al que alguien se suscriba -- es la referencia
          // de "así reservas si no tienes membresía" para poder comparar contra PRO/VIP. Sin
          // botón de acción para clientes (v2.28.0); el admin lo sigue pudiendo editar abajo.
          plan.monthlyPrice > 0 ? (
            <button onClick={onCheckout} disabled={locked || blockedForNew}
              className="w-full mt-4 py-3 rounded-xl text-sm font-extrabold"
              style={{
                background: locked || blockedForNew ? "rgba(255,255,255,0.08)" : badge ? badge.color : "rgba(255,255,255,0.14)",
                color: locked || blockedForNew ? "#6B7688" : badge ? badge.text : "#fff",
              }}>
              {pending ? "Pendiente de verificar" : locked ? "Tu plan actual" : blockedForNew ? "Cupo lleno" : isExpired ? "Renovar" : "Suscribirme"}
            </button>
          ) : (
            <p className="text-xs text-center mt-4 py-3" style={{ color: "#7C8CA6" }}>Así reservas sin membresía</p>
          )
        ) : (
          <div className="flex gap-2 mt-4">
            <button onClick={onEdit} className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5" style={{ background: "rgba(255,255,255,0.10)", color: COLORS.chalk }}>
              <Pencil size={12} /> Editar
            </button>
            {plan.monthlyPrice > 0 && (
              <button onClick={onDelete} className="py-2.5 px-3.5 rounded-xl text-xs font-bold" style={{ background: "rgba(255,255,255,0.10)", color: "#93A8C9" }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-4 space-y-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {rateLabels.map((lbl) => (
          <div key={lbl} className="flex items-center justify-between gap-3 text-xs">
            <span style={{ color: "#93A8C9" }}>{lbl}</span>
            <span className="font-bold text-right shrink-0" style={{ color: COLORS.chalk }}>{rateItemDisplay(plan, lbl, basePlan)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: "#93A8C9" }}>Bloque de reserva gratis*</span>
          <span className="font-bold text-right shrink-0" style={{ color: COLORS.chalk }}>{plan.freeBlocksPerMonth > 0 ? `${plan.freeBlocksPerMonth}/mes` : "Ninguno"}</span>
        </div>
        {/* Una sola fila para todas las canchas (v2.54.0) -- antes había una por cancha, pero
           todas cobran el mismo precio de bloque hoy, así que repetirlo por cancha era ruido
           sin información nueva. Toma la primera como representativa. */}
        {courts[0] && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span style={{ color: "#93A8C9" }}>Precio de Alquiler de Bloque ({blockLabel})</span>
            <span className="font-bold text-right shrink-0" style={{ color: COLORS.chalk }}>{courtRowDisplay(plan, courts[0])}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: "#93A8C9" }}>Precio Open Play</span>
          <span className="font-bold text-right shrink-0" style={{ color: COLORS.chalk }}>
            {plan.openPlayDiscountPct >= 100 ? "100% (Gratis)" : plan.openPlayDiscountPct > 0 ? `${plan.openPlayDiscountPct}% off` : "Sin descuento"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span style={{ color: "#93A8C9" }}>Ventana de reserva</span>
          <span className="font-bold text-right shrink-0" style={{ color: COLORS.chalk }}>{formatBookingWindow(plan.bookingWindowHours)}</span>
        </div>
      </div>
    </div>
  );
}

function MembresiasTab({ membershipPlans, club, courts, users, subscriptions, addMembershipPlan, updateMembershipPlan, removeMembershipPlan, subscribeToPlan, currentUser, role,
  coupons, createCoupon, removeCoupon, couponInfo, redeemCoupon }) {
  const [showForm, setShowForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [checkoutPlanId, setCheckoutPlanId] = useState(null);
  const isAdmin = role === "admin";
  const todayIso = new Date().toISOString().slice(0, 10);

  // Cupón de descuento (v2.82.0, ver couponInfo/redeemCoupon en el componente principal) --
  // válido solo si llegó por link/QR, apunta a un plan real, y todavía no se canjeó. Apenas hay
  // uno válido, se abre solo el checkout de SU plan (una sola vez -- `couponAutoOpenedRef` evita
  // reabrirlo si el cliente lo cierra a mano) con el % ya aplicado.
  const activeCoupon = couponInfo && couponInfo.plan && !couponInfo.coupon.used ? couponInfo : null;
  const couponAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (activeCoupon && !isAdmin && !couponAutoOpenedRef.current) {
      couponAutoOpenedRef.current = true;
      setCheckoutPlanId(activeCoupon.plan.id);
    }
  }, [activeCoupon, isAdmin]);
  const [couponRedeemError, setCouponRedeemError] = useState("");

  // Ascendente por precio (v2.54.0, antes descendente) -- el plan más barato primero, el más
  // caro/premium al final: PRO ($50) antes que VIP ($100), como pidió el club. Sigue siendo
  // genérico por precio, no por nombre, así que un futuro plan nuevo cae en su lugar solo.
  const paidPlans = [...membershipPlans].filter((p) => p.monthlyPrice > 0).sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  const freePlans = membershipPlans.filter((p) => p.monthlyPrice === 0);
  const orderedPlans = [...paidPlans, ...freePlans];
  // "Sin plan" -- de acá sale el precio real de cada concepto del tarifario; los planes pagos
  // solo guardan un % de descuento sobre esto (v2.38.0, ver rateItemDisplay).
  const basePlan = freePlans[0] || null;
  // Etiqueta de la duración del bloque para la fila unificada de precio de cancha (v2.54.0,
  // reemplaza una fila POR cancha -- todas cobran lo mismo hoy, tener una fila por cancha era
  // ruido). Mismo formato "1h:30" que pidió el club, calculado de club.blockMinutes en vez de
  // hardcodeado -- si el club cambia la duración del bloque, la etiqueta se actualiza sola.
  const blockLabel = club.blockMinutes % 60 === 0 ? `${club.blockMinutes / 60}h`
    : club.blockMinutes < 60 ? `${club.blockMinutes} min`
    : `${Math.floor(club.blockMinutes / 60)}h:${String(club.blockMinutes % 60).padStart(2, "0")}`;

  // Union every distinct rate-card label across plans, in first-seen order, so the
  // comparison table stays correct even if plans don't share the exact same line items.
  const rateLabels = useMemo(() => {
    const seen = [];
    orderedPlans.forEach((p) => (p.rateCard || []).forEach((r) => { if (!seen.includes(r.label)) seen.push(r.label); }));
    return seen;
  }, [orderedPlans]);
  // "Bloque de reserva gratis*" (fila fija, ya no viene del rate card desde v2.30.0) es la
  // única fila que de verdad depende de la nota al pie (horario frío/sin torneo) -- las filas
  // de precio por cancha (v2.38.2) no tienen esa restricción, aplican siempre.
  const hasFootnote = orderedPlans.some((p) => p.freeBlocksPerMonth > 0);

  const badgeFor = (idx) => {
    if (idx === 0 && paidPlans.length > 0) return { label: "MEJOR VALOR", color: COLORS.ball, text: COLORS.courtDark };
    if (idx === 1 && paidPlans.length > 1) return { label: "MÁS POPULAR", color: "#F2B84B", text: COLORS.courtDark };
    return null;
  };

  // Cupo máximo de miembros ACTIVOS (no vencidos) por plan -- una membresía vencida libera su
  // cupo, igual que una reserva cancelada libera un bloque. Un plan sin maxMembers (null) es
  // ilimitado y nunca se marca lleno. Fuente única para la tabla de escritorio y las cards de
  // mobile, para que ambas vistas nunca muestren cupos distintos.
  const planState = (plan, idx) => {
    const badge = badgeFor(idx);
    const isCurrent = currentUser.planId === plan.id;
    // Una membresía vencida sigue siendo "el plan actual" pero debe poder renovarse -- si no,
    // el botón queda deshabilitado para siempre.
    const isExpired = isCurrent && !!currentUser.planExpiresAt && currentUser.planExpiresAt < todayIso;
    // Suscripción a ESTE plan ya enviada pero todavía sin verificar (v2.37.0) -- mientras el
    // admin no la confirme, currentUser.planId no cambia (ver subscribeToPlan), así que sin
    // esto el botón seguiría ofreciendo "Suscribirme" de nuevo y dejaría mandar la misma
    // solicitud varias veces.
    const pending = subscriptions.some((s) => s.userId === currentUser.id && s.planId === plan.id && s.paymentStatus !== "confirmada");
    const locked = (isCurrent && !isExpired) || pending;
    const activeMembers = plan.maxMembers != null ? users.filter((u) => u.planId === plan.id && (!u.planExpiresAt || u.planExpiresAt >= todayIso)).length : 0;
    const slotsLeft = plan.maxMembers != null ? Math.max(0, plan.maxMembers - activeMembers) : null;
    const isFull = plan.maxMembers != null && slotsLeft === 0;
    return { badge, isCurrent, isExpired, pending, locked, isFull, slotsLeft };
  };

  const selectedPlan = orderedPlans.find((p) => p.id === checkoutPlanId);
  const editingPlan = orderedPlans.find((p) => p.id === editingPlanId);

  return (
    <div className="mt-2 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionTitle sub="Compara beneficios y suscríbete a la membresía que más te convenga.">Planes y membresías</SectionTitle>
        {isAdmin && <button onClick={() => { setShowForm((s) => !s); setEditingPlanId(null); }} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.courtDark, color: "#fff" }}><Plus size={14} /> Nuevo plan</button>}
      </div>

      {isAdmin && showForm && <MembershipPlanForm basePlan={basePlan} onSave={(p) => { addMembershipPlan(p); setShowForm(false); }} onCancel={() => setShowForm(false)} />}
      {isAdmin && editingPlan && (
        // key={editingPlan.id} (v2.38.1) -- sin esto, cambiar de "Editar" un plan a otro sin
        // cerrar el formulario primero reutilizaba la MISMA instancia de MembershipPlanForm:
        // sus useState (name, monthlyPrice, rateCard...) solo se inicializan desde `initial` en
        // el primer montaje, así que quedaban con los datos del plan anterior aunque
        // `editingPlan`/`onSave` ya apuntaran al plan nuevo -- exactamente lo que dejó a Plan
        // VIP con el nombre, precio y tarifario viejos de Plan PRO pisados encima al guardar.
        // El key fuerza un remontaje limpio cada vez que cambia qué plan se está editando.
        <MembershipPlanForm key={editingPlan.id} initial={editingPlan} basePlan={basePlan}
          onSave={(p) => { updateMembershipPlan(editingPlan.id, p); setEditingPlanId(null); }}
          onCancel={() => setEditingPlanId(null)} />
      )}

      {isAdmin && <CouponesCard membershipPlans={paidPlans} coupons={coupons} createCoupon={createCoupon} removeCoupon={removeCoupon} />}

      <div className="rounded-[24px] overflow-hidden" style={{ background: COLORS.courtDark }}>
        <div className="px-5 md:px-7 pt-7 pb-5 flex items-start justify-between flex-wrap gap-3">
          <h2 className="disp text-2xl md:text-[28px] leading-tight" style={{ color: COLORS.chalk }}>
            Elige tu <span style={{ color: COLORS.ball }}>membresía</span>
          </h2>
          <p className="text-xs text-right max-w-[220px]" style={{ color: "#A9C0DC" }}>
            ¿Juegas al menos una vez por semana?<br />Una membresía se paga sola.
          </p>
        </div>

        {/* Desktop/tablet (md+): tabla comparativa, columna por plan -- hay espacio de sobra
           para las 3 columnas sin scroll lateral. */}
        <div className="hidden md:block overflow-x-auto px-2 pb-3">
          <table className="w-full border-collapse" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th className="text-left align-bottom px-4 pb-4" style={{ width: 170 }}>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: "#4E6180" }}>Beneficio</span>
                </th>
                {orderedPlans.map((plan, idx) => {
                  const { badge, locked, isExpired, pending, isFull, slotsLeft, isCurrent } = planState(plan, idx);
                  const blockedForNew = isFull && !isCurrent;
                  return (
                    <th key={plan.id} className="align-bottom px-2 pb-0 text-center" style={{ minWidth: 128 }}>
                      <div className="rounded-t-2xl pt-3.5 pb-4 px-2"
                        style={{ background: idx === 0 ? "rgba(255,106,26,0.12)" : idx === 1 ? "rgba(242,184,75,0.08)" : "transparent" }}>
                        <div className="h-[20px] flex items-center justify-center mb-1.5">
                          {badge && <span className="inline-block text-[9px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: badge.color, color: badge.text }}>{badge.label}</span>}
                        </div>
                        <p className="text-[13px] font-extrabold uppercase tracking-wide leading-tight" style={{ color: idx === 0 ? COLORS.ball : idx === 1 ? "#F2B84B" : COLORS.chalk }}>{plan.name}</p>
                        {plan.maxMembers != null && (
                          <p className="text-[10px] mt-1" style={{ color: isFull ? "#F2A65A" : "#7C8CA6" }}>
                            {isFull ? "Cupo lleno" : `${slotsLeft}/${plan.maxMembers} cupos`}
                          </p>
                        )}
                        {/* "Sin plan" es solo la referencia de comparación -- sin botón de
                           suscripción para clientes (v2.28.0). */}
                        {!isAdmin && plan.monthlyPrice > 0 && (
                          <button onClick={() => setCheckoutPlanId((id) => (id === plan.id ? null : plan.id))} disabled={locked || blockedForNew}
                            className="w-full mt-3 py-2 rounded-lg text-[11px] font-extrabold"
                            style={{
                              background: locked || blockedForNew ? "rgba(255,255,255,0.08)" : badge ? badge.color : "rgba(255,255,255,0.12)",
                              color: locked || blockedForNew ? "#6B7688" : badge ? badge.text : "#fff",
                            }}>
                            {pending ? "Pendiente" : locked ? "Tu plan" : blockedForNew ? "Cupo lleno" : isExpired ? "Renovar" : "Suscribirme"}
                          </button>
                        )}
                        {!isAdmin && plan.monthlyPrice === 0 && (
                          <p className="text-[10px] mt-3" style={{ color: "#7C8CA6" }}>Así reservas sin membresía</p>
                        )}
                        {isAdmin && (
                          <div className="flex gap-1.5 mt-3">
                            <button onClick={() => { setEditingPlanId((id) => (id === plan.id ? null : plan.id)); setShowForm(false); }}
                              className="flex-1 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1" style={{ background: "rgba(255,255,255,0.10)", color: COLORS.chalk }}>
                              <Pencil size={11} /> Editar
                            </button>
                            {plan.monthlyPrice > 0 && (
                              <button onClick={() => removeMembershipPlan(plan.id)} className="py-1.5 px-2 rounded-lg text-[10px] font-bold" style={{ color: "#93A8C9" }}>
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <ComparisonRow label="Costo mensual" plans={orderedPlans}
                render={(p) => (p.monthlyPrice > 0 ? formatMoney(p.monthlyPrice) : "Pago por uso")} highlight />
              <ComparisonRow label="Bloque de reserva gratis*" plans={orderedPlans}
                render={(p) => (p.freeBlocksPerMonth > 0 ? `${p.freeBlocksPerMonth}/mes` : "Ninguno")} />
              {courts[0] && (
                <ComparisonRow label={`Precio de Alquiler de Bloque (${blockLabel})`} plans={orderedPlans}
                  render={(p) => courtRowDisplay(p, courts[0])} />
              )}
              <ComparisonRow label="Precio Open Play" plans={orderedPlans}
                render={(p) => (p.openPlayDiscountPct >= 100 ? "100% (Gratis)" : p.openPlayDiscountPct > 0 ? `${p.openPlayDiscountPct}% off` : "Sin descuento")} />
              {rateLabels.map((lbl) => (
                <ComparisonRow key={lbl} label={lbl} plans={orderedPlans}
                  render={(p) => rateItemDisplay(p, lbl, basePlan)} />
              ))}
              <ComparisonRow label="Ventana de reserva" plans={orderedPlans} render={(p) => formatBookingWindow(p.bookingWindowHours)} />
            </tbody>
          </table>
          {hasFootnote && (
            <p className="px-4 pt-1 pb-3 text-[11px] leading-relaxed" style={{ color: "#7C8CA6" }}>
              * Disfrutable en bloques de horarios fríos (de 8am a 5pm) y en días sin torneos, sujeto a disponibilidad.
            </p>
          )}
        </div>

        {/* Mobile (&lt;md): cards apiladas, una por plan, sin scroll lateral -- misma
           información que la tabla de arriba (mismo rateLabels/planState). */}
        <div className="md:hidden px-4 pb-6 space-y-4">
          {orderedPlans.map((plan, idx) => (
            <PlanCard key={plan.id} plan={plan} idx={idx} rateLabels={rateLabels} basePlan={basePlan} courts={courts} blockLabel={blockLabel} state={planState(plan, idx)} isAdmin={isAdmin}
              onCheckout={() => setCheckoutPlanId((id) => (id === plan.id ? null : plan.id))}
              onEdit={() => { setEditingPlanId((id) => (id === plan.id ? null : plan.id)); setShowForm(false); }}
              onDelete={() => removeMembershipPlan(plan.id)} />
          ))}
          {hasFootnote && (
            <p className="text-[11px] leading-relaxed px-1" style={{ color: "#7C8CA6" }}>
              * Disfrutable en bloques de horarios fríos (de 8am a 5pm) y en días sin torneos, sujeto a disponibilidad.
            </p>
          )}
        </div>
      </div>

      {/* Mismo <Modal> que usan Reservas/Actividades para su checkout (v2.28.0) -- antes esto
         era una Card suelta que aparecía pegada más abajo en la página, sin backdrop ni
         bottom-sheet en mobile, así que se sentía distinto (y en mobile había que scrollear
         para encontrarla). Con Modal gana lo mismo que ganó todo lo demás: fondo oscuro,
         hoja anclada abajo en mobile, y el botón de atrás del teléfono la cierra en vez de
         sacar de la app. */}
      {selectedPlan && (() => {
        // El cupón solo aplica si es DE ESTE plan puntual -- si el cliente cerró el checkout
        // que se abrió solo y eligió suscribirse a otro plan distinto, ese otro paga precio
        // completo (el cupón sigue ahí, sin usar, por si vuelve a este plan).
        const couponHere = activeCoupon && activeCoupon.plan.id === selectedPlan.id ? activeCoupon : null;
        const confirmSubscription = async (checkout) => {
          setCouponRedeemError("");
          if (couponHere) {
            const result = await redeemCoupon(couponHere.coupon.id);
            if (result?.error) { setCouponRedeemError(result.error); return; }
          }
          subscribeToPlan(selectedPlan.id, checkout);
          setCheckoutPlanId(null);
        };
        return (
          <Modal onClose={() => setCheckoutPlanId(null)}>
            <Card>
              {couponHere && (
                <div className="mb-4 px-3 py-2.5 rounded-xl flex items-center gap-2 text-xs font-bold" style={{ background: "#EAF5EE", color: "#1B7A4C" }}>
                  <Tag size={14} className="shrink-0" /> Cupón {couponHere.coupon.code}: {couponHere.coupon.discountPct}% de descuento aplicado.
                </div>
              )}
              {couponRedeemError && <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "#FCE9E4", color: "#B23A1B" }}>{couponRedeemError}</p>}
              <CheckoutPanel title={`Suscripción a ${selectedPlan.name}`} baseUsd={selectedPlan.monthlyPrice} discountPct={couponHere ? couponHere.coupon.discountPct : 0} club={club} defaultName={currentUser.name}
                onConfirm={confirmSubscription} onCancel={() => setCheckoutPlanId(null)} confirmLabel="Confirmar suscripción" />
            </Card>
          </Modal>
        );
      })()}
    </div>
  );
}

// Panel de administración de cupones (v2.82.0, ver coupons/createCoupon/removeCoupon en el
// componente principal) -- crear uno elige plan + %, genera un código único, y deja compartirlo
// como link o como QR (CouponQR, justo abajo). Solo se ofrecen planes PAGOS ("Sin plan" no
// tiene precio del que descontar nada). Un cupón ya usado no se puede borrar -- queda como
// historial de quién lo canjeó (ver `usedBy`/`usedAt`), solo los que siguen disponibles.
function CouponesCard({ membershipPlans, coupons, createCoupon, removeCoupon }) {
  const [planId, setPlanId] = useState(membershipPlans[0]?.id || "");
  const [pct, setPct] = useState(20);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [qrFor, setQrFor] = useState(null);

  const create = async () => {
    if (!planId || !pct) return;
    setCreating(true); setError("");
    const result = await createCoupon(planId, pct);
    setCreating(false);
    if (result?.error) { setError(result.error); return; }
    setQrFor(result.data.id);
  };

  const planName = (id) => membershipPlans.find((p) => p.id === id)?.name || "(plan borrado)";

  return (
    <Card>
      <SectionTitle sub="Cada cupón da un % de descuento en UN plan puntual y sirve una sola vez -- compártelo como link o como código QR.">Cupones de descuento</SectionTitle>
      {membershipPlans.length === 0 ? (
        <p className="text-sm text-gray-400">Crea primero un plan pago para poder generar cupones.</p>
      ) : (
        <>
          <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end mb-4">
            <div>
              <Label>Plan</Label>
              <select style={inputStyle} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {membershipPlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <Label>% de descuento</Label>
              <input type="number" min={1} max={100} style={inputStyle} value={pct} onChange={(e) => setPct(e.target.value)} />
            </div>
            <button onClick={create} disabled={creating || !planId} style={{ background: COLORS.court, color: "#fff", opacity: (creating || !planId) ? 0.6 : 1 }}
              className="px-4 py-2.5 rounded-xl text-sm font-bold h-[42px] flex items-center gap-1.5">
              <Plus size={15} /> {creating ? "Creando…" : "Crear cupón"}
            </button>
          </div>
          {error && <p className="text-xs mb-3 px-3 py-2 rounded-lg" style={{ background: "#FCE9E4", color: "#B23A1B" }}>{error}</p>}

          <div className="space-y-2">
            {coupons.length === 0 && <p className="text-xs text-gray-400 italic">Ningún cupón creado todavía.</p>}
            {coupons.map((c) => (
              <div key={c.id} className="rounded-xl p-3" style={{ background: "#F5F6F9" }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="font-bold text-sm mono">{c.code}</p>
                    <p className="text-xs" style={{ color: "#6B7688" }}>{c.discountPct}% en {planName(c.planId)}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap" style={{ background: c.used ? "#DCEBD5" : "#FBF3E4", color: c.used ? COLORS.courtDark : "#8A5A16" }}>
                      {c.used ? "Usado" : "Disponible"}
                    </span>
                    {!c.used && (
                      <button onClick={() => setQrFor((id) => (id === c.id ? null : c.id))} className="text-xs font-semibold underline flex items-center gap-1" style={{ color: COLORS.court }}>
                        <QrCode size={13} /> QR
                      </button>
                    )}
                    {!c.used && (
                      <button onClick={() => removeCoupon(c.id)} title="Borrar cupón" className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
                {qrFor === c.id && <CouponQR code={c.code} />}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

// QR + link de un cupón puntual (v2.82.0) -- se genera al vuelo con la librería `qrcode`
// (cliente puro, sin llamada al servidor) apenas se expande esta fila, no de una por cada
// cupón de la lista -- generar 20 QR ocultos que nadie va a ver sería trabajo de sobra.
function CouponQR({ code }) {
  const [dataUrl, setDataUrl] = useState(null);
  const url = `${window.location.origin}/?cupon=${code}`;
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { width: 220, margin: 1 }).then((d) => { if (alive) setDataUrl(d); }).catch(() => {});
    return () => { alive = false; };
  }, [url]);
  return (
    <div className="mt-3 pt-3 flex flex-col items-center gap-2.5" style={{ borderTop: `1px dashed ${COLORS.line}` }}>
      {dataUrl ? (
        <img src={dataUrl} alt={`QR del cupón ${code}`} style={{ width: 180, height: 180 }} className="rounded-lg" />
      ) : (
        <p className="text-xs text-gray-400 py-8">Generando QR…</p>
      )}
      <input readOnly value={url} onFocus={(e) => e.target.select()} style={{ ...inputStyle, width: "auto", fontSize: 11 }} className="mono text-center" />
      <div className="flex items-center gap-3">
        <button onClick={() => navigator.clipboard?.writeText(url)} className="text-xs font-semibold underline flex items-center gap-1" style={{ color: COLORS.court }}>
          <Copy size={12} /> Copiar link
        </button>
        {dataUrl && (
          <a href={dataUrl} download={`cupon-${code}.png`} className="text-xs font-semibold underline flex items-center gap-1" style={{ color: COLORS.court }}>
            <Download size={12} /> Descargar QR
          </a>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: PERFIL — datos propios (autoservicio) + resumen de la membresía.
   Cualquier usuario (admin o cliente) tiene uno; el guardado solo toca
   name/zone/phone/dupr_rating -- role y plan_id nunca se tocan desde aquí
   (ver updateProfile en el componente principal y el trigger de la migración
   profile_plan_expiry.sql que revierte cualquier intento de auto-ascenderse).
   ========================================================================= */
// Activar/desactivar notificaciones push (v2.42.0) -- una tarjeta chica, autocontenida, en el
// tab Perfil (la ve tanto un cliente como el admin, cada uno con su propio estado: activar
// notificaciones es por dispositivo/navegador, no por cuenta). "unsupported" cubre tanto un
// navegador viejo como abrir la app por http sin TLS (Web Push exige un contexto seguro) --
// en ese caso no se ofrece nada, en vez de mostrar un botón que va a fallar seguro.
function NotificationsCard({ currentUser }) {
  const [status, setStatus] = useState("checking"); // checking | unsupported | denied | off | on
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) {
        if (alive) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") { if (alive) setStatus("denied"); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (alive) setStatus(sub ? "on" : "off");
      } catch {
        if (alive) setStatus("off");
      }
    })();
    return () => { alive = false; };
  }, []);

  const enable = async () => {
    setBusy(true); setError("");
    try {
      // Sin esta env var (VITE_ -- se hornea en el bundle al momento del build, agregarla en
      // Vercel sin volver a desplegar no alcanza) urlBase64ToUint8Array revienta con un
      // "Cannot read properties of undefined" críptico -- v2.52.1 lo cambia por un mensaje
      // que de verdad dice qué falta y a quién avisarle, en vez de un error de JS pelado.
      if (!import.meta.env.VITE_VAPID_PUBLIC_KEY) {
        throw new Error("Las notificaciones push todavía no están configuradas del lado del servidor (falta la llave VAPID en Vercel) -- avísale al admin del proyecto.");
      }
      if (Notification.permission !== "granted") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { setStatus("denied"); setBusy(false); return; }
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions")
        .upsert({ user_id: currentUser.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: "endpoint" });
      if (error) throw error;
      setStatus("on");
    } catch (err) {
      setError(err?.message || "No se pudo activar las notificaciones.");
    }
    setBusy(false);
  };

  const disable = async () => {
    setBusy(true); setError("");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      setError(err?.message || "No se pudo desactivar las notificaciones.");
    }
    setBusy(false);
  };

  if (status === "unsupported") return null;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: status === "on" ? COLORS.court : "#EEF1F7" }}>
            {status === "on" ? <Bell size={16} color="#fff" /> : <BellOff size={16} color="#78829A" />}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm" style={{ color: COLORS.courtDark }}>Notificaciones</p>
            <p className="text-xs" style={{ color: "#6B7688" }}>
              {status === "denied" ? "Las bloqueaste en el navegador -- para activarlas, cambia el permiso de notificaciones de este sitio."
                : status === "on" ? "Activas en este dispositivo."
                : "Avísame de pagos verificados, cupos casi llenos y anuncios del club."}
            </p>
          </div>
        </div>
        {status !== "denied" && status !== "checking" && (
          <button disabled={busy} onClick={status === "on" ? disable : enable}
            style={{ background: status === "on" ? "#EEF1F7" : COLORS.court, color: status === "on" ? COLORS.ink : "#fff", opacity: busy ? 0.6 : 1 }}
            className="px-3.5 py-2 rounded-xl text-sm font-bold shrink-0">
            {busy ? "..." : status === "on" ? "Desactivar" : "Activar"}
          </button>
        )}
      </div>
      {error && <p className="text-xs font-semibold mt-2" style={{ color: "#B23A1B" }}>{error}</p>}
    </Card>
  );
}

// Switch de "Ver como cliente" (v2.48.0) -- vive en Perfil porque esa pestaña sigue visible
// incluso en modo cliente (Perfil está en NAV_ITEMS para ambos roles), así el admin siempre
// tiene dónde volver a apagarlo sin perder el hilo. El banner de arriba de <main> es el atajo
// rápido para apagarlo desde cualquier pestaña; este switch es la única forma de ENCENDERLO.
function ViewAsClientCard({ viewAsClient, setViewAsClient }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="font-bold text-sm flex items-center gap-1.5" style={{ color: COLORS.courtDark }}><Eye size={15} /> Ver como cliente</p>
          <p className="text-xs mt-1" style={{ color: "#6B7688" }}>
            {viewAsClient
              ? "Estás viendo la app como la vería un socio -- seguís siendo admin de verdad, esto es solo la interfaz."
              : "Previsualiza la app sin las pestañas ni controles de admin, sin cerrar tu sesión."}
          </p>
        </div>
        <button onClick={() => setViewAsClient((v) => !v)} className="shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm"
          style={{ background: viewAsClient ? COLORS.clay : COLORS.court, color: "#fff" }}>
          {viewAsClient ? "Volver a admin" : "Activar"}
        </button>
      </div>
    </Card>
  );
}

function ProfileTab({ currentUser, membershipPlans, subscriptions, courts, updateProfile, setTab, viewAsClient, setViewAsClient }) {
  const [name, setName] = useState(currentUser.name);
  const [phone, setPhone] = useState(currentUser.phone || "");
  const [zone, setZone] = useState(currentUser.zone || "");
  const [duprRating, setDuprRating] = useState(currentUser.duprRating ?? "");
  const [gender, setGender] = useState(currentUser.gender || "");
  const [birthDate, setBirthDate] = useState(currentUser.birthDate || "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const dirty = name !== currentUser.name || phone !== (currentUser.phone || "") ||
    zone !== (currentUser.zone || "") || String(duprRating) !== String(currentUser.duprRating ?? "") ||
    gender !== (currentUser.gender || "") || birthDate !== (currentUser.birthDate || "");

  const save = async () => {
    if (!name.trim()) { setError("El nombre no puede quedar vacío."); return; }
    setError(""); setNotice(""); setSaving(true);
    const result = await updateProfile({ name: name.trim(), phone: phone.trim(), zone: zone.trim(), duprRating: duprRating === "" ? "" : Number(duprRating), gender, birthDate });
    setSaving(false);
    if (result?.error) setError(result.error);
    else setNotice("Datos guardados.");
  };

  const plan = membershipPlans.find((p) => p.id === currentUser.planId) || membershipPlans[0] || null;
  // Precio real de cada concepto del tarifario -- ver rateItemDisplay (v2.38.0).
  const basePlan = membershipPlans.find((p) => p.monthlyPrice === 0) || null;
  const isPaidPlan = (plan?.monthlyPrice || 0) > 0;
  const today = new Date().toISOString().slice(0, 10);
  const isExpired = isPaidPlan && !!currentUser.planExpiresAt && currentUser.planExpiresAt < today;
  // Suscripción mandada pero todavía sin verificar (v2.37.0) -- mientras tanto el plan de
  // arriba sigue siendo el que ya tenía (o "Sin membresía"), así que esto es lo único que le
  // avisa que su solicitud sí se registró y está en cola.
  const pendingSub = subscriptions.filter((s) => s.userId === currentUser.id && s.paymentStatus !== "confirmada").sort((a, b) => b.createdAt - a.createdAt)[0];
  const pendingPlan = pendingSub && membershipPlans.find((p) => p.id === pendingSub.planId);

  return (
    <div className="mt-2 space-y-6 max-w-2xl">
      <SectionTitle sub="Tus datos de contacto y tu membresía.">Perfil</SectionTitle>

      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: currentUser.role === "admin" ? COLORS.clay : COLORS.court }}>
            {currentUser.role === "admin" ? <Shield size={18} color="#fff" /> : <UserCircle size={20} color="#fff" />}
          </div>
          <div className="min-w-0">
            <p className="font-bold truncate" style={{ color: COLORS.courtDark }}>{currentUser.name}</p>
            <p className="text-xs" style={{ color: "#6B7688" }}>{currentUser.role === "admin" ? "Administrador" : "Cliente"}{currentUser.createdAt ? ` · miembro desde ${formatDateHuman(new Date(currentUser.createdAt).toISOString().slice(0, 10))}` : ""}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div><Label>Nombre completo</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div>
            <Label>Correo</Label>
            <div className="relative">
              <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
              <input disabled style={{ ...inputStyle, paddingLeft: 32, background: "#F4F5F8", color: "#8891A0" }} value={currentUser.email} />
            </div>
            <p className="text-[10px] mt-1" style={{ color: "#8891A0" }}>Para cambiar el correo, contacta al club.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Nivel DUPR</Label>
              <div className="relative">
                <Medal size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                <input type="number" step="0.01" min="2" max="8" style={{ ...inputStyle, paddingLeft: 32 }} value={duprRating}
                  onChange={(e) => setDuprRating(e.target.value)} placeholder="Ej. 3.5" />
              </div>
            </div>
            <div>
              <Label>WhatsApp</Label>
              <div className="relative">
                <Smartphone size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                <input type="tel" style={{ ...inputStyle, paddingLeft: 32 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0414-1234567" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Género</Label>
              <div className="flex gap-1.5">
                {[{ v: "masculino", l: "Masculino" }, { v: "femenino", l: "Femenino" }].map((o) => (
                  <button key={o.v} type="button" onClick={() => setGender(o.v)} className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                    style={{ background: gender === o.v ? COLORS.court : "#EEF1F7", color: gender === o.v ? "#fff" : COLORS.ink }}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Fecha de nacimiento</Label>
              <input type="date" style={inputStyle} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div>
            <Label>Domicilio</Label>
            <div className="relative">
              <MapPinned size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
              <input style={{ ...inputStyle, paddingLeft: 32 }} value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Ej. Chacao, Caracas" />
            </div>
          </div>

          {notice && <p className="text-xs font-semibold" style={{ color: COLORS.court }}>{notice}</p>}
          {error && <p className="text-xs font-semibold" style={{ color: "#B23A1B" }}>{error}</p>}

          <button disabled={!dirty || saving} onClick={save} style={{ background: COLORS.courtDark, color: "#fff", opacity: !dirty || saving ? 0.5 : 1 }}
            className="px-4 py-2.5 rounded-xl font-bold text-sm">
            {saving ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </Card>

      {currentUser.role === "admin" && <ViewAsClientCard viewAsClient={viewAsClient} setViewAsClient={setViewAsClient} />}

      <NotificationsCard currentUser={currentUser} />

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#6B7688" }}>Tu membresía</p>
            <p className="disp text-xl mt-0.5" style={{ color: COLORS.courtDark }}>{plan?.name || "Sin membresía"}</p>
          </div>
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: isExpired ? "#FBEAE3" : isPaidPlan ? "#E4F3EC" : "#EDEFF4", color: isExpired ? COLORS.clay : isPaidPlan ? COLORS.court : "#6B7688" }}>
            {isExpired ? "Vencida" : isPaidPlan ? "Activa" : "Pago por uso"}
          </span>
        </div>

        {isPaidPlan ? (
          <p className="text-sm" style={{ color: "#6B7688" }}>
            {formatMoney(plan.monthlyPrice)}/mes · {isExpired ? "venció el " : "vence el "}
            <span className="font-semibold" style={{ color: isExpired ? COLORS.clay : COLORS.ink }}>
              {currentUser.planExpiresAt ? formatDateFull(currentUser.planExpiresAt) : "—"}
            </span>
          </p>
        ) : (
          <p className="text-sm" style={{ color: "#6B7688" }}>No tienes una membresía paga — pagas por uso en cada reserva, Open Play o clase.</p>
        )}

        {pendingSub && (
          <p className="text-xs mt-3 px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
            <Clock size={13} className="shrink-0" /> Tu suscripción a {pendingPlan?.name || "un plan"} está pendiente de verificación -- se activa apenas el club confirme tu pago.
          </p>
        )}

        {isPaidPlan && (
          <ul className="mt-3 space-y-1">
            <li className="text-xs flex items-center gap-1.5" style={{ color: "#6B7688" }}>
              <Check size={12} color={COLORS.court} /> Bloques de reserva gratis — {plan.freeBlocksPerMonth > 0 ? `${plan.freeBlocksPerMonth}/mes` : "Ninguno"}
            </li>
            {courts.map((c) => (
              <li key={c.id} className="text-xs flex items-center gap-1.5" style={{ color: "#6B7688" }}>
                <Check size={12} color={COLORS.court} /> Precio {c.name} — {courtRowDisplay(plan, c)}
              </li>
            ))}
            <li className="text-xs flex items-center gap-1.5" style={{ color: "#6B7688" }}>
              <Check size={12} color={COLORS.court} /> Open Play — {plan.openPlayDiscountPct >= 100 ? "100% (Gratis)" : plan.openPlayDiscountPct > 0 ? `${plan.openPlayDiscountPct}% off` : "Sin descuento"}
            </li>
            {plan.rateCard?.map((r) => (
              <li key={r.label} className="text-xs flex items-center gap-1.5" style={{ color: "#6B7688" }}>
                <Check size={12} color={COLORS.court} /> {r.label} — {rateItemDisplay(plan, r.label, basePlan)}
              </li>
            ))}
          </ul>
        )}

        <button onClick={() => setTab("membresias")} className="w-full mt-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5"
          style={{ background: COLORS.clay, color: "#fff" }}>
          <Sparkles size={14} /> {isExpired ? "Renovar membresía" : isPaidPlan ? "Ver otros planes / mejorar" : "Ver planes de membresía"}
        </button>
      </Card>
    </div>
  );
}

