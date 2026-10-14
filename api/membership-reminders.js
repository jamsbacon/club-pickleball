// Avisos de vencimiento de membresía (v2.103.0) -- Vercel Cron + Serverless Function (Node).
//
// Corre UNA vez al día (ver vercel.json: 12:00 UTC = 8:00 a.m. en Caracas) y le avisa a cada socio con
// un plan de pago cuando le quedan 7 días, 3 días y el día mismo del vencimiento (0): notificación push
// a sus dispositivos suscritos y correo. Mismo patrón de seguridad que api/send-push.js (es código de
// servidor, usa la service_role key, jamás se importa desde src/App.jsx), pero esta función NO la llama
// un usuario sino el cron de Vercel -- por eso exige `Authorization: Bearer ${CRON_SECRET}` (Vercel lo
// manda solo cuando existe esa variable de entorno) y se niega a correr si CRON_SECRET no está definida,
// para que nadie pueda dispararla desde afuera.
//
// Nunca avisa dos veces lo mismo: la tabla `membership_reminders` guarda, por (socio, fecha de vencimiento,
// aviso 7/3/0), qué canales ya salieron. Si el socio renueva, su `plan_expires_at` cambia y deja de
// coincidir con la fecha del aviso -- no hace falta cancelar nada. El correo es opcional: si no hay
// RESEND_API_KEY el push sale igual y el correo queda pendiente (se reintenta en la siguiente corrida
// del mismo día, y deja de intentarse sola al pasar la fecha).
//
// `?dry=1` (con el mismo secreto) no envía ni guarda nada: devuelve a quién le tocaría aviso hoy.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REMINDER_FROM = process.env.REMINDER_FROM_EMAIL; // ej. "Pickle Hub <avisos@tudominio.com>"
const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.APP_URL || "https://club-pickleball.vercel.app/";

export const REMINDER_DAYS = [7, 3, 0];
const TIMEZONE = "America/Caracas";

