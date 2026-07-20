import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

const nativeFetch = window.fetch.bind(window);
async function bootstrap() {
  const sessionResponse = await nativeFetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (!sessionResponse.ok) {
    window.location.replace("/auth/login");
    return;
  }
  const session = await sessionResponse.json();
  window.fetch = (input, init = {}) => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.href);
    const headers = new Headers(request.headers);
    if (url.origin === window.location.origin && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      headers.set("X-CSRF-Token", session.csrfToken);
    }
    return nativeFetch(input, { ...init, headers, credentials: "same-origin" }).then((response) => {
      if (response.status === 401) window.location.replace("/auth/login");
      return response;
    });
  };

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((registration) => registration.unregister()));
    if ("caches" in window) caches.keys().then((keys) => keys.filter((key) => key.includes("wardrobe")).forEach((key) => caches.delete(key)));
  }

  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
