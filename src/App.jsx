import React, { useState, useMemo, useEffect } from "react";
import {
  Trophy, Users, MapPin, Calendar, ClipboardList, Plus, Trash2,
  ChevronRight, ChevronDown, Shuffle, ArrowUpDown, CheckCircle2,
  Clock, AlertTriangle, Swords, ListOrdered, Settings2, X,
  UserPlus, Pencil, Medal, Hourglass, DollarSign,
  CalendarClock, PartyPopper, Award, Lock, Unlock,
  Image as ImageIcon, Smartphone, Banknote, Upload, Star, Building2,
  GraduationCap, Sparkles, Check, ArrowRight, LogOut, Shield, Mail, KeyRound, BarChart3, MapPinned, ChevronLeft, Repeat, Search
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";

/* =========================================================================
   ID / UTILITY HELPERS
   ========================================================================= */
let __id = 1;
const uid = (p = "id") => `${p}_${__id++}`;

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
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" });
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

function formatMoney(n, symbol = "$") {
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

// Presale price wins while today falls inside [presaleStart, presaleEnd] (and is set);
// otherwise falls back to the regular registration price. Charged per player, so a
// doubles team pays double what a single competitor pays.
function tournamentRegPrice(tournament) {
  const today = new Date().toISOString().slice(0, 10);
  const inPresale = tournament.presaleStart && tournament.presaleEnd && today >= tournament.presaleStart && today <= tournament.presaleEnd;
  if (inPresale && Number(tournament.presalePrice) > 0) return Number(tournament.presalePrice) || 0;
  return Number(tournament.regularPrice) || 0;
}

// Resolves a court's price for a given time-of-day, honoring an optional list of
// time-window overrides (peak/off-peak pricing) before falling back to the court's base price.
function courtPriceInfo(court, timeMin) {
  const rule = (court.priceRules || []).find((r) => timeMin >= timeToMinutes(r.startTime) && timeMin < timeToMinutes(r.endTime));
  const base = Number(rule ? rule.price : court.pricePerBlock) || 0;
  const memberRaw = rule ? rule.memberPrice : court.memberPrice;
  const member = memberRaw === undefined || memberRaw === null || memberRaw === "" ? base : Number(memberRaw) || 0;
  return { base, member };
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
      if (t.priceUsd === undefined) return; // manually-entered team, no checkout on record
      const client = resolve(t.userId, null);
      if (client) entries.push({ client, usd: Number(t.priceUsd) || 0, ts: t.createdAt, kind: "Torneo" });
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

function groupByZone(users) {
  const map = {};
  users.filter((u) => u.role === "cliente").forEach((u) => {
    const z = (u.zone || "").trim() || "Sin especificar";
    map[z] = (map[z] || 0) + 1;
  });
  return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function groupByPlan(users, membershipPlans) {
  const map = {};
  users.filter((u) => u.role === "cliente" && u.planId).forEach((u) => { map[u.planId] = (map[u.planId] || 0) + 1; });
  return membershipPlans.filter((p) => p.monthlyPrice > 0).map((p) => ({ label: p.name, value: map[p.id] || 0 }));
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
  teamIds.forEach((tid) => {
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
  return Object.values(rows).sort((x, y) => {
    if (y.pg !== x.pg) return y.pg - x.pg;
    const diffX = x.setsF - x.setsC, diffY = y.setsF - y.setsC;
    if (diffY !== diffX) return diffY - diffX;
    const pdX = x.ptsF - x.ptsC, pdY = y.ptsF - y.ptsC;
    return pdY - pdX;
  });
}

/* =========================================================================
   SCHEDULER — assigns day / time / court to every match, guaranteeing that
   no player is ever booked into two matches at the same time slot.
   ========================================================================= */
function buildSchedule(categories, courts, dates, dailyStart, dailyEnd, matchDuration, breakM, occupiedKeys = new Set()) {
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

  // reset previous schedule
  categories.forEach((c) => c.matches.forEach((m) => { m.day = null; m.time = null; m.courtId = null; }));

  let groupQueue = [];
  categories.forEach((c) => c.matches.filter((m) => m.phase === "group").forEach((m) => groupQueue.push(m)));

  let slotIndex = 0;
  while (groupQueue.length > 0 && slotIndex < slots.length) {
    const slot = slots[slotIndex];
    const usedPlayers = new Set();
    for (let c = 0; c < courts.length && groupQueue.length > 0; c++) {
      if (occupiedKeys.has(blockKey(courts[c].id, slot.date, slot.timeMin))) continue;
      let foundIdx = -1;
      for (let i = 0; i < groupQueue.length; i++) {
        const ps = playersOf(groupQueue[i]);
        if (ps.length > 0 && ps.every((p) => !usedPlayers.has(p))) { foundIdx = i; break; }
      }
      if (foundIdx === -1) continue;
      const match = groupQueue.splice(foundIdx, 1)[0];
      playersOf(match).forEach((p) => usedPlayers.add(p));
      match.day = slot.date; match.time = minutesToTime(slot.timeMin); match.courtId = courts[c].id;
    }
    slotIndex++;
  }

  const unscheduledGroup = groupQueue.length;
  let curIndex = slotIndex;

  categories.forEach((cat) => {
    const byRound = {};
    cat.matches.filter((m) => m.phase !== "group" && !isByeMatch(m)).forEach((m) => {
      const key = m.seq != null ? m.seq : m.round;
      byRound[key] = byRound[key] || [];
      byRound[key].push(m);
    });
    Object.keys(byRound).map(Number).sort((a, b) => a - b).forEach((rn) => {
      const matches = byRound[rn];
      let mi = 0;
      while (mi < matches.length) {
        if (curIndex >= slots.length) return;
        const slot = slots[curIndex];
        for (let c = 0; c < courts.length && mi < matches.length; c++) {
          if (occupiedKeys.has(blockKey(courts[c].id, slot.date, slot.timeMin))) continue;
          const match = matches[mi++];
          match.day = slot.date; match.time = minutesToTime(slot.timeMin); match.courtId = courts[c].id;
        }
        curIndex++;
      }
    });
  });

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
    capacityExceeded: unscheduledGroup > 0 || curIndex > slots.length,
    unscheduledGroup,
    totalSlots: slots.length,
    start, end,
  };
}

/* =========================================================================
   APP VERSION
   ========================================================================= */
const APP_VERSION = "2.2.0";

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

const FORMAT_LABELS = {
  liga: "Liga (todos contra todos)",
  grupos: "Fase de grupos",
  eliminatoria: "Eliminación directa",
  grupos_eliminatoria: "Grupos + Eliminatoria",
  doble_eliminacion: "Doble Eliminación (Llave A / Llave B)",
};

const MODALITY_LABELS = { individual: "Individual (single)", dobles: "Dobles" };
const GENDER_LABELS = { masculino: "Masculino", femenino: "Femenino", mixto: "Mixto" };
const LEVEL_OPTIONS = ["Principiante", "3.0", "3.5", "4.0", "4.5", "5.0+", "Open / Profesional"];

function makeCategoryName(modality, gender, level) {
  return `${MODALITY_LABELS[modality]} ${GENDER_LABELS[gender]} ${level}`.replace("Individual (single)", "Individual");
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
  const [tab, setTab] = useState("club");

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

  const [club, setClub] = useState(null);
  const [courts, setCourts] = useState([]);
  const [clubDataLoading, setClubDataLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [clubRes, courtsRes] = await Promise.all([
        supabase.from("clubs").select("*").limit(1),
        supabase.from("courts").select("*").order("created_at"),
      ]);
      if (clubRes.error) console.error("fetch clubs:", clubRes.error.message);
      if (courtsRes.error) console.error("fetch courts:", courtsRes.error.message);
      // Fallback defensivo si por algún motivo la fila semilla de `clubs` no existe --
      // evita que la app quede sin poder renderizar en vez de romperse.
      setClub(clubRes.data?.[0]
        ? mapClubRow(clubRes.data[0])
        : { id: null, name: "Pickle Hub", openTime: "07:00", closeTime: "22:00", blockMinutes: 90, bsPerUsd: 180, pagoMovil: { banco: "", telefono: "", cedula: "" } });
      setCourts((courtsRes.data || []).map(mapCourtRow));
      setClubDataLoading(false);
    })();
  }, []);

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
      const res = await fetch("https://bcv.today/api/v1/rate.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.EUR) throw new Error("La respuesta no trajo tasa EUR");
      updateClub({ bsPerUsd: Number(data.EUR) });
      setRateStatus({ loading: false, error: null, lastSync: Date.now(), source: "bcv_eur", effectiveDate: data.effective_date });
    } catch (err) {
      setRateStatus((s) => ({
        ...s, loading: false,
        error: `No se pudo conectar con la API del BCV (${err.message || "error de red"}). La tasa se mantiene editable manualmente.`,
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
    reference: r.reference, proofName: r.proof_name,
    priceUsd: r.price_usd != null ? Number(r.price_usd) : null, priceBs: r.price_bs != null ? Number(r.price_bs) : null,
    createdAt: new Date(r.created_at).getTime(),
  });
  const [bookings, setBookings] = useState([]);
  useEffect(() => {
    supabase.from("bookings").select("*").order("created_at").then(({ data, error }) => {
      if (error) { console.error("fetch bookings:", error.message); return; }
      setBookings(data.map(mapBookingRow));
    });
  }, []);

  // ---- Eventos: Open Plays y Clases (Torneos ya tiene su propio estado más abajo) ----
  const [openPlays, setOpenPlays] = useState([]);
  const [classes, setClasses] = useState([]);

  // ---- Membresías ----
  // Each plan carries a "rateCard" — free-form priced line items (court booking, Open Plays,
  // league days, monthly classes, drills, etc.) shown side-by-side in the comparison table.
  // Real checkout math for courts/Open Plays/classes reads the flat memberPrice set on each
  // item instead (see courtPriceInfo/memberDiscountPct) — the rateCard here is the plan's
  // advertised rate sheet, editable independently of what's actually been created yet.
  const mapPlanRow = (r) => ({
    id: r.id, name: r.name, monthlyPrice: Number(r.monthly_price), privateCourtAccess: r.private_court_access,
    description: r.description || "",
    rateCard: (r.rate_card || []).map((it, i) => ({ id: it.id || `${r.id}-rate-${i}`, label: it.label, price: it.price })),
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
    createdAt: new Date(r.created_at).getTime(),
  });
  const [subscriptions, setSubscriptions] = useState([]);
  useEffect(() => {
    supabase.from("subscriptions").select("*").order("created_at").then(({ data, error }) => {
      if (error) { console.error("fetch subscriptions:", error.message); return; }
      setSubscriptions(data.map(mapSubscriptionRow));
    });
  }, []);

  // ---- Cuentas (login / registro) ----
  // Backend real: Supabase Auth guarda las credenciales; la tabla `profiles` (1:1 con
  // auth.users, creada por un trigger en cuanto alguien se registra — ver supabase/schema.sql)
  // guarda el resto (name, role, planId, zone). `users` sigue siendo la lista completa de
  // perfiles, igual que antes, para no tocar los componentes que ya la consumen
  // (EstadisticasTab, LoyalClientsCard, PartnerPicker, InscripcionTab) — solo cambia de dónde
  // sale el dato: antes vivía en memoria, ahora se trae de la tabla `profiles`.
  const [users, setUsers] = useState([]);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Supabase abre una sesión temporal de "recuperación" cuando el usuario entra desde el
  // enlace del correo de reset -- no es un login normal, así que se intercepta con este flag
  // para forzar la pantalla de "elige tu nueva contraseña" en vez de dejarlo pasar a la app.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const currentUserId = session?.user?.id || null;
  const currentUser = users.find((u) => u.id === currentUserId) || null;

  const mapProfileRow = (p) => ({
    id: p.id, name: p.name, email: p.email, role: p.role, planId: p.plan_id,
    zone: p.zone || "", createdAt: new Date(p.created_at).getTime(),
  });

  const fetchAllProfiles = async () => {
    const { data, error } = await supabase.from("profiles").select("*").order("created_at");
    if (error) { console.error("fetchAllProfiles:", error.message); return; }
    setUsers(data.map(mapProfileRow));
  };

  useEffect(() => {
    fetchAllProfiles();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "SIGNED_IN") fetchAllProfiles(); // trae el perfil recién creado/logueado
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true); // vino del link del correo de reset
      if (event === "SIGNED_OUT") { setTab("club"); setPasswordRecovery(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const registerUser = async ({ name, email, password, zone }) => {
    if (!name.trim() || !email.trim() || !password) return { error: "Completa todos los campos." };
    const { error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { name: name.trim(), role: "cliente", zone: (zone || "").trim() } },
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
    id: r.id, name: r.name, startDate: r.start_date || "", endDate: r.end_date || "",
    dailyStart: r.daily_start, dailyEnd: r.daily_end, playDays: r.play_days || [],
    presaleStart: r.presale_start || "", presaleEnd: r.presale_end || "", presalePrice: r.presale_price ?? "",
    regStart: r.reg_start || "", regEnd: r.reg_end || "", regularPrice: r.regular_price ?? "",
  });
  const [tournament, setTournament] = useState({
    id: null, name: "Copa Verano Pickleball",
    startDate: "", endDate: "", dailyStart: "08:00", dailyEnd: "20:00",
    presaleStart: "", presaleEnd: "", presalePrice: "", regularPrice: "",
    regStart: "", regEnd: "", playDays: [],
  });
  useEffect(() => {
    supabase.from("tournaments").select("*").limit(1).then(({ data, error }) => {
      if (error) { console.error("fetch tournaments:", error.message); return; }
      if (data?.[0]) setTournament(mapTournamentRow(data[0]));
    });
  }, []);
  // Actualiza local al toque y persiste en `tournaments` en segundo plano (mismo patrón que updateClub).
  const updateTournament = (patch) => {
    setTournament((t) => ({ ...t, ...patch }));
    if (!tournament.id) return;
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("startDate" in patch) dbPatch.start_date = patch.startDate || null;
    if ("endDate" in patch) dbPatch.end_date = patch.endDate || null;
    if ("dailyStart" in patch) dbPatch.daily_start = patch.dailyStart;
    if ("dailyEnd" in patch) dbPatch.daily_end = patch.dailyEnd;
    if ("playDays" in patch) dbPatch.play_days = patch.playDays;
    if ("presaleStart" in patch) dbPatch.presale_start = patch.presaleStart || null;
    if ("presaleEnd" in patch) dbPatch.presale_end = patch.presaleEnd || null;
    if ("presalePrice" in patch) dbPatch.presale_price = patch.presalePrice === "" ? null : patch.presalePrice;
    if ("regStart" in patch) dbPatch.reg_start = patch.regStart || null;
    if ("regEnd" in patch) dbPatch.reg_end = patch.regEnd || null;
    if ("regularPrice" in patch) dbPatch.regular_price = patch.regularPrice === "" ? null : patch.regularPrice;
    supabase.from("tournaments").update(dbPatch).eq("id", tournament.id).then(({ error }) => {
      if (error) console.error("updateTournament:", error.message);
    });
  };

  const [matchDuration, setMatchDuration] = useState(35);
  const [breakM, setBreakM] = useState(10);

  const mapCategoryRow = (r) => ({
    id: r.id, name: r.name, format: r.format, modality: r.modality, gender: r.gender, level: r.level,
    maxTeams: r.max_teams, seedMode: r.seed_mode, bestOf: r.best_of, bracketSize: r.bracket_size,
    teams: r.teams || [], waitlist: r.waitlist || [], groups: r.groups || [], matches: r.matches || [],
    drawGenerated: r.draw_generated, groupsClosed: r.groups_closed,
  });
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    supabase.from("categories").select("*").order("created_at").then(({ data, error }) => {
      if (error) { console.error("fetch categories:", error.message); return; }
      setCategories(data.map(mapCategoryRow));
    });
  }, []);
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
  const currentPlan = membershipPlans.find((p) => p.id === currentUser?.planId) || membershipPlans[0];

  const dates = useMemo(
    () => filterDatesByPlayDays(dateRange(tournament.startDate, tournament.endDate), tournament.playDays),
    [tournament.startDate, tournament.endDate, tournament.playDays]
  );

  // Every block already claimed by a booking, an Open Play, a class or a scheduled tournament
  // match — the single source of truth so nothing ever gets double-booked across modules.
  const occupiedKeys = useMemo(() => {
    const set = new Set();
    bookings.forEach((b) => { if (b.status !== "cancelada") set.add(blockKey(b.courtId, b.date, b.timeMin)); });
    openPlays.forEach((e) => e.occupiedBlocks.forEach((b) => set.add(blockKey(b.courtId, b.date, b.timeMin))));
    classes.forEach((e) => e.occupiedBlocks.forEach((b) => set.add(blockKey(b.courtId, b.date, b.timeMin))));
    categories.forEach((cat) => cat.matches.forEach((m) => {
      if (m.day && m.courtId && !isByeMatch(m)) set.add(blockKey(m.courtId, m.day, timeToMinutes(m.time)));
    }));
    return set;
  }, [bookings, openPlays, classes, categories]);

  // Punto único por el que pasan setCategoryFormat/addTeam/removeTeam/removeFromWaitlist/
  // generateDraw/closeGroupsAndSeedBracket/submitScore -- persistir acá cubre los siete de una vez.
  // NOTA: no se puede leer una variable asignada *dentro* del updater de setCategories
  // justo después de llamarlo -- en React 18 ese updater no corre síncronamente, corre
  // en el siguiente render. Por eso `updated` se calcula ACÁ AFUERA, a partir del
  // `categories` del closure de este render (que si es el actual), y se usa tanto para
  // el setState como para el guardado en Supabase.
  const updateCategory = (id, updater) => {
    const current = categories.find((c) => c.id === id);
    if (!current) return;
    const updated = updater({ ...current });
    setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
    supabase.from("categories").update({
      name: updated.name, max_teams: updated.maxTeams, seed_mode: updated.seedMode,
      best_of: updated.bestOf, bracket_size: updated.bracketSize, format: updated.format,
      draw_generated: updated.drawGenerated, groups_closed: updated.groupsClosed,
      teams: updated.teams, waitlist: updated.waitlist, groups: updated.groups, matches: updated.matches,
    }).eq("id", id).then(({ error }) => { if (error) console.error("updateCategory:", error.message); });
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

  const addCategory = async (modality, gender, level, maxTeams) => {
    const { data: row, error } = await supabase.from("categories").insert({
      tournament_id: tournament.id, name: makeCategoryName(modality, gender, level),
      modality, gender, level, max_teams: maxTeams ? Number(maxTeams) : null,
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
  const addTeam = (catId, players, checkout) => {
    const name = players.map((p) => p.name).join(" / ");
    players.forEach((p) => upsertPlayerRanking(p.name, p.ranking, true));
    updateCategory(catId, (c) => {
      const team = { id: uid("team"), name, players, createdAt: Date.now(), ...(checkout || {}) };
      if (c.maxTeams && c.teams.length >= c.maxTeams) {
        c.waitlist = [...c.waitlist, team];
      } else {
        c.teams = [...c.teams, team];
      }
      return c;
    });
  };
  // Removing a confirmed team automatically promotes the next team in line from the waitlist.
  const removeTeam = (catId, teamId) => {
    updateCategory(catId, (c) => {
      c.teams = c.teams.filter((t) => t.id !== teamId);
      if (c.waitlist.length > 0) {
        const [promoted, ...restWaitlist] = c.waitlist;
        c.teams = [...c.teams, promoted];
        c.waitlist = restWaitlist;
      }
      return c;
    });
  };
  const removeFromWaitlist = (catId, teamId) => {
    updateCategory(catId, (c) => {
      c.waitlist = c.waitlist.filter((t) => t.id !== teamId);
      return c;
    });
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
    const status = data.paymentMethod === "movil" ? "pendiente_verificacion" : "pendiente_efectivo";
    const { data: row, error } = await supabase.from("bookings").insert({
      court_id: data.courtId, date: data.date, time_min: data.timeMin, block_minutes: data.blockMinutes,
      user_id: data.userId, user_name: data.userName, status,
      payment_method: data.paymentMethod, reference: data.reference, proof_name: data.proofName,
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
    reference: r.reference, proofName: r.proof_name,
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
  useEffect(() => { fetchOpenPlays(); fetchClasses(); }, []);

  // A recurring Open Play (e.g. "Jueves de DUPR, todos los jueves a las 6pm") se guarda como
  // una fila independiente por cada ocurrencia semanal -- todas comparten recurring_group_id
  // (un UUID generado acá, porque Postgres necesita el mismo valor en cada fila del lote)
  // para que la UI las agrupe/borre en bloque.
  const addOpenPlay = async ({ recurrence, ...data }) => {
    const occurrenceDates = [data.date];
    if (recurrence?.until && recurrence.until >= data.date) {
      occurrenceDates.length = 0;
      let d = new Date(data.date + "T00:00:00");
      const until = new Date(recurrence.until + "T00:00:00");
      while (d <= until) { occurrenceDates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 7); }
    }
    const seriesId = occurrenceDates.length > 1 ? crypto.randomUUID() : null;
    const rows = occurrenceDates.map((dt) => ({
      name: data.name, image: data.image || "", level: data.level, price: data.price, member_price: data.memberPrice,
      capacity: data.capacity, description: data.description || "", court_ids: data.courtIds,
      date: dt, start_time: data.startTime, end_time: data.endTime, recurring_group_id: seriesId,
      occupied_blocks: computeOccupiedBlocks(data.courtIds, dt, data.startTime, data.endTime),
    }));
    const { data: inserted, error } = await supabase.from("open_plays").insert(rows).select();
    if (error) { console.error("addOpenPlay:", error.message); return; }
    setOpenPlays((p) => [...p, ...inserted.map((r) => mapOpenPlayRow({ ...r, open_play_registrations: [] }))]);
  };
  // Mismo patrón de expansión que addOpenPlay, para clases recurrentes.
  const addClass = async ({ recurrence, ...data }) => {
    const occurrenceDates = [data.date];
    if (recurrence?.until && recurrence.until >= data.date) {
      occurrenceDates.length = 0;
      let d = new Date(data.date + "T00:00:00");
      const until = new Date(recurrence.until + "T00:00:00");
      while (d <= until) { occurrenceDates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 7); }
    }
    const seriesId = occurrenceDates.length > 1 ? crypto.randomUUID() : null;
    const rows = occurrenceDates.map((dt) => ({
      academy_name: data.academyName, level: data.level, price: data.price, member_price: data.memberPrice,
      court_ids: data.courtIds, date: dt, start_time: data.startTime, end_time: data.endTime,
      recurring_group_id: seriesId, occupied_blocks: computeOccupiedBlocks(data.courtIds, dt, data.startTime, data.endTime),
    }));
    const { data: inserted, error } = await supabase.from("classes").insert(rows).select();
    if (error) { console.error("addClass:", error.message); return; }
    setClasses((p) => [...p, ...inserted.map((r) => mapClassRow({ ...r, class_registrations: [] }))]);
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
  const registerForOpenPlay = async (id, reg) => {
    const { data: row, error } = await supabase.from("open_play_registrations").insert({
      open_play_id: id, user_id: reg.userId, user_name: reg.userName, payment_method: reg.paymentMethod,
      reference: reg.reference, proof_name: reg.proofName, price_usd: reg.priceUsd, price_bs: reg.priceBs,
    }).select().single();
    if (error) { console.error("registerForOpenPlay:", error.message); return; }
    setOpenPlays((p) => p.map((e) => (e.id === id ? { ...e, registrations: [...e.registrations, mapRegistrationRow(row)] } : e)));
  };
  const registerForClass = async (id, reg) => {
    const { data: row, error } = await supabase.from("class_registrations").insert({
      class_id: id, user_id: reg.userId, user_name: reg.userName, payment_method: reg.paymentMethod,
      reference: reg.reference, proof_name: reg.proofName, price_usd: reg.priceUsd, price_bs: reg.priceBs,
    }).select().single();
    if (error) { console.error("registerForClass:", error.message); return; }
    setClasses((p) => p.map((e) => (e.id === id ? { ...e, registrations: [...e.registrations, mapRegistrationRow(row)] } : e)));
  };

  // ---- Membresías ----
  const addMembershipPlan = async (plan) => {
    const { data: row, error } = await supabase.from("membership_plans").insert({
      name: plan.name, monthly_price: plan.monthlyPrice, private_court_access: plan.privateCourtAccess,
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
  const subscribeToPlan = async (planId, checkout) => {
    const { data: row, error } = await supabase.from("subscriptions").insert({
      plan_id: planId, user_id: currentUser?.id, payment_method: checkout.paymentMethod,
      reference: checkout.reference, proof_name: checkout.proofName, price_usd: checkout.priceUsd, price_bs: checkout.priceBs,
    }).select().single();
    if (error) { console.error("subscribeToPlan:", error.message); return; }
    setSubscriptions((p) => [...p, mapSubscriptionRow(row)]);
    setUsers((prev) => prev.map((u) => (u.id === currentUser?.id ? { ...u, planId } : u)));
    const { error: profErr } = await supabase.from("profiles").update({ plan_id: planId }).eq("id", currentUser?.id);
    if (profErr) console.error("subscribeToPlan (profiles):", profErr.message);
  };

  const runScheduler = () => {
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
    const clone = structuredClone(categories);
    const info = buildSchedule(clone, courts, dates, tournament.dailyStart, tournament.dailyEnd, matchDuration, breakM, occupiedKeys);
    setCategories(clone);
    setScheduleInfo(info);
    setTab("torneos");
    // buildSchedule pudo tocar matches/groups de varias categorías a la vez -- upsert en bloque
    // (updateCategory solo cubre una categoría por llamada, no sirve para este caso).
    supabase.from("categories").upsert(clone.map((c) => ({
      id: c.id, tournament_id: tournament.id, name: c.name, modality: c.modality, gender: c.gender, level: c.level,
      max_teams: c.maxTeams, seed_mode: c.seedMode, best_of: c.bestOf, bracket_size: c.bracketSize, format: c.format,
      draw_generated: c.drawGenerated, groups_closed: c.groupsClosed,
      teams: c.teams, waitlist: c.waitlist, groups: c.groups, matches: c.matches,
    }))).then(({ error }) => { if (error) console.error("runScheduler persist:", error.message); });
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
    return (
      <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
        <GlobalStyles />
        <AuthScreen club={club} registerUser={registerUser} loginUser={loginUser} resetPasswordUser={resetPasswordUser} />
      </div>
    );
  }

  const role = currentUser.role;
  const visibleNav = NAV_ITEMS.filter((it) => it.roles.includes(role));
  const effectiveTab = visibleNav.some((it) => it.id === tab) ? tab : visibleNav[0].id;

  return (
    <div style={{ background: COLORS.chalk, color: COLORS.ink, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen flex">
      <GlobalStyles />

      <Sidebar tab={effectiveTab} setTab={setTab} club={club} stats={stats} currentUser={currentUser} currentPlan={currentPlan} logoutUser={logoutUser} visibleNav={visibleNav} />

      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar tab={effectiveTab} stats={stats} currentUser={currentUser} currentPlan={currentPlan} logoutUser={logoutUser} visibleNav={visibleNav} />

        <main className="max-w-7xl w-full mx-auto px-4 md:px-10 pt-6 pb-28 md:pb-16 flex-1">
          {effectiveTab === "club" && role === "admin" && <ClubTab club={club} updateClub={updateClub} courts={courts} addCourt={addCourt} updateCourt={updateCourt} removeCourt={removeCourt} rateStatus={rateStatus} syncBcvRate={syncBcvRate} />}

          {effectiveTab === "estadisticas" && role === "admin" && (
            <EstadisticasTab bookings={bookings} openPlays={openPlays} classes={classes} subscriptions={subscriptions}
              membershipPlans={membershipPlans} users={users} club={club} courts={courts} categories={categories} />
          )}

          {effectiveTab === "reservas" && (
            <ReservasTab club={club} courts={courts} occupiedKeys={occupiedKeys} bookings={bookings}
              createBooking={createBooking} cancelBooking={cancelBooking} currentUser={currentUser} currentPlan={currentPlan}
              categories={categories} openPlays={openPlays} classes={classes} role={role} />
          )}

          {effectiveTab === "eventos" && (
            <EventosTab club={club} courts={courts} openPlays={openPlays} classes={classes}
              addOpenPlay={addOpenPlay} addClass={addClass} removeOpenPlay={removeOpenPlay} removeOpenPlaySeries={removeOpenPlaySeries} removeClass={removeClass} removeClassSeries={removeClassSeries}
              registerForOpenPlay={registerForOpenPlay} registerForClass={registerForClass}
              currentUser={currentUser} currentPlan={currentPlan} membershipPlans={membershipPlans} role={role}
              tournament={tournament} categories={categories} occupiedKeys={occupiedKeys} setTab={setTab} />
          )}

          {effectiveTab === "torneos" && (
            <TorneosSection
              role={role} currentUser={currentUser} users={users} club={club}
              tournament={tournament} setTournament={updateTournament} dates={dates}
              categories={categories} activeCat={activeCat} setActiveCatId={setActiveCatId}
              addCategory={addCategory} removeCategory={removeCategory}
              addTeam={addTeam} removeTeam={removeTeam} removeFromWaitlist={removeFromWaitlist}
              generateDraw={generateDraw} closeGroupsAndSeedBracket={closeGroupsAndSeedBracket}
              suggestedRanking={suggestedRanking} upsertPlayerRanking={upsertPlayerRanking}
              setCategoryFormat={setCategoryFormat} courts={courts}
              matchDuration={matchDuration} breakM={breakM}
              runScheduler={runScheduler} scheduleInfo={scheduleInfo}
              setMatchDuration={setMatchDuration} setBreakM={setBreakM}
              submitScore={submitScore}
            />
          )}

          {effectiveTab === "membresias" && (
            <MembresiasTab membershipPlans={membershipPlans} club={club} courts={courts}
              addMembershipPlan={addMembershipPlan} updateMembershipPlan={updateMembershipPlan} removeMembershipPlan={removeMembershipPlan}
              subscribeToPlan={subscribeToPlan} currentUser={currentUser} role={role} />
          )}
        </main>
      </div>

      <MobileNav tab={effectiveTab} setTab={setTab} visibleNav={visibleNav} />
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

/* =========================================================================
   AUTH — login / registro. Sin backend real: las cuentas viven en memoria
   durante la sesión. Incluye una cuenta admin de muestra para poder ver
   ambas vistas (administrador y cliente) sin salir de la app.
   ========================================================================= */
function AuthScreen({ club, registerUser, loginUser, resetPasswordUser, updatePassword, forceReset }) {
  const [mode, setMode] = useState(forceReset ? "reset" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [zone, setZone] = useState("");
  const [zoneStatus, setZoneStatus] = useState({ loading: false, error: null, auto: false });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(""); // mensaje de éxito (no es error), p.ej. "te enviamos un correo"

  // La sesión temporal de recuperación viene del padre (App) -- mientras dure, no se puede
  // salir de esta pantalla ni volver a login/register.
  useEffect(() => { if (forceReset) setMode("reset"); }, [forceReset]);

  const detectZone = () => {
    if (!navigator.geolocation) {
      setZoneStatus({ loading: false, error: "Tu navegador no soporta geolocalización — escribe tu zona.", auto: false });
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
          else setZoneStatus({ loading: false, error: "No se pudo identificar la zona — escríbela manualmente.", auto: false });
          if (detected) setZone(detected);
        } catch {
          setZoneStatus({ loading: false, error: "No se pudo consultar la ubicación — escríbela manualmente.", auto: false });
        }
      },
      () => setZoneStatus({ loading: false, error: "Permiso de ubicación denegado — escríbela manualmente.", auto: false }),
      { timeout: 8000 }
    );
  };

  useEffect(() => { if (mode === "register") detectZone(); }, [mode]);

  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    setError("");
    setNotice("");
    if (mode === "reset" && newPassword !== newPassword2) { setError("Las contraseñas no coinciden."); return; }
    setSubmitting(true);
    let result;
    if (mode === "login") result = await loginUser(email, password);
    else if (mode === "register") result = await registerUser({ name, email, password, zone });
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

  const fillDemoAdmin = () => {
    setMode("login");
    setEmail("admin@club.com");
    setPassword("admin123");
    setError("");
  };

  const fillDemoClient = () => {
    setMode("login");
    setEmail("cliente@club.com");
    setPassword("cliente123");
    setError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: COLORS.courtDark }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-7">
          <div style={{ background: COLORS.ball }} className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-lg">
            <Trophy size={22} color={COLORS.courtDark} strokeWidth={2.5} />
          </div>
          <p className="text-[10px] tracking-[0.25em] uppercase mb-1" style={{ color: "#93A8C9" }}>Club OS</p>
          <h1 className="disp text-2xl text-center" style={{ color: COLORS.chalk }}>{club.name || "Mi Club"}</h1>
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
            {mode === "register" && (
              <div><Label>Nombre completo</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" /></div>
            )}
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

            {mode === "register" && (
              <div>
                <Label>Zona / sector</Label>
                <div className="relative">
                  <MapPinned size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                  <input style={{ ...inputStyle, paddingLeft: 32 }} value={zone}
                    onChange={(e) => { setZone(e.target.value); setZoneStatus((s) => ({ ...s, auto: false, error: null })); }}
                    placeholder="Ej. Chacao, Caracas" />
                </div>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <p className="text-[10px]" style={{ color: zoneStatus.error ? "#B23A1B" : zoneStatus.auto ? COLORS.court : "#6B7688" }}>
                    {zoneStatus.loading ? "Detectando tu ubicación…" : zoneStatus.auto ? "Detectada automáticamente — puedes editarla." : zoneStatus.error || "Se usa para las estadísticas del club."}
                  </p>
                  <button type="button" onClick={detectZone} className="text-[10px] font-bold shrink-0" style={{ color: COLORS.court }}>Detectar de nuevo</button>
                </div>
              </div>
            )}

            {notice && <p className="text-xs font-semibold" style={{ color: COLORS.court }}>{notice}</p>}
            {error && <p className="text-xs font-semibold" style={{ color: "#B23A1B" }}>{error}</p>}

            <button disabled={submitting} onClick={submit} style={{ background: COLORS.clay, color: "#fff", opacity: submitting ? 0.6 : 1 }} className="w-full py-2.5 rounded-xl font-bold text-sm mt-1">
              {submitting ? "Un momento…" : mode === "login" ? "Entrar" : mode === "register" ? "Crear cuenta" : mode === "recover" ? "Enviar enlace" : "Guardar nueva contraseña"}
            </button>
          </div>

          {(mode === "login" || mode === "register") && (
            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${COLORS.line}` }}>
              <p className="text-xs mb-2" style={{ color: "#6B7688" }}>¿Quieres probar rápido alguna vista?</p>
              <div className="space-y-2">
                <button onClick={fillDemoClient} className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
                  <Users size={13} /> Usar cuenta demo de cliente
                </button>
                <button onClick={fillDemoAdmin} className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
                  <Shield size={13} /> Usar cuenta demo de administrador
                </button>
              </div>
              <p className="mono text-[10px] text-center mt-2" style={{ color: "#8891A0" }}>cliente@club.com · cliente123 &nbsp;·&nbsp; admin@club.com · admin123</p>
            </div>
          )}
        </div>

        {(mode === "login" || mode === "register") && (
          <p className="text-center text-[11px] mt-5" style={{ color: "#55677E" }}>
            Regístrate normal o usa una de las cuentas demo para entrar rápido a la vista de cliente o de administrador.
          </p>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   SIDEBAR (desktop) + TOPBAR (ticker) + MOBILE NAV
   ========================================================================= */
const NAV_ITEMS = [
  { id: "club", label: "Club", short: "Club", icon: Building2, sub: "Horario, canchas y precios", roles: ["admin"] },
  { id: "estadisticas", label: "Estadísticas", short: "Stats", icon: BarChart3, sub: "Ingresos, horarios pico, membresías y zonas", roles: ["admin"] },
  // "eventos" (id interno sin cambios) va primero -- es la sección de aterrizaje del cliente.
  { id: "eventos", label: "Actividades", short: "Actividades", icon: PartyPopper, sub: "Open Plays, Torneos y Clases del club", roles: ["admin", "cliente"] },
  { id: "reservas", label: "Reservas", short: "Reservas", icon: CalendarClock, sub: "Reserva un bloque de cancha disponible", roles: ["admin", "cliente"] },
  { id: "torneos", label: "Torneos", short: "Torneos", icon: Trophy, sub: "Organiza el torneo del club", roles: ["admin", "cliente"] },
  { id: "membresias", label: "Membresías", short: "Planes", icon: Award, sub: "Planes, beneficios y suscripción", roles: ["admin", "cliente"] },
];

function Sidebar({ tab, setTab, club, stats, currentUser, currentPlan, logoutUser, visibleNav }) {
  return (
    <aside className="hidden md:flex flex-col w-64 shrink-0 sticky top-0 h-screen" style={{ background: COLORS.courtDark }}>
      <div className="px-6 pt-7 pb-6">
        <div className="flex items-center gap-2.5">
          <div style={{ background: COLORS.ball }} className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
            <Trophy size={16} color={COLORS.courtDark} strokeWidth={2.5} />
          </div>
          <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "#93A8C9" }}>Club OS</span>
        </div>
        <h1 className="disp text-lg leading-snug mt-3 line-clamp-2" style={{ color: COLORS.chalk }}>
          {club.name || "Mi Club"}
        </h1>
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

function MobileNav({ tab, setTab, visibleNav }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex justify-around px-1.5 py-2"
      style={{ background: COLORS.courtDark, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      {visibleNav.map((it) => {
        const Icon = it.icon;
        const active = tab === it.id;
        return (
          <button key={it.id} onClick={() => setTab(it.id)} className="flex flex-col items-center gap-1 px-2 py-1 rounded-lg flex-1"
            style={{ color: active ? COLORS.ball : "#6B7688" }}>
            <Icon size={17} strokeWidth={2.25} />
            <span className="text-[9px] font-semibold">{it.short}</span>
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
function TorneoTab({ tournament, setTournament: updateTournament, dates }) {
  const set = (k, v) => updateTournament({ [k]: v });
  return (
    <div className="grid md:grid-cols-2 gap-5 mt-2">
      <Card>
        <SectionTitle sub="Nombre y días de juego del evento.">Datos generales</SectionTitle>
        <div className="space-y-4">
          <div>
            <Label>Nombre del torneo</Label>
            <input style={inputStyle} value={tournament.name} onChange={(e) => set("name", e.target.value)} placeholder="Copa Verano Pickleball" />
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
          {dates.length > 0 && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
              {dates.length} día(s) de juego · {formatDateHuman(dates[0])} a {formatDateHuman(dates[dates.length - 1])}
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
              <Label>Precio de preventa</Label>
              <div className="relative">
                <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
                <input type="number" min={0} style={{ ...inputStyle, paddingLeft: 30 }} value={tournament.presalePrice}
                  onChange={(e) => set("presalePrice", e.target.value)} placeholder="0.00" />
              </div>
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
            <Label>Precio regular (por jugador, fuera de preventa)</Label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#78829A" />
              <input type="number" min={0} style={{ ...inputStyle, paddingLeft: 30 }} value={tournament.regularPrice}
                onChange={(e) => set("regularPrice", e.target.value)} placeholder="0.00" />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: CANCHAS
   ========================================================================= */
function ClubTab({ club, updateClub, courts, addCourt, updateCourt, removeCourt, rateStatus, syncBcvRate }) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [price, setPrice] = useState(8);
  const [memberPrice, setMemberPrice] = useState(8);
  const [hasSpecialPricing, setHasSpecialPricing] = useState(false);
  const [newRules, setNewRules] = useState([]);
  const setC = (k, v) => updateClub({ [k]: v });
  const setPagoMovil = (k, v) => updateClub({ pagoMovil: { ...club.pagoMovil, [k]: v } });

  const handleAddCourt = () => {
    const n = name.trim() || `Cancha ${courts.length + 1}`;
    addCourt({
      name: n, isPrivate, pricePerBlock: Number(price) || 0, memberPrice: Number(memberPrice) || 0,
      priceRules: hasSpecialPricing ? newRules : [],
    });
    setName(""); setIsPrivate(false); setPrice(8); setMemberPrice(8); setHasSpecialPricing(false); setNewRules([]);
  };

  const blocksPerDay = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes).length;

  const minutesAgo = rateStatus.lastSync ? Math.round((Date.now() - rateStatus.lastSync) / 60000) : null;

  return (
    <div className="mt-2 space-y-5">
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
                      ? `Última sincronización: hace ${minutesAgo <= 0 ? "menos de 1" : minutesAgo} min${rateStatus.effectiveDate ? ` · vigente ${rateStatus.effectiveDate}` : ""}`
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

      <Card>
        <SectionTitle sub="Cada cancha puede ser pública (cualquiera reserva) o privada (prioridad para miembros), con precio normal, precio con membresía, y horarios con precio especial.">Canchas</SectionTitle>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <div><Label>Nombre</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cancha 3" /></div>
          <div>
            <Label>Acceso</Label>
            <Segmented value={isPrivate ? "priv" : "pub"} onChange={(v) => setIsPrivate(v === "priv")}
              options={[{ value: "pub", label: "Pública" }, { value: "priv", label: "Privada" }]} />
          </div>
          <div><Label>Precio / bloque (USD)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div><Label>Precio con membresía (USD)</Label><input type="number" min={0} style={inputStyle} value={memberPrice} onChange={(e) => setMemberPrice(e.target.value)} /></div>
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
    </div>
  );
}

// Shared by the "add court" form and each existing CourtCard — a small list of
// {startTime, endTime, price, memberPrice} time-window overrides (e.g. tarifa nocturna,
// fin de semana) that courtPriceInfo() checks before falling back to the court's base price.
function PriceRuleEditor({ rules, onChange }) {
  const [from, setFrom] = useState("18:00");
  const [to, setTo] = useState("22:00");
  const [rulePrice, setRulePrice] = useState(0);
  const [ruleMemberPrice, setRuleMemberPrice] = useState(0);

  const addRule = () => {
    if (!from || !to || from >= to) return;
    onChange([...rules, { id: uid("rule"), startTime: from, endTime: to, price: Number(rulePrice) || 0, memberPrice: Number(ruleMemberPrice) || 0 }]);
    setRulePrice(0); setRuleMemberPrice(0);
  };
  const removeRule = (id) => onChange(rules.filter((r) => r.id !== id));

  return (
    <div className="space-y-2">
      {rules.map((r) => (
        <div key={r.id} className="flex items-center justify-between px-2.5 py-2 rounded-lg text-xs" style={{ background: "#fff", border: `1px solid ${COLORS.line}` }}>
          <span>{formatTimeAmPm(r.startTime)}–{formatTimeAmPm(r.endTime)} · {formatMoney(r.price)} normal / {formatMoney(r.memberPrice ?? r.price)} miembro</span>
          <button onClick={() => removeRule(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
      ))}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 items-end">
        <div><Label>Desde</Label><input type="time" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>Hasta</Label><input type="time" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><Label>Precio normal</Label><input type="number" min={0} style={inputStyle} value={rulePrice} onChange={(e) => setRulePrice(e.target.value)} /></div>
        <div><Label>Precio miembro</Label><input type="number" min={0} style={inputStyle} value={ruleMemberPrice} onChange={(e) => setRuleMemberPrice(e.target.value)} /></div>
        <button onClick={addRule} className="py-2.5 rounded-lg text-xs font-bold h-[38px]" style={{ background: COLORS.court, color: "#fff" }}>
          <Plus size={14} className="inline" />
        </button>
      </div>
    </div>
  );
}

// A single court row in the admin's Canchas list — click the pencil to edit its name,
// access, base/member price and its time-based special-pricing rules in place.
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
          <span className="mono text-xs" style={{ color: "#6B7688" }}>
            {formatMoney(court.pricePerBlock)} <span style={{ color: "#9AA6BC" }}>normal</span> · {formatMoney(court.memberPrice ?? court.pricePerBlock)} <span style={{ color: "#9AA6BC" }}>miembro</span>
          </span>
          <button onClick={() => setEditing((s) => !s)} style={{ color: editing ? COLORS.court : "#9AA6BC" }}><Pencil size={14} /></button>
          <button onClick={onRemove} className="text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
        </div>
      </div>

      {editing && (
        <div className="px-3 pb-3 pt-2 space-y-3" style={{ borderTop: `1px solid ${COLORS.line}`, background: "#fff" }}>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-2">
            <div><Label>Nombre</Label><input style={inputStyle} value={court.name} onChange={(e) => onUpdate({ name: e.target.value })} /></div>
            <div>
              <Label>Acceso</Label>
              <Segmented value={court.isPrivate ? "priv" : "pub"} onChange={(v) => onUpdate({ isPrivate: v === "priv" })} options={[{ value: "pub", label: "Pública" }, { value: "priv", label: "Privada" }]} />
            </div>
            <div><Label>Precio / bloque (USD)</Label><input type="number" min={0} style={inputStyle} value={court.pricePerBlock} onChange={(e) => onUpdate({ pricePerBlock: Number(e.target.value) || 0 })} /></div>
            <div><Label>Precio con membresía (USD)</Label><input type="number" min={0} style={inputStyle} value={court.memberPrice ?? court.pricePerBlock} onChange={(e) => onUpdate({ memberPrice: Number(e.target.value) || 0 })} /></div>
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
function StatCard({ label, value, icon: Icon }) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EAF0F8" }}>
          <Icon size={18} color={COLORS.court} />
        </div>
        <div className="min-w-0">
          <p className="disp text-xl truncate" style={{ color: COLORS.courtDark }}>{value}</p>
          <p className="text-xs" style={{ color: "#6B7688" }}>{label}</p>
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

function HBarList({ data, color = COLORS.court }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs mb-1"><span className="font-medium truncate pr-2">{d.label}</span><span className="mono shrink-0" style={{ color: "#6B7688" }}>{d.value}</span></div>
          <div className="h-2 rounded-full" style={{ background: "#EDEFF4" }}>
            <div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
      {data.length === 0 && <p className="text-xs text-gray-400 italic">Sin datos todavía.</p>}
    </div>
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

function EstadisticasTab({ bookings, openPlays, classes, subscriptions, membershipPlans, users, club, courts, categories }) {
  const transactions = useMemo(() => buildTransactions(bookings, openPlays, classes, subscriptions), [bookings, openPlays, classes, subscriptions]);
  const byDay = useMemo(() => groupByDay(transactions, 14), [transactions]);
  const byMonth = useMemo(() => groupByMonth(transactions, 6), [transactions]);
  const byHour = useMemo(() => groupByHour(bookings, club), [bookings, club]);
  const byZone = useMemo(() => groupByZone(users), [users]);
  const byPlan = useMemo(() => groupByPlan(users, membershipPlans), [users, membershipPlans]);

  const totalRevenue = transactions.reduce((s, t) => s + t.usd, 0);
  const totalMembers = users.filter((u) => u.role === "cliente" && u.planId && membershipPlans.find((p) => p.id === u.planId)?.monthlyPrice > 0).length;
  const totalBookings = bookings.filter((b) => b.status !== "cancelada").length;
  const totalClients = users.filter((u) => u.role === "cliente").length;

  return (
    <div className="mt-2 space-y-6">
      <SectionTitle sub="Ingresos, horarios pico, membresías y de dónde vienen tus jugadores.">Estadísticas del club</SectionTitle>

      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Ingresos totales" value={formatMoney(totalRevenue)} icon={DollarSign} />
        <StatCard label="Membresías activas" value={totalMembers} icon={Award} />
        <StatCard label="Reservas totales" value={totalBookings} icon={CalendarClock} />
        <StatCard label="Jugadores registrados" value={totalClients} icon={Users} />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <SectionTitle sub="Suma de reservas, Open Plays, clases y membresías, últimos 14 días.">Ingresos por día</SectionTitle>
          <MiniBarChart data={byDay} money />
        </Card>
        <Card>
          <SectionTitle sub="Mismo total, agrupado por mes (últimos 6 meses).">Ingresos por mes</SectionTitle>
          <MiniBarChart data={byMonth} color={COLORS.clay} money />
        </Card>
      </div>

      <Card>
        <SectionTitle sub="Todas las reservas de cancha, agrupadas por bloque horario — identifica los horarios pico del club.">Horas más concurridas</SectionTitle>
        <HourLineChart data={byHour} />
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <SectionTitle sub="Cuántos jugadores tienen cada plan activo.">Membresías contratadas</SectionTitle>
          <HBarList data={byPlan} color={COLORS.court} />
        </Card>
        <Card>
          <SectionTitle sub="Zona registrada por cada jugador al crear su cuenta (detectada automáticamente o escrita a mano).">Zona de los jugadores</SectionTitle>
          <HBarList data={byZone} color={COLORS.clay} />
        </Card>
      </div>

      <LoyalClientsCard bookings={bookings} openPlays={openPlays} classes={classes} categories={categories} users={users} />
    </div>
  );
}

/* =========================================================================
   TAB: CATEGORIAS
   ========================================================================= */
const TORNEO_SUB_ITEMS = [
  { id: "config", label: "Torneo", roles: ["admin"] },
  { id: "categorias", label: "Categorías", roles: ["admin"] },
  { id: "inscripcion", label: "Inscripción", roles: ["admin", "cliente"] },
  { id: "calendario", label: "Calendario", roles: ["admin", "cliente"] },
  { id: "resultados", label: "Resultados", roles: ["admin", "cliente"] },
];

function TorneosSection(props) {
  const { role } = props;
  const visibleSubItems = TORNEO_SUB_ITEMS.filter((it) => it.roles.includes(role));
  const [subTab, setSubTab] = useState(visibleSubItems[0]?.id);
  useEffect(() => {
    if (!visibleSubItems.some((it) => it.id === subTab)) setSubTab(visibleSubItems[0]?.id);
  }, [role]);

  const {
    tournament, setTournament, dates, categories, activeCat, setActiveCatId,
    addCategory, removeCategory, addTeam, removeTeam, removeFromWaitlist,
    generateDraw, closeGroupsAndSeedBracket, suggestedRanking, upsertPlayerRanking,
    setCategoryFormat, courts, matchDuration, breakM, runScheduler, scheduleInfo,
    setMatchDuration, setBreakM, submitScore, currentUser, users, club,
  } = props;

  return (
    <div>
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {visibleSubItems.map((it) => (
          <button key={it.id} onClick={() => setSubTab(it.id)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap"
            style={{ background: subTab === it.id ? COLORS.court : "#EAEEF5", color: subTab === it.id ? "#fff" : COLORS.ink }}>
            {it.label}
          </button>
        ))}
      </div>

      {subTab === "config" && role === "admin" && <TorneoTab tournament={tournament} setTournament={setTournament} dates={dates} />}

      {subTab === "categorias" && role === "admin" && (
        <CategoriasTab
          categories={categories} activeCat={activeCat} setActiveCatId={setActiveCatId}
          addCategory={addCategory} removeCategory={removeCategory}
          addTeam={addTeam} removeTeam={removeTeam} removeFromWaitlist={removeFromWaitlist}
          generateDraw={generateDraw} closeGroupsAndSeedBracket={closeGroupsAndSeedBracket}
          suggestedRanking={suggestedRanking} upsertPlayerRanking={upsertPlayerRanking}
          setCategoryFormat={setCategoryFormat} courts={courts} dates={dates} tournament={tournament}
          matchDuration={matchDuration} breakM={breakM}
        />
      )}

      {subTab === "inscripcion" && (
        <InscripcionTab categories={categories} addTeam={addTeam} suggestedRanking={suggestedRanking}
          role={role} currentUser={currentUser} users={users} club={club} tournament={tournament} />
      )}

      {subTab === "calendario" && (
        <CalendarioTab categories={categories} courts={courts} runScheduler={runScheduler} role={role}
          scheduleInfo={scheduleInfo} tournament={tournament}
          matchDuration={matchDuration} setMatchDuration={setMatchDuration} breakM={breakM} setBreakM={setBreakM} />
      )}

      {subTab === "resultados" && (
        <ResultadosTab categories={categories} courts={courts} submitScore={submitScore}
          closeGroupsAndSeedBracket={closeGroupsAndSeedBracket} />
      )}
    </div>
  );
}

function CategoriasTab({ categories, activeCat, setActiveCatId, addCategory, removeCategory, addTeam, removeTeam, removeFromWaitlist, generateDraw, closeGroupsAndSeedBracket, suggestedRanking, upsertPlayerRanking, setCategoryFormat, courts, dates, tournament, matchDuration, breakM }) {
  const [showNew, setShowNew] = useState(categories.length === 0);
  return (
    <div className="grid md:grid-cols-[260px_1fr] gap-5 mt-2">
      <div>
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Categorías</h3>
            <button onClick={() => setShowNew(true)} style={{ color: COLORS.court }}><Plus size={18} /></button>
          </div>
          <div className="space-y-1.5">
            {categories.map((c) => (
              <button key={c.id} onClick={() => setActiveCatId(c.id)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between group"
                style={{ background: activeCat?.id === c.id ? "#EAF3E6" : "transparent", color: activeCat?.id === c.id ? COLORS.courtDark : COLORS.ink, fontWeight: activeCat?.id === c.id ? 700 : 500 }}>
                <span className="truncate">{c.name}</span>
                <ChevronRight size={14} className="opacity-40 group-hover:opacity-100" />
              </button>
            ))}
            {categories.length === 0 && <p className="text-xs text-gray-400 italic px-1">Crea tu primera categoría.</p>}
          </div>
        </Card>
        {showNew && <NewCategoryForm onCreate={(...args) => { addCategory(...args); setShowNew(false); }} onCancel={() => setShowNew(false)} />}
      </div>

      <div>
        {activeCat ? (
          <CategoryDetail cat={activeCat} addTeam={addTeam} removeTeam={removeTeam} removeFromWaitlist={removeFromWaitlist}
            generateDraw={generateDraw} closeGroupsAndSeedBracket={closeGroupsAndSeedBracket} removeCategory={removeCategory}
            suggestedRanking={suggestedRanking} upsertPlayerRanking={upsertPlayerRanking}
            setCategoryFormat={setCategoryFormat} categories={categories} courts={courts} dates={dates}
            tournament={tournament} matchDuration={matchDuration} breakM={breakM} />
        ) : (
          <Card><p className="text-sm text-gray-400">Selecciona o crea una categoría para comenzar.</p></Card>
        )}
      </div>
    </div>
  );
}

/* Segmented control used across the category-creation wizard */
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className="px-3.5 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background: value === o.value ? COLORS.court : "#EAEEF5", color: value === o.value ? COLORS.chalk : COLORS.ink }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NewCategoryForm({ onCreate, onCancel }) {
  const [modality, setModality] = useState("dobles");
  const [gender, setGender] = useState("mixto");
  const [level, setLevel] = useState(LEVEL_OPTIONS[2]);
  const [maxTeams, setMaxTeams] = useState("");
  const previewName = makeCategoryName(modality, gender, level);

  return (
    <Card className="mt-3">
      <h4 className="font-bold text-sm mb-4">Nueva categoría</h4>
      <div className="space-y-4">
        <div>
          <Label>1. Modalidad</Label>
          <Segmented value={modality} onChange={setModality}
            options={[{ value: "individual", label: "Individual" }, { value: "dobles", label: "Dobles" }]} />
        </div>
        <div>
          <Label>2. Género</Label>
          <Segmented value={gender} onChange={setGender}
            options={[{ value: "masculino", label: "Masculino" }, { value: "femenino", label: "Femenino" }, { value: "mixto", label: "Mixto" }]} />
        </div>
        <div>
          <Label>3. Nivel de habilidad</Label>
          <select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
          Nombre automático: <b>{previewName}</b>
        </div>
        <div>
          <Label>Cupo máximo de equipos (opcional)</Label>
          <input type="number" min={2} style={inputStyle} value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} placeholder="Sin límite" />
          <p className="text-xs mt-1" style={{ color: "#6B7688" }}>Al llenarse, los siguientes inscritos entran a una lista de espera y suben automáticamente si alguien se retira.</p>
        </div>
        <p className="text-xs" style={{ color: "#6B7688" }}>El formato del torneo se elige más adelante, una vez que sepas cuántos equipos se inscribieron — la app te dará una recomendación.</p>
        <div className="flex gap-2 pt-1">
          <button onClick={() => onCreate(modality, gender, level, maxTeams)}
            style={{ background: COLORS.court, color: COLORS.chalk }}
            className="flex-1 py-2 rounded-xl font-semibold text-sm">Crear categoría</button>
          <button onClick={onCancel} className="px-3 rounded-xl text-sm text-gray-400">Cancelar</button>
        </div>
      </div>
    </Card>
  );
}

function CategoryDetail({ cat, addTeam, removeTeam, removeFromWaitlist, generateDraw, closeGroupsAndSeedBracket, removeCategory, suggestedRanking, upsertPlayerRanking, setCategoryFormat, categories, courts, dates, tournament, matchDuration, breakM }) {
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="disp text-lg" style={{ color: COLORS.courtDark }}>{cat.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {cat.format ? FORMAT_LABELS[cat.format] : "Formato por definir"} · {cat.teams.length}{cat.maxTeams ? `/${cat.maxTeams}` : ""} equipo(s) inscrito(s)
              {cat.waitlist.length > 0 && ` · ${cat.waitlist.length} en lista de espera`}
            </p>
          </div>
          <button onClick={() => removeCategory(cat.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>
        </div>
      </Card>

      <TeamRegistration cat={cat} addTeam={addTeam} removeTeam={removeTeam} removeFromWaitlist={removeFromWaitlist}
        suggestedRanking={suggestedRanking} upsertPlayerRanking={upsertPlayerRanking} />

      {!cat.format ? (
        <FormatAdvisor cat={cat} categories={categories} courts={courts} dates={dates} tournament={tournament}
          matchDuration={matchDuration} breakM={breakM} onSelect={(f) => setCategoryFormat(cat.id, f)} />
      ) : (
        <>
          <DrawSetup cat={cat} generateDraw={generateDraw} onChangeFormat={() => setCategoryFormat(cat.id, null)} />
          {cat.drawGenerated && <DrawPreview cat={cat} closeGroupsAndSeedBracket={closeGroupsAndSeedBracket} />}
        </>
      )}
    </div>
  );
}

/* Player-name + ranking field: autofills the ranking from the app-wide directory
   (by prior tournament results) and only lets the organizer override it. */
function PlayerField({ label, name, setName, ranking, setRanking, suggestedRanking }) {
  const [editing, setEditing] = useState(false);
  const suggestion = name.trim() ? suggestedRanking(name) : "";
  const showSuggested = suggestion !== "" && !editing && String(ranking) === "";
  return (
    <div>
      <Label>{label}</Label>
      <input style={{ ...inputStyle, marginBottom: 6 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
      <div className="flex items-center gap-1.5">
        <input type="number" style={inputStyle} disabled={showSuggested}
          value={showSuggested ? suggestion : ranking}
          onChange={(e) => setRanking(e.target.value)}
          placeholder="Ranking" />
        <button type="button" onClick={() => setEditing((e) => !e)} title="Editar ranking (solo organizador)"
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#EAEEF5", color: COLORS.court }}>
          <Pencil size={13} />
        </button>
      </div>
      {showSuggested && <p className="text-[10px] mt-1" style={{ color: "#6B7688" }}>Sugerido por ranking histórico — pulsa el lápiz para editarlo.</p>}
    </div>
  );
}

function TeamRegistration({ cat, addTeam, removeTeam, removeFromWaitlist, suggestedRanking, upsertPlayerRanking }) {
  const isDoubles = cat.modality !== "individual";
  const [p1, setP1] = useState(""); const [r1, setR1] = useState("");
  const [p2, setP2] = useState(""); const [r2, setR2] = useState("");
  const full = cat.maxTeams && cat.teams.length >= cat.maxTeams;

  const submit = () => {
    if (!p1.trim()) return;
    if (isDoubles && !p2.trim()) return;
    const r1Final = r1 !== "" ? r1 : suggestedRanking(p1);
    const players = [{ name: p1.trim(), ranking: r1Final || 0 }];
    if (isDoubles) {
      const r2Final = r2 !== "" ? r2 : suggestedRanking(p2);
      players.push({ name: p2.trim(), ranking: r2Final || 0 });
    }
    addTeam(cat.id, players);
    setP1(""); setR1(""); setP2(""); setR2("");
  };

  return (
    <Card>
      <SectionTitle sub="El nombre del equipo se arma solo con los nombres de los jugadores. El ranking se sugiere del historial de la app y solo el organizador puede editarlo.">
        Equipos inscritos {cat.maxTeams ? `(${cat.teams.length}/${cat.maxTeams})` : ""}
      </SectionTitle>

      <div className={`grid gap-2 items-start mb-4 ${isDoubles ? "md:grid-cols-[1fr_1fr_auto]" : "md:grid-cols-[1fr_auto]"}`}>
        <PlayerField label={isDoubles ? "Jugador 1" : "Jugador"} name={p1} setName={setP1} ranking={r1} setRanking={setR1} suggestedRanking={suggestedRanking} />
        {isDoubles && <PlayerField label="Jugador 2" name={p2} setName={setP2} ranking={r2} setRanking={setR2} suggestedRanking={suggestedRanking} />}
        <button onClick={submit} style={{ background: COLORS.court, color: COLORS.chalk }} className="px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-1 h-[38px] self-end">
          <Plus size={16} /> {full ? "Añadir (espera)" : "Añadir"}
        </button>
      </div>

      {full && (
        <div className="text-xs px-3 py-2 rounded-lg mb-3 flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
          <Hourglass size={12} /> Cupo lleno — los nuevos equipos entran a la lista de espera y suben automáticamente si alguien se retira.
        </div>
      )}

      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {(cat.teams || []).map((t) => (
          <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "#EEF1F7" }}>
            <div>
              <span className="font-semibold">{t.name}</span>
              <span className="text-gray-500 ml-2 text-xs">{(t.players || []).map((p) => `${p.name} (${p.ranking || 0})`).join(" · ")}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="mono text-xs px-2 py-0.5 rounded-full" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>Σ {teamRankSum(t)}</span>
              <button onClick={() => removeTeam(cat.id, t.id)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
            </div>
          </div>
        ))}
        {(cat.teams || []).length === 0 && <p className="text-xs text-gray-400 italic">Sin equipos todavía.</p>}
      </div>

      {(cat.waitlist || []).length > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: COLORS.line }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: "#8A5A16" }}>
            <Hourglass size={12} /> Lista de espera ({cat.waitlist.length})
          </p>
          <div className="space-y-1.5">
            {(cat.waitlist || []).map((t, i) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "#FBF3E4" }}>
                <span><span className="mono text-xs mr-2" style={{ color: "#8A5A16" }}>#{i + 1}</span>{t.name}</span>
                <button onClick={() => removeFromWaitlist(cat.id, t.id)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
              </div>
            ))}
          </div>
        </div>
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
      <div className="flex items-center justify-between mb-1">
        <SectionTitle sub="Define cómo se sembrarán los equipos y arma el draw de esta categoría.">
          Configurar draw · {FORMAT_LABELS[cat.format]}
        </SectionTitle>
        <button onClick={onChangeFormat} className="text-xs font-semibold shrink-0" style={{ color: COLORS.clay }}>Cambiar formato</button>
      </div>
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
        onClick={() => generateDraw(cat.id, { seedMode, bestOf, bracketSize: nextPow2(Number(bracketSize)), numGroups })}
        style={{ background: canGenerate ? COLORS.clay : "#E5E5E5", color: canGenerate ? "#fff" : "#999" }}
        className="mt-5 px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2">
        <Swords size={16} /> {cat.drawGenerated ? "Regenerar draw" : "Generar draw"}
      </button>
      {!canGenerate && <p className="text-xs text-red-400 mt-2">Necesitas más equipos inscritos para este formato/tamaño de cuadro.</p>}
    </Card>
  );
}

function DrawPreview({ cat, closeGroupsAndSeedBracket }) {
  const teamName = (id) => cat.teams.find((t) => t.id === id)?.name || "?";
  const isDouble = cat.format === "doble_eliminacion";
  return (
    <Card>
      <SectionTitle>Draw generado</SectionTitle>
      {cat.groups.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          {cat.groups.map((g) => (
            <div key={g.id} className="rounded-xl p-3" style={{ background: "#EEF1F7" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-sm">{g.name}</span>
                <span className="text-xs text-gray-500">clasifican {g.qualifiers}</span>
              </div>
              <ul className="text-sm space-y-1">
                {g.teamIds.map((tid) => <li key={tid}>• {teamName(tid)}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}

      {cat.format === "grupos_eliminatoria" && !cat.groupsClosed && (
        <button onClick={() => closeGroupsAndSeedBracket(cat.id)}
          style={{ background: COLORS.court, color: COLORS.chalk }}
          className="mb-5 px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5">
          <CheckCircle2 size={15} /> Cerrar fase de grupos y armar eliminatoria
        </button>
      )}
      {cat.format === "grupos_eliminatoria" && !cat.groupsClosed && (
        <p className="text-xs text-amber-600 -mt-3 mb-5">Carga primero todos los resultados de grupos en la pestaña "Resultados" y luego cierra la fase para definir el cuadro final.</p>
      )}

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
function CalendarioTab({ categories, courts, runScheduler, scheduleInfo, tournament, matchDuration, setMatchDuration, breakM, setBreakM, role }) {
  const isAdmin = role === "admin";
  const [filterCat, setFilterCat] = useState("all");
  const allMatches = categories.flatMap((c) => c.matches.map((m) => ({ ...m, catName: c.name })));
  const scheduled = allMatches.filter((m) => m.day).sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
  const filtered = filterCat === "all" ? scheduled : scheduled.filter((m) => m.categoryId === filterCat);

  const catById = {}; categories.forEach((c) => catById[c.id] = c);
  const courtById = {}; courts.forEach((c) => courtById[c.id] = c);
  const teamLabel = (m, side) => {
    const cat = catById[m.categoryId];
    if (side === "A") return m.teamALabel || cat.teams.find((t) => t.id === m.teamAId)?.name || "Por definir";
    return m.teamBLabel || cat.teams.find((t) => t.id === m.teamBId)?.name || "Por definir";
  };
  const phaseTag = (m) => {
    if (m.phase === "bracket") return ` · R${m.round}`;
    if (m.phase === "bracket_wr") return ` · Llave A R${m.round}`;
    if (m.phase === "bracket_lb") return ` · Llave B R${m.round}`;
    return "";
  };

  const byDay = {};
  filtered.forEach((m) => { (byDay[m.day] = byDay[m.day] || []).push(m); });

  return (
    <div className="mt-2 space-y-5">
      {isAdmin && (
        <Card>
          <SectionTitle sub="Duración de cada partido e intervalo entre partidos. Puedes ajustarlos antes o después de generar el calendario.">Duración de partidos</SectionTitle>
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <div>
              <Label>Duración aproximada por partido (min)</Label>
              <input type="number" min={10} style={inputStyle} value={matchDuration} onChange={(e) => setMatchDuration(e.target.value)} />
            </div>
            <div>
              <Label>Intervalo entre partidos (min)</Label>
              <input type="number" min={0} style={inputStyle} value={breakM} onChange={(e) => setBreakM(e.target.value)} />
            </div>
            <div className="text-xs px-3 py-2.5 rounded-lg h-fit" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
              Cada franja por cancha: {Number(matchDuration) + Number(breakM)} min
            </div>
          </div>
        </Card>
      )}

      {(isAdmin || scheduleInfo) && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <SectionTitle sub={isAdmin ? "Genera (o vuelve a generar) los horarios evitando que un jugador tenga dos partidos a la vez." : "Horario generado por el organizador del torneo."}>Calendario de juego</SectionTitle>
            </div>
            {isAdmin && (
              <button onClick={runScheduler} style={{ background: COLORS.clay, color: "#fff" }} className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 h-fit">
                <Clock size={16} /> {scheduleInfo ? "Actualizar calendario" : "Generar calendario"}
              </button>
            )}
          </div>

        {scheduleInfo && (
          <div className="mt-3 flex flex-wrap gap-3">
            {scheduleInfo.start && scheduleInfo.end && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EAF0F8", color: COLORS.courtDark }}>
                Inicio: {formatDateHuman(scheduleInfo.start.day)} {formatTimeAmPm(scheduleInfo.start.time)} → Fin estimado: {formatDateHuman(scheduleInfo.end.day)} {formatTimeAmPm(scheduleInfo.end.time)}
              </div>
            )}
            {scheduleInfo.capacityExceeded && (
              <div className="text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "#FCE9E4", color: "#B23A1B" }}>
                <AlertTriangle size={14} /> No alcanzan los horarios disponibles ({scheduleInfo.unscheduledGroup} partido(s) sin ubicar). Agrega más canchas, días u horas.
              </div>
            )}
          </div>
        )}
      </Card>
      )}

      {scheduled.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={() => setFilterCat("all")} className="px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: filterCat === "all" ? COLORS.court : "#EAEEF5", color: filterCat === "all" ? "#fff" : COLORS.ink }}>Todas</button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setFilterCat(c.id)} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: filterCat === c.id ? COLORS.court : "#EAEEF5", color: filterCat === c.id ? "#fff" : COLORS.ink }}>{c.name}</button>
            ))}
          </div>

          {Object.keys(byDay).sort().map((day) => (
            <div key={day} className="mb-6">
              <p className="text-xs font-bold uppercase mb-2" style={{ color: COLORS.clay }}>{formatDateHuman(day)}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase">
                      <th className="py-1.5 pr-3">Hora</th>
                      <th className="py-1.5 pr-3">Cancha</th>
                      <th className="py-1.5 pr-3">Categoría</th>
                      <th className="py-1.5 pr-3">Partido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDay[day].map((m) => (
                      <tr key={m.id} className="border-t" style={{ borderColor: COLORS.line }}>
                        <td className="py-2 pr-3 mono font-semibold">{formatTimeAmPm(m.time)}</td>
                        <td className="py-2 pr-3">{courtById[m.courtId]?.name}</td>
                        <td className="py-2 pr-3 text-gray-500">{m.catName}{phaseTag(m)}</td>
                        <td className="py-2 pr-3 font-medium">{teamLabel(m, "A")} <span className="text-gray-400 font-normal">vs</span> {teamLabel(m, "B")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </Card>
      )}
      {scheduled.length === 0 && (
        <Card><p className="text-sm text-gray-400">{isAdmin ? 'Aún no hay calendario generado. Configura torneo, canchas y al menos un draw de categoría, luego pulsa "Generar calendario".' : "El organizador del torneo todavía no ha generado el calendario."}</p></Card>
      )}
    </div>
  );
}

/* =========================================================================
   TAB: INSCRIPCIÓN (autoservicio de jugadores)
   ========================================================================= */
// Type-ahead partner picker — searches the app's user directory ("Instagram-style") by name
// or email, or falls back to inviting someone not registered yet by name + email. Emits the
// resolved player object ({userId, name, ranking} or {name, email, ranking}) via onChange,
// or null while no valid partner is resolved yet.
function PartnerPicker({ users, excludeUserId, suggestedRanking, onChange }) {
  const [mode, setMode] = useState("search");
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [ranking, setRanking] = useState("");

  const results = mode === "search" && !selectedUser && query.trim().length > 0
    ? users.filter((u) => u.id !== excludeUserId && u.role !== "admin" &&
        (u.name.toLowerCase().includes(query.trim().toLowerCase()) || u.email.toLowerCase().includes(query.trim().toLowerCase())))
        .slice(0, 6)
    : [];

  useEffect(() => {
    if (mode === "search" && selectedUser) {
      onChange({ userId: selectedUser.id, name: selectedUser.name, ranking: Number(ranking) || 0 });
    } else if (mode === "invite" && inviteName.trim() && inviteEmail.trim()) {
      onChange({ name: inviteName.trim(), email: inviteEmail.trim(), ranking: Number(ranking) || 0 });
    } else {
      onChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedUser, inviteName, inviteEmail, ranking]);

  const pickUser = (u) => { setSelectedUser(u); setQuery(u.name); setRanking(suggestedRanking(u.name) || ""); };
  const clearUser = () => { setSelectedUser(null); setQuery(""); setRanking(""); };
  const switchMode = (m) => { setMode(m); setSelectedUser(null); setQuery(""); setInviteName(""); setInviteEmail(""); setRanking(""); };

  const hasPartner = (mode === "search" && selectedUser) || (mode === "invite" && inviteName.trim() && inviteEmail.trim());

  return (
    <div>
      <div className="flex gap-1.5 mb-2">
        <button type="button" onClick={() => switchMode("search")} className="px-3 py-1 rounded-lg text-[11px] font-bold"
          style={{ background: mode === "search" ? COLORS.court : "#EAEEF5", color: mode === "search" ? "#fff" : COLORS.ink }}>Buscar jugador</button>
        <button type="button" onClick={() => switchMode("invite")} className="px-3 py-1 rounded-lg text-[11px] font-bold"
          style={{ background: mode === "invite" ? COLORS.court : "#EAEEF5", color: mode === "invite" ? "#fff" : COLORS.ink }}>Invitar por correo</button>
      </div>

      {mode === "search" ? (
        selectedUser ? (
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-2" style={{ background: "#DCEBD5" }}>
            <span className="text-sm font-semibold flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: COLORS.court, color: "#fff" }}>{selectedUser.name.charAt(0).toUpperCase()}</span>
              {selectedUser.name} <span className="text-xs font-normal text-gray-500">· {selectedUser.email}</span>
            </span>
            <button onClick={clearUser} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
          </div>
        ) : (
          <div className="relative mb-2">
            <input style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca a tu pareja por nombre o correo…" />
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
              <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>Nadie coincide — usa "Invitar por correo" si tu pareja aún no está registrada en la app.</p>
            )}
          </div>
        )
      ) : (
        <div className="grid sm:grid-cols-2 gap-2 mb-2">
          <input style={inputStyle} value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Nombre de tu pareja" />
          <input type="email" style={inputStyle} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Correo de invitación" />
        </div>
      )}

      {hasPartner && (
        <div>
          <Label>Nivel / ranking de tu pareja (opcional)</Label>
          <input type="number" style={inputStyle} value={ranking} onChange={(e) => setRanking(e.target.value)} placeholder="Ej. 3.5" />
        </div>
      )}
      {mode === "invite" && hasPartner && (
        <p className="text-[11px] mt-1.5 flex items-center gap-1" style={{ color: "#6B7688" }}><Mail size={11} /> Le llegará una invitación a {inviteEmail} para crear su cuenta.</p>
      )}
    </div>
  );
}

function InscripcionTab({ categories, addTeam, suggestedRanking, role, currentUser, users, club, tournament }) {
  const isAdmin = role === "admin";

  // ---- Admin path: unchanged manual roster entry (free-text names), no payment step —
  // this mirrors what CategoriasTab's organizer roster editor already does. ----
  if (isAdmin) return <InscripcionAdminForm categories={categories} addTeam={addTeam} suggestedRanking={suggestedRanking} />;

  // ---- Player self-registration: only categories still open to the current user, no free-text
  // name for themselves, a searched/invited partner for doubles, and a real checkout step. ----
  const eligible = categories.filter((c) => {
    const drawStarted = c.matches && c.matches.length > 0;
    if (drawStarted) return false;
    const alreadyIn = [...c.teams, ...c.waitlist].some((t) => t.players.some((p) => p.userId === currentUser.id));
    return !alreadyIn;
  });

  const [catId, setCatId] = useState(eligible[0]?.id || null);
  const cat = eligible.find((c) => c.id === catId) || null;
  const [done, setDone] = useState(null);
  const [myRanking, setMyRanking] = useState(suggestedRanking(currentUser.name) || "");
  const [partner, setPartner] = useState(null);

  const isDoubles = cat && cat.modality !== "individual";
  const full = cat && cat.maxTeams && cat.teams.length >= cat.maxTeams;
  const canCheckout = cat && (!isDoubles || partner);
  const unitPrice = tournamentRegPrice(tournament);
  const totalPrice = unitPrice * (isDoubles ? 2 : 1);

  const selectCat = (id) => { setCatId(id); setDone(null); setPartner(null); };

  const confirm = (checkout) => {
    const players = [{ name: currentUser.name, ranking: Number(myRanking) || 0, userId: currentUser.id }];
    if (isDoubles) players.push(partner);
    addTeam(cat.id, players, { ...checkout, userId: currentUser.id });
    setDone(cat.name);
    setPartner(null);
  };

  if (categories.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Todavía no hay categorías abiertas para inscripción.</p></Card>;
  }

  return (
    <div className="mt-2 grid md:grid-cols-[280px_1fr] gap-5">
      <Card>
        <SectionTitle sub="Solo se muestran las categorías en las que todavía puedes inscribirte.">Categorías abiertas</SectionTitle>
        <div className="space-y-1.5">
          {eligible.map((c) => {
            const spotsLeft = c.maxTeams ? Math.max(0, c.maxTeams - c.teams.length) : null;
            return (
              <button key={c.id} onClick={() => selectCat(c.id)}
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm"
                style={{ background: catId === c.id ? "#EAF3E6" : "#EEF1F7", color: catId === c.id ? COLORS.courtDark : COLORS.ink, fontWeight: catId === c.id ? 700 : 500 }}>
                <div className="flex items-center justify-between">
                  <span className="truncate">{c.name}</span>
                  {spotsLeft === 0 ? <Hourglass size={13} color="#8A5A16" /> : <UserPlus size={13} className="opacity-50" />}
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "#6B7688" }}>
                  {c.teams.length}{c.maxTeams ? `/${c.maxTeams}` : ""} equipos{c.waitlist.length > 0 ? ` · ${c.waitlist.length} en espera` : ""}
                </p>
              </button>
            );
          })}
          {eligible.length === 0 && <p className="text-xs text-gray-400 italic px-1">No hay categorías disponibles para ti en este momento — ya estás inscrito en todas las abiertas, o su calendario ya fue generado.</p>}
        </div>
      </Card>

      {cat && (
        <Card>
          <SectionTitle sub="El cupo se confirma solo, sin que el organizador tenga que hacerlo por ti.">
            Inscribirme en {cat.name}
          </SectionTitle>

          {full && (
            <div className="text-xs px-3 py-2 rounded-lg mb-4 flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
              <Hourglass size={12} /> El cupo está lleno — te inscribirás en la lista de espera y subirás automáticamente si alguien se retira.
            </div>
          )}

          <div className="mb-4">
            <Label>{isDoubles ? "Jugador 1 (tú)" : "Jugador"}</Label>
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-2" style={{ background: "#EEF1F7" }}>
              <span className="text-sm font-semibold flex items-center gap-2">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: COLORS.court, color: "#fff" }}>{currentUser.name.charAt(0).toUpperCase()}</span>
                {currentUser.name}
              </span>
            </div>
            <input type="number" style={inputStyle} value={myRanking} onChange={(e) => setMyRanking(e.target.value)} placeholder="Tu nivel / ranking (opcional)" />
          </div>

          {isDoubles && (
            <div className="mb-4">
              <Label>Jugador 2 (tu pareja)</Label>
              <PartnerPicker users={users} excludeUserId={currentUser.id} suggestedRanking={suggestedRanking} onChange={setPartner} />
            </div>
          )}

          {canCheckout && (
            <CheckoutPanel title={`Inscripción a ${cat.name}${isDoubles ? " (dupla)" : ""}`} baseUsd={totalPrice} discountPct={0} club={club} defaultName={currentUser.name} requireName={false}
              onConfirm={confirm} confirmLabel={full ? "Unirme a la lista de espera" : "Confirmar inscripción"} />
          )}

          {done && (
            <div className="mt-4 text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>
              <CheckCircle2 size={13} /> ¡Listo! Tu cupo quedó registrado en {done}.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// Organizer-side manual roster entry — kept exactly as before (free-text names, no payment
// step) for adding walk-in players the admin is registering on someone's behalf.
function InscripcionAdminForm({ categories, addTeam, suggestedRanking }) {
  const [catId, setCatId] = useState(categories[0]?.id || null);
  const cat = categories.find((c) => c.id === catId) || null;
  const [done, setDone] = useState(false);

  const isDoubles = cat && cat.modality !== "individual";
  const [p1, setP1] = useState(""); const [r1, setR1] = useState("");
  const [p2, setP2] = useState(""); const [r2, setR2] = useState("");

  if (categories.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Todavía no hay categorías abiertas para inscripción.</p></Card>;
  }

  const full = cat && cat.maxTeams && cat.teams.length >= cat.maxTeams;

  const submit = () => {
    if (!cat || !p1.trim()) return;
    if (isDoubles && !p2.trim()) return;
    const r1Final = r1 !== "" ? r1 : suggestedRanking(p1);
    const players = [{ name: p1.trim(), ranking: r1Final || 0 }];
    if (isDoubles) {
      const r2Final = r2 !== "" ? r2 : suggestedRanking(p2);
      players.push({ name: p2.trim(), ranking: r2Final || 0 });
    }
    addTeam(cat.id, players);
    setP1(""); setR1(""); setP2(""); setR2("");
    setDone(true);
  };

  return (
    <div className="mt-2 grid md:grid-cols-[280px_1fr] gap-5">
      <Card>
        <SectionTitle sub="Elige la categoría en la que quieres registrar un equipo.">Categorías abiertas</SectionTitle>
        <div className="space-y-1.5">
          {categories.map((c) => {
            const spotsLeft = c.maxTeams ? Math.max(0, c.maxTeams - c.teams.length) : null;
            return (
              <button key={c.id} onClick={() => { setCatId(c.id); setDone(false); }}
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm"
                style={{ background: catId === c.id ? "#EAF3E6" : "#EEF1F7", color: catId === c.id ? COLORS.courtDark : COLORS.ink, fontWeight: catId === c.id ? 700 : 500 }}>
                <div className="flex items-center justify-between">
                  <span className="truncate">{c.name}</span>
                  {spotsLeft === 0 ? <Hourglass size={13} color="#8A5A16" /> : <UserPlus size={13} className="opacity-50" />}
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "#6B7688" }}>
                  {c.teams.length}{c.maxTeams ? `/${c.maxTeams}` : ""} equipos{c.waitlist.length > 0 ? ` · ${c.waitlist.length} en espera` : ""}
                </p>
              </button>
            );
          })}
        </div>
      </Card>

      {cat && (
        <Card>
          <SectionTitle sub="Registro manual de un equipo — por ejemplo, un jugador que se inscribe presencialmente.">
            Registrar equipo en {cat.name}
          </SectionTitle>

          {full && (
            <div className="text-xs px-3 py-2 rounded-lg mb-4 flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
              <Hourglass size={12} /> El cupo está lleno — se inscribirá en la lista de espera.
            </div>
          )}

          <div className={`grid gap-3 mb-4 ${isDoubles ? "sm:grid-cols-2" : ""}`}>
            <PlayerField label={isDoubles ? "Jugador 1" : "Jugador"} name={p1} setName={setP1} ranking={r1} setRanking={setR1} suggestedRanking={suggestedRanking} />
            {isDoubles && <PlayerField label="Jugador 2" name={p2} setName={setP2} ranking={r2} setRanking={setR2} suggestedRanking={suggestedRanking} />}
          </div>

          <button onClick={submit} style={{ background: COLORS.clay, color: "#fff" }} className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2">
            <UserPlus size={16} /> {full ? "Agregar a la lista de espera" : "Registrar equipo"}
          </button>

          {done && (
            <div className="mt-4 text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>
              <CheckCircle2 size={13} /> Equipo registrado en {cat.name}.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/* =========================================================================
   TAB: RESULTADOS
   ========================================================================= */
function ResultadosTab({ categories, courts, submitScore, closeGroupsAndSeedBracket }) {
  const [catId, setCatId] = useState(categories[0]?.id || null);
  const cat = categories.find((c) => c.id === catId) || categories[0] || null;

  if (!cat) return <Card className="mt-2"><p className="text-sm text-gray-400">Crea una categoría primero.</p></Card>;

  const courtById = {}; courts.forEach((c) => (courtById[c.id] = c));
  const teamName = (id) => cat.teams.find((t) => t.id === id)?.name || "?";
  const playableMatches = cat.matches.filter((m) => !isByeMatch(m));
  const isDouble = cat.format === "doble_eliminacion";
  const hasSingleBracket = cat.matches.some((m) => m.phase === "bracket");

  return (
    <div className="mt-2 space-y-5">
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button key={c.id} onClick={() => setCatId(c.id)} className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{ background: catId === c.id ? COLORS.court : "#EAEEF5", color: catId === c.id ? "#fff" : COLORS.ink }}>{c.name}</button>
        ))}
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
        <SectionTitle sub="Selecciona un partido y carga el marcador (se admite más de un set). Los BYE no se muestran porque no se juegan.">Cargar resultados</SectionTitle>
        <div className="space-y-3">
          {playableMatches.map((m) => (
            <MatchRow key={m.id} m={m} cat={cat} courtById={courtById} teamName={teamName} bestOf={cat.bestOf}
              onSubmit={(sets) => submitScore(cat.id, m.id, sets)} />
          ))}
          {playableMatches.length === 0 && <p className="text-xs text-gray-400 italic">Genera primero el draw de esta categoría.</p>}
        </div>
      </Card>
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

function MatchRow({ m, cat, courtById, teamName, bestOf, onSubmit }) {
  const [open, setOpen] = useState(false);
  const setsNeeded = Math.ceil(bestOf / 2);
  const [sets, setSets] = useState(m.sets.length ? m.sets : Array.from({ length: bestOf }, () => ({ a: "", b: "" })));

  const labelA = m.teamALabel || teamName(m.teamAId) || "Por definir";
  const labelB = m.teamBLabel || teamName(m.teamBId) || "Por definir";
  const playable = m.teamAId && m.teamBId;

  const save = () => {
    const cleaned = sets.filter((s) => s.a !== "" && s.b !== "");
    if (cleaned.length === 0) return;
    onSubmit(cleaned);
    setOpen(false);
  };

  return (
    <div className="rounded-xl p-3" style={{ background: m.winnerId ? "#EEF1F7" : "#FAFAF7", border: `1px solid ${COLORS.line}` }}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm">
          <span className={m.winnerId === m.teamAId ? "font-bold" : ""}>{labelA}</span>
          <span className="text-gray-400 mx-1.5">vs</span>
          <span className={m.winnerId === m.teamBId ? "font-bold" : ""}>{labelB}</span>
          {m.day && <span className="mono text-xs text-gray-400 ml-3">{formatDateHuman(m.day)} {formatTimeAmPm(m.time)} · {courtById[m.courtId]?.name}</span>}
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
  const canConfirm = (!requireName || userName.trim()) && (method === "efectivo" || (reference.trim() && proofName));

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    setProofName(f ? f.name : "");
  };

  const submit = () => {
    if (!canConfirm) return;
    onConfirm({ userName: userName.trim() || "Invitado", paymentMethod: method, reference: reference.trim(), proofName, priceUsd: discounted, priceBs: bs });
  };

  return (
    <div className="rounded-xl p-4 mt-3" style={{ background: "#EEF1F7", border: `1px solid ${COLORS.line}` }}>
      <p className="text-sm font-bold mb-3" style={{ color: COLORS.courtDark }}>{title}</p>

      <div className="rounded-lg p-3 mb-3" style={{ background: COLORS.courtDark }}>
        <span className="text-xs" style={{ color: "#A9C0DC" }}>{discountPct > 0 ? `Precio con ${discountPct}% de descuento por membresía` : "Total a pagar"}</span>
        <div className="flex items-baseline gap-3 mt-1 flex-wrap">
          <span className="disp text-2xl" style={{ color: COLORS.ball }}>{formatMoney(discounted)}</span>
          <span className="mono text-sm" style={{ color: "#D6E1F0" }}>≈ {formatMoney(bs, "Bs. ")}</span>
        </div>
        {discountPct > 0 && baseUsd > 0 && <p className="text-[10px] mt-1 line-through" style={{ color: "#55677E" }}>{formatMoney(baseUsd)} sin membresía</p>}
        <p className="text-[10px] mt-1.5" style={{ color: "#4E6180" }}>Bs calculado a {formatMoney(club.bsPerUsd, "Bs. ")}/USD (referencia EUR BCV)</p>
      </div>

      {requireName && (
        <div className="mb-3"><Label>Tu nombre</Label><input style={inputStyle} value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Nombre y apellido" /></div>
      )}

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

  const occupant = (cid, timeMin) => {
    if (!occupiedKeys.has(blockKey(cid, date, timeMin))) return null;
    for (const cat of categories) {
      const m = cat.matches.find((mm) => mm.courtId === cid && mm.day === date && !isByeMatch(mm) && timeToMinutes(mm.time) === timeMin);
      if (m) return { kind: "Torneo", label: cat.name };
    }
    const op = openPlays.find((e) => e.occupiedBlocks.some((b) => b.courtId === cid && b.date === date && b.timeMin === timeMin));
    if (op) return { kind: "Open Play", label: op.name };
    const cls = classes.find((e) => e.occupiedBlocks.some((b) => b.courtId === cid && b.date === date && b.timeMin === timeMin));
    if (cls) return { kind: "Clase", label: cls.academyName };
    return { kind: "Reservado", label: "" };
  };

  const availableCourtsAt = (timeMin) => courts.filter((c) => !occupant(c.id, timeMin));

  const lockedPrivate = court && court.isPrivate && !currentPlan?.privateCourtAccess;
  const isMember = !!currentPlan && currentPlan.monthlyPrice > 0;

  const shiftDate = (delta) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
    setSelectedTime(null);
    setCourtId(null);
  };

  const pickTime = (t) => {
    setSelectedTime(t);
    setCourtId(null);
  };

  const confirm = (checkout) => {
    createBooking({ courtId: court.id, date, timeMin: selectedTime, blockMinutes: club.blockMinutes, userId: currentUser.id, ...checkout });
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
            <input type="date" style={{ ...inputStyle, textAlign: "center", fontWeight: 700 }} value={date} onChange={(e) => { setDate(e.target.value); setSelectedTime(null); setCourtId(null); }} />
            <button onClick={() => shiftDate(1)} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EAEEF5" }}>
              <ChevronRight size={16} color={COLORS.courtDark} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {blocks.map((t) => {
            const available = availableCourtsAt(t);
            const occ = available.length === 0;
            const isSel = selectedTime === t;
            return (
              <button key={t} onClick={() => !occ && pickTime(t)} disabled={occ}
                title={occ ? "Ocupado — ninguna cancha disponible" : `${available.length} cancha${available.length === 1 ? "" : "s"} disponible${available.length === 1 ? "" : "s"}`}
                className="rounded-xl py-2.5 px-1.5 text-center transition-all"
                style={{
                  background: occ ? "#EDEEF2" : isSel ? COLORS.court : "#fff",
                  border: `1.5px solid ${occ ? "transparent" : isSel ? COLORS.court : COLORS.line}`,
                  cursor: occ ? "not-allowed" : "pointer",
                }}>
                <p className="mono text-sm font-bold" style={{ color: occ ? "#9AA6BC" : isSel ? "#fff" : COLORS.courtDark }}>{minutesToAmPm(t)}</p>
                <p className="text-[9px] mt-0.5 font-bold uppercase tracking-wide" style={{ color: occ ? "#9AA6BC" : isSel ? "#DCEBD5" : "#78829A" }}>
                  {occ ? "Ocupado" : `${available.length} cancha${available.length === 1 ? "" : "s"}`}
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

      {selectedTime !== null && (
        <Card>
          <SectionTitle sub="Toca una cancha para continuar.">Canchas disponibles · {minutesToAmPm(selectedTime)} ({formatDateHuman(date)})</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {availableCourtsAt(selectedTime).map((c) => {
              const { base, member } = courtPriceInfo(c, selectedTime);
              const shownPrice = isMember ? member : base;
              const isSel = courtId === c.id;
              return (
                <button key={c.id} onClick={() => setCourtId(c.id)}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1.5"
                  style={{ background: isSel ? COLORS.court : "#EAEEF5", color: isSel ? "#fff" : COLORS.ink }}>
                  {c.isPrivate && <Lock size={12} />} {c.name}
                  <span className="text-[10px] font-semibold opacity-80">{formatMoney(shownPrice)}</span>
                </button>
              );
            })}
          </div>
          {availableCourtsAt(selectedTime).length === 0 && <p className="text-xs text-gray-400 italic">No hay canchas disponibles para este horario.</p>}
        </Card>
      )}

      {selectedTime !== null && court && (
        <Card>
          <SectionTitle>Confirmar {court.name} · {minutesToAmPm(selectedTime)} ({formatDateHuman(date)})</SectionTitle>
          {lockedPrivate ? (
            <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
              <Lock size={13} /> Esta cancha es privada — necesitas una membresía con acceso a canchas privadas. Revisa la sección Membresías.
            </div>
          ) : (
            <CheckoutPanel title={`${club.blockMinutes} min en ${court.name}`} baseUsd={courtPriceInfo(court, selectedTime).base}
              discountPct={isMember ? memberDiscountPct(courtPriceInfo(court, selectedTime).base, courtPriceInfo(court, selectedTime).member) : 0}
              club={club} defaultName={currentUser.name}
              onConfirm={confirm} onCancel={() => setCourtId(null)} confirmLabel="Confirmar reserva" />
          )}
        </Card>
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

function OpenPlayForm({ courts, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [level, setLevel] = useState("Todos");
  const [price, setPrice] = useState(5);
  const [memberPrice, setMemberPrice] = useState(5);
  const [description, setDescription] = useState("");
  const [courtIds, setCourtIds] = useState([]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [capacity, setCapacity] = useState(8);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurUntil, setRecurUntil] = useState("");

  const handleImage = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(f);
  };

  const canSave = name.trim() && courtIds.length > 0 && date && startTime < endTime && Number(capacity) > 0
    && (!isRecurring || (recurUntil && recurUntil >= date));

  return (
    <Card className="mt-3">
      <h4 className="font-bold text-sm mb-4">Nuevo Open Play</h4>
      <div className="space-y-3">
        <div><Label>Nombre de la actividad</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jueves de DUPR" /></div>
        <div>
          <Label>Imagen (opcional)</Label>
          <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer" style={{ border: `1.5px dashed ${COLORS.line}`, color: image ? COLORS.court : "#6B7688" }}>
            <ImageIcon size={14} /> {image ? "Imagen cargada" : "Subir imagen"}
            <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nivel recomendado</Label>
            <select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="Todos">Todos</option>
              {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div><Label>Precio sin membresía (USD)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Precio con membresía (USD)</Label><input type="number" min={0} style={inputStyle} value={memberPrice} onChange={(e) => setMemberPrice(e.target.value)} /></div>
          <div><Label>Cupos (quorum máximo)</Label><input type="number" min={1} style={inputStyle} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        </div>
        <div><Label>Descripción</Label><textarea style={{ ...inputStyle, minHeight: 70 }} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><Label>Canchas a utilizar</Label><MultiCourtSelect courts={courts} value={courtIds} onChange={setCourtIds} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Fecha {isRecurring ? "del primer evento" : ""}</Label>
            <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
            {date && <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>{formatDateFull(date)}</p>}
          </div>
          <div><Label>Desde</Label><input type="time" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div><Label>Hasta</Label><input type="time" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        <p className="text-xs" style={{ color: "#6B7688" }}>Los bloques de horario de las canchas elegidas quedan reservados automáticamente para esta actividad — nadie más podrá reservarlos.</p>

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

        <div className="flex gap-2 pt-1">
          <button disabled={!canSave} onClick={() => onCreate({ name: name.trim(), image, level, price: Number(price) || 0, memberPrice: Number(memberPrice) || 0, capacity: Number(capacity) || 0, description, courtIds, date, startTime, endTime, recurrence: isRecurring ? { until: recurUntil } : null })}
            style={{ background: canSave ? COLORS.court : "#E5E5E5", color: canSave ? COLORS.chalk : "#999" }} className="flex-1 py-2 rounded-xl font-semibold text-sm">
            {isRecurring ? "Crear serie recurrente" : "Crear Open Play"}
          </button>
          <button onClick={onCancel} className="px-3 rounded-xl text-sm text-gray-400">Cancelar</button>
        </div>
      </div>
    </Card>
  );
}

function ClaseForm({ courts, onCreate, onCancel }) {
  const [academyName, setAcademyName] = useState("");
  const [level, setLevel] = useState("Todos");
  const [price, setPrice] = useState(15);
  const [memberPrice, setMemberPrice] = useState(15);
  const [courtIds, setCourtIds] = useState([]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("18:00");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurUntil, setRecurUntil] = useState("");

  const canSave = academyName.trim() && courtIds.length > 0 && date && startTime < endTime
    && (!isRecurring || (recurUntil && recurUntil >= date));

  return (
    <Card className="mt-3">
      <h4 className="font-bold text-sm mb-4">Nueva Clase</h4>
      <div className="space-y-3">
        <div><Label>Nombre de la Academia</Label><input style={inputStyle} value={academyName} onChange={(e) => setAcademyName(e.target.value)} placeholder="Academia PickleUp" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Nivel recomendado</Label>
            <select style={inputStyle} value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="Todos">Todos</option>
              {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div><Label>Precio sin membresía (USD)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>
        <div><Label>Precio con membresía (USD)</Label><input type="number" min={0} style={inputStyle} value={memberPrice} onChange={(e) => setMemberPrice(e.target.value)} /></div>
        <div><Label>Canchas a utilizar</Label><MultiCourtSelect courts={courts} value={courtIds} onChange={setCourtIds} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Fecha</Label>
            <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
            {date && <p className="text-[11px] mt-1" style={{ color: "#6B7688" }}>{formatDateFull(date)}</p>}
          </div>
          <div><Label>Desde</Label><input type="time" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div><Label>Hasta</Label><input type="time" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>

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

        <div className="flex gap-2 pt-1">
          <button disabled={!canSave} onClick={() => onCreate({ academyName: academyName.trim(), level, price: Number(price) || 0, memberPrice: Number(memberPrice) || 0, courtIds, date, startTime, endTime, recurrence: isRecurring ? { until: recurUntil } : null })}
            style={{ background: canSave ? COLORS.court : "#E5E5E5", color: canSave ? COLORS.chalk : "#999" }} className="flex-1 py-2 rounded-xl font-semibold text-sm">
            {isRecurring ? "Crear serie recurrente" : "Crear Clase"}
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
function EventListItem({ kind, title, description, date, startTime, endTime, price, image, recurring, meta, onClick }) {
  const kindMeta = {
    open_play: { label: "Open Play", color: COLORS.court },
    torneo: { label: "Torneo", color: COLORS.clay },
    clase: { label: "Clase", color: COLORS.courtDark },
  }[kind];

  return (
    <button onClick={onClick} className="w-full text-left rounded-2xl p-3 flex gap-3"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, boxShadow: "0 1px 2px rgba(20,30,25,.04), 0 10px 24px -18px rgba(20,30,25,.22)" }}>
      <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden shrink-0"
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

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ background: `${kindMeta.color}1A`, color: kindMeta.color }}>{kindMeta.label}</span>
            <p className="disp text-[15px] leading-tight mt-1 truncate" style={{ color: COLORS.courtDark }}>{title}</p>
          </div>
          <span className="mono text-sm font-extrabold shrink-0" style={{ color: COLORS.court }}>{price}</span>
        </div>
        {description && <p className="text-xs mt-1 line-clamp-2" style={{ color: "#6B7688" }}>{description}</p>}
        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px]" style={{ color: "#6B7688" }}>
          <span className="flex items-center gap-1"><Calendar size={11} /> {date ? formatDateHuman(date) : "Por definir"}</span>
          {startTime && <span className="flex items-center gap-1"><Clock size={11} /> {formatTimeAmPm(startTime)}{endTime ? `–${formatTimeAmPm(endTime)}` : ""}</span>}
        </div>
        <div className="flex items-center justify-between gap-2 mt-auto pt-2">
          {meta && <span className="text-[11px] font-bold" style={{ color: meta.full ? COLORS.clay : COLORS.court }}>{meta.text}</span>}
          <span className="text-[11px] font-bold px-3 py-1 rounded-full shrink-0 ml-auto" style={{ background: COLORS.ball, color: "#fff" }}>Ver más</span>
        </div>
      </div>
    </button>
  );
}

// `occurrences` is every future/today entry that shares e's recurringGroupId (or just [e]
// for a one-off event). When there's more than one, the panel lists each date so the member
// picks which session to check out for, instead of forcing a single date on a recurring series.
function EventDetail({ e, occurrences, courts, club, currentPlan, currentUser, onRegister, onRemove, onRemoveSeries, onClose }) {
  const courtNames = e.courtIds.map((id) => courts.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
  const isSeries = occurrences.length > 1;
  const isMember = !!currentPlan && currentPlan.monthlyPrice > 0;
  const [checkoutId, setCheckoutId] = useState(isSeries ? null : e.id);
  const checkoutTarget = occurrences.find((o) => o.id === checkoutId);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="disp text-lg" style={{ color: COLORS.courtDark }}>{e.name}</p>
          <p className="text-xs mt-1" style={{ color: "#6B7688" }}>
            Nivel {e.level} · {formatTimeAmPm(e.startTime)}–{formatTimeAmPm(e.endTime)} · {courtNames}
            {isSeries ? (
              <> · <span style={{ color: COLORS.court, fontWeight: 700 }}>Recurrente, cada {weekdayLabel(e.date)}</span></>
            ) : (
              <> · {formatDateHuman(e.date)}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isSeries && onRemoveSeries && <button onClick={onRemoveSeries} title="Eliminar toda la serie" className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>}
          {!isSeries && onRemove && <button onClick={() => onRemove(e.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>}
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600"><X size={18} /></button>
        </div>
      </div>
      {e.description && <p className="text-sm mb-3" style={{ color: "#3D4A5C" }}>{e.description}</p>}

      {isSeries ? (
        <div className="space-y-1.5 mb-4">
          <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: "#6B7688" }}>Próximas fechas — elige una para inscribirte</p>
          {occurrences.map((o) => {
            const slotsLeft = e.capacity ? Math.max(0, e.capacity - o.registrations.length) : null;
            const isFull = slotsLeft === 0;
            return (
              <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: checkoutId === o.id ? "#DCEBD5" : "#EEF1F7" }}>
                <span>{formatDateHuman(o.date)} <span className="text-gray-500 text-xs">
                  · {slotsLeft !== null ? (isFull ? "Cupo lleno" : `${slotsLeft} cupo${slotsLeft === 1 ? "" : "s"} disponible${slotsLeft === 1 ? "" : "s"}`) : `${o.registrations.length} inscrito(s)`}
                </span></span>
                <div className="flex items-center gap-2">
                  {onRemove && <button onClick={() => onRemove(o.id)} title="Eliminar esta fecha" className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>}
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
      ) : (
        <p className="text-xs mb-4" style={{ color: "#6B7688" }}>
          {e.capacity
            ? (e.registrations.length >= e.capacity ? "Cupo lleno" : `${Math.max(0, e.capacity - e.registrations.length)} cupo${(e.capacity - e.registrations.length) === 1 ? "" : "s"} disponible${(e.capacity - e.registrations.length) === 1 ? "" : "s"} de ${e.capacity}`)
            : `${e.registrations.length} inscrito(s)`}
        </p>
      )}

      {checkoutTarget && (
        (checkoutTarget.capacity && checkoutTarget.registrations.length >= checkoutTarget.capacity) ? (
          <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
            <AlertTriangle size={13} /> Este cupo está lleno — ya se alcanzó el quorum máximo.
          </div>
        ) : (
          <CheckoutPanel title={`Inscripción a ${e.name}${isSeries ? ` · ${formatDateHuman(checkoutTarget.date)}` : ""}`} baseUsd={e.price} discountPct={isMember ? memberDiscountPct(e.price, e.memberPrice) : 0} club={club} defaultName={currentUser.name}
            onConfirm={(checkout) => onRegister(checkoutTarget.id, { ...checkout, userId: currentUser.id })} onCancel={onClose} confirmLabel="Confirmar inscripción" />
        )
      )}
    </Card>
  );
}

function ClassDetail({ e, occurrences, courts, club, currentPlan, currentUser, onRegister, onRemove, onRemoveSeries, onClose }) {
  const courtNames = e.courtIds.map((id) => courts.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
  const isSeries = occurrences.length > 1;
  const isMember = !!currentPlan && currentPlan.monthlyPrice > 0;
  const [checkoutId, setCheckoutId] = useState(isSeries ? null : e.id);
  const checkoutTarget = occurrences.find((o) => o.id === checkoutId);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="disp text-lg" style={{ color: COLORS.courtDark }}>{e.academyName}</p>
          <p className="text-xs mt-1" style={{ color: "#6B7688" }}>
            Nivel {e.level} · {formatTimeAmPm(e.startTime)}–{formatTimeAmPm(e.endTime)} · {courtNames}
            {isSeries ? (
              <> · <span style={{ color: COLORS.court, fontWeight: 700 }}>Recurrente, cada {weekdayLabel(e.date)}</span></>
            ) : (
              <> · {formatDateHuman(e.date)}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isSeries && onRemoveSeries && <button onClick={onRemoveSeries} title="Eliminar toda la serie" className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>}
          {!isSeries && onRemove && <button onClick={() => onRemove(e.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>}
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600"><X size={18} /></button>
        </div>
      </div>

      {isSeries ? (
        <div className="space-y-1.5 mb-4">
          <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: "#6B7688" }}>Próximas fechas — elige una para inscribirte</p>
          {occurrences.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: checkoutId === o.id ? "#DCEBD5" : "#EEF1F7" }}>
              <span>{formatDateHuman(o.date)} <span className="text-gray-500 text-xs">· {o.registrations.length} inscrito(s)</span></span>
              <div className="flex items-center gap-2">
                {onRemove && <button onClick={() => onRemove(o.id)} title="Eliminar esta fecha" className="text-gray-300 hover:text-red-500"><Trash2 size={13} /></button>}
                <button onClick={() => setCheckoutId(o.id)} className="text-xs font-bold px-2.5 py-1 rounded-lg"
                  style={{ background: checkoutId === o.id ? COLORS.court : "#fff", color: checkoutId === o.id ? "#fff" : COLORS.court, border: `1.5px solid ${COLORS.court}` }}>
                  {checkoutId === o.id ? "Seleccionada" : "Elegir"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs mb-4" style={{ color: "#6B7688" }}>{e.registrations.length} inscrito(s)</p>
      )}

      {checkoutTarget && (
        <CheckoutPanel title={`Cupo en clase con ${e.academyName}${isSeries ? ` · ${formatDateHuman(checkoutTarget.date)}` : ""}`} baseUsd={e.price} discountPct={isMember ? memberDiscountPct(e.price, e.memberPrice) : 0} club={club} defaultName={currentUser.name}
          onConfirm={(checkout) => onRegister(checkoutTarget.id, { ...checkout, userId: currentUser.id })} onCancel={onClose} confirmLabel="Confirmar cupo" />
      )}
    </Card>
  );
}

const EVENT_FILTER_CHIPS = [
  { value: "all", label: "Disponibles ahora" },
  { value: "open_play", label: "Open Plays" },
  { value: "clase", label: "Clases" },
  { value: "torneo", label: "Torneos" },
];

function EventosTab({ club, courts, openPlays, classes, addOpenPlay, addClass, removeOpenPlay, removeClass, removeOpenPlaySeries, removeClassSeries, registerForOpenPlay, registerForClass, currentUser, currentPlan, tournament, categories, setTab, role }) {
  const [showOpenPlayForm, setShowOpenPlayForm] = useState(false);
  const [showClaseForm, setShowClaseForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [filterKind, setFilterKind] = useState("all");
  const isAdmin = role === "admin";
  const hasTournamentActivity = categories.some((c) => c.teams.length > 0);
  const todayIso = new Date().toISOString().slice(0, 10);

  const noEvents = openPlays.length === 0 && classes.length === 0 && !hasTournamentActivity;

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
        key: `op-${key}`, kind: "open_play", title: rep.name,
        description: rep.description || `Nivel ${rep.level}`,
        date: rep.date, startTime: rep.startTime, endTime: rep.endTime,
        price: rep.price > 0 ? formatMoney(rep.price) : "Gratis", image: rep.image, recurring: isSeries,
        meta: slotsLeft !== null
          ? { text: slotsLeft > 0 ? `${slotsLeft} cupo${slotsLeft === 1 ? "" : "s"} disponible${slotsLeft === 1 ? "" : "s"}` : "Cupo lleno", full: slotsLeft === 0 }
          : { text: `${rep.registrations.length} inscrito(s)` },
        onClick: () => setSelected({ kind: "open_play", key }),
      });
    });
    classSeries.forEach((list) => {
      const key = list[0].recurringGroupId || list[0].id;
      const rep = list.find((c) => c.date >= todayIso) || list[list.length - 1];
      const isSeries = list.length > 1;
      items.push({
        key: `cl-${key}`, kind: "clase", title: rep.academyName, description: `Nivel ${rep.level}`,
        date: rep.date, startTime: rep.startTime, endTime: rep.endTime,
        price: rep.price > 0 ? formatMoney(rep.price) : "Gratis", image: null, recurring: isSeries,
        meta: { text: `${rep.registrations.length} inscrito(s)` },
        onClick: () => setSelected({ kind: "clase", key }),
      });
    });
    items.push({
      key: "torneo", kind: "torneo", title: tournament.name || "Torneo del club",
      description: hasTournamentActivity ? `${categories.length} categoría(s) abiertas.` : "Configúralo en la pestaña Torneos.",
      date: tournament.startDate, startTime: tournament.dailyStart, endTime: tournament.dailyEnd,
      price: "Ver detalles", image: null, recurring: false,
      meta: { text: hasTournamentActivity ? `${categories.reduce((s, c) => s + c.teams.length, 0)} equipos inscritos` : "Sin categorías aún" },
      onClick: () => setTab("torneos"),
    });
    return items;
  }, [openPlaySeries, classSeries, tournament, categories, hasTournamentActivity, todayIso]);

  const filteredItems = listItems.filter((it) => {
    if (filterKind !== "all" && it.kind !== filterKind) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return it.title.toLowerCase().includes(q) || (it.description || "").toLowerCase().includes(q);
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
          </div>
        )}
      </div>

      {isAdmin && showOpenPlayForm && <div className="mb-5"><OpenPlayForm courts={courts} onCreate={(d) => { addOpenPlay(d); setShowOpenPlayForm(false); }} onCancel={() => setShowOpenPlayForm(false)} /></div>}
      {isAdmin && showClaseForm && <div className="mb-5"><ClaseForm courts={courts} onCreate={(d) => { addClass(d); setShowClaseForm(false); }} onCancel={() => setShowClaseForm(false)} /></div>}

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
            <EventListItem key={it.key} kind={it.kind} title={it.title} description={it.description}
              date={it.date} startTime={it.startTime} endTime={it.endTime} price={it.price} image={it.image}
              recurring={it.recurring} meta={it.meta} onClick={it.onClick} />
          ))}
        </div>

        {noEvents && <p className="text-xs text-gray-400 italic">Aún no hay Open Plays ni clases programadas.</p>}
        {!noEvents && filteredItems.length === 0 && <p className="text-xs text-gray-400 italic">Ninguna actividad coincide con la búsqueda o el filtro.</p>}
      </div>

      {selected?.kind === "open_play" && (() => {
        const list = seriesForKey(selected.key);
        if (!list) return null;
        const occurrences = list.filter((o) => o.date >= todayIso);
        const e = occurrences[0] || list[list.length - 1];
        return (
          <EventDetail e={e} occurrences={occurrences.length ? occurrences : [e]} courts={courts} club={club} currentPlan={currentPlan} currentUser={currentUser}
            onRegister={(occurrenceId, checkout) => { registerForOpenPlay(occurrenceId, checkout); setSelected(null); }}
            onRemove={isAdmin ? (occurrenceId) => { removeOpenPlay(occurrenceId); setSelected(null); } : null}
            onRemoveSeries={isAdmin && e.recurringGroupId ? () => { removeOpenPlaySeries(e.recurringGroupId); setSelected(null); } : null}
            onClose={() => setSelected(null)} />
        );
      })()}

      {selected?.kind === "clase" && (() => {
        const list = classSeriesForKey(selected.key);
        if (!list) return null;
        const occurrences = list.filter((c) => c.date >= todayIso);
        const e = occurrences[0] || list[list.length - 1];
        return (
          <ClassDetail e={e} occurrences={occurrences.length ? occurrences : [e]} courts={courts} club={club} currentPlan={currentPlan} currentUser={currentUser}
            onRegister={(occurrenceId, checkout) => { registerForClass(occurrenceId, checkout); setSelected(null); }}
            onRemove={isAdmin ? (occurrenceId) => { removeClass(occurrenceId); setSelected(null); } : null}
            onRemoveSeries={isAdmin && e.recurringGroupId ? () => { removeClassSeries(e.recurringGroupId); setSelected(null); } : null}
            onClose={() => setSelected(null)} />
        );
      })()}
    </div>
  );
}

/* =========================================================================
   TAB: MEMBRESÍAS
   ========================================================================= */
// Used both to create a new plan and to edit an existing one (pass `initial`).
// The rate card is a free-form list of priced line items (court booking, Open Plays,
// league days, monthly classes, drills…) shown in the comparison table below — it's
// the plan's advertised rate sheet, independent of what's actually bookable yet.
function MembershipPlanForm({ initial, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [monthlyPrice, setMonthlyPrice] = useState(initial?.monthlyPrice ?? 30);
  const [privateCourtAccess, setPrivateCourtAccess] = useState(initial?.privateCourtAccess ?? true);
  const [description, setDescription] = useState(initial?.description || "");
  const [rateCard, setRateCard] = useState(initial?.rateCard || []);
  const [rateLabel, setRateLabel] = useState("");
  const [ratePrice, setRatePrice] = useState(0);

  const addRate = () => {
    if (!rateLabel.trim()) return;
    setRateCard((rc) => [...rc, { id: uid("rate"), label: rateLabel.trim(), price: Number(ratePrice) || 0 }]);
    setRateLabel(""); setRatePrice(0);
  };
  const removeRate = (id) => setRateCard((rc) => rc.filter((r) => r.id !== id));

  return (
    <Card>
      <h4 className="font-bold text-sm mb-4">{initial ? `Editar ${initial.name}` : "Nuevo plan de membresía"}</h4>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>Nombre</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Precio mensual (USD)</Label><input type="number" min={0} style={inputStyle} value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} /></div>
      </div>
      <div className="mt-3">
        <Label>Acceso a canchas privadas</Label>
        <Segmented value={privateCourtAccess ? "si" : "no"} onChange={(v) => setPrivateCourtAccess(v === "si")} options={[{ value: "si", label: "Sí" }, { value: "no", label: "No" }]} />
      </div>
      <div className="mt-3"><Label>Descripción</Label><textarea style={{ ...inputStyle, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></div>

      <div className="mt-4">
        <Label>Tarifario (se muestra en la tabla comparativa)</Label>
        <div className="space-y-1.5 mb-2">
          {rateCard.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs" style={{ background: "#EEF1F7" }}>
              <span>{r.label}</span>
              <div className="flex items-center gap-2">
                <span className="mono font-bold">{r.price > 0 ? formatMoney(r.price) : "Gratis"}</span>
                <button onClick={() => removeRate(r.id)} className="text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[2fr_1fr_auto] gap-2 items-end">
          <div><Label>Concepto</Label><input style={inputStyle} value={rateLabel} onChange={(e) => setRateLabel(e.target.value)} placeholder="Reserva de cancha (1h30min)" /></div>
          <div><Label>Precio (USD)</Label><input type="number" min={0} style={inputStyle} value={ratePrice} onChange={(e) => setRatePrice(e.target.value)} /></div>
          <button onClick={addRate} disabled={!rateLabel.trim()} className="px-3 py-2.5 rounded-xl text-xs font-bold h-[38px]" style={{ background: rateLabel.trim() ? COLORS.court : "#E5E5E5", color: rateLabel.trim() ? "#fff" : "#999" }}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex gap-2 pt-4">
        <button disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), monthlyPrice: Number(monthlyPrice) || 0, privateCourtAccess, description, rateCard })}
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

function MembresiasTab({ membershipPlans, club, courts, addMembershipPlan, updateMembershipPlan, removeMembershipPlan, subscribeToPlan, currentUser, role }) {
  const [showForm, setShowForm] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [checkoutPlanId, setCheckoutPlanId] = useState(null);
  const isAdmin = role === "admin";

  const paidPlans = [...membershipPlans].filter((p) => p.monthlyPrice > 0).sort((a, b) => b.monthlyPrice - a.monthlyPrice);
  const freePlans = membershipPlans.filter((p) => p.monthlyPrice === 0);
  const orderedPlans = [...paidPlans, ...freePlans];

  // Union every distinct rate-card label across plans, in first-seen order, so the
  // comparison table stays correct even if plans don't share the exact same line items.
  const rateLabels = useMemo(() => {
    const seen = [];
    orderedPlans.forEach((p) => (p.rateCard || []).forEach((r) => { if (!seen.includes(r.label)) seen.push(r.label); }));
    return seen;
  }, [orderedPlans]);

  const badgeFor = (idx) => {
    if (idx === 0 && paidPlans.length > 0) return { label: "MEJOR VALOR", color: COLORS.ball, text: COLORS.courtDark };
    if (idx === 1 && paidPlans.length > 1) return { label: "MÁS POPULAR", color: "#F2B84B", text: COLORS.courtDark };
    return null;
  };

  const selectedPlan = orderedPlans.find((p) => p.id === checkoutPlanId);
  const editingPlan = orderedPlans.find((p) => p.id === editingPlanId);

  return (
    <div className="mt-2 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionTitle sub="Compara beneficios y suscríbete a la membresía que más te convenga.">Planes y membresías</SectionTitle>
        {isAdmin && <button onClick={() => { setShowForm((s) => !s); setEditingPlanId(null); }} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.courtDark, color: "#fff" }}><Plus size={14} /> Nuevo plan</button>}
      </div>

      {isAdmin && showForm && <MembershipPlanForm onSave={(p) => { addMembershipPlan(p); setShowForm(false); }} onCancel={() => setShowForm(false)} />}
      {isAdmin && editingPlan && (
        <MembershipPlanForm initial={editingPlan}
          onSave={(p) => { updateMembershipPlan(editingPlan.id, p); setEditingPlanId(null); }}
          onCancel={() => setEditingPlanId(null)} />
      )}

      <div className="rounded-[24px] overflow-hidden" style={{ background: COLORS.courtDark }}>
        <div className="px-5 md:px-7 pt-7 pb-5 flex items-start justify-between flex-wrap gap-3">
          <h2 className="disp text-2xl md:text-[28px] leading-tight" style={{ color: COLORS.chalk }}>
            Elige tu <span style={{ color: COLORS.ball }}>membresía</span>
          </h2>
          <p className="text-xs text-right max-w-[220px]" style={{ color: "#A9C0DC" }}>
            ¿Juegas al menos una vez por semana?<br />Una membresía se paga sola.
          </p>
        </div>

        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full border-collapse" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th className="text-left align-bottom px-4 pb-4" style={{ width: 170 }}>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: "#4E6180" }}>Beneficio</span>
                </th>
                {orderedPlans.map((plan, idx) => {
                  const badge = badgeFor(idx);
                  const isCurrent = currentUser.planId === plan.id;
                  return (
                    <th key={plan.id} className="align-bottom px-2 pb-0 text-center" style={{ minWidth: 128 }}>
                      <div className="rounded-t-2xl pt-3.5 pb-4 px-2"
                        style={{ background: idx === 0 ? "rgba(255,106,26,0.12)" : idx === 1 ? "rgba(242,184,75,0.08)" : "transparent" }}>
                        <div className="h-[20px] flex items-center justify-center mb-1.5">
                          {badge && <span className="inline-block text-[9px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: badge.color, color: badge.text }}>{badge.label}</span>}
                        </div>
                        <p className="text-[13px] font-extrabold uppercase tracking-wide leading-tight" style={{ color: idx === 0 ? COLORS.ball : idx === 1 ? "#F2B84B" : COLORS.chalk }}>{plan.name}</p>
                        {!isAdmin && (
                          <button onClick={() => setCheckoutPlanId((id) => (id === plan.id ? null : plan.id))} disabled={isCurrent}
                            className="w-full mt-3 py-2 rounded-lg text-[11px] font-extrabold"
                            style={{ background: isCurrent ? "rgba(255,255,255,0.08)" : badge ? badge.color : "rgba(255,255,255,0.12)", color: isCurrent ? "#6B7688" : badge ? badge.text : "#fff" }}>
                            {isCurrent ? "Tu plan" : plan.monthlyPrice > 0 ? "Suscribirme" : "Elegir"}
                          </button>
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
              {rateLabels.map((lbl) => (
                <ComparisonRow key={lbl} label={lbl} plans={orderedPlans}
                  render={(p) => {
                    const item = (p.rateCard || []).find((r) => r.label === lbl);
                    if (!item) return "—";
                    return item.price > 0 ? formatMoney(item.price) : "Gratis";
                  }} />
              ))}
              <ComparisonRow label="Canchas privadas" plans={orderedPlans} render={(p) => p.privateCourtAccess} isBool />
            </tbody>
          </table>
        </div>
      </div>

      {selectedPlan && (
        <Card>
          <CheckoutPanel title={`Suscripción a ${selectedPlan.name}`} baseUsd={selectedPlan.monthlyPrice} discountPct={0} club={club} defaultName={currentUser.name}
            onConfirm={(checkout) => { subscribeToPlan(selectedPlan.id, checkout); setCheckoutPlanId(null); }} onCancel={() => setCheckoutPlanId(null)} confirmLabel="Confirmar suscripción" />
        </Card>
      )}
    </div>
  );
}