// Fecha de hoy (YYYY-MM-DD) en la zona horaria del club, no en UTC.
export function todayInClub(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export function formatLongDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Texto del aviso según los días que faltan (7, 3 o 0).
export function buildReminder(days, { name, planName, expiresOn }) {
  const first = (name || "").trim().split(/\s+/)[0] || "Hola";
  const fecha = formatLongDate(expiresOn);
  const loss = "Si no la renuevas, perderás tus beneficios de socio (precios de membresía y demás ventajas de tu plan).";
  let title, lead;
  if (days === 0) { title = "Tu membresía vence HOY"; lead = `Tu membresía ${planName} vence hoy (${fecha}).`; }
  else { title = `Tu membresía vence en ${days} días`; lead = `A tu membresía ${planName} le quedan ${days} días: vence el ${fecha}.`; }
  const push = { title, body: `${lead} ${loss}` };
  const email = {
    subject: title,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#1c2a3a">
<h2 style="color:#1B3A6B;margin-bottom:4px">${escapeHtml(title)}</h2>
<p>Hola ${escapeHtml(first)},</p>
<p>${escapeHtml(lead)}</p>
<p><strong>${escapeHtml(loss)}</strong></p>
<p><a href="${escapeHtml(APP_URL)}" style="display:inline-block;background:#E8772E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-weight:bold">Renovar mi membresía</a></p>
<p style="color:#6B7688;font-size:12px">Pickle Hub · Este es un aviso automático.</p>
</div>`,
  };
  return { push, email };
}

// Orquesta una corrida. `deps` permite probarla sin red (ver tests locales): { admin, sendPush, sendEmail }.
export async function runReminders({ admin, sendPush, sendEmail, today, dry = false }) {
  const dates = REMINDER_DAYS.map((n) => addDays(today, n));
  const kindOfDate = Object.fromEntries(REMINDER_DAYS.map((n) => [addDays(today, n), n]));

  const { data: profiles, error: pErr } = await admin.from("profiles").select("id, name, email, plan_id, plan_expires_at").in("plan_expires_at", dates);
  if (pErr) throw new Error(`profiles: ${pErr.message}`);
  if (!profiles || profiles.length === 0) return { due: 0, results: [] };
  const { data: plans, error: plErr } = await admin.from("membership_plans").select("id, name, monthly_price");
  if (plErr) throw new Error(`plans: ${plErr.message}`);
  const planById = Object.fromEntries((plans || []).map((p) => [p.id, p]));
  const due = profiles
    .map((p) => ({ profile: p, plan: planById[p.plan_id], kind: kindOfDate[p.plan_expires_at] }))
    .filter((x) => x.plan && Number(x.plan.monthly_price) > 0 && x.kind !== undefined);
  if (due.length === 0) return { due: 0, results: [] };

  const { data: existing, error: eErr } = await admin.from("membership_reminders").select("user_id, expires_on, kind, push_sent, email_sent").in("expires_on", dates);
  if (eErr) throw new Error(`reminders: ${eErr.message}`);
  const sentKey = (uid, on, kind) => `${uid}|${on}|${kind}`;
  const done = Object.fromEntries((existing || []).map((r) => [sentKey(r.user_id, r.expires_on, r.kind), r]));

  const { data: subs, error: sErr } = await admin.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").in("user_id", due.map((x) => x.profile.id));
  if (sErr) throw new Error(`push_subscriptions: ${sErr.message}`);
  const subsByUser = {};
  (subs || []).forEach((s) => { (subsByUser[s.user_id] = subsByUser[s.user_id] || []).push(s); });

  const results = [];
  const rows = [];
  const deadEndpoints = [];
  for (const { profile, plan, kind } of due) {
    const prev = done[sentKey(profile.id, profile.plan_expires_at, String(kind))] || { push_sent: false, email_sent: false };
    const msg = buildReminder(kind, { name: profile.name, planName: plan.name, expiresOn: profile.plan_expires_at });
    const res = { user: profile.name, email: profile.email, kind, expiresOn: profile.plan_expires_at, push: prev.push_sent ? "ya enviado" : "pendiente", mail: prev.email_sent ? "ya enviado" : "pendiente" };
    let pushSent = !!prev.push_sent, emailSent = !!prev.email_sent;
    if (!dry) {
      if (!pushSent) {
        const mine = subsByUser[profile.id] || [];
        let ok = 0;
        for (const s of mine) {
          const r = await sendPush(s, JSON.stringify({ title: msg.push.title, body: msg.push.body, url: "/" }));
          if (r === "ok") ok++; else if (r === "dead") deadEndpoints.push(s.endpoint);
        }
        // Sin dispositivos suscritos no hay nada que reintentar: se da por atendido el canal push.
        pushSent = true; res.push = mine.length === 0 ? "sin dispositivos" : `${ok}/${mine.length} dispositivos`;
      }
      if (!emailSent && profile.email) {
        const r = await sendEmail(profile.email, msg.email);
        if (r === "ok") { emailSent = true; res.mail = "enviado"; } else res.mail = r === "disabled" ? "correo no configurado" : `error: ${r}`;
      }
      rows.push({ user_id: profile.id, expires_on: profile.plan_expires_at, kind: String(kind), push_sent: pushSent, email_sent: emailSent });
    }
    results.push(res);
  }
  if (!dry && rows.length > 0) {
    const { error } = await admin.from("membership_reminders").upsert(rows, { onConflict: "user_id,expires_on,kind" });
    if (error) throw new Error(`guardar avisos: ${error.message}`);
  }
  if (!dry && deadEndpoints.length > 0) await admin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  return { due: due.length, results };
}

async function realSendPush(sub, payload) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    return "ok";
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return "dead"; // suscripción invalidada por el navegador
    console.error("membership-reminders webpush:", err.statusCode, err.message);
    return "error";
  }
}

async function realSendEmail(to, { subject, html }) {
  if (!RESEND_API_KEY || !REMINDER_FROM) return "disabled";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: REMINDER_FROM, to: [to], subject, html }),
    });
    if (r.ok) return "ok";
    return `${r.status} ${(await r.text()).slice(0, 120)}`;
  } catch (err) {
    return err.message;
  }
}

export default async function handler(req, res) {
  if (!CRON_SECRET) {
    console.error("membership-reminders: falta CRON_SECRET");
    return res.status(500).json({ error: "CRON_SECRET no está configurada en el servidor." });
  }
  if ((req.headers.authorization || "") !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: "No autorizado." });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return res.status(500).json({ error: "Faltan variables de Supabase en el servidor." });
  const dry = req.query?.dry === "1";
  if (!dry && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails("mailto:admin@club-pickleball.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const out = await runReminders({ admin, sendPush: VAPID_PRIVATE_KEY ? realSendPush : async () => "error", sendEmail: realSendEmail, today: todayInClub(), dry });
    return res.status(200).json({ dry, ...out });
  } catch (err) {
    console.error("membership-reminders:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
