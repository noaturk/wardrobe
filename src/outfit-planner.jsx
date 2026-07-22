import { useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "@phosphor-icons/react/Camera";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { ArrowClockwise } from "@phosphor-icons/react/ArrowClockwise";
import { CloudRain } from "@phosphor-icons/react/CloudRain";
import { CloudSun } from "@phosphor-icons/react/CloudSun";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { MapPin } from "@phosphor-icons/react/MapPin";
import { Plus } from "@phosphor-icons/react/Plus";
import { Snowflake } from "@phosphor-icons/react/Snowflake";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { Shuffle } from "@phosphor-icons/react/Shuffle";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UploadSimple } from "@phosphor-icons/react/UploadSimple";
import { Wind } from "@phosphor-icons/react/Wind";
import { X } from "@phosphor-icons/react/X";
import { CameraCapture, uploadModelReference } from "./camera-capture.jsx";
import { IMAGE_ACCEPT, isHeicFile, prepareImageFile } from "./image-files.mjs";
import { CATEGORY_LABELS, buildOutfitSuggestions } from "./outfit-suggestions.mjs";
import { buildWeatherOutfitSuggestions, fetchCurrentWeather, manualWeatherCurrent, weatherProfile } from "./weather-outfits.mjs";
import { buildOccasionOutfitSuggestions, findMatchingBuckets } from "./occasion-outfits.mjs";
import { readStoredManualWeather, readWeatherLocationPreference } from "./weather-preferences.mjs";
import "./outfit-planner.css";

export { buildOutfitSuggestions } from "./outfit-suggestions.mjs";

const CATEGORY_NAMES = {
  upperbody: "Gornji dio",
  wholebody_up: "Jakna",
  lowerbody: "Donji dio",
  onepiece: "Cjelovit komad",
  accessories_up: "Dodatak",
  shoes: "Obuća",
};

function categoryName(item) {
  return CATEGORY_NAMES[item.part] || CATEGORY_LABELS[item.part] || "Komad";
}


async function request(path, options) {
  let response;
  try {
    response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  } catch {
    // fetch() itself rejected: no response ever arrived (e.g. a proxy dropped a slow
    // connection). The server has no idea the client disconnected and keeps working, so this
    // is not proof the request failed — callers that can verify the outcome should do so
    // instead of reporting a hard failure.
    throw Object.assign(new Error("Connection was interrupted before a response arrived."), { networkError: true });
  }
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The outfit request could not be completed.");
  return body;
}

async function pollForRecentOutfit(itemIds, { attempts = 36, intervalMs = 5_000 } = {}) {
  const targetKey = JSON.stringify([...itemIds].sort());
  const since = Date.now() - 10 * 60 * 1000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    try {
      const outfits = await request("/api/outfits");
      const match = outfits.find((outfit) => outfit.source === "ai"
        && Date.parse(outfit.createdAt) >= since
        && JSON.stringify([...outfit.itemIds].sort()) === targetKey);
      if (match) return match;
    } catch { /* Keep polling; a transient failure here shouldn't end the recovery attempt. */ }
  }
  return null;
}

function OutfitPieces({ items, onSelectPiece, missingLabel }) {
  return (
    <div className="outfit-pieces">
      {items.map((item) => (
        <figure key={item.id}>
          <button type="button" className="outfit-pieces__image" onClick={() => onSelectPiece?.(item)} aria-label={`Prikaži ${item.name || categoryName(item)} veće`}>
            <img src={item.thumbnail || item.image} alt="" loading="lazy" decoding="async" />
          </button>
          <figcaption>{item.name || categoryName(item)}</figcaption>
        </figure>
      ))}
      {missingLabel && (
        <figure className="outfit-pieces__missing">
          <span className="outfit-pieces__missing-slot" aria-hidden="true">+</span>
          <figcaption>{missingLabel}</figcaption>
        </figure>
      )}
    </div>
  );
}

function PieceLightbox({ item, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="piece-lightbox" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <figure className="piece-lightbox__dialog" role="dialog" aria-modal="true" aria-label={item.name || categoryName(item)}>
        <button type="button" className="piece-lightbox__close" onClick={onClose} aria-label="Zatvori"><X size={20} /></button>
        <img src={item.image} alt="" />
        <figcaption>{item.name || categoryName(item)}</figcaption>
      </figure>
    </div>
  );
}

