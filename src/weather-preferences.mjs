// Small localStorage-backed weather preferences shared between App.jsx (Settings) and outfit-planner.jsx.

const WEATHER_LOCATION_STORAGE_KEY = "open-wardrobe-weather-location-v1";
const MANUAL_WEATHER_STORAGE_KEY = "open-wardrobe-manual-weather-v1";

export function readWeatherLocationPreference() {
  try {
    return localStorage.getItem(WEATHER_LOCATION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeWeatherLocationPreference(value) {
  try {
    localStorage.setItem(WEATHER_LOCATION_STORAGE_KEY, value ? "1" : "0");
  } catch { /* localStorage may be unavailable in private browsing */ }
}

export function readStoredManualWeather() {
  try {
    const value = JSON.parse(localStorage.getItem(MANUAL_WEATHER_STORAGE_KEY) || "null");
    if (!value || typeof value !== "object") return null;
    const temperature = Number(value.temperature);
    if (!Number.isFinite(temperature)) return null;
    return {
      temperature,
      precipitation: ["none", "rain", "snow"].includes(value.precipitation) ? value.precipitation : "none",
      wind: ["light", "moderate", "strong"].includes(value.wind) ? value.wind : "light",
    };
  } catch {
    return null;
  }
}

export function writeStoredManualWeather(value) {
  try {
    if (!value) { localStorage.removeItem(MANUAL_WEATHER_STORAGE_KEY); return; }
    localStorage.setItem(MANUAL_WEATHER_STORAGE_KEY, JSON.stringify(value));
  } catch { /* localStorage may be unavailable in private browsing */ }
}
