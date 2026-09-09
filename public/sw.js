// Service worker de Pickle Hub (v2.42.0).
//
// A propósito NO cachea el bundle de la app (nada de "cache-first" ni precache de JS/CSS):
// este club despliega varias veces al día y lo último que queremos es que un socio quede
// atascado viendo una versión vieja de la app porque el service worker le sirvió el JS
// cacheado en vez de bajar el nuevo. El único trabajo real de este archivo es (1) existir
// -- Chrome/Android exigen un service worker con un handler de "fetch" para considerar la
// app instalable -- y (2) mostrar las notificaciones push cuando lleguen.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Passthrough puro: siempre va a la red, nunca a un caché. Satisface el requisito de
// instalabilidad sin arriesgar contenido viejo.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// El payload lo manda api/send-push.js como JSON: { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "" }; }
  const title = data.title || "Pickle Hub";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Al hacer clic, enfoca una pestaña ya abierta de la app si existe; si no, abre una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
