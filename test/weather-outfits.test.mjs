import test from "node:test";
import assert from "node:assert/strict";
import { buildWeatherOutfitSuggestions, fetchCurrentWeather, manualWeatherCurrent, weatherProfile } from "../src/weather-outfits.mjs";

const item = (id, part, name, tags = []) => ({ id, part, name, tags, color: "#808080", image: `/img/${id}.png` });

const wardrobe = [
  item("tee", "upperbody", "Light linen t-shirt"),
  item("hoodie", "upperbody", "Warm wool hoodie"),
  item("shorts", "lowerbody", "Navy shorts"),
  item("trousers", "lowerbody", "Charcoal trousers"),
  item("jacket", "wholebody_up", "Waterproof shell jacket"),
  item("shoes", "shoes", "Closed leather shoes"),
];

test("weather profile recognizes rain, wind and apparent temperature", () => {
  const profile = weatherProfile({ temperature_2m: 14, apparent_temperature: 9.6, weather_code: 63, precipitation: 0.4, wind_speed_10m: 31 });
  assert.equal(profile.temperatureBand, "cool");
  assert.equal(profile.rainy, true);
  assert.equal(profile.windy, true);
  assert.equal(profile.condition, "kiša");
});

test("hot weather prioritizes a light top and shorts", () => {
  const suggestions = buildWeatherOutfitSuggestions(wardrobe, { apparent_temperature: 31, weather_code: 0, precipitation: 0, wind_speed_10m: 5 });
  const firstIds = suggestions[0].items.map((piece) => piece.id);
  assert.ok(firstIds.includes("tee"));
  assert.ok(firstIds.includes("shorts"));
  assert.ok(!firstIds.includes("jacket"));
});

test("cold rain prioritizes protective layers", () => {
  const suggestions = buildWeatherOutfitSuggestions(wardrobe, { apparent_temperature: 6, weather_code: 61, precipitation: 1.2, wind_speed_10m: 28 });
  const firstIds = suggestions[0].items.map((piece) => piece.id);
  assert.ok(firstIds.includes("jacket"));
  assert.ok(firstIds.includes("hoodie"));
  assert.match(suggestions[0].reason, /6°C/);
});

test("current weather request uses rounded coordinates and required variables", async () => {
  let requestedUrl = "";
  const current = await fetchCurrentWeather(46.3057, 16.3366, async (url, options) => {
    requestedUrl = url;
    assert.equal(options.cache, "no-store");
    return { ok: true, json: async () => ({ current: { temperature_2m: 23, apparent_temperature: 24, weather_code: 1, precipitation: 0, wind_speed_10m: 8 } }) };
  });
  const url = new URL(requestedUrl);
  assert.equal(url.hostname, "api.open-meteo.com");
  assert.equal(url.searchParams.get("latitude"), "46.3057");
  assert.equal(url.searchParams.get("longitude"), "16.3366");
  assert.match(url.searchParams.get("current"), /apparent_temperature/);
  assert.equal(current.apparent_temperature, 24);
});

test("manual weather converts approximate precipitation and wind choices", () => {
  const current = manualWeatherCurrent({ temperature: "14", precipitation: "rain", wind: "strong" });
  assert.equal(current.temperature_2m, 14);
  assert.equal(current.apparent_temperature, 14);
  assert.equal(current.weather_code, 61);
  assert.equal(current.precipitation, 1);
  assert.equal(current.wind_speed_10m, 32);
  assert.throws(() => manualWeatherCurrent({ temperature: 80 }), /−30 i 50/);
});

test("weather network failure offers manual input instead of a browser error", async () => {
  await assert.rejects(
    fetchCurrentWeather(46.3057, 16.3366, async () => { throw new TypeError("Failed to fetch"); }),
    /Unesi uvjete ručno/,
  );
});
