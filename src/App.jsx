import React, { useState, useMemo, useEffect } from "react";
import {
  Trophy, Users, MapPin, Calendar, ClipboardList, Plus, Trash2,
  ChevronRight, ChevronDown, Shuffle, ArrowUpDown, CheckCircle2,
  Clock, AlertTriangle, Swords, ListOrdered, Settings2, X,
  UserPlus, Pencil, Medal, Hourglass, DollarSign,
  CalendarClock, PartyPopper, Award, Lock, Unlock,
  Image as ImageIcon, Smartphone, Banknote, Upload, Star, Building2,
  GraduationCap, Sparkles, Check, ArrowRight, LogOut, Shield, Mail, KeyRound, BarChart3, MapPinned, ChevronLeft, Repeat
} from "lucide-react";

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
  team.players.reduce((s, p) => s + (Number(p.ranking) || 0), 0);

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
const APP_VERSION = "1.0.0";

/* =========================================================================
   DESIGN TOKENS
   ========================================================================= */
const COLORS = {
  court: "#123B32",        // deep refined pine green — primary
  courtDark: "#0A1F1A",    // near-black pine — sidebar / dark surfaces
  chalk: "#F7F5EF",        // warm ivory paper — canvas + light text on dark
  ink: "#16241F",          // near-black body text
  ball: "#D4F24B",         // citrus lime — signature accent
  ballDark: "#9CC22A",
  clay: "#DB5A34",         // clay-court terracotta — secondary CTA / alerts
  line: "#E9E5D9",         // warm hairline border
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

  // ---- Club-wide schedule & courts (shared by Reservas, Eventos and Torneos) ----
  const [club, setClub] = useState({
    name: "Club Pickleball Central",
    openTime: "07:00", closeTime: "22:00", blockMinutes: 60,
    bsPerUsd: 180, // equivalente Bs por USD, anclado a la tasa EUR publicada por el BCV (ver syncBcvRate)
    pagoMovil: { banco: "Banesco", telefono: "0414-1234567", cedula: "V-12345678" },
  });
  // Estado de la sincronización con la API del BCV.
  const [rateStatus, setRateStatus] = useState({ loading: false, error: null, lastSync: null, source: "manual", effectiveDate: null });

  const syncBcvRate = async () => {
    setRateStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch("https://bcv.today/api/v1/rate.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.EUR) throw new Error("La respuesta no trajo tasa EUR");
      setClub((c) => ({ ...c, bsPerUsd: Number(data.EUR) }));
      setRateStatus({ loading: false, error: null, lastSync: Date.now(), source: "bcv_eur", effectiveDate: data.effective_date });
    } catch (err) {
      setRateStatus((s) => ({
        ...s, loading: false,
        error: `No se pudo conectar con la API del BCV (${err.message || "error de red"}). La tasa se mantiene editable manualmente.`,
      }));
    }
  };

  // Sincroniza al abrir la app y luego cada 30 minutos, mientras la pestaña siga abierta.
  useEffect(() => {
    syncBcvRate();
    const interval = setInterval(syncBcvRate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const [courts, setCourts] = useState([
    { id: uid("court"), name: "Cancha 1", isPrivate: false, pricePerBlock: 8 },
    { id: uid("court"), name: "Cancha 2", isPrivate: false, pricePerBlock: 8 },
  ]);

  // ---- Reservas (individual court bookings) ----
  const [bookings, setBookings] = useState([]);

  // ---- Eventos: Open Plays y Clases (Torneos ya tiene su propio estado más abajo) ----
  const [openPlays, setOpenPlays] = useState([]);
  const [classes, setClasses] = useState([]);

  // ---- Membresías ----
  const [membershipPlans, setMembershipPlans] = useState([
    { id: uid("plan"), name: "Sin membresía", monthlyPrice: 0, courtDiscountPct: 0, eventDiscountPct: 0, privateCourtAccess: false, description: "Precio regular en reservas y eventos, sin acceso a canchas privadas." },
    { id: uid("plan"), name: "Club Silver", monthlyPrice: 25, courtDiscountPct: 15, eventDiscountPct: 10, privateCourtAccess: true, description: "Acceso a canchas privadas y descuentos en reservas y eventos." },
    { id: uid("plan"), name: "Club Gold", monthlyPrice: 45, courtDiscountPct: 30, eventDiscountPct: 25, privateCourtAccess: true, description: "El mayor descuento, prioridad de reserva y acceso total a canchas privadas." },
  ]);
  const [subscriptions, setSubscriptions] = useState([]);

  // ---- Cuentas (login / registro) ----
  // No hay backend real: los usuarios viven en memoria durante la sesión del navegador.
  // Se incluye una cuenta admin de muestra para poder probar ambas vistas de inmediato.
  const [users, setUsers] = useState([
    { id: uid("user"), name: "Administrador del Club", email: "admin@club.com", password: "admin123", role: "admin", planId: null, zone: "", createdAt: Date.now() },
  ]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const currentUser = users.find((u) => u.id === currentUserId) || null;

  const registerUser = ({ name, email, password, zone }) => {
    if (!name.trim() || !email.trim() || !password) return { error: "Completa todos los campos." };
    if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
      return { error: "Ya existe una cuenta con ese correo." };
    }
    const user = { id: uid("user"), name: name.trim(), email: email.trim(), password, role: "cliente", planId: null, zone: (zone || "").trim(), createdAt: Date.now() };
    setUsers((p) => [...p, user]);
    setCurrentUserId(user.id);
    setTab("reservas");
    return { user };
  };
  const loginUser = (email, password) => {
    const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.password === password);
    if (!user) return { error: "Correo o contraseña incorrectos." };
    setCurrentUserId(user.id);
    setTab(user.role === "admin" ? "club" : "reservas");
    return { user };
  };
  const logoutUser = () => setCurrentUserId(null);

  const [tournament, setTournament] = useState({
    name: "Copa Verano Pickleball",
    startDate: "", endDate: "", dailyStart: "08:00", dailyEnd: "20:00",
    presaleStart: "", presaleEnd: "", presalePrice: "",
    regStart: "", regEnd: "",
  });
  const [matchDuration, setMatchDuration] = useState(35);
  const [breakM, setBreakM] = useState(10);
  const [categories, setCategories] = useState([]);
  const [activeCatId, setActiveCatId] = useState(null);
  const [scheduleInfo, setScheduleInfo] = useState(null);
  // App-wide player ranking directory: { "nombre en minúsculas": { name, ranking } }
  // In a real deployment this would be the players' historical ranking across
  // all tournaments in the platform; here it's simulated for the current session.
  const [playerDirectory, setPlayerDirectory] = useState({});

  const activeCat = categories.find((c) => c.id === activeCatId) || null;
  const currentPlan = membershipPlans.find((p) => p.id === currentUser?.planId) || membershipPlans[0];

  const dates = useMemo(() => dateRange(tournament.startDate, tournament.endDate), [tournament.startDate, tournament.endDate]);

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

  const updateCategory = (id, updater) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? updater({ ...c }) : c)));
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
    setPlayerDirectory((prev) => {
      if (prev[key] && !force) return prev; // never silently overwrite an existing ranking
      return { ...prev, [key]: { name: name.trim(), ranking: Number(ranking) || 0 } };
    });
  };

  const addCategory = (modality, gender, level, maxTeams) => {
    const cat = {
      id: uid("cat"), name: makeCategoryName(modality, gender, level), format: null,
      modality, gender, level, maxTeams: maxTeams ? Number(maxTeams) : null,
      seedMode: "ranking", bestOf: 3, bracketSize: 4,
      teams: [], waitlist: [], groups: [], matches: [], drawGenerated: false, groupsClosed: false,
    };
    setCategories((p) => [...p, cat]);
    setActiveCatId(cat.id);
    setTab("categorias");
  };

  const removeCategory = (id) => {
    setCategories((p) => p.filter((c) => c.id !== id));
    if (activeCatId === id) setActiveCatId(null);
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
  const addTeam = (catId, players) => {
    const name = players.map((p) => p.name).join(" / ");
    players.forEach((p) => upsertPlayerRanking(p.name, p.ranking, true));
    updateCategory(catId, (c) => {
      const team = { id: uid("team"), name, players };
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
  const createBooking = (data) => {
    const booking = { id: uid("book"), status: data.paymentMethod === "movil" ? "pendiente_verificacion" : "pendiente_efectivo", createdAt: Date.now(), ...data };
    setBookings((p) => [...p, booking]);
    return booking;
  };
  const cancelBooking = (id) => setBookings((p) => p.map((b) => (b.id === id ? { ...b, status: "cancelada" } : b)));
  const confirmBooking = (id) => setBookings((p) => p.map((b) => (b.id === id ? { ...b, status: "confirmada" } : b)));

  // ---- Eventos: Open Plays y Clases ----
  const computeOccupiedBlocks = (courtIds, date, startTime, endTime) => {
    const blocks = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes)
      .filter((t) => t >= timeToMinutes(startTime) && t < timeToMinutes(endTime));
    const out = [];
    courtIds.forEach((courtId) => blocks.forEach((timeMin) => out.push({ courtId, date, timeMin })));
    return out;
  };
  // A recurring Open Play (e.g. "Jueves de DUPR, todos los jueves a las 6pm") is stored as one
  // independent entry per weekly occurrence — each keeps its own date, court blocks and
  // registrations — linked by a shared recurringGroupId so the UI can group/bulk-delete them.
  const addOpenPlay = ({ recurrence, ...data }) => {
    if (recurrence?.until && recurrence.until >= data.date) {
      const seriesId = uid("series");
      const occurrenceDates = [];
      let d = new Date(data.date + "T00:00:00");
      const until = new Date(recurrence.until + "T00:00:00");
      while (d <= until) {
        occurrenceDates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 7);
      }
      const entries = occurrenceDates.map((dt) => ({
        id: uid("op"), type: "open_play", registrations: [], recurringGroupId: seriesId,
        ...data, date: dt, occupiedBlocks: computeOccupiedBlocks(data.courtIds, dt, data.startTime, data.endTime),
      }));
      setOpenPlays((p) => [...p, ...entries]);
      return;
    }
    const occupiedBlocks = computeOccupiedBlocks(data.courtIds, data.date, data.startTime, data.endTime);
    setOpenPlays((p) => [...p, { id: uid("op"), type: "open_play", registrations: [], occupiedBlocks, ...data }]);
  };
  const addClass = (data) => {
    const occupiedBlocks = computeOccupiedBlocks(data.courtIds, data.date, data.startTime, data.endTime);
    setClasses((p) => [...p, { id: uid("cls"), type: "clase", registrations: [], occupiedBlocks, ...data }]);
  };
  const removeOpenPlay = (id) => setOpenPlays((p) => p.filter((e) => e.id !== id));
  const removeOpenPlaySeries = (recurringGroupId) => setOpenPlays((p) => p.filter((e) => e.recurringGroupId !== recurringGroupId));
  const removeClass = (id) => setClasses((p) => p.filter((e) => e.id !== id));
  const registerForOpenPlay = (id, reg) => setOpenPlays((p) => p.map((e) => (e.id === id ? { ...e, registrations: [...e.registrations, { ...reg, createdAt: Date.now() }] } : e)));
  const registerForClass = (id, reg) => setClasses((p) => p.map((e) => (e.id === id ? { ...e, registrations: [...e.registrations, { ...reg, createdAt: Date.now() }] } : e)));

  // ---- Membresías ----
  const addMembershipPlan = (plan) => setMembershipPlans((p) => [...p, { id: uid("plan"), ...plan }]);
  const removeMembershipPlan = (id) => setMembershipPlans((p) => p.filter((pl) => pl.id !== id));
  const subscribeToPlan = (planId, checkout) => {
    setSubscriptions((p) => [...p, { id: uid("sub"), planId, userId: currentUser?.id, createdAt: Date.now(), ...checkout }]);
    setUsers((prev) => prev.map((u) => (u.id === currentUser?.id ? { ...u, planId } : u)));
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
  };

  const stats = {
    courts: courts.length,
    bookings: bookings.filter((b) => b.status !== "cancelada").length,
    events: new Set(openPlays.map((e) => e.recurringGroupId || e.id)).size + classes.length + (categories.some((c) => c.teams.length > 0) ? 1 : 0),
    members: subscriptions.length,
  };

  if (!currentUser) {
    return (
      <div style={{ background: COLORS.chalk, fontFamily: "'Inter', system-ui, sans-serif" }} className="w-full min-h-screen">
        <GlobalStyles />
        <AuthScreen club={club} registerUser={registerUser} loginUser={loginUser} />
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
          {effectiveTab === "club" && role === "admin" && <ClubTab club={club} setClub={setClub} courts={courts} setCourts={setCourts} rateStatus={rateStatus} syncBcvRate={syncBcvRate} />}

          {effectiveTab === "estadisticas" && role === "admin" && (
            <EstadisticasTab bookings={bookings} openPlays={openPlays} classes={classes} subscriptions={subscriptions}
              membershipPlans={membershipPlans} users={users} club={club} courts={courts} />
          )}

          {effectiveTab === "reservas" && (
            <ReservasTab club={club} courts={courts} occupiedKeys={occupiedKeys} bookings={bookings}
              createBooking={createBooking} cancelBooking={cancelBooking} currentUser={currentUser} currentPlan={currentPlan}
              categories={categories} openPlays={openPlays} classes={classes} role={role} />
          )}

          {effectiveTab === "eventos" && (
            <EventosTab club={club} courts={courts} openPlays={openPlays} classes={classes}
              addOpenPlay={addOpenPlay} addClass={addClass} removeOpenPlay={removeOpenPlay} removeOpenPlaySeries={removeOpenPlaySeries} removeClass={removeClass}
              registerForOpenPlay={registerForOpenPlay} registerForClass={registerForClass}
              currentUser={currentUser} currentPlan={currentPlan} membershipPlans={membershipPlans} role={role}
              tournament={tournament} categories={categories} occupiedKeys={occupiedKeys} setTab={setTab} />
          )}

          {effectiveTab === "torneos" && (
            <TorneosSection
              role={role}
              tournament={tournament} setTournament={setTournament} dates={dates}
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
              addMembershipPlan={addMembershipPlan} removeMembershipPlan={removeMembershipPlan}
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
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap');
      .disp { font-family: 'Space Grotesk', 'Inter', sans-serif; letter-spacing: -0.015em; }
      .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
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
function AuthScreen({ club, registerUser, loginUser }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [zone, setZone] = useState("");
  const [zoneStatus, setZoneStatus] = useState({ loading: false, error: null, auto: false });
  const [error, setError] = useState("");

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

  const submit = () => {
    setError("");
    const result = mode === "login" ? loginUser(email, password) : registerUser({ name, email, password, zone });
    if (result?.error) setError(result.error);
  };

  const fillDemoAdmin = () => {
    setMode("login");
    setEmail("admin@club.com");
    setPassword("admin123");
    setError("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: COLORS.courtDark }}>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-7">
          <div style={{ background: COLORS.ball }} className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-lg">
            <Trophy size={22} color={COLORS.courtDark} strokeWidth={2.5} />
          </div>
          <p className="text-[10px] tracking-[0.25em] uppercase mb-1" style={{ color: "#8FA79A" }}>Club OS</p>
          <h1 className="disp text-2xl text-center" style={{ color: COLORS.chalk }}>{club.name || "Mi Club"}</h1>
        </div>

        <p className="text-center text-[10px] mono mb-4" style={{ color: "#5C6E64" }}>v{APP_VERSION}</p>

        <div className="rounded-[20px] p-6" style={{ background: COLORS.chalk }}>
          <div className="flex gap-1.5 mb-5 p-1 rounded-xl" style={{ background: "#EEEBE0" }}>
            <button onClick={() => { setMode("login"); setError(""); }} className="flex-1 py-2 rounded-lg text-sm font-bold"
              style={{ background: mode === "login" ? "#fff" : "transparent", color: mode === "login" ? COLORS.courtDark : "#8B968A", boxShadow: mode === "login" ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
              Iniciar sesión
            </button>
            <button onClick={() => { setMode("register"); setError(""); }} className="flex-1 py-2 rounded-lg text-sm font-bold"
              style={{ background: mode === "register" ? "#fff" : "transparent", color: mode === "register" ? COLORS.courtDark : "#8B968A", boxShadow: mode === "register" ? "0 1px 3px rgba(0,0,0,.08)" : "none" }}>
              Crear cuenta
            </button>
          </div>

          <div className="space-y-3">
            {mode === "register" && (
              <div><Label>Nombre completo</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" /></div>
            )}
            <div>
              <Label>Correo</Label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#9AA697" />
                <input type="email" style={{ ...inputStyle, paddingLeft: 32 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" />
              </div>
            </div>
            <div>
              <Label>Contraseña</Label>
              <div className="relative">
                <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#9AA697" />
                <input type="password" style={{ ...inputStyle, paddingLeft: 32 }} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && submit()} />
              </div>
            </div>

            {mode === "register" && (
              <div>
                <Label>Zona / sector</Label>
                <div className="relative">
                  <MapPinned size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#9AA697" />
                  <input style={{ ...inputStyle, paddingLeft: 32 }} value={zone}
                    onChange={(e) => { setZone(e.target.value); setZoneStatus((s) => ({ ...s, auto: false, error: null })); }}
                    placeholder="Ej. Chacao, Caracas" />
                </div>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <p className="text-[10px]" style={{ color: zoneStatus.error ? "#B23A1B" : zoneStatus.auto ? COLORS.court : "#8B968A" }}>
                    {zoneStatus.loading ? "Detectando tu ubicación…" : zoneStatus.auto ? "Detectada automáticamente — puedes editarla." : zoneStatus.error || "Se usa para las estadísticas del club."}
                  </p>
                  <button type="button" onClick={detectZone} className="text-[10px] font-bold shrink-0" style={{ color: COLORS.court }}>Detectar de nuevo</button>
                </div>
              </div>
            )}

            {error && <p className="text-xs font-semibold" style={{ color: "#B23A1B" }}>{error}</p>}

            <button onClick={submit} style={{ background: COLORS.clay, color: "#fff" }} className="w-full py-2.5 rounded-xl font-bold text-sm mt-1">
              {mode === "login" ? "Entrar" : "Crear cuenta"}
            </button>
          </div>

          <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${COLORS.line}` }}>
            <p className="text-xs mb-2" style={{ color: "#8B968A" }}>¿Quieres ver la vista de administrador?</p>
            <button onClick={fillDemoAdmin} className="w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5" style={{ background: "#EEF3EB", color: COLORS.courtDark }}>
              <Shield size={13} /> Usar cuenta demo de administrador
            </button>
            <p className="mono text-[10px] text-center mt-2" style={{ color: "#A6ADA0" }}>admin@club.com · admin123</p>
          </div>
        </div>

        <p className="text-center text-[11px] mt-5" style={{ color: "#6E8478" }}>
          Regístrate normal para ver la vista de cliente, o usa la cuenta demo para ver la de administrador.
        </p>
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
  { id: "reservas", label: "Reservas", short: "Reservas", icon: CalendarClock, sub: "Reserva un bloque de cancha disponible", roles: ["admin", "cliente"] },
  { id: "eventos", label: "Eventos", short: "Eventos", icon: PartyPopper, sub: "Open Plays, Torneos y Clases del club", roles: ["admin", "cliente"] },
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
          <span className="text-[10px] tracking-[0.25em] uppercase" style={{ color: "#8FA79A" }}>Club OS</span>
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
              style={{ background: active ? "rgba(212,242,75,0.10)" : "transparent", color: active ? COLORS.ball : "#AEC0B7" }}>
              {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full" style={{ background: COLORS.ball }} />}
              <Icon size={16} strokeWidth={2.25} /> {it.label}
            </button>
          );
        })}
      </nav>

      <div className="mx-3 mb-3 rounded-2xl px-4 py-3.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: currentUser.role === "admin" ? COLORS.clay : currentPlan?.monthlyPrice > 0 ? COLORS.ball : "#3A4A43" }}>
            {currentUser.role === "admin" ? <Shield size={14} color="#fff" /> : <Star size={14} color={currentPlan?.monthlyPrice > 0 ? COLORS.courtDark : "#9AA697"} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold truncate" style={{ color: COLORS.chalk }}>{currentUser.name}</p>
            <p className="text-[10px] truncate" style={{ color: "#8FA79A" }}>
              {currentUser.role === "admin" ? "Administrador" : currentPlan?.name || "Sin membresía"}
            </p>
          </div>
          <button onClick={logoutUser} title="Cerrar sesión" className="shrink-0 text-[#8FA79A] hover:text-white"><LogOut size={15} /></button>
        </div>
      </div>

      <div className="mx-3 mb-5 rounded-2xl px-4 py-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#5E7669" }}>Resumen en vivo</p>
        <div className="grid grid-cols-2 gap-y-3">
          <StatMini label="Canchas" value={stats.courts} />
          <StatMini label="Reservas" value={stats.bookings} />
          <StatMini label="Eventos" value={stats.events} />
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
      <p className="text-[10px] uppercase tracking-wide mt-1" style={{ color: "#6E8478" }}>{label}</p>
    </div>
  );
}

function TopBar({ tab, stats, currentUser, currentPlan, logoutUser, visibleNav }) {
  const meta = visibleNav.find((i) => i.id === tab) || visibleNav[0];
  const Icon = meta.icon;
  return (
    <div className="sticky top-0 z-30 backdrop-blur-md" style={{ background: "rgba(247,245,239,0.86)", borderBottom: `1px solid ${COLORS.line}` }}>
      <div className="max-w-7xl mx-auto px-4 md:px-10 py-4 md:py-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: COLORS.court }}>
            <Icon size={16} color={COLORS.chalk} strokeWidth={2.25} />
          </div>
          <div>
            <h2 className="disp text-lg leading-none" style={{ color: COLORS.courtDark }}>{meta.label}</h2>
            <p className="text-xs mt-1" style={{ color: "#8B968A" }}>{meta.sub}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 md:hidden">
          <span className="text-[10px] px-2.5 py-1 rounded-full font-bold" style={{ background: currentUser.role === "admin" ? COLORS.clay : "#EEF0EA", color: currentUser.role === "admin" ? "#fff" : COLORS.courtDark }}>
            {currentUser.role === "admin" ? "Admin" : currentPlan?.name || "Sin membresía"}
          </span>
          <button onClick={logoutUser} className="text-gray-400"><LogOut size={16} /></button>
        </div>
        <div className="hidden md:flex items-center gap-4 md:gap-6">
          <TickerStat label="Canchas" value={stats.courts} />
          <TickerStat label="Reservas" value={stats.bookings} />
          <TickerStat label="Eventos" value={stats.events} />
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
      <p className="text-[9px] uppercase tracking-widest mt-1" style={{ color: "#9AA697" }}>{label}</p>
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
            style={{ color: active ? COLORS.ball : "#7C8C82" }}>
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
      {sub && <p className="text-sm mt-1.5" style={{ color: "#8B968A" }}>{sub}</p>}
    </div>
  );
}
function Label({ children }) {
  return <label className="block text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "#7C8B80" }}>{children}</label>;
}
const inputStyle = { border: `1.5px solid ${COLORS.line}`, borderRadius: 12, padding: "9px 12px", width: "100%", fontSize: 14, outline: "none" };

/* =========================================================================
   TAB: TORNEO
   ========================================================================= */
function TorneoTab({ tournament, setTournament, dates }) {
  const set = (k, v) => setTournament((t) => ({ ...t, [k]: v }));
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
          {dates.length > 0 && (
            <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EEF3EB", color: COLORS.courtDark }}>
              {dates.length} día(s) de juego · {formatDateHuman(dates[0])} a {formatDateHuman(dates[dates.length - 1])}
            </div>
          )}
          <p className="text-xs" style={{ color: "#8B968A" }}>La duración de partidos y el intervalo entre ellos ahora se configuran en la pestaña <b>Calendario</b>, donde puedes ajustarlos antes o después de generar el horario.</p>
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
                <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2" color="#9AA697" />
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
        </Card>
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: CANCHAS
   ========================================================================= */
function ClubTab({ club, setClub, courts, setCourts, rateStatus, syncBcvRate }) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [price, setPrice] = useState(8);
  const setC = (k, v) => setClub((c) => ({ ...c, [k]: v }));
  const setPagoMovil = (k, v) => setClub((c) => ({ ...c, pagoMovil: { ...c.pagoMovil, [k]: v } }));

  const addCourt = () => {
    const n = name.trim() || `Cancha ${courts.length + 1}`;
    setCourts((c) => [...c, { id: uid("court"), name: n, isPrivate, pricePerBlock: Number(price) || 0 }]);
    setName(""); setIsPrivate(false); setPrice(8);
  };

  const blocksPerDay = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes).length;

  const minutesAgo = rateStatus.lastSync ? Math.round((Date.now() - rateStatus.lastSync) / 60000) : null;

  return (
    <div className="mt-2 space-y-5">
      <Card>
        <SectionTitle sub="Define el horario general del club. Estos bloques son la base de Reservas, Eventos y Torneos.">Horario en bloques</SectionTitle>
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
        <div className="text-xs px-3 py-2 rounded-lg mt-3" style={{ background: "#EEF3EB", color: COLORS.courtDark }}>
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
                <p className="text-xs mt-0.5" style={{ color: rateStatus.error ? "#B23A1B" : "#9FBBAA" }}>
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
            <p className="text-[10px] mt-1" style={{ color: "#8B968A" }}>Se sincroniza sola cada 30 min. Editarla aquí la deja en modo manual hasta la próxima sincronización.</p>
          </div>
          <div className="mono text-xs px-3 py-2.5 rounded-lg h-fit self-end" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
            Ej: {formatMoney(10)} ≈ {formatMoney(10 * (Number(club.bsPerUsd) || 0), "Bs. ")}
          </div>
        </div>
        <p className="text-xs font-bold uppercase tracking-wide mt-4 mb-2" style={{ color: "#7C8B80" }}>Datos de Pago Móvil</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Banco</Label><input style={inputStyle} value={club.pagoMovil.banco} onChange={(e) => setPagoMovil("banco", e.target.value)} /></div>
          <div><Label>Teléfono</Label><input style={inputStyle} value={club.pagoMovil.telefono} onChange={(e) => setPagoMovil("telefono", e.target.value)} /></div>
          <div><Label>Cédula / RIF</Label><input style={inputStyle} value={club.pagoMovil.cedula} onChange={(e) => setPagoMovil("cedula", e.target.value)} /></div>
        </div>
      </Card>

      <Card>
        <SectionTitle sub="Cada cancha puede ser pública (cualquiera reserva) o privada (prioridad para miembros), con su propio precio por bloque.">Canchas</SectionTitle>
        <div className="grid sm:grid-cols-[1.4fr_1fr_1fr_auto] gap-2 items-end mb-4">
          <div><Label>Nombre</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Cancha 3" /></div>
          <div>
            <Label>Acceso</Label>
            <Segmented value={isPrivate ? "priv" : "pub"} onChange={(v) => setIsPrivate(v === "priv")}
              options={[{ value: "pub", label: "Pública" }, { value: "priv", label: "Privada" }]} />
          </div>
          <div><Label>Precio / bloque (USD)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <button onClick={addCourt} style={{ background: COLORS.court, color: COLORS.chalk }} className="px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-1 h-[38px]">
            <Plus size={16} /> Agregar
          </button>
        </div>
        <div className="space-y-2">
          {courts.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl" style={{ background: "#F4F7F1" }}>
              <span className="flex items-center gap-2 text-sm font-medium">
                {c.isPrivate ? <Lock size={14} color={COLORS.clay} /> : <Unlock size={14} color={COLORS.court} />} {c.name}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: c.isPrivate ? "#FBE3D6" : "#DCEBD5", color: c.isPrivate ? COLORS.clay : COLORS.courtDark }}>
                  {c.isPrivate ? "Privada" : "Pública"}
                </span>
              </span>
              <div className="flex items-center gap-3">
                <span className="mono text-xs" style={{ color: "#7C8B80" }}>{formatMoney(c.pricePerBlock)} / bloque</span>
                <button onClick={() => setCourts((cs) => cs.filter((x) => x.id !== c.id))} className="text-gray-400 hover:text-red-500">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
          {courts.length === 0 && <p className="text-sm text-gray-400 italic">Aún no hay canchas registradas.</p>}
        </div>
      </Card>
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
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#EEF3EB" }}>
          <Icon size={18} color={COLORS.court} />
        </div>
        <div className="min-w-0">
          <p className="disp text-xl truncate" style={{ color: COLORS.courtDark }}>{value}</p>
          <p className="text-xs" style={{ color: "#8B968A" }}>{label}</p>
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
          <span key={i} className="flex-1 mono text-[8px] text-center truncate" style={{ color: "#9AA697" }}>{d.label}</span>
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
          <span key={i} className="flex-1 mono text-[8px] text-center" style={{ color: "#9AA697" }}>{i % everyN === 0 ? d.label : ""}</span>
        ))}
      </div>
      {data[peakIdx] && (
        <p className="text-xs mt-3" style={{ color: "#8B968A" }}>
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
          <div className="flex justify-between text-xs mb-1"><span className="font-medium truncate pr-2">{d.label}</span><span className="mono shrink-0" style={{ color: "#8B968A" }}>{d.value}</span></div>
          <div className="h-2 rounded-full" style={{ background: "#EEEBE0" }}>
            <div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
      {data.length === 0 && <p className="text-xs text-gray-400 italic">Sin datos todavía.</p>}
    </div>
  );
}

function EstadisticasTab({ bookings, openPlays, classes, subscriptions, membershipPlans, users, club, courts }) {
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
    setMatchDuration, setBreakM, submitScore,
  } = props;

  return (
    <div>
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {visibleSubItems.map((it) => (
          <button key={it.id} onClick={() => setSubTab(it.id)}
            className="px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap"
            style={{ background: subTab === it.id ? COLORS.court : "#F0F3ED", color: subTab === it.id ? "#fff" : COLORS.ink }}>
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
        <InscripcionTab categories={categories} addTeam={addTeam} suggestedRanking={suggestedRanking} />
      )}

      {subTab === "calendario" && (
        <CalendarioTab categories={categories} courts={courts} runScheduler={runScheduler}
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
          style={{ background: value === o.value ? COLORS.court : "#F0F3ED", color: value === o.value ? COLORS.chalk : COLORS.ink }}>
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
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EEF3EB", color: COLORS.courtDark }}>
          Nombre automático: <b>{previewName}</b>
        </div>
        <div>
          <Label>Cupo máximo de equipos (opcional)</Label>
          <input type="number" min={2} style={inputStyle} value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} placeholder="Sin límite" />
          <p className="text-xs mt-1" style={{ color: "#8B968A" }}>Al llenarse, los siguientes inscritos entran a una lista de espera y suben automáticamente si alguien se retira.</p>
        </div>
        <p className="text-xs" style={{ color: "#8B968A" }}>El formato del torneo se elige más adelante, una vez que sepas cuántos equipos se inscribieron — la app te dará una recomendación.</p>
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
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#F0F3ED", color: COLORS.court }}>
          <Pencil size={13} />
        </button>
      </div>
      {showSuggested && <p className="text-[10px] mt-1" style={{ color: "#8B968A" }}>Sugerido por ranking histórico — pulsa el lápiz para editarlo.</p>}
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
        {cat.teams.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "#F4F7F1" }}>
            <div>
              <span className="font-semibold">{t.name}</span>
              <span className="text-gray-500 ml-2 text-xs">{t.players.map((p) => `${p.name} (${p.ranking || 0})`).join(" · ")}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="mono text-xs px-2 py-0.5 rounded-full" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>Σ {teamRankSum(t)}</span>
              <button onClick={() => removeTeam(cat.id, t.id)} className="text-gray-300 hover:text-red-500"><X size={14} /></button>
            </div>
          </div>
        ))}
        {cat.teams.length === 0 && <p className="text-xs text-gray-400 italic">Sin equipos todavía.</p>}
      </div>

      {cat.waitlist.length > 0 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: COLORS.line }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ color: "#8A5A16" }}>
            <Hourglass size={12} /> Lista de espera ({cat.waitlist.length})
          </p>
          <div className="space-y-1.5">
            {cat.waitlist.map((t, i) => (
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
            <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "#8FA79A" }}>Recomendación</p>
            <p className="disp text-lg" style={{ color: COLORS.ball }}>{FORMAT_LABELS[rec.format]}</p>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: "#CFE1D8" }}>
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
                  style={{ border: `2px solid ${isRec ? COLORS.ball : COLORS.line}`, background: isRec ? "#F6FBDE" : "#fff" }}>
                  {isRec && (
                    <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: COLORS.ball, color: COLORS.courtDark }}>
                      SUGERIDO
                    </span>
                  )}
                  <p className="text-sm font-bold pr-16" style={{ color: COLORS.courtDark }}>{c.label}</p>
                  <p className="text-xs mt-1" style={{ color: "#8B968A" }}>{c.desc}</p>
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
        <p className="text-xs mt-4" style={{ color: "#8B968A" }}>También puedes elegir cualquier formato manualmente arriba — la recomendación es solo un punto de partida.</p>
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
              style={{ background: seedMode === "ranking" ? COLORS.court : "#F0F3ED", color: seedMode === "ranking" ? COLORS.chalk : COLORS.ink }}>
              <ArrowUpDown size={14} /> Por ranking
            </button>
            <button onClick={() => setSeedMode("random")} className="flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5"
              style={{ background: seedMode === "random" ? COLORS.court : "#F0F3ED", color: seedMode === "random" ? COLORS.chalk : COLORS.ink }}>
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
              <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: "#EEF3EB" }}>
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
          <div className="md:col-span-2 text-xs px-3 py-2.5 rounded-xl" style={{ background: "#EEF3EB", color: COLORS.courtDark }}>
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
            <div key={g.id} className="rounded-xl p-3" style={{ background: "#F4F7F1" }}>
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
    <div className="rounded-lg p-2.5 text-xs" style={{ border: `1px solid ${COLORS.line}`, background: m.winnerId ? "#F4F7F1" : "#fff" }}>
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
              <p className="text-[10px] text-center uppercase" style={{ color: "#8B968A" }}>{roundLabel(rn, wrRounds.length)}</p>
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
                <p className="text-[10px] text-center uppercase" style={{ color: "#8B968A" }}>Ronda B{rn}</p>
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
  const colors = { 1: COLORS.ball, 2: "#C9D4CC", 3: COLORS.clay, 4: "#5E7669" };
  const titles = { 1: "Campeón", 2: "2° lugar", 3: "3er lugar", 4: "4° lugar" };
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: colors[place] }}>
        {place === 1 ? <Trophy size={16} color={COLORS.courtDark} /> : <Medal size={15} color={COLORS.courtDark} />}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide" style={{ color: "#9FBBAA" }}>{titles[place]}</p>
        <p className="text-sm font-bold" style={{ color: COLORS.chalk }}>{label}</p>
      </div>
    </div>
  );
}

/* =========================================================================
   TAB: CALENDARIO
   ========================================================================= */
function CalendarioTab({ categories, courts, runScheduler, scheduleInfo, tournament, matchDuration, setMatchDuration, breakM, setBreakM }) {
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

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionTitle sub="Genera (o vuelve a generar) los horarios evitando que un jugador tenga dos partidos a la vez.">Calendario de juego</SectionTitle>
          </div>
          <button onClick={runScheduler} style={{ background: COLORS.clay, color: "#fff" }} className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 h-fit">
            <Clock size={16} /> {scheduleInfo ? "Actualizar calendario" : "Generar calendario"}
          </button>
        </div>

        {scheduleInfo && (
          <div className="mt-3 flex flex-wrap gap-3">
            {scheduleInfo.start && scheduleInfo.end && (
              <div className="text-xs px-3 py-2 rounded-lg" style={{ background: "#EEF3EB", color: COLORS.courtDark }}>
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

      {scheduled.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={() => setFilterCat("all")} className="px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: filterCat === "all" ? COLORS.court : "#F0F3ED", color: filterCat === "all" ? "#fff" : COLORS.ink }}>Todas</button>
            {categories.map((c) => (
              <button key={c.id} onClick={() => setFilterCat(c.id)} className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: filterCat === c.id ? COLORS.court : "#F0F3ED", color: filterCat === c.id ? "#fff" : COLORS.ink }}>{c.name}</button>
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
        <Card><p className="text-sm text-gray-400">Aún no hay calendario generado. Configura torneo, canchas y al menos un draw de categoría, luego pulsa "Generar calendario".</p></Card>
      )}
    </div>
  );
}

/* =========================================================================
   TAB: INSCRIPCIÓN (autoservicio de jugadores)
   ========================================================================= */
function InscripcionTab({ categories, addTeam, suggestedRanking }) {
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
        <SectionTitle sub="Elige la categoría en la que quieres competir.">Categorías abiertas</SectionTitle>
        <div className="space-y-1.5">
          {categories.map((c) => {
            const spotsLeft = c.maxTeams ? Math.max(0, c.maxTeams - c.teams.length) : null;
            return (
              <button key={c.id} onClick={() => { setCatId(c.id); setDone(false); }}
                className="w-full text-left px-3 py-2.5 rounded-xl text-sm"
                style={{ background: catId === c.id ? "#EAF3E6" : "#F4F7F1", color: catId === c.id ? COLORS.courtDark : COLORS.ink, fontWeight: catId === c.id ? 700 : 500 }}>
                <div className="flex items-center justify-between">
                  <span className="truncate">{c.name}</span>
                  {spotsLeft === 0 ? <Hourglass size={13} color="#8A5A16" /> : <UserPlus size={13} className="opacity-50" />}
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "#8B968A" }}>
                  {c.teams.length}{c.maxTeams ? `/${c.maxTeams}` : ""} equipos{c.waitlist.length > 0 ? ` · ${c.waitlist.length} en espera` : ""}
                </p>
              </button>
            );
          })}
        </div>
      </Card>

      {cat && (
        <Card>
          <SectionTitle sub="Regístrate directamente — el cupo se confirma solo, sin que el organizador tenga que hacerlo por ti.">
            Inscribirme en {cat.name}
          </SectionTitle>

          {full && (
            <div className="text-xs px-3 py-2 rounded-lg mb-4 flex items-center gap-1.5" style={{ background: "#FBF3E4", color: "#8A5A16" }}>
              <Hourglass size={12} /> El cupo está lleno — te inscribirás en la lista de espera y subirás automáticamente si alguien se retira.
            </div>
          )}

          <div className={`grid gap-3 mb-4 ${isDoubles ? "sm:grid-cols-2" : ""}`}>
            <PlayerField label={isDoubles ? "Jugador 1 (tú)" : "Tu nombre"} name={p1} setName={setP1} ranking={r1} setRanking={setR1} suggestedRanking={suggestedRanking} />
            {isDoubles && <PlayerField label="Jugador 2 (pareja)" name={p2} setName={setP2} ranking={r2} setRanking={setR2} suggestedRanking={suggestedRanking} />}
          </div>

          <button onClick={submit} style={{ background: COLORS.clay, color: "#fff" }} className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2">
            <UserPlus size={16} /> {full ? "Unirme a la lista de espera" : "Confirmar inscripción"}
          </button>

          {done && (
            <div className="mt-4 text-xs px-3 py-2 rounded-lg flex items-center gap-1.5" style={{ background: "#DCEBD5", color: COLORS.courtDark }}>
              <CheckCircle2 size={13} /> ¡Listo! Tu cupo quedó registrado en {cat.name}.
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
            style={{ background: catId === c.id ? COLORS.court : "#F0F3ED", color: catId === c.id ? "#fff" : COLORS.ink }}>{c.name}</button>
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
    <div className="rounded-xl p-3" style={{ background: m.winnerId ? "#F4F7F1" : "#FAFAF7", border: `1px solid ${COLORS.line}` }}>
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
    <div className="rounded-xl p-4 mt-3" style={{ background: "#F4F7F1", border: `1px solid ${COLORS.line}` }}>
      <p className="text-sm font-bold mb-3" style={{ color: COLORS.courtDark }}>{title}</p>

      <div className="rounded-lg p-3 mb-3" style={{ background: COLORS.courtDark }}>
        <span className="text-xs" style={{ color: "#9FBBAA" }}>{discountPct > 0 ? `Precio con ${discountPct}% de descuento por membresía` : "Total a pagar"}</span>
        <div className="flex items-baseline gap-3 mt-1 flex-wrap">
          <span className="disp text-2xl" style={{ color: COLORS.ball }}>{formatMoney(discounted)}</span>
          <span className="mono text-sm" style={{ color: "#CFE1D8" }}>≈ {formatMoney(bs, "Bs. ")}</span>
        </div>
        {discountPct > 0 && baseUsd > 0 && <p className="text-[10px] mt-1 line-through" style={{ color: "#6E8478" }}>{formatMoney(baseUsd)} sin membresía</p>}
        <p className="text-[10px] mt-1.5" style={{ color: "#5E7669" }}>Bs calculado a {formatMoney(club.bsPerUsd, "Bs. ")}/USD (referencia EUR BCV)</p>
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
            <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer" style={{ border: `1.5px dashed ${COLORS.line}`, color: proofName ? COLORS.court : "#8B968A" }}>
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
  const [courtId, setCourtId] = useState(courts[0]?.id || "");
  const [selectedTime, setSelectedTime] = useState(null);
  const blocks = generateDayBlocks(club.openTime, club.closeTime, club.blockMinutes);
  const court = courts.find((c) => c.id === courtId) || courts[0];

  useEffect(() => { if ((!courtId || !courts.some((c) => c.id === courtId)) && courts[0]) setCourtId(courts[0].id); }, [courts, courtId]);

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

  const lockedPrivate = court && court.isPrivate && !currentPlan?.privateCourtAccess;

  const shiftDate = (delta) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().slice(0, 10));
    setSelectedTime(null);
  };

  const confirm = (checkout) => {
    createBooking({ courtId: court.id, date, timeMin: selectedTime, blockMinutes: club.blockMinutes, ...checkout });
    setSelectedTime(null);
  };

  const activeBookings = bookings.filter((b) => b.status !== "cancelada").sort((a, b) => (a.date + a.timeMin) - (b.date + b.timeMin));
  const visibleBookings = role === "admin" ? activeBookings : activeBookings.filter((b) => b.userName === currentUser.name);

  if (courts.length === 0) {
    return <Card className="mt-2"><p className="text-sm text-gray-400">Configura al menos una cancha en la sección Club.</p></Card>;
  }

  return (
    <div className="mt-2 space-y-5">
      <Card>
        <SectionTitle sub="Elige una cancha y una fecha, luego toca un horario disponible.">Reservar cancha</SectionTitle>

        <div className="flex flex-wrap gap-2 mb-5">
          {courts.map((c) => (
            <button key={c.id} onClick={() => { setCourtId(c.id); setSelectedTime(null); }}
              className="px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5"
              style={{ background: courtId === c.id ? COLORS.court : "#F0F3ED", color: courtId === c.id ? "#fff" : COLORS.ink }}>
              {c.isPrivate && <Lock size={12} />} {c.name}
            </button>
          ))}
        </div>

        <div className="max-w-sm mb-5">
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: COLORS.court }}>{formatDateFull(date)}</p>
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDate(-1)} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#F0F3ED" }}>
              <ChevronLeft size={16} color={COLORS.courtDark} />
            </button>
            <input type="date" style={{ ...inputStyle, textAlign: "center", fontWeight: 700 }} value={date} onChange={(e) => { setDate(e.target.value); setSelectedTime(null); }} />
            <button onClick={() => shiftDate(1)} className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "#F0F3ED" }}>
              <ChevronRight size={16} color={COLORS.courtDark} />
            </button>
          </div>
        </div>

        {court?.isPrivate && !currentPlan?.privateCourtAccess && (
          <div className="mb-4 px-3 py-2 rounded-lg text-xs flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
            <Lock size={13} /> Cancha privada — necesitas una membresía con acceso para reservarla.
          </div>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {blocks.map((t) => {
            const occ = occupant(court.id, t);
            const isSel = selectedTime === t;
            return (
              <button key={t} onClick={() => !occ && setSelectedTime(t)} disabled={!!occ}
                title={occ ? `${occ.kind}${occ.label ? ": " + occ.label : ""}` : "Disponible"}
                className="rounded-xl py-2.5 px-1.5 text-center transition-all"
                style={{
                  background: occ ? "#F0EEE5" : isSel ? COLORS.court : "#fff",
                  border: `1.5px solid ${occ ? "transparent" : isSel ? COLORS.court : COLORS.line}`,
                  cursor: occ ? "not-allowed" : "pointer",
                }}>
                <p className="mono text-sm font-bold" style={{ color: occ ? "#B5AF9E" : isSel ? "#fff" : COLORS.courtDark }}>{minutesToAmPm(t)}</p>
                <p className="text-[9px] mt-0.5 font-bold uppercase tracking-wide" style={{ color: occ ? "#B5AF9E" : isSel ? "#DCEBD5" : "#9AA697" }}>
                  {occ ? occ.kind : "Libre"}
                </p>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-4 mt-4 text-[11px]" style={{ color: "#8B968A" }}>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: "#fff", border: `1.5px solid ${COLORS.line}` }} /> Disponible</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: "#F0EEE5" }} /> Ocupado</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ background: COLORS.court }} /> Seleccionado</span>
        </div>
      </Card>

      {selectedTime !== null && court && (
        <Card>
          <SectionTitle>Confirmar {court.name} · {minutesToAmPm(selectedTime)} ({formatDateHuman(date)})</SectionTitle>
          {lockedPrivate ? (
            <div className="text-xs px-3 py-2.5 rounded-lg flex items-center gap-1.5" style={{ background: "#FBE3D6", color: COLORS.clay }}>
              <Lock size={13} /> Esta cancha es privada — necesitas una membresía con acceso a canchas privadas. Revisa la sección Membresías.
            </div>
          ) : (
            <CheckoutPanel title={`${club.blockMinutes} min en ${court.name}`} baseUsd={court.pricePerBlock}
              discountPct={currentPlan?.courtDiscountPct || 0} club={club} defaultName={currentUser.name}
              onConfirm={confirm} onCancel={() => setSelectedTime(null)} confirmLabel="Confirmar reserva" />
          )}
        </Card>
      )}

      <Card>
        <SectionTitle>{role === "admin" ? "Todas las reservas" : "Mis reservas"}</SectionTitle>
        <div className="space-y-1.5">
          {visibleBookings.map((b) => {
            const c = courts.find((cc) => cc.id === b.courtId);
            return (
              <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: "#F4F7F1" }}>
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
          style={{ background: value.includes(c.id) ? COLORS.court : "#F0F3ED", color: value.includes(c.id) ? "#fff" : COLORS.ink }}>
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
  const [description, setDescription] = useState("");
  const [courtIds, setCourtIds] = useState([]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("20:00");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurUntil, setRecurUntil] = useState("");

  const handleImage = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(f);
  };

  const canSave = name.trim() && courtIds.length > 0 && date && startTime < endTime
    && (!isRecurring || (recurUntil && recurUntil >= date));

  return (
    <Card className="mt-3">
      <h4 className="font-bold text-sm mb-4">Nuevo Open Play</h4>
      <div className="space-y-3">
        <div><Label>Nombre de la actividad</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jueves de DUPR" /></div>
        <div>
          <Label>Imagen (opcional)</Label>
          <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer" style={{ border: `1.5px dashed ${COLORS.line}`, color: image ? COLORS.court : "#8B968A" }}>
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
          <div><Label>Precio (USD)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>
        <div><Label>Descripción</Label><textarea style={{ ...inputStyle, minHeight: 70 }} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div><Label>Canchas a utilizar</Label><MultiCourtSelect courts={courts} value={courtIds} onChange={setCourtIds} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Fecha {isRecurring ? "del primer evento" : ""}</Label>
            <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
            {date && <p className="text-[11px] mt-1" style={{ color: "#8B968A" }}>{formatDateFull(date)}</p>}
          </div>
          <div><Label>Desde</Label><input type="time" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div><Label>Hasta</Label><input type="time" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        <p className="text-xs" style={{ color: "#8B968A" }}>Los bloques de horario de las canchas elegidas quedan reservados automáticamente para esta actividad — nadie más podrá reservarlos.</p>

        <div className="rounded-xl p-3" style={{ background: "#F4F7F1" }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Evento recurrente (semanal)</Label>
              <p className="text-[11px]" style={{ color: "#8B968A" }}>Ej: "Jueves de DUPR" cada jueves a la misma hora.</p>
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
                  <p className="text-[11px] mt-1" style={{ color: "#8B968A" }}>Última fecha: {formatDateFull(recurUntil)}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button disabled={!canSave} onClick={() => onCreate({ name: name.trim(), image, level, price: Number(price) || 0, description, courtIds, date, startTime, endTime, recurrence: isRecurring ? { until: recurUntil } : null })}
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
  const [courtIds, setCourtIds] = useState([]);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("18:00");

  const canSave = academyName.trim() && courtIds.length > 0 && date && startTime < endTime;

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
          <div><Label>Precio (USD)</Label><input type="number" min={0} style={inputStyle} value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>
        <div><Label>Canchas a utilizar</Label><MultiCourtSelect courts={courts} value={courtIds} onChange={setCourtIds} /></div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Fecha</Label>
            <input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} />
            {date && <p className="text-[11px] mt-1" style={{ color: "#8B968A" }}>{formatDateFull(date)}</p>}
          </div>
          <div><Label>Desde</Label><input type="time" style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
          <div><Label>Hasta</Label><input type="time" style={inputStyle} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 pt-1">
          <button disabled={!canSave} onClick={() => onCreate({ academyName: academyName.trim(), level, price: Number(price) || 0, courtIds, date, startTime, endTime })}
            style={{ background: canSave ? COLORS.court : "#E5E5E5", color: canSave ? COLORS.chalk : "#999" }} className="flex-1 py-2 rounded-xl font-semibold text-sm">Crear Clase</button>
          <button onClick={onCancel} className="px-3 rounded-xl text-sm text-gray-400">Cancelar</button>
        </div>
      </div>
    </Card>
  );
}

function EventPoster({ kind, title, subtitle, date, price, image, recurring, onClick }) {
  const kindMeta = {
    open_play: { label: "OPEN PLAY", color: COLORS.court },
    torneo: { label: "TORNEO", color: COLORS.clay },
    clase: { label: "CLASE", color: COLORS.courtDark },
  }[kind];
  const day = date ? new Date(date + "T00:00:00") : null;

  return (
    <button onClick={onClick} className="text-left rounded-[20px] overflow-hidden flex flex-col"
      style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, boxShadow: "0 1px 2px rgba(20,30,25,.04), 0 16px 32px -22px rgba(20,30,25,.22)" }}>
      <div className="relative h-36 md:h-40 overflow-hidden shrink-0" style={!image ? { background: `linear-gradient(135deg, ${kindMeta.color}, ${COLORS.courtDark})` } : undefined}>
        {image && <img src={image} alt={title} className="w-full h-full object-cover" />}
        {!image && (
          <div className="absolute inset-0 flex items-center justify-center opacity-[0.14]">
            <Trophy size={64} color="#fff" />
          </div>
        )}
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(10,31,26,0.78) 100%)" }} />
        <div className="absolute top-3 left-3 right-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wide" style={{ background: kindMeta.color, color: "#fff" }}>{kindMeta.label}</span>
          {recurring && (
            <span className="text-[9px] font-extrabold px-2.5 py-1 rounded-full uppercase tracking-wide flex items-center gap-1" style={{ background: "rgba(255,255,255,0.92)", color: COLORS.courtDark }}>
              <Repeat size={10} /> Recurrente
            </span>
          )}
        </div>
        {day && (
          <div className="absolute top-3 right-3 rounded-lg overflow-hidden text-center shadow-md" style={{ background: "#fff", minWidth: 44 }}>
            <div className="text-[8px] font-extrabold uppercase py-0.5" style={{ background: COLORS.clay, color: "#fff" }}>{day.toLocaleDateString("es-ES", { month: "short" }).replace(".", "")}</div>
            <div className="mono text-base font-extrabold py-0.5" style={{ color: COLORS.courtDark }}>{day.getDate()}</div>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-3.5">
          <p className="disp text-white text-base leading-tight">{title}</p>
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.85)" }}>{subtitle}</p>}
        </div>
      </div>
      <div className="p-3.5 flex items-center justify-between mt-auto">
        <span className="mono text-sm font-extrabold" style={{ color: COLORS.court }}>{price}</span>
        <span className="text-xs font-bold flex items-center gap-1" style={{ color: COLORS.clay }}>Ver más <ArrowRight size={13} /></span>
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
  const [checkoutId, setCheckoutId] = useState(isSeries ? null : e.id);
  const checkoutTarget = occurrences.find((o) => o.id === checkoutId);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="disp text-lg" style={{ color: COLORS.courtDark }}>{e.name}</p>
          <p className="text-xs mt-1" style={{ color: "#8B968A" }}>
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
      {e.description && <p className="text-sm mb-3" style={{ color: "#4B5A50" }}>{e.description}</p>}

      {isSeries ? (
        <div className="space-y-1.5 mb-4">
          <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: "#8B968A" }}>Próximas fechas — elige una para inscribirte</p>
          {occurrences.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-3 py-2 rounded-lg text-sm" style={{ background: checkoutId === o.id ? "#DCEBD5" : "#F4F7F1" }}>
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
        <p className="text-xs mb-4" style={{ color: "#8B968A" }}>{e.registrations.length} inscrito(s)</p>
      )}

      {checkoutTarget && (
        <CheckoutPanel title={`Inscripción a ${e.name}${isSeries ? ` · ${formatDateHuman(checkoutTarget.date)}` : ""}`} baseUsd={e.price} discountPct={currentPlan?.eventDiscountPct || 0} club={club} defaultName={currentUser.name}
          onConfirm={(checkout) => onRegister(checkoutTarget.id, checkout)} onCancel={onClose} confirmLabel="Confirmar inscripción" />
      )}
    </Card>
  );
}

function ClassDetail({ e, courts, club, currentPlan, currentUser, onRegister, onRemove, onClose }) {
  const courtNames = e.courtIds.map((id) => courts.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="disp text-lg" style={{ color: COLORS.courtDark }}>{e.academyName}</p>
          <p className="text-xs mt-1" style={{ color: "#8B968A" }}>Nivel {e.level} · {formatDateHuman(e.date)} · {formatTimeAmPm(e.startTime)}–{formatTimeAmPm(e.endTime)} · {courtNames}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {onRemove && <button onClick={onRemove} className="text-gray-300 hover:text-red-500"><Trash2 size={16} /></button>}
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600"><X size={18} /></button>
        </div>
      </div>
      <p className="text-xs mb-4" style={{ color: "#8B968A" }}>{e.registrations.length} inscrito(s)</p>
      <CheckoutPanel title={`Cupo en clase con ${e.academyName}`} baseUsd={e.price} discountPct={currentPlan?.eventDiscountPct || 0} club={club} defaultName={currentUser.name}
        onConfirm={onRegister} onCancel={onClose} confirmLabel="Confirmar cupo" />
    </Card>
  );
}

function EventosTab({ club, courts, openPlays, classes, addOpenPlay, addClass, removeOpenPlay, removeClass, removeOpenPlaySeries, registerForOpenPlay, registerForClass, currentUser, currentPlan, tournament, categories, setTab, role }) {
  const [showOpenPlayForm, setShowOpenPlayForm] = useState(false);
  const [showClaseForm, setShowClaseForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const isAdmin = role === "admin";
  const hasTournamentActivity = categories.some((c) => c.teams.length > 0);
  const todayIso = new Date().toISOString().slice(0, 10);

  const courtNames = (ids) => ids.map((id) => courts.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
  const noEvents = openPlays.length === 0 && classes.length === 0 && !hasTournamentActivity;

  // Recurring Open Plays are stored as one entry per occurrence (sharing a recurringGroupId)
  // so registrations/court blocks stay per-date. Group them back into one card per series —
  // showing the next upcoming date — instead of flooding the grid with every future week.
  const openPlaySeries = useMemo(() => {
    const groups = {};
    openPlays.forEach((e) => {
      const key = e.recurringGroupId || e.id;
      (groups[key] = groups[key] || []).push(e);
    });
    return Object.values(groups).map((list) => [...list].sort((a, b) => a.date.localeCompare(b.date)));
  }, [openPlays]);

  const seriesForKey = (key) => openPlaySeries.find((list) => (list[0].recurringGroupId || list[0].id) === key);

  return (
    <div className="mt-2 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionTitle sub="Toda la actividad programada del club: Open Plays, Torneos y Clases.">Eventos</SectionTitle>
        {isAdmin && (
          <div className="flex gap-2">
            <button onClick={() => { setShowOpenPlayForm((s) => !s); setShowClaseForm(false); }} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.court, color: "#fff" }}><Plus size={14} /> Open Play</button>
            <button onClick={() => { setShowClaseForm((s) => !s); setShowOpenPlayForm(false); }} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.courtDark, color: "#fff" }}><Plus size={14} /> Clase</button>
          </div>
        )}
      </div>

      {isAdmin && showOpenPlayForm && <OpenPlayForm courts={courts} onCreate={(d) => { addOpenPlay(d); setShowOpenPlayForm(false); }} onCancel={() => setShowOpenPlayForm(false)} />}
      {isAdmin && showClaseForm && <ClaseForm courts={courts} onCreate={(d) => { addClass(d); setShowClaseForm(false); }} onCancel={() => setShowClaseForm(false)} />}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {openPlaySeries.map((list) => {
          const key = list[0].recurringGroupId || list[0].id;
          const rep = list.find((o) => o.date >= todayIso) || list[list.length - 1];
          const isSeries = list.length > 1;
          return (
            <EventPoster key={key} kind="open_play" title={rep.name}
              subtitle={isSeries
                ? `Cada ${weekdayLabel(rep.date)} · ${formatTimeAmPm(rep.startTime)} · ${courtNames(rep.courtIds)}`
                : `Nivel ${rep.level} · ${courtNames(rep.courtIds)}`}
              date={rep.date} price={rep.price > 0 ? formatMoney(rep.price) : "Gratis"} image={rep.image}
              recurring={isSeries}
              onClick={() => setSelected({ kind: "open_play", key })} />
          );
        })}

        <EventPoster kind="torneo" title={tournament.name || "Torneo del club"}
          subtitle={hasTournamentActivity ? `${categories.length} categoría(s)` : "Configúralo en Torneos"}
          date={tournament.startDate}
          price={hasTournamentActivity ? `${categories.reduce((s, c) => s + c.teams.length, 0)} equipos inscritos` : "Ver detalles"}
          onClick={() => setTab("torneos")} />

        {classes.map((e) => (
          <EventPoster key={e.id} kind="clase" title={e.academyName}
            subtitle={`Nivel ${e.level} · ${courtNames(e.courtIds)}`}
            date={e.date} price={e.price > 0 ? formatMoney(e.price) : "Gratis"}
            onClick={() => setSelected({ kind: "clase", id: e.id })} />
        ))}
      </div>

      {noEvents && <p className="text-xs text-gray-400 italic">Aún no hay Open Plays ni clases programadas.</p>}

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
        const e = classes.find((x) => x.id === selected.id);
        if (!e) return null;
        return (
          <ClassDetail e={e} courts={courts} club={club} currentPlan={currentPlan} currentUser={currentUser}
            onRegister={(checkout) => { registerForClass(e.id, checkout); setSelected(null); }}
            onRemove={isAdmin ? () => { removeClass(e.id); setSelected(null); } : null}
            onClose={() => setSelected(null)} />
        );
      })()}
    </div>
  );
}

/* =========================================================================
   TAB: MEMBRESÍAS
   ========================================================================= */
function MembershipPlanForm({ onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [monthlyPrice, setMonthlyPrice] = useState(30);
  const [courtDiscountPct, setCourtDiscountPct] = useState(10);
  const [eventDiscountPct, setEventDiscountPct] = useState(10);
  const [privateCourtAccess, setPrivateCourtAccess] = useState(true);
  const [description, setDescription] = useState("");

  return (
    <Card>
      <h4 className="font-bold text-sm mb-4">Nuevo plan de membresía</h4>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><Label>Nombre</Label><input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Precio mensual (USD)</Label><input type="number" min={0} style={inputStyle} value={monthlyPrice} onChange={(e) => setMonthlyPrice(e.target.value)} /></div>
        <div><Label>Descuento en reservas (%)</Label><input type="number" min={0} max={100} style={inputStyle} value={courtDiscountPct} onChange={(e) => setCourtDiscountPct(e.target.value)} /></div>
        <div><Label>Descuento en eventos (%)</Label><input type="number" min={0} max={100} style={inputStyle} value={eventDiscountPct} onChange={(e) => setEventDiscountPct(e.target.value)} /></div>
      </div>
      <div className="mt-3">
        <Label>Acceso a canchas privadas</Label>
        <Segmented value={privateCourtAccess ? "si" : "no"} onChange={(v) => setPrivateCourtAccess(v === "si")} options={[{ value: "si", label: "Sí" }, { value: "no", label: "No" }]} />
      </div>
      <div className="mt-3"><Label>Descripción</Label><textarea style={{ ...inputStyle, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="flex gap-2 pt-4">
        <button disabled={!name.trim()} onClick={() => onCreate({ name: name.trim(), monthlyPrice: Number(monthlyPrice) || 0, courtDiscountPct: Number(courtDiscountPct) || 0, eventDiscountPct: Number(eventDiscountPct) || 0, privateCourtAccess, description })}
          style={{ background: name.trim() ? COLORS.court : "#E5E5E5", color: name.trim() ? COLORS.chalk : "#999" }} className="flex-1 py-2 rounded-xl font-semibold text-sm">Crear plan</button>
        <button onClick={onCancel} className="px-3 rounded-xl text-sm text-gray-400">Cancelar</button>
      </div>
    </Card>
  );
}

function ComparisonRow({ label, plans, render, isBool, highlight }) {
  return (
    <tr style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      <td className="px-4 py-3.5 text-xs font-bold" style={{ color: "#CFE1D8" }}>{label}</td>
      {plans.map((p, idx) => {
        const val = render(p);
        return (
          <td key={p.id} className="px-3 py-3.5 text-center">
            {isBool ? (
              val ? <Check size={16} color={COLORS.ball} className="inline" strokeWidth={3} /> : <span style={{ color: "#4E625A" }}>—</span>
            ) : (
              <span className={highlight ? "mono text-base font-extrabold" : "mono text-sm font-bold"} style={{ color: idx === 0 ? COLORS.ball : idx === 1 ? "#F2B84B" : "#E4E7DE" }}>{val}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function MembresiasTab({ membershipPlans, club, courts, addMembershipPlan, removeMembershipPlan, subscribeToPlan, currentUser, role }) {
  const [showForm, setShowForm] = useState(false);
  const [checkoutPlanId, setCheckoutPlanId] = useState(null);
  const isAdmin = role === "admin";

  const avgCourtPrice = courts.length ? courts.reduce((s, c) => s + Number(c.pricePerBlock || 0), 0) / courts.length : 8;
  const avgEventPrice = 10;

  const paidPlans = [...membershipPlans].filter((p) => p.monthlyPrice > 0).sort((a, b) => b.monthlyPrice - a.monthlyPrice);
  const freePlans = membershipPlans.filter((p) => p.monthlyPrice === 0);
  const orderedPlans = [...paidPlans, ...freePlans];

  const badgeFor = (idx) => {
    if (idx === 0 && paidPlans.length > 0) return { label: "MEJOR VALOR", color: COLORS.ball, text: COLORS.courtDark };
    if (idx === 1 && paidPlans.length > 1) return { label: "MÁS POPULAR", color: "#F2B84B", text: COLORS.courtDark };
    return null;
  };

  const selectedPlan = orderedPlans.find((p) => p.id === checkoutPlanId);

  return (
    <div className="mt-2 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <SectionTitle sub="Compara beneficios y suscríbete a la membresía que más te convenga.">Planes y membresías</SectionTitle>
        {isAdmin && <button onClick={() => setShowForm((s) => !s)} className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={{ background: COLORS.courtDark, color: "#fff" }}><Plus size={14} /> Nuevo plan</button>}
      </div>

      {isAdmin && showForm && <MembershipPlanForm onCreate={(p) => { addMembershipPlan(p); setShowForm(false); }} onCancel={() => setShowForm(false)} />}

      <div className="rounded-[24px] overflow-hidden" style={{ background: COLORS.courtDark }}>
        <div className="px-5 md:px-7 pt-7 pb-5 flex items-start justify-between flex-wrap gap-3">
          <h2 className="disp text-2xl md:text-[28px] leading-tight" style={{ color: COLORS.chalk }}>
            Elige tu <span style={{ color: COLORS.ball }}>membresía</span>
          </h2>
          <p className="text-xs text-right max-w-[220px]" style={{ color: "#9FBBAA" }}>
            ¿Juegas al menos una vez por semana?<br />Una membresía se paga sola.
          </p>
        </div>

        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full border-collapse" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th className="text-left align-bottom px-4 pb-4" style={{ width: 170 }}>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: "#5E7669" }}>Beneficio</span>
                </th>
                {orderedPlans.map((plan, idx) => {
                  const badge = badgeFor(idx);
                  const isCurrent = currentUser.planId === plan.id;
                  return (
                    <th key={plan.id} className="align-bottom px-2 pb-0 text-center" style={{ minWidth: 128 }}>
                      <div className="rounded-t-2xl pt-3.5 pb-4 px-2"
                        style={{ background: idx === 0 ? "rgba(212,242,75,0.10)" : idx === 1 ? "rgba(242,184,75,0.08)" : "transparent" }}>
                        <div className="h-[20px] flex items-center justify-center mb-1.5">
                          {badge && <span className="inline-block text-[9px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: badge.color, color: badge.text }}>{badge.label}</span>}
                        </div>
                        <p className="text-[13px] font-extrabold uppercase tracking-wide leading-tight" style={{ color: idx === 0 ? COLORS.ball : idx === 1 ? "#F2B84B" : COLORS.chalk }}>{plan.name}</p>
                        {!isAdmin && (
                          <button onClick={() => setCheckoutPlanId((id) => (id === plan.id ? null : plan.id))} disabled={isCurrent}
                            className="w-full mt-3 py-2 rounded-lg text-[11px] font-extrabold"
                            style={{ background: isCurrent ? "rgba(255,255,255,0.08)" : idx <= 1 ? badge.color : "rgba(255,255,255,0.12)", color: isCurrent ? "#7C8C82" : idx <= 1 ? badge.text : "#fff" }}>
                            {isCurrent ? "Tu plan" : plan.monthlyPrice > 0 ? "Suscribirme" : "Elegir"}
                          </button>
                        )}
                        {isAdmin && plan.monthlyPrice > 0 && (
                          <button onClick={() => removeMembershipPlan(plan.id)} className="w-full mt-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1" style={{ color: "#8FA79A" }}>
                            <Trash2 size={11} /> Eliminar
                          </button>
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
              <ComparisonRow label="Reserva de cancha / bloque" plans={orderedPlans}
                render={(p) => (p.courtDiscountPct >= 100 ? "Gratis" : formatMoney(avgCourtPrice * (1 - (p.courtDiscountPct || 0) / 100)))} />
              <ComparisonRow label="Open Plays y eventos" plans={orderedPlans}
                render={(p) => (p.eventDiscountPct > 0 ? formatMoney(avgEventPrice * (1 - p.eventDiscountPct / 100)) : "Precio regular")} />
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

