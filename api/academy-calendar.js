// Calendario de la Academia (PickleUp) dentro de PickleHub -- Vercel Serverless Function (Node).
// Hace de intermediario para que el token del feed de PickleUp viva solo en el servidor
// (ACADEMY_FEED_URL + ACADEMY_FEED_TOKEN en las env vars de Vercel, sin prefijo VITE_) y nunca
// se hornee en el bundle del navegador. Solo lectura: devuelve fecha/hora/sede/título de las
// clases de la academia, nada de alumnos. Si las env vars no están configuradas responde
// { classes: [] } para que el calendario de PickleHub siga funcionando igual sin el vínculo.
export default async function handler(req, res) {
  const url = process.env.ACADEMY_FEED_URL;
  const token = process.env.ACADEMY_FEED_TOKEN;
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  if (!url || !token) return res.status(200).json({ classes: [], configured: false });
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return res.status(200).json({ classes: [], error: `feed ${r.status}` });
    const data = await r.json();
    return res.status(200).json({ classes: Array.isArray(data.classes) ? data.classes : [], configured: true });
  } catch (e) {
    return res.status(200).json({ classes: [], error: String(e?.message || e) });
  }
}
