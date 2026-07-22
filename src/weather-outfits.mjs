import { buildOutfitSuggestions } from "./outfit-suggestions.mjs";

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function weatherProfile(current = {}) {
  const temperature = numberOr(current.apparent_temperature, numberOr(current.temperature_2m, Number.NaN));
  if (!Number.isFinite(temperature)) throw new Error("Weather response does not include a valid temperature.");
  const code = numberOr(current.weather_code);
  const precipitation = numberOr(current.precipitation);
  const windSpeed = numberOr(current.wind_speed_10m);
  const snowy = SNOW_CODES.has(code);
  const rainy = !snowy && (RAIN_CODES.has(code) || precipitation > 0);
  const windy = windSpeed >= 25;
  const temperatureBand = temperature <= 8 ? "cold" : temperature <= 16 ? "cool" : temperature >= 26 ? "hot" : "mild";
  const condition = snowy ? "snijeg" : rainy ? "kiša" : windy ? "vjetrovito" : code <= 1 ? "vedro" : "promjenjivo";

  return { temperature, code, precipitation, windSpeed, snowy, rainy, windy, temperatureBand, condition };
}

export async function fetchCurrentWeather(latitude, longitude, fetcher = fetch) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Lokacija nije valjana.");
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    timezone: "auto",
    forecast_days: "1",
  });
  let response;
  try {
    response = await fetcher(`${OPEN_METEO_FORECAST_URL}?${params}`, { cache: "no-store" });
  } catch {
    throw new Error("Automatsko vrijeme nije dostupno. Unesi uvjete ručno.");
  }
  if (!response.ok) throw new Error("Vrijeme trenutačno nije moguće dohvatiti.");
  const body = await response.json();
  weatherProfile(body.current);
  return body.current;
}

export function manualWeatherCurrent({ temperature, precipitation = "none", wind = "light" } = {}) {
  const parsedTemperature = Number(temperature);
  if (!Number.isFinite(parsedTemperature) || parsedTemperature < -30 || parsedTemperature > 50) {
    throw new Error("Unesi temperaturu između −30 i 50 °C.");
  }
  const weatherCodes = { none: 1, rain: 61, snow: 71 };
  const windSpeeds = { light: 8, moderate: 18, strong: 32 };
  return {
    temperature_2m: parsedTemperature,
    apparent_temperature: parsedTemperature,
    precipitation: precipitation === "none" ? 0 : 1,
    weather_code: weatherCodes[precipitation] ?? weatherCodes.none,
    wind_speed_10m: windSpeeds[wind] ?? windSpeeds.light,
  };
}