function WeatherIcon({ profile, size = 24 }) {
  const Icon = profile?.snowy ? Snowflake : profile?.rainy ? CloudRain : profile?.windy ? Wind : CloudSun;
  return <Icon size={size} weight="duotone" aria-hidden="true" />;
}

function geolocationMessage(error) {
  if (error?.code === 1) return "Lokacija nije dopuštena. Možeš je odobriti u postavkama preglednika i pokušati ponovno.";
  if (error?.code === 2) return "Preglednik trenutačno ne može odrediti lokaciju.";
  if (error?.code === 3) return "Dohvaćanje lokacije traje predugo. Pokušaj ponovno.";
  return "Lokaciju trenutačno nije moguće dohvatiti.";
}

// Reference-photo gate: capture a selfie or upload a photo, then try the outfit on yourself.
function ReferenceGate({ referenceReady, onOpenSettings, onReferenceSaved }) {
  const fileRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("Saving…");
  const [error, setError] = useState("");

  const upload = async (file) => {
    if (!file) return;
    setUploading(true); setUploadLabel(isHeicFile(file) ? "Converting HEIC…" : "Saving…"); setError("");
    try {
      await uploadModelReference(file);
      onReferenceSaved();
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="outfit-reference">
      <div className="outfit-reference__lead">
        <span className="outfit-reference__badge"><Camera size={16} /></span>
        <div>
          <strong>Najprije dodaj svoju fotografiju</strong>
          <p>Fotografiraj se ili odaberi jednu fotografiju. Sprema se privatno, koristi samo za isprobavanje i ne prikazuje se u ormaru.</p>
        </div>
      </div>
      <div className="outfit-reference__actions">
        <button type="button" className="outfit-reference__primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <><SpinnerGap size={15} className="outfit-spin" /> {uploadLabel}</> : <><UploadSimple size={16} weight="bold" /> Odaberi fotografiju</>}
        </button>
        <button type="button" className="outfit-reference__secondary" onClick={() => setCameraOpen(true)} disabled={uploading}>
          <Camera size={15} /> Fotografiraj se
        </button>
        <button type="button" className="outfit-reference__link" onClick={onOpenSettings}>
          <GearSix size={14} /> Upravljaj u Postavkama
        </button>
      </div>
      {error && <p className="outfit-reference__error" role="alert">{error}</p>}
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ""; }}
      />
      {cameraOpen && <CameraCapture onClose={() => setCameraOpen(false)} onSaved={() => { setCameraOpen(false); onReferenceSaved(); }} />}
    </div>
  );
}

