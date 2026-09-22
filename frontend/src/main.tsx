import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { aplicarTema, lerTema } from "./lib/tema";

// Auto-recover from stale chunk errors after a new deploy
const RELOAD_KEY = "chunk-reload-attempt";
window.addEventListener("error", (e) => {
  const msg = String(e?.message || "");
  if (msg.includes("Failed to fetch dynamically imported module") || msg.includes("Importing a module script failed")) {
    if (!sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, "1");
      window.location.reload();
    }
  }
});
window.addEventListener("unhandledrejection", (e) => {
  const msg = String(e?.reason?.message || "");
  if (msg.includes("Failed to fetch dynamically imported module") || msg.includes("Importing a module script failed")) {
    if (!sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, "1");
      window.location.reload();
    }
  }
});
window.addEventListener("load", () => {
  setTimeout(() => sessionStorage.removeItem(RELOAD_KEY), 5000);
});

// Garante que a classe `dark` e o localStorage concordam mesmo se o script
// anti-piscada do index.html falhar (ex.: localStorage bloqueado).
aplicarTema(lerTema());

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