function itemText(item) {
  return [item.name, ...(item.tags || [])].join(" ").toLocaleLowerCase("hr-HR");
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function itemWeatherScore(item, profile) {
  const text = itemText(item);
  const isJacket = item.part === "wholebody_up";
  const isShoes = item.part === "shoes";
  const looksWarm = includesAny(text, ["hood", "jacket", "jakna", "kaput", "coat", "knit", "plet", "wool", "vuna", "sweater", "pulover"]);
  const looksLight = includesAny(text, ["t-shirt", "majica", "linen", "lan", "tank", "short", "kratk", "light", "lagan"]);
  const looksRainReady = includesAny(text, ["rain", "kišn", "waterproof", "shell", "parka", "boot", "čizm"]);
  const looksOpen = includesAny(text, ["sandal", "natikač", "slipper"]);
  let score = 0;

  if (profile.temperatureBand === "cold") score += (isJacket ? 7 : 0) + (looksWarm ? 5 : 0) - (looksLight ? 6 : 0);
  if (profile.temperatureBand === "cool") score += (isJacket ? 4 : 0) + (looksWarm ? 3 : 0) - (looksLight ? 2 : 0);
  if (profile.temperatureBand === "hot") score += (looksLight ? 6 : 0) - (isJacket ? 8 : 0) - (looksWarm ? 5 : 0);
  if (profile.rainy || profile.snowy) score += (isJacket ? 4 : 0) + (looksRainReady ? 6 : 0) + (isShoes ? 2 : 0) - (looksOpen ? 6 : 0);
  if (profile.windy) score += (isJacket ? 4 : 0) + (looksWarm ? 2 : 0);
  return score;
}

function combinationWeatherScore(items, profile) {
  let score = items.reduce((total, item) => total + itemWeatherScore(item, profile), 0);
  const hasJacket = items.some((item) => item.part === "wholebody_up");
  if (["cold", "cool"].includes(profile.temperatureBand) && !hasJacket) score -= 4;
  if ((profile.rainy || profile.snowy || profile.windy) && !hasJacket) score -= 3;
  if (profile.temperatureBand === "hot" && hasJacket) score -= 5;
  return score;
}

// What single piece would turn a close-but-incomplete combination into a genuine fit — used
// to show a "+" placeholder instead of silently hiding an otherwise-good combo over one gap.
function missingPieceHint(items, profile) {
  const hasJacket = items.some((item) => item.part === "wholebody_up");
  if (hasJacket) return null;
  if (profile.snowy) return "topla nepromočiva jakna";
  if (profile.rainy) return "nepromočiva jakna";
  if (profile.temperatureBand === "cold") return "topla jakna";
  if (profile.temperatureBand === "cool" || profile.windy) return "lagana jakna";
  return null;
}

function weatherSuggestionName(profile, index) {
  const names = profile.snowy
    ? ["Slojevito za snijeg", "Topliji izbor", "Za hladan izlazak"]
    : profile.rainy
      ? ["Spremno za kišu", "Za promjenjivo vrijeme", "Slojevi za danas"]
      : profile.windy
        ? ["Za vjetrovit dan", "Stabilni slojevi", "Za svjež zrak"]
        : profile.temperatureBand === "hot"
          ? ["Lagano za toplinu", "Prozračno danas", "Ljetna ravnoteža"]
          : profile.temperatureBand === "cold"
            ? ["Toplo i slojevito", "Za hladniji dan", "Ugodni slojevi"]
            : ["Uravnoteženo za danas", "Prema vremenu", "Dnevni izbor"];
  return names[index % names.length];
}

function weatherReason(profile) {
  const facts = [`Osjećaj ${Math.round(profile.temperature)}°C`];
  if (profile.rainy) facts.push("moguća kiša");
  if (profile.snowy) facts.push("snijeg");
  if (profile.windy) facts.push(`vjetar ${Math.round(profile.windSpeed)} km/h`);
  const advice = profile.temperatureBand === "hot"
    ? "Prednost imaju lagani i prozračni komadi."
    : profile.temperatureBand === "cold"
      ? "Prednost imaju topliji slojevi i zatvoreniji komadi."
      : profile.rainy || profile.snowy || profile.windy
        ? "Prednost imaju zaštitni slojevi i praktična obuća."
        : "Odabir je prilagođen blagim trenutnim uvjetima.";
  return `${facts.join(" · ")}. ${advice}`;
}

export function buildWeatherOutfitSuggestions(items, current) {
  const profile = weatherProfile(current);
  return buildOutfitSuggestions(items)
    .map((suggestion, index) => {
      const score = combinationWeatherScore(suggestion.items, profile);
      return { suggestion, index, score, missing: missingPieceHint(suggestion.items, profile) };
    })
    // A non-negative score means the combination suits the current conditions — on genuinely
    // mild, clear days nothing scores above 0 either (there's nothing for the weather to
    // reward), so requiring a strictly positive score meant weather picks never appeared on
    // the most common kind of day. A combo that's merely close — its only gap is the one
    // missing category `missing` identifies — is still included so it can show a "+"
    // placeholder for what would complete it, instead of silently disappearing. Anything
    // worse than that isn't honest to label as a tailored pick.
    .filter(({ score, missing }) => score >= 0 || (missing && score > -6))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .slice(0, 4)
    .map(({ suggestion, score, missing }, index) => ({
      ...suggestion,
      id: `weather-${suggestion.id}`,
      name: weatherSuggestionName(profile, index),
      reason: weatherReason(profile),
      weather: profile,
      isWeatherPick: true,
      missingPiece: score >= 0 ? null : missing,
    }));
}