export function OutfitPlanner({ items, usage, onClose, onOpenSettings, onOpenLooks, embedded = false }) {
  const suggestions = useMemo(() => buildOutfitSuggestions(items), [items]);
  const [selected, setSelected] = useState(null);
  const [direction, setDirection] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [referenceReady, setReferenceReady] = useState(null);
  const [referenceNotice, setReferenceNotice] = useState("");
  const [retakeOpen, setRetakeOpen] = useState(false);
  const [generatedNow, setGeneratedNow] = useState(0);
  const [manualIds, setManualIds] = useState([]);
  const [generatedResult, setGeneratedResult] = useState(null);
  const [weatherState, setWeatherState] = useState({ status: "idle", current: null, error: "", source: null });
  const [manualWeatherOpen, setManualWeatherOpen] = useState(false);
  const [manualWeather, setManualWeather] = useState({ temperature: 18, precipitation: "none", wind: "light" });
  const [manualWeatherError, setManualWeatherError] = useState("");
  const [ownPhotoChoicesOpen, setOwnPhotoChoicesOpen] = useState(false);
  const [ownPhotoBusy, setOwnPhotoBusy] = useState(false);
  const [ownPhotoError, setOwnPhotoError] = useState("");
  const ownPhotoLibraryRef = useRef(null);
  const ownPhotoCameraRef = useRef(null);
  const [enlargedPiece, setEnlargedPiece] = useState(null);
  const [occasionText, setOccasionText] = useState("");
  const [customOccasionBuckets, setCustomOccasionBuckets] = useState([]);
  const [occasionAiStatus, setOccasionAiStatus] = useState("idle"); // idle | checking | failed
  const currentWeatherProfile = useMemo(() => weatherState.current ? weatherProfile(weatherState.current) : null, [weatherState.current]);
  const weatherSuggestions = useMemo(() => weatherState.current ? buildWeatherOutfitSuggestions(items, weatherState.current) : [], [items, weatherState.current]);
  const weatherActive = weatherState.status === "ready" && Boolean(currentWeatherProfile);
  const showingWeatherPicks = weatherActive && weatherSuggestions.length > 0;
  const occasionSuggestions = useMemo(() => buildOccasionOutfitSuggestions(items, occasionText, customOccasionBuckets), [items, occasionText, customOccasionBuckets]);
  const showingOccasionPicks = occasionSuggestions.length > 0;

  useEffect(() => {
    request("/api/occasion-buckets").then(setCustomOccasionBuckets).catch(() => {});
  }, []);

  // A description that doesn't match any known occasion (built-in or previously learned) is
  // sent to OpenAI once, after the owner pauses typing, to generate a reusable keyword bucket
  // — learned buckets are then matched locally forever after, so the same phrase never costs
  // a second call.
  useEffect(() => {
    const trimmed = occasionText.trim();
    if (trimmed.length < 3 || findMatchingBuckets(trimmed, customOccasionBuckets).length) { setOccasionAiStatus("idle"); return undefined; }
    let cancelled = false;
    setOccasionAiStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const result = await request("/api/occasion-buckets/generate", { method: "POST", body: JSON.stringify({ description: trimmed }) });
        if (cancelled) return;
        setCustomOccasionBuckets(result.buckets || []);
        setOccasionAiStatus("idle");
      } catch {
        if (!cancelled) setOccasionAiStatus("failed");
      }
    }, 900);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [occasionText, customOccasionBuckets]);
  const activeSuggestions = showingOccasionPicks ? occasionSuggestions : showingWeatherPicks ? weatherSuggestions : suggestions;

  useEffect(() => {
    request("/api/import/config")
      .then((setup) => setReferenceReady(Boolean(setup.hasModelReference)))
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!generating) return undefined;
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [generating, startedAt]);

  const markReferenceReady = () => {
    setReferenceReady(true);
    setReferenceNotice("Your photo is saved. You can try this outfit on yourself now.");
  };

  const generate = async () => {
    if (!selected) return;
    const itemIds = selected.items.map((item) => item.id);
    setError(""); setGenerating(true); setStartedAt(Date.now()); setElapsed(0);
    try {
      const result = await request("/api/outfits/generate", {
        method: "POST",
        body: JSON.stringify({ itemIds, name: selected.name, direction }),
      });
      setGeneratedResult(result);
      setGeneratedNow((current) => current + 1);
      setSelected(null);
      setDirection("");
    } catch (requestError) {
      if (requestError.networkError) {
        const recovered = await pollForRecentOutfit(itemIds);
        if (recovered) {
          setGeneratedResult(recovered);
          setGeneratedNow((current) => current + 1);
          setSelected(null);
          setDirection("");
        } else {
          setError("Connection was interrupted and the result could not be confirmed. Check 'Na meni' in a moment before trying again.");
        }
      } else {
        setError(requestError.message);
      }
    }
    finally { setGenerating(false); window.dispatchEvent(new Event("wardrobe:usage-refresh")); }
  };

  const uploadOwnCombinationPhoto = async (file) => {
    if (!file || !selected || ownPhotoBusy) return;
    setOwnPhotoBusy(true);
    setOwnPhotoError("");
    try {
      const prepared = await prepareImageFile(file);
      const ids = selected.items.map((item) => item.id).join(",");
      const response = await fetch(`/api/outfits/photos?itemIds=${encodeURIComponent(ids)}`, {
        method: "POST",
        headers: { "Content-Type": prepared.type },
        body: prepared,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Fotografiju nije moguće spremiti.");
      setGeneratedResult(result);
      setOwnPhotoChoicesOpen(false);
      setSelected(null);
      setDirection("");
    } catch (uploadError) {
      setOwnPhotoError(uploadError.message);
    } finally {
      setOwnPhotoBusy(false);
    }
  };

  const elapsedLabel = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`;
  const manualItems = items.filter((item) => manualIds.includes(item.id));
  const toggleManualItem = (item) => {
    setManualIds((current) => current.includes(item.id)
      ? current.filter((id) => id !== item.id)
      : current.length < 5 ? [...current, item.id] : current);
  };
  const reviewManualOutfit = () => {
    if (!manualItems.length) return;
    setSelected({ id: `manual-${manualItems.map((item) => item.id).join("-")}`, name: "Moja kombinacija", reason: "Komadi koje si sama odabrala. Pregled ne koristi OpenAI.", items: manualItems });
  };

  const pickRandomSuggestion = () => {
    if (!items.length) return;
    const groups = items.reduce((result, item) => {
      (result[item.part] ||= []).push(item);
      return result;
    }, {});
    const pickOne = (list) => list?.length ? list[Math.floor(Math.random() * list.length)] : null;
    let picked = [pickOne(groups.upperbody), pickOne(groups.lowerbody)].filter(Boolean);
    if (Math.random() < 0.65) picked.push(pickOne(groups.wholebody_up));
    if (Math.random() < 0.65) picked.push(pickOne(groups.shoes));
    if (Math.random() < 0.5) picked.push(pickOne(groups.accessories_up));
    picked = [...new Map(picked.filter(Boolean).map((item) => [item.id, item])).values()];
    if (picked.length < 2) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      picked = [];
      for (const item of shuffled) {
        if (picked.some((existing) => existing.part === item.part)) continue;
        picked.push(item);
        if (picked.length === 4) break;
      }
    }
    if (picked.length < 2) return;
    setSelected({ id: `random-${Date.now()}`, name: "Random kombinacija", reason: "Nasumično odabrani komadi iz tvog ormara. Pregled ne koristi OpenAI.", items: picked });
  };

  const loadWeatherSuggestions = () => {
    if (!navigator.geolocation) {
      setWeatherState({ status: "error", current: null, error: "Ovaj preglednik ne podržava dohvaćanje lokacije.", source: null });
      setManualWeatherOpen(true);
      return;
    }
    setWeatherState((current) => ({ ...current, status: "loading", error: "" }));
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const current = await fetchCurrentWeather(coords.latitude, coords.longitude);
        setWeatherState({ status: "ready", current, error: "", source: "location" });
      } catch (weatherError) {
        setWeatherState({ status: "error", current: null, error: weatherError.message, source: null });
        setManualWeatherOpen(true);
      }
    }, (locationError) => {
      setWeatherState({ status: "error", current: null, error: geolocationMessage(locationError), source: null });
      setManualWeatherOpen(true);
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
  };

  useEffect(() => {
    if (readWeatherLocationPreference()) {
      loadWeatherSuggestions();
    } else {
      const stored = readStoredManualWeather();
      if (stored) {
        try { setWeatherState({ status: "ready", current: manualWeatherCurrent(stored), error: "", source: "manual" }); }
        catch { /* Ignore a stale/invalid stored value. */ }
      }
    }
    // Runs once on mount only — this auto-fetch should never re-trigger from later re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyManualWeather = (event) => {
    event.preventDefault();
    try {
      const current = manualWeatherCurrent(manualWeather);
      setWeatherState({ status: "ready", current, error: "", source: "manual" });
      setManualWeatherError("");
      setManualWeatherOpen(false);
    } catch (weatherError) {
      setManualWeatherError(weatherError.message);
    }
  };

  return (
    <div className={embedded ? "outfit-page" : "outfit-backdrop"} onMouseDown={(event) => !embedded && event.target === event.currentTarget && onClose()}>
      <section className={`outfit-panel${embedded ? " outfit-panel--embedded" : ""}`} role={embedded ? undefined : "dialog"} aria-modal={embedded ? undefined : "true"} aria-labelledby="outfit-title" aria-busy={generating}>
        <header className="outfit-heading">
          <div>
            <p><Sparkle size={12} weight="fill" /> Bez generiranja dok ti ne potvrdiš</p>
            <h2 id="outfit-title">Kombinacije</h2>
            <span>Složi odjeću iz ormara, jasno pregledaj odabrane komade, a AI uključi tek ako želiš vidjeti rezultat na sebi.</span>
          </div>
          {!embedded && <button onClick={onClose} aria-label="Zatvori kombinacije"><X size={21} /></button>}
        </header>
        <ol className="outfit-flow">
          <li className="active"><span>1</span>Odaberi</li>
          <li className={selected ? "active" : ""}><span>2</span>Pregledaj</li>
          <li className={generating || generatedResult ? "active" : ""}><span>3</span>Isprobaj uz AI</li>
        </ol>

        {generating ? (
          <div className="outfit-generating">
            <SpinnerGap size={30} />
            <div>
              <h3>Isprobavam kombinaciju na tvojoj fotografiji</h3>
              <p>OpenAI postavlja {selected.items.length} {selected.items.length === 1 ? "odabrani komad" : "odabrana komada"} na privatnu referentnu fotografiju. Obrada obično traje 30–120 sekundi.</p>
              <strong>Proteklo vrijeme · {elapsedLabel}</strong>
              <small>Možeš otvoriti drugi dio aplikacije; obrada se neće prekinuti.</small>
            </div>
            <OutfitPieces items={selected.items} onSelectPiece={setEnlargedPiece} />
          </div>
        ) : selected ? (
          <div className="outfit-selection">
            <button className="outfit-back" onClick={() => setSelected(null)}>← Natrag na odabir</button>
            <div className="outfit-selection__copy">
              <div>
                <p>Odabrana kombinacija</p>
                <h3>{selected.name}</h3>
                <span>{selected.reason}</span>
              </div>
              <OutfitPieces items={selected.items} onSelectPiece={setEnlargedPiece} />
            </div>
            <label className="outfit-direction">
              <span>Dodatna uputa, nije obavezna</span>
              <textarea value={direction} onChange={(event) => setDirection(event.target.value)} maxLength={500} rows={3} placeholder="Primjer: fotografija cijelog tijela, mirna gradska ulica, prirodno svjetlo" />
            </label>
            {referenceReady === false ? (
              <ReferenceGate referenceReady={referenceReady} onOpenSettings={onOpenSettings} onReferenceSaved={markReferenceReady} />
            ) : (
              <div className="outfit-confirm">
                <div className="outfit-confirm__meta">
                  {referenceReady === true && (
                    <span className="outfit-reference-chip">
                      <Check size={12} weight="bold" /> Tvoja fotografija je spremna
                      <button type="button" onClick={() => setRetakeOpen(true)}>Zamijeni</button>
                    </span>
                  )}
                  <p><strong>Ovaj gumb koristi jednu image generaciju.</strong> Pregled i slaganje kombinacije ne koriste OpenAI.</p>
                </div>
                <button className="outfit-confirm__go" disabled={referenceReady !== true} onClick={generate}>
                  {referenceReady === null ? "Provjeravam fotografiju…" : <><Sparkle size={16} weight="fill" /> Isprobaj kombinaciju uz AI</>}
                </button>
              </div>
            )}
            {referenceNotice && <p className="outfit-reference-notice" role="status">{referenceNotice}</p>}

            <div className={`photo-disclosure${ownPhotoChoicesOpen ? " is-open" : ""}`}>
              <button className="photo-disclosure__trigger" type="button" onClick={() => setOwnPhotoChoicesOpen((current) => !current)} aria-expanded={ownPhotoChoicesOpen}>
                <span><Camera size={18} weight="bold" aria-hidden="true" /><span><strong>Uslikaj kako ti stoji</strong><small>Tvoja stvarna fotografija u ovoj kombinaciji. Sprema se privatno, ne koristi OpenAI.</small></span></span>
                <CaretDown size={17} aria-hidden="true" />
              </button>
              {ownPhotoChoicesOpen && (
                <div className="photo-disclosure__actions">
                  <button type="button" onClick={() => ownPhotoCameraRef.current?.click()} disabled={ownPhotoBusy}><Camera size={16} /> Fotografiraj se</button>
                  <button type="button" onClick={() => ownPhotoLibraryRef.current?.click()} disabled={ownPhotoBusy}>Odaberi iz galerije</button>
                </div>
              )}
            </div>
            {ownPhotoBusy && <p className="outfit-status"><SpinnerGap size={16} className="outfit-spin" /> Spremanje fotografije…</p>}
            {ownPhotoError && <p className="outfit-error" role="alert">{ownPhotoError}</p>}
            <input
              ref={ownPhotoLibraryRef}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              onChange={(event) => { void uploadOwnCombinationPhoto(event.target.files?.[0]); event.target.value = ""; }}
            />
            <input
              ref={ownPhotoCameraRef}
              type="file"
              accept="image/*"
              capture="user"
              hidden
              onChange={(event) => { void uploadOwnCombinationPhoto(event.target.files?.[0]); event.target.value = ""; }}
            />
          </div>
        ) : (
          <>
            {generatedResult && (
              <section className="outfit-complete" role="status">
                <img src={generatedResult.image} alt="" decoding="async" />
                <div><p>Privatno spremljeno</p><h3>Kombinacija je spremna</h3><span>Rezultat se nalazi u tvojoj zbirci “Na meni”.</span></div>
                <button type="button" onClick={onOpenLooks}>Otvori Na meni</button>
              </section>
            )}

            <section className={`weather-bar weather-bar--${weatherState.status}`} aria-label="Vrijeme za prijedloge">
              <div className="weather-bar__row">
                <div className="weather-bar__status">
                  <WeatherIcon profile={currentWeatherProfile} size={18} />
                  {weatherState.status === "ready" && currentWeatherProfile ? (
                    <span className="weather-bar__reading">
                      <strong>{Math.round(currentWeatherProfile.temperature)}°</strong>
                      {currentWeatherProfile.condition} · {weatherState.source === "manual" ? "približni ručni unos" : "osjećaj temperature"} · vjetar {Math.round(currentWeatherProfile.windSpeed)} km/h
                    </span>
                  ) : weatherState.status === "loading" ? (
                    <span className="weather-bar__reading"><SpinnerGap className="outfit-spin" size={14} /> Dohvaćam vrijeme…</span>
                  ) : weatherState.status === "error" ? (
                    <span className="weather-bar__reading weather-bar__reading--error">{weatherState.error}</span>
                  ) : (
                    <span className="weather-bar__reading">Vrijeme nije postavljeno za prijedloge ispod.</span>
                  )}
                </div>
                <div className="weather-bar__actions">
                  <button type="button" className="weather-bar__manual-toggle" aria-expanded={manualWeatherOpen} aria-controls="weather-manual-form" onClick={() => { setManualWeatherOpen((current) => !current); setManualWeatherError(""); }}>
                    Unesi ručno <CaretDown size={13} weight="bold" className={manualWeatherOpen ? "is-open" : ""} aria-hidden="true" />
                  </button>
                  <button type="button" className="weather-bar__location" onClick={loadWeatherSuggestions} disabled={weatherState.status === "loading"}>
                    {weatherState.status === "loading"
                      ? <SpinnerGap className="outfit-spin" size={14} />
                      : weatherState.status === "ready" && weatherState.source === "location"
                        ? <><ArrowClockwise size={14} /> Osvježi</>
                        : <><MapPin size={14} weight="bold" /> Lokacija</>}
                  </button>
                </div>
              </div>
              {manualWeatherOpen && (
                <form id="weather-manual-form" className="weather-manual__form" onSubmit={applyManualWeather}>
                  <label className="weather-manual__temperature">
                    <span>Temperatura otprilike</span>
                    <span className="weather-manual__number">
                      <input
                        type="number"
                        min="-30"
                        max="50"
                        step="1"
                        inputMode="numeric"
                        value={manualWeather.temperature}
                        onChange={(event) => setManualWeather((current) => ({ ...current, temperature: event.target.value }))}
                        aria-label="Približna temperatura u Celzijevim stupnjevima"
                      />
                      <b>°C</b>
                    </span>
                  </label>
                  <fieldset>
                    <legend>Oborine</legend>
                    <div className="weather-manual__segments">
                      {[{ value: "none", label: "Nema" }, { value: "rain", label: "Kiša" }, { value: "snow", label: "Snijeg" }].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={manualWeather.precipitation === option.value ? "active" : ""}
                          aria-pressed={manualWeather.precipitation === option.value}
                          data-weather-precipitation={option.value}
                          onClick={() => setManualWeather((current) => ({ ...current, precipitation: option.value }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Vjetar</legend>
                    <div className="weather-manual__segments">
                      {[{ value: "light", label: "Slab" }, { value: "moderate", label: "Umjeren" }, { value: "strong", label: "Jak" }].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={manualWeather.wind === option.value ? "active" : ""}
                          aria-pressed={manualWeather.wind === option.value}
                          data-weather-wind={option.value}
                          onClick={() => setManualWeather((current) => ({ ...current, wind: option.value }))}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <button className="weather-manual__submit" type="submit">Složi prema unosu</button>
                  {manualWeatherError && <p className="weather-manual__error" role="alert">{manualWeatherError}</p>}
                </form>
              )}
              {weatherState.status === "idle" && (
                <p className="weather-bar__privacy">Lokacija se traži tek nakon klika. Koordinate se šalju Open-Meteu radi aktualnog vremena i ne spremaju se u aplikaciju.</p>
              )}
            </section>

            <section className={`occasion-bar${showingOccasionPicks ? " occasion-bar--active" : ""}`}>
              <label className="occasion-bar__label" htmlFor="occasion-input">Za koju priliku ti treba kombinacija?</label>
              <input
                id="occasion-input"
                type="text"
                className="occasion-bar__input"
                value={occasionText}
                onChange={(event) => setOccasionText(event.target.value)}
                placeholder="npr. poslovni sastanak, izlazak navečer, teretana…"
                maxLength={120}
              />
              {occasionAiStatus === "checking" && (
                <p className="occasion-bar__ai-status"><SpinnerGap className="outfit-spin" size={13} /> Ovaj opis ne prepoznajem — pitam AI za prijedlog (koristi jednu analizu).</p>
              )}
              {occasionAiStatus === "failed" && (
                <p className="occasion-bar__empty">AI trenutačno ne može pomoći s ovim opisom. Pokušaj preformulirati ili budi konkretniji.</p>
              )}
              {occasionAiStatus === "idle" && occasionText.trim() && !showingOccasionPicks && (
                <p className="occasion-bar__empty">Nema dovoljno prepoznatljivih komada za ovaj opis — ispod su prikazani drugi prijedlozi.</p>
              )}
            </section>

            <section className={`outfit-intro${showingOccasionPicks ? " outfit-intro--occasion" : showingWeatherPicks ? " outfit-intro--weather" : ""}`}>
              <div>
                <p>{showingOccasionPicks ? "Prema opisu prilike" : showingWeatherPicks ? "Prema trenutnom vremenu" : "Brzi početak"}</p>
                <h3>{showingOccasionPicks ? "Prijedlozi za priliku" : showingWeatherPicks ? "Prijedlozi prema vremenu" : "Prijedlozi iz tvog ormara"}</h3>
                <p>{showingOccasionPicks
                  ? "Ovi prijedlozi su odabrani prema opisu prilike koji si upisao/la gore. Ne pozivaju OpenAI i ne troše generacije."
                  : showingWeatherPicks
                    ? "Ovi prijedlozi stvarno odgovaraju trenutnim uvjetima — ostali komadi u ormaru nisu dovoljno prilagođeni pa nisu prikazani. Ne pozivaju OpenAI i ne troše generacije."
                    : weatherActive
                      ? "Nijedna kombinacija iz ormara nije dovoljno prilagođena trenutnom vremenu, pa su prikazani opći prijedlozi. Ne pozivaju OpenAI i ne troše generacije."
                      : "Prijedlozi koriste samo spremljene kategorije i boje. Ne pozivaju OpenAI i ne troše generacije."}</p>
              </div>
              <div className="outfit-intro__actions">
                {weatherActive && currentWeatherProfile && (
                  <span className="outfit-intro__weather"><WeatherIcon profile={currentWeatherProfile} size={15} /> {Math.round(currentWeatherProfile.temperature)}° · {currentWeatherProfile.condition}</span>
                )}
                <span>{items.length} komada dostupno</span>
                <button type="button" className="outfit-intro__random" disabled={!items.length} onClick={pickRandomSuggestion}>
                  <Shuffle size={15} weight="bold" /> Odaberi mi random kombinaciju
                </button>
              </div>
            </section>
            {activeSuggestions.length ? (
              <div className="outfit-suggestions">
                {activeSuggestions.map((suggestion) => (
                  <article key={suggestion.id} className={suggestion.isWeatherPick || suggestion.isOccasionPick ? (suggestion.isAiOccasionPick ? "outfit-suggestions__ai-pick" : "outfit-suggestions__weather-pick") : undefined}>
                    <OutfitPieces items={suggestion.items} onSelectPiece={setEnlargedPiece} missingLabel={suggestion.missingPiece} />
                    <div>
                      {suggestion.isWeatherPick && <span className="outfit-suggestions__badge"><WeatherIcon profile={suggestion.weather} size={12} /> Prema vremenu</span>}
                      {suggestion.isOccasionPick && <span className={`outfit-suggestions__badge${suggestion.isAiOccasionPick ? " outfit-suggestions__badge--ai" : ""}`}>{suggestion.isAiOccasionPick && <Sparkle size={12} weight="fill" />} Za priliku</span>}
                      <h3>{suggestion.name}</h3>
                      <p>{suggestion.reason}{suggestion.missingPiece && <> Nedostaje: <strong>{suggestion.missingPiece}</strong>.</>}</p>
                      <small>{suggestion.items.map((item) => item.name || categoryName(item)).join(" · ")}</small>
                    </div>
                    <button onClick={() => setSelected(suggestion)}>Odaberi ovu kombinaciju</button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="outfit-empty">
                <h3>Dodaj komade iz barem dvije kategorije</h3>
                <p>Za korisne prijedloge kreni s jednim gornjim i jednim donjim dijelom. Obuća, jakne i dodaci proširuju izbor.</p>
                <button onClick={() => { onClose(); window.dispatchEvent(new Event("wardrobe:add-clothes")); }}>Dodaj još odjeće</button>
              </div>
            )}

            <section className="outfit-builder" aria-labelledby="outfit-builder-title">
              <header>
                <div><p>Ručno slaganje · bez OpenAI poziva</p><h3 id="outfit-builder-title">Odaberi do 5 komada</h3></div>
                <span>{manualItems.length}/5 odabrano</span>
              </header>
              <div className="outfit-builder__grid">
                {items.map((item) => {
                  const chosen = manualIds.includes(item.id);
                  return (
                    <button key={item.id} type="button" className={chosen ? "selected" : ""} aria-pressed={chosen} disabled={!chosen && manualIds.length >= 5} onClick={() => toggleManualItem(item)}>
                      <span className="outfit-builder__check">{chosen ? <Check size={13} weight="bold" /> : <Plus size={13} />}</span>
                      <img src={item.thumbnail || item.image} alt="" loading="lazy" decoding="async" />
                      <strong>{item.name || categoryName(item)}</strong>
                      <small>{categoryName(item)}</small>
                    </button>
                  );
                })}
              </div>
              <footer>
                <p>{manualItems.length ? manualItems.map((item) => item.name || categoryName(item)).join(" · ") : "Dodirni komade koje želiš zajedno pregledati."}</p>
                <button type="button" disabled={!manualItems.length} onClick={reviewManualOutfit}>Pregledaj kombinaciju</button>
              </footer>
            </section>
          </>
        )}

        {loading && <p className="outfit-status"><SpinnerGap size={16} /> Učitavam spremljene prikaze…</p>}
        {error && <p className="outfit-error" role="alert">{error}</p>}
        {usage && <footer className="outfit-usage">Danas pokrenuto: {(typeof usage.today.images === "number" ? usage.today.images : usage.today.images?.requested || 0) + generatedNow}{usage.dailyImageLimit > 0 ? `/${usage.dailyImageLimit}` : ""} image generacija.</footer>}
      </section>
      {retakeOpen && <CameraCapture title="Retake your photo" onClose={() => setRetakeOpen(false)} onSaved={() => { setRetakeOpen(false); markReferenceReady(); }} />}
      {enlargedPiece && <PieceLightbox item={enlargedPiece} onClose={() => setEnlargedPiece(null)} />}
    </div>
  );
}
