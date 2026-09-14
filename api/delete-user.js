// Elimina la cuenta de un socio por completo (v2.58.0) -- Vercel Serverless Function (Node),
// mismo patrón de seguridad que api/send-push.js (ver su comentario, léelo primero si esto es
// nuevo): esta es la única otra pieza del proyecto que corre en un servidor de verdad, porque
// necesita la service_role key de Supabase para (a) borrar filas que RLS a propósito NO deja
// tocar desde el cliente ni siquiera con sesión de admin -- bookings/subscriptions/profiles no
// tienen policy de DELETE, a diferencia de open_play_registrations/class_registrations que sí
// (por eso esas dos SÍ se pueden borrar desde el cliente hoy, ver removeOpenPlayRegistration/
// removeClassRegistration en App.jsx) -- y (b) borrar la cuenta de Supabase Auth, que solo
// existe en la Admin API y exige la service_role key sí o sí. Nunca se importa desde
// src/App.jsx; el cliente (deleteUserAccount) solo le pega un POST.
//
// Qué NO borra este endpoint: las categorías de torneo (categories.teams/waitlist). Esa
// limpieza vive en el cliente (deleteUserAccount, App.jsx) porque reutiliza
// removePersonFromCategory, que además reajusta precios y promueve lista de espera -- duplicar
// esa lógica acá sería arriesgarse a que las dos copias se desincronicen con el tiempo. El
// cliente SIEMPRE corre esa limpieza primero y solo llama a este endpoint después.
//
// Qué SÍ preserva a propósito: cualquier registro con pago YA VERIFICADO (status/payment_status
// === "confirmada") en bookings/subscriptions/open_play_registrations/class_registrations --
// decisión del club (ver buildUserDeletionSummary en App.jsx): borrar plata que de verdad entró
// falsearía los reportes históricos de Estadísticas. subscriptions.user_id tiene "on delete
// cascade" hacia profiles.id (a diferencia de las otras tres tablas, que tienen "on delete set
// null") -- por eso, antes de borrar la fila de profiles, se le quita el user_id a mano a
// cualquier suscripción verificada que haya quedado: si no, el cascade se la llevaría igual,
// verificada o no.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// Tablas con user_id + una columna de estado de pago que hay que limpiar (solo lo NO
// verificado -- ver el comentario de arriba). open_play_registrations/class_registrations
// podrían borrarse desde el cliente (tienen policy admin), pero se hacen acá también para que
// TODA la limpieza de "todo menos categorías" quede en un solo lugar, un solo viaje de red.
const CLEANUP_TABLES = [
  { table: "bookings", statusCol: "status" },
  { table: "subscriptions", statusCol: "payment_status" },
  { table: "open_play_registrations", statusCol: "payment_status" },
  { table: "class_registrations", statusCol: "payment_status" },
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    console.error("delete-user: faltan variables de entorno del servidor");
    return res.status(500).json({ error: "Borrado de usuarios no configurado en el servidor todavía." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Falta sesión." });

  const authClient = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Sesión inválida." });
  const callerId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", callerId).single();
  if (callerProfile?.role !== "admin") return res.status(403).json({ error: "Solo un admin puede eliminar usuarios." });

  const { userId: targetId } = req.body || {};
  if (!targetId) return res.status(400).json({ error: "Falta userId." });
  if (targetId === callerId) return res.status(400).json({ error: "No puedes eliminar tu propia cuenta desde acá." });

  const { data: target } = await admin.from("profiles").select("id, role").eq("id", targetId).single();
  if (!target) return res.status(404).json({ error: "Este usuario ya no existe." });
  // Blindaje extra -- la UI (UsuariosTab) ya oculta el botón sobre otro admin, pero nunca hay
  // que confiar solo en eso: quien le pegue directo a este endpoint también queda bloqueado.
  if (target.role === "admin") return res.status(400).json({ error: "Primero quítale el rol de admin antes de eliminarlo." });

  // 1. Borra lo NO verificado de cada tabla; lo verificado ("confirmada") se deja intacto tal
  // cual está -- el .or() también agarra filas con la columna en NULL (no debería pasar en la
  // práctica, todo insert de la app manda un estado, pero así no quedan huérfanas sin querer).
  const results = await Promise.all(
    CLEANUP_TABLES.map(({ table, statusCol }) =>
      admin.from(table).delete().eq("user_id", targetId).or(`${statusCol}.is.null,${statusCol}.neq.confirmada`)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed) { console.error("delete-user cleanup:", failed.error.message); return res.status(500).json({ error: "No se pudo limpiar toda su actividad -- intenta de nuevo." }); }

  // 2. subscriptions es la única de las cuatro con "on delete cascade" hacia profiles (las
  // otras tres son "on delete set null") -- sin este paso, cualquier suscripción verificada que
  // haya quedado (recién preservada arriba a propósito) desaparecería igual al borrar la fila
  // de profiles en el paso 4.
  const { error: nullErr } = await admin.from("subscriptions").update({ user_id: null }).eq("user_id", targetId);
  if (nullErr) { console.error("delete-user null subs:", nullErr.message); return res.status(500).json({ error: "No se pudo preservar sus membresías verificadas -- intenta de nuevo." }); }

  // 3. Notificaciones push: son solo tokens de dispositivo, sin valor histórico -- se borran
  // todas (además esta tabla sí tiene "on delete cascade" hacia profiles, así que igual
  // desaparecerían solas en el paso 4; esto solo lo hace explícito).
  await admin.from("push_subscriptions").delete().eq("user_id", targetId);

  // 4. La fila de perfil.
  const { error: profileErr } = await admin.from("profiles").delete().eq("id", targetId);
  if (profileErr) { console.error("delete-user profile:", profileErr.message); return res.status(500).json({ error: "No se pudo borrar su perfil -- intenta de nuevo." }); }

  // 5. La cuenta de Auth -- el paso sin vuelta atrás, va último a propósito: si algo de arriba
  // falla, la persona todavía puede entrar y el admin puede reintentar, en vez de quedar con el
  // login ya borrado pero datos sueltos sin terminar de limpiar.
  const { error: authErr } = await admin.auth.admin.deleteUser(targetId);
  if (authErr) { console.error("delete-user auth:", authErr.message); return res.status(500).json({ error: "Se borraron sus datos pero no su cuenta de acceso -- avisa para revisarlo a mano." }); }

  return res.status(200).json({ deleted: true });
}
