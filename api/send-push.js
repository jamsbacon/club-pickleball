// Envío de notificaciones push (v2.42.0) -- Vercel Serverless Function (Node).
//
// Vive fuera de src/ a propósito: esta es la ÚNICA pieza del proyecto que corre en un
// servidor de verdad (todo lo demás es la SPA en el navegador hablando directo con
// Supabase). Necesita la llave privada VAPID y la service_role key de Supabase -- ninguna de
// las dos puede llegar nunca al bundle del cliente, así que este archivo NUNCA se importa
// desde src/App.jsx; el cliente solo le pega un POST por fetch("/api/send-push").
//
// Seguridad: cualquiera que sepa la URL podría intentar pegarle a este endpoint, así que
// TODA llamada exige un access_token real de Supabase (el de la sesión ya logueada en la
// app) -- lo primero que hace este handler es validarlo contra Supabase antes de mandar
// nada. Los tipos que de verdad importan mantener privados (pago verificado, anuncios,
// nueva actividad) además exigen que ese usuario sea admin. "capacity_alert" es la única
// excepción -- la dispara el propio checkout de cualquier socio cuando su inscripción deja
// una actividad casi llena -- pero en vez de confiar en lo que dice el cliente, este handler
// vuelve a consultar la base de datos con la service role key para confirmar que de verdad
// está casi llena antes de mandar nada.
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const VAPID_PUBLIC_KEY = process.env.VITE_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

webpush.setVapidDetails("mailto:admin@club-pickleball.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const ADMIN_ONLY_TYPES = new Set(["payment_confirmed", "announcement", "activity_published"]);

// occurrenceTable -> { activityTable, registrationsTable, fk } -- lo que hace falta para
// releer capacidad/inscritos real desde cero, sin confiar en el número que mande el cliente.
const ACTIVITY_TABLES = {
  open_play: { activityTable: "open_plays", registrationsTable: "open_play_registrations", fk: "open_play_id" },
  clase: { activityTable: "classes", registrationsTable: "class_registrations", fk: "class_id" },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !VAPID_PRIVATE_KEY) {
    console.error("send-push: faltan variables de entorno del servidor");
    return res.status(500).json({ error: "Notificaciones push no configuradas en el servidor todavía." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Falta sesión." });

  const authClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Sesión inválida." });
  const callerId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { type, title, body, url } = req.body || {};
  if (!type || !title || !body) return res.status(400).json({ error: "Faltan campos (type, title, body)." });

  if (ADMIN_ONLY_TYPES.has(type)) {
    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerId).single();
    if (callerProfile?.role !== "admin") return res.status(403).json({ error: "Solo un admin puede enviar esto." });
  }

  let userIds = null; // null = broadcast a todos los suscritos
  if (type === "payment_confirmed") {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "Falta userId." });
    userIds = [userId];
  } else if (type === "capacity_alert") {
    const { activityKind, occurrenceId } = req.body;
    const cfg = ACTIVITY_TABLES[activityKind];
    if (!cfg || !occurrenceId) return res.status(400).json({ error: "Falta activityKind/occurrenceId." });
    const { data: occ } = await admin.from(cfg.activityTable).select("capacity").eq("id", occurrenceId).single();
    if (!occ?.capacity) return res.status(204).end(); // sin cupo definido, no hay "casi lleno" que avisar
    const { count } = await admin.from(cfg.registrationsTable).select("id", { count: "exact", head: true }).eq(cfg.fk, occurrenceId);
    const spotsLeft = occ.capacity - (count || 0);
    if (spotsLeft > 1) return res.status(204).end(); // el cliente se equivocó o alguien se salió justo antes -- no está casi lleno
    // Broadcast a todos MENOS quien acaba de inscribirse (ya sabe que se inscribió).
    userIds = "all_except_caller";
  }
  // "announcement" y "activity_published" quedan en userIds = null -> broadcast a todos.

  let query = admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
  if (Array.isArray(userIds)) query = query.in("user_id", userIds);
  const { data: subs, error: subsErr } = await query;
  if (subsErr) { console.error("send-push subs:", subsErr.message); return res.status(500).json({ error: subsErr.message }); }

  const targets = userIds === "all_except_caller" ? (subs || []).filter((s) => s.user_id !== callerId) : (subs || []);
  if (targets.length === 0) return res.status(200).json({ sent: 0 });

  const payload = JSON.stringify({ title, body, url: url || "/" });
  const deadEndpoints = [];
  let sent = 0;
  await Promise.all(targets.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err) {
      // 404/410 = el navegador invalidó esa suscripción (desinstaló, borró datos...) -- se
      // limpia sola de la tabla en vez de seguir intentando mandarle para siempre.
      if (err.statusCode === 404 || err.statusCode === 410) deadEndpoints.push(s.endpoint);
      else console.error("send-push webpush:", s.endpoint, err.statusCode, err.message);
    }
  }));

  if (deadEndpoints.length > 0) await admin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);

  return res.status(200).json({ sent, removed: deadEndpoints.length });
}
