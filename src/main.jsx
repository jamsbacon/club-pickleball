import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA (v2.42.0) -- registra el service worker (ver public/sw.js) para que la app sea
// instalable y pueda mostrar notificaciones push. `load` en vez de arrancarlo de una para no
// competir por ancho de banda con el primer render de la app.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.error("SW register:", err));
  });
}
