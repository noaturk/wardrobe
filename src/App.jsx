import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { ChartLine } from "@phosphor-icons/react/ChartLine";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Plus } from "@phosphor-icons/react/Plus";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { TShirt } from "@phosphor-icons/react/TShirt";
import { Trash } from "@phosphor-icons/react/Trash";
import { Camera } from "@phosphor-icons/react/Camera";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretLeft } from "@phosphor-icons/react/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { X } from "@phosphor-icons/react/X";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { IMAGE_ACCEPT, isHeicFile, prepareImageFile } from "./image-files.mjs";
import { LookLightbox, LooksCollection } from "./looks-collection.jsx";
import { readStoredManualWeather, readWeatherLocationPreference, writeStoredManualWeather, writeWeatherLocationPreference } from "./weather-preferences.mjs";

const CameraCapture = lazy(() => import("./camera-capture.jsx").then((module) => ({ default: module.CameraCapture })));

const WardrobeImportFlow = lazy(() => import("./import-flow.jsx").then((module) => ({ default: module.WardrobeImportFlow })));
const OutfitPlanner = lazy(() => import("./outfit-planner.jsx").then((module) => ({ default: module.OutfitPlanner })));

const STORAGE_KEY = "open-wardrobe-edits-v1";
const DELETED_STORAGE_KEY = "open-wardrobe-deleted-v1";
const DEFAULT_VIEW_STORAGE_KEY = "open-wardrobe-default-view-v1";

const TYPES = [
  { id: "all", label: "Sve" },
  { id: "upperbody", label: "Gornji dijelovi", singular: "Gornji dio" },
  { id: "wholebody_up", label: "Jakne", singular: "Jakna" },
  { id: "lowerbody", label: "Donji dijelovi", singular: "Donji dio" },
  { id: "onepiece", label: "Odijela i kompleti", singular: "Cjelovit komad" },
  { id: "accessories_up", label: "Dodaci", singular: "Dodatak" },
  { id: "shoes", label: "Obuća", singular: "Obuća" },
];

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));

function usageValue(usage, period, kind, outcome = "requested") {
  const value = usage?.[period]?.[kind];
  return typeof value === "number" ? (outcome === "requested" ? value : 0) : Number(value?.[outcome] || 0);
}

function normalizeSearchValue(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hr-HR").trim();
}


function readEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}


function persistEdit(item) {
  const edits = readEdits();
  edits[item.id] = {
    name: item.name || "",
    part: item.part,
    subcategory: item.subcategory || "",
    brand: item.brand || "",
    color: item.color || null,
    secondaryColor: item.secondaryColor || null,
    tags: item.tags || [],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function removePersistedEdit(id) {
  const edits = readEdits();
  delete edits[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function readDefaultViewPreference() {
  try {
    return localStorage.getItem(DEFAULT_VIEW_STORAGE_KEY) === "garment" ? "garment" : "photos";
  } catch {
    return "photos";
  }
}

function writeDefaultViewPreference(value) {
  try {
    localStorage.setItem(DEFAULT_VIEW_STORAGE_KEY, value === "garment" ? "garment" : "photos");
  } catch { /* localStorage may be unavailable in private browsing */ }
}

function readDeletedItems() {
  try {
    const value = JSON.parse(localStorage.getItem(DELETED_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function persistDeletedItem(id) {
  const deleted = readDeletedItems();
  deleted.add(id);
  localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deleted]));
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 72) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
    if (selected.length === 5) break;
  }

  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let radius = 0; radius <= 18; radius += 2) {
    const startX = Math.max(0, imageX - radius);
    const startY = Math.max(0, imageY - radius);
    const width = Math.min(canvas.width - startX, (radius * 2) + 1);
    const height = Math.min(canvas.height - startY, (radius * 2) + 1);
    const data = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
    }
  }

  return null;
}

function GalleryItem({ item, selected, onOpen, index }) {
  const type = TYPE_MAP[item.part]?.singular || "Komad odjeće";

  return (
    <button
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`Otvori ${item.name || type}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
    >
      <span className="gallery-item__art"><OptimizedImage
          src={item.thumbnail || item.image}
          alt=""
          sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
          breakpoints={[120, 180, 240, 320, 480]}
          priority={index < 6}
          fetchPriority={index < 2 ? "high" : "auto"}
        /></span>
      <span className="gallery-item__copy">
        <strong>{item.name || type}</strong>
        <small>
          {item.color && <i className="gallery-item__swatch" style={{ backgroundColor: item.color }} aria-hidden="true" />}
          {[item.brand, item.subcategory || TYPE_MAP[item.part]?.singular || type].filter(Boolean).join(" · ")}
        </small>
      </span>
    </button>
  );
}

function TagEditor({ tags, onChange }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#/, "");
    if (!nextTag || tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput("");
  };

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {tags.map((tag) => (
          <span className="editable-tag" key={tag}>
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={`Remove ${tag}`}>
              <X size={12} weight="regular" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="Add a detail"
          aria-label="Add detail tag"
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label="Add detail">
          <Plus size={15} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
  if (optional && !value) {
    return (
      <div className="color-slot empty-color-slot">
        <div className="color-slot-heading">
          <span>{label}</span>
          <small>Optional</small>
        </div>
        <p>No distinct secondary color detected.</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>Add secondary color</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{label}</span>
        {optional && <button type="button" onClick={onClear}>Remove</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Choose ${label.toLowerCase()}`}
        />
        <span className="selected-color-copy">
          <small>Selected</small>
          <strong>{value || "Custom"}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>Image suggestions</span>
        <small>Click to apply</small>
      </div>
      <div className="palette" aria-label={`${label} suggestions from image`}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`Use ${color} as ${label.toLowerCase()}`}
            title={color}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? "Cancel picking" : `Pick ${label.toLowerCase()} from image`}
      </button>
    </div>
  );
}

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus }) {
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>Name</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={TYPE_MAP[draft.part]?.singular || "Wardrobe item"}
        />
      </label>

      <label className="field">
        <span>Category</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {TYPES.slice(1).map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}
        </select>
      </label>

      <label className="field">
        <span>Type</span>
        <input
          value={draft.subcategory || ""}
          onChange={(event) => setDraft((current) => ({ ...current, subcategory: event.target.value }))}
          placeholder="npr. majica, traperice, sako"
        />
      </label>

      <label className="field">
        <span>Brand</span>
        <input
          value={draft.brand || ""}
          onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))}
          placeholder="npr. Zara, Nike"
        />
      </label>

      <fieldset className="color-field">
        <legend>Colors</legend>
        <div className="colors-editor">
          <ColorControl
            label="Primary color"
            field="primary"
            value={draft.color}
            palette={palette}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
            sampling={sampling}
            setSampling={setSampling}
          />
          <ColorControl
            label="Secondary color"
            field="secondary"
            value={draft.secondaryColor}
            palette={palette}
            onChange={(secondaryColor) => setDraft((current) => ({ ...current, secondaryColor }))}
            sampling={sampling}
            setSampling={setSampling}
            optional
            onClear={() => setDraft((current) => ({ ...current, secondaryColor: null }))}
            onAdd={() => setDraft((current) => ({ ...current, secondaryColor: suggestedSecondary }))}
          />
        </div>
        <p className="color-help" aria-live="polite">{sampling ? `Click anywhere on the garment to sample the ${sampling} color.` : sampleStatus || "Primary colors come from the image. A secondary is suggested only when a distinct color has meaningful coverage."}</p>
      </fieldset>

      <div className="field details-field">
        <span>Details</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>
    </div>
  );
}

function ItemAppearanceStudio({ item, onOpenSettings, onRecordsChange, onOpenRecord }) {
  const libraryRef = useRef(null);
  const cameraRef = useRef(null);
  const [records, setRecords] = useState([]);
  const [referenceReady, setReferenceReady] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState(null);
  const [photoChoicesOpen, setPhotoChoicesOpen] = useState(false);

  const loadStudio = useCallback(async () => {
    try {
      const [outfitsResponse, configResponse] = await Promise.all([
        fetch("/api/outfits", { cache: "no-store" }),
        fetch("/api/import/config", { cache: "no-store" }),
      ]);
      if (!outfitsResponse.ok || !configResponse.ok) throw new Error("Could not load your try-on studio.");
      const [outfits, config] = await Promise.all([outfitsResponse.json(), configResponse.json()]);
      const matchingRecords = outfits.filter((record) => record.itemIds?.includes(item.id));
      setRecords(matchingRecords);
      onRecordsChange?.(matchingRecords);
      setReferenceReady(Boolean(config.hasModelReference));
      setNotice(null);
    } catch (loadError) {
      setNotice({ tone: "error", text: loadError.message });
    } finally {
      setLoading(false);
    }
  }, [item.id]);

  useEffect(() => {
    void loadStudio();
    window.addEventListener("wardrobe:setup-refresh", loadStudio);
    return () => window.removeEventListener("wardrobe:setup-refresh", loadStudio);
  }, [loadStudio]);

  useEffect(() => {
    if (!busy) return undefined;
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

  const addResult = (record, message) => {
    setRecords((current) => {
      const next = [record, ...current];
      onRecordsChange?.(next);
      return next;
    });
    setNotice({ tone: "success", text: message });
  };

  const generateWithAI = async () => {
    if (referenceReady !== true || busy) return;
    setBusy("ai");
    setStartedAt(Date.now());
    setElapsed(0);
    setNotice({ tone: "progress", text: "Pripremam privatnu referentnu fotografiju i ovaj komad…" });
    try {
      const response = await fetch("/api/outfits/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [item.id], name: `${item.name || "Komad"} na meni` }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "AI prikaz nije moguće izraditi.");
      addResult(body, "AI prikaz je gotov i privatno spremljen.");
      onOpenRecord?.(body, false);
      window.dispatchEvent(new Event("wardrobe:usage-refresh"));
    } catch (generateError) {
      setNotice({ tone: "error", text: generateError.message });
    } finally {
      setBusy("");
    }
  };

  const uploadWearingPhoto = async (file) => {
    if (!file || busy) return;
    setBusy("photo");
    setStartedAt(Date.now());
    setElapsed(0);
    setNotice({ tone: "progress", text: isHeicFile(file) ? "Privatno pretvaram iPhone fotografiju…" : "Privatno spremam fotografiju…" });
    try {
      const prepared = await prepareImageFile(file);
      const response = await fetch(`/api/outfits/photos?itemId=${encodeURIComponent(item.id)}`, {
        method: "POST",
        headers: { "Content-Type": prepared.type },
        body: prepared,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Fotografiju nije moguće spremiti.");
      addResult(body, "Tvoja fotografija je privatno spremljena. OpenAI nije korišten.");
      setPhotoChoicesOpen(false);
    } catch (uploadError) {
      setNotice({ tone: "error", text: uploadError.message });
    } finally {
      setBusy("");
    }
  };

  const removeResult = async (record) => {
    if (!window.confirm(`Obrisati “${record.name}”?`)) return;
    const response = await fetch(`/api/outfits/${record.id}`, { method: "DELETE" });
    if (response.ok) setRecords((current) => {
      const next = current.filter((candidate) => candidate.id !== record.id);
      onRecordsChange?.(next);
      return next;
    });
    else setNotice({ tone: "error", text: "Taj prikaz trenutačno nije moguće obrisati." });
  };

  const elapsedLabel = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`;

  return (
    <section className="appearance-studio" aria-labelledby={`appearance-${item.id}`} aria-busy={Boolean(busy)}>
      <div className="appearance-studio__heading">
        <div>
          <p>Privatna kabina</p>
          <h3 id={`appearance-${item.id}`}>Kako mi stoji?</h3>
        </div>
        {loading && <SpinnerGap className="wardrobe-state__spinner" size={18} aria-label="Učitavam prikaze" />}
      </div>

      <article className="tryon-primary">
        <span className="tryon-primary__icon"><Sparkle size={19} weight="fill" aria-hidden="true" /></span>
        <div className="tryon-primary__copy">
          <strong>Isprobaj uz AI</strong>
          <p>Koristi tvoju privatnu referentnu fotografiju i jednu OpenAI image generaciju.</p>
        </div>
        <div className="tryon-primary__action">
          {referenceReady === false ? (
            <button type="button" onClick={onOpenSettings}>Dodaj referentnu fotografiju</button>
          ) : (
            <button type="button" onClick={generateWithAI} disabled={referenceReady !== true || Boolean(busy)}>
              {busy === "ai" ? <><SpinnerGap className="wardrobe-state__spinner" size={15} /> Generiranje · {elapsedLabel}</> : referenceReady === null ? "Provjeravam…" : "Isprobaj uz AI"}
            </button>
          )}
        </div>
        {busy === "ai" && <p className="tryon-primary__progress"><strong>OpenAI obrađuje prikaz · {elapsedLabel}</strong> Panel možeš zatvoriti; obrada će se nastaviti u pozadini.</p>}
      </article>

      <div className={`photo-disclosure${photoChoicesOpen ? " is-open" : ""}`}>
        <button className="photo-disclosure__trigger" type="button" onClick={() => setPhotoChoicesOpen((current) => !current)} aria-expanded={photoChoicesOpen}>
          <span><Camera size={18} weight="bold" aria-hidden="true" /><span><strong>Dodaj svoju fotografiju</strong><small>Sprema se privatno i ne koristi OpenAI.</small></span></span>
          <CaretDown size={17} aria-hidden="true" />
        </button>
        {photoChoicesOpen && (
          <div className="photo-disclosure__actions">
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={Boolean(busy)}><Camera size={16} /> Fotografiraj se</button>
            <button type="button" onClick={() => libraryRef.current?.click()} disabled={Boolean(busy)}>Odaberi iz galerije</button>
          </div>
        )}
      </div>

      {busy === "photo" && <p className="appearance-notice" data-tone="progress"><SpinnerGap className="wardrobe-state__spinner" size={14} /> Spremanje fotografije · {elapsedLabel}</p>}
      {notice && <p className="appearance-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}

      {!!records.length && (
        <section className="appearance-history" aria-label="Rezultati na meni">
          <div className="appearance-history__heading"><div><p>Rezultati</p><strong>Na meni</strong></div><span>{records.length} spremljeno</span></div>
          <div className="appearance-history__rail">
            {records.map((record) => (
              <figure key={record.id} className="appearance-result">
                <button className="appearance-result__open" type="button" onClick={() => onOpenRecord?.(record, true)} aria-label={`Otvori ${record.name} preko cijelog ekrana`}>
                  <img src={record.image} alt="" />
                </button>
                <figcaption><span>{record.source === "ai" ? "AI prikaz" : "Moja fotografija"}</span><time>{new Date(record.createdAt).toLocaleDateString("hr-HR")}</time></figcaption>
                <button type="button" onClick={() => removeResult(record)} aria-label={`Delete ${record.name}`}><Trash size={14} /></button>
              </figure>
            ))}
          </div>
        </section>
      )}

      <input ref={libraryRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(event) => { void uploadWearingPhoto(event.target.files?.[0]); event.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={(event) => { void uploadWearingPhoto(event.target.files?.[0]); event.target.value = ""; }} />
    </section>
  );
}

function LegacyItemViewer({ item, onClose, onSave, onDelete, onDeleteModeled, onOpenSettings }) {
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const type = TYPE_MAP[item.part]?.singular || "Wardrobe item";
  const hasModeledImage = Boolean(item.modeledImage);
  const pieceRotation = useMemo(() => {
    const hash = [...item.id].reduce((total, character) => total + character.charCodeAt(0), 0);
    return `${(hash % 9) - 4}deg`;
  }, [item.id]);

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      part: draft.part,
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(draft.tags),
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setShaking(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShaking(true));
    });
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty) nudgeUnsaved();
    else onClose();
  }, [isDirty, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  useEffect(() => {
    setSampling(null);
    setSampleStatus("");
    setPalette(item.palette || []);
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  }, [item]);

  const cancelEditing = () => {
    setDraft({ name: item.name || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  const saveEditing = () => {
    onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) });
    setSampling(null);
    setSampleStatus("Changes saved.");
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus("That spot is transparent—try directly on the garment.");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`Sampled ${color} as the ${sampling} color.`);
    setSampling(null);
  };

  const garmentArtwork = (
    <div
      className={`viewer-art${hasModeledImage ? " viewer-art-floating" : ""}${sampling ? " sampling" : ""}`}
      style={hasModeledImage ? { "--piece-rotation": pieceRotation } : undefined}
    >
      <OptimizedImage
        ref={imageRef}
        src={item.image}
        alt={`Selected ${type.toLowerCase()}`}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">Click garment to sample</span>}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="Selected wardrobe item">
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="Close viewer" ref={closeButtonRef}>
        <X size={24} weight="light" aria-hidden="true" />
      </button>

      {hasModeledImage ? (
        <div className="modeled-hero">
          <OptimizedImage
            className="modeled-hero-photo"
            src={item.modeledImage}
            alt={`${draft.name || type} worn by a model`}
            sizes="(max-width: 860px) 100vw, 520px"
            breakpoints={[320, 480, 640, 800, 1040, 1280]}
            quality={82}
            priority
          />
          <div className="viewer-heading modeled-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </>
      )}

      <div className="viewer-details editing">
        <ItemAppearanceStudio item={item} onOpenSettings={onOpenSettings} />

        <details className="piece-editor" open={isDirty || closeBlocked}>
          <summary><span>Edit piece details</span><small>Name, category, colors and tags</small></summary>
          <div className="piece-editor__body">
            <ItemEditor
              draft={draft}
              setDraft={setDraft}
              palette={palette}
              sampling={sampling}
              setSampling={setSampling}
              sampleStatus={sampleStatus}
            />

            {closeBlocked && <p className="unsaved-notice" role="status">Save or cancel changes before closing.</p>}

            <div className="viewer-actions">
              <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
                <Trash size={15} weight="regular" aria-hidden="true" /> Delete piece
              </button>
              {hasModeledImage && <button className="delete-button" type="button" onClick={() => onDeleteModeled(item.id)}>
                <Trash size={15} weight="regular" aria-hidden="true" /> Old modeled photo
              </button>}
              <span className="action-spacer" />
              <button className="secondary-button" type="button" onClick={cancelEditing}>Cancel</button>
              <button className="primary-button" type="button" onClick={saveEditing}>
                <Check size={15} weight="bold" aria-hidden="true" /> Save changes
              </button>
            </div>
          </div>
        </details>
      </div>
    </aside>
    </div>
    </div>
  );
}

function ItemViewer({ item, onClose, onSave, onDelete, onDeleteModeled, onOpenSettings, deleting, deleteError }) {
  const closeButtonRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState({ name: item.name || "", part: item.part, subcategory: item.subcategory || "", brand: item.brand || "", color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [activeView, setActiveView] = useState(() => readDefaultViewPreference() === "garment" ? "garment" : "photos");
  const [appearanceRecords, setAppearanceRecords] = useState([]);
  const [activeRecordId, setActiveRecordId] = useState(null);
  const [lightboxRecord, setLightboxRecord] = useState(null);
  const type = TYPE_MAP[item.part]?.singular || "Komad odjeće";
  const hasModeledImage = Boolean(item.modeledImage);

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      part: draft.part,
      subcategory: (draft.subcategory || "").trim(),
      brand: (draft.brand || "").trim(),
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(draft.tags),
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      part: item.part,
      subcategory: (item.subcategory || "").trim(),
      brand: (item.brand || "").trim(),
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setEditorOpen(true);
    setShaking(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setShaking(true)));
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty) nudgeUnsaved();
    else onClose();
  }, [isDirty, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || lightboxRecord) return;
      if (sampling) setSampling(null);
      else requestClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [lightboxRecord, requestClose, sampling]);

  useEffect(() => {
    setSampling(null);
    setSampleStatus("");
    setPalette(item.palette || []);
    setDraft({ name: item.name || "", part: item.part, subcategory: item.subcategory || "", brand: item.brand || "", color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
    setActiveView(readDefaultViewPreference() === "garment" ? "garment" : "photos");
    setAppearanceRecords([]);
    setActiveRecordId(item.modeledImage ? "modeled" : null);
    setEditorOpen(false);
    setCloseBlocked(false);
  }, [item.id]);

  useEffect(() => { if (!isDirty) setCloseBlocked(false); }, [isDirty]);

  const cancelEditing = () => {
    setDraft({ name: item.name || "", part: item.part, subcategory: item.subcategory || "", brand: item.brand || "", color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])] });
    setSampling(null);
    setSampleStatus("");
    setCloseBlocked(false);
    setEditorOpen(false);
  };

  const saveEditing = () => {
    onSave({ ...item, ...draft, name: draft.name.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) });
    setSampling(null);
    setSampleStatus("Promjene su spremljene.");
    setCloseBlocked(false);
    setEditorOpen(false);
  };

  const toggleEditor = () => {
    if (editorOpen && isDirty && !window.confirm("Odbaciti nespremljene promjene?")) return;
    if (editorOpen && isDirty) cancelEditing();
    else setEditorOpen((current) => !current);
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus("To mjesto je prozirno — klikni izravno na odjeću.");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`Odabrana je boja ${color}.`);
    setSampling(null);
  };

  const handleRecordsChange = useCallback((records) => {
    setAppearanceRecords(records);
    setActiveRecordId((current) => {
      if (current === "modeled") return current;
      if (records.some((record) => record.id === current)) return current;
      return records[0]?.id ?? (item.modeledImage ? "modeled" : null);
    });
    if (!records.length && !item.modeledImage) setActiveView((current) => current === "photos" ? "garment" : current);
  }, [item.modeledImage]);

  const openRecord = useCallback((record, fullscreen = true) => {
    setActiveRecordId(record.id);
    setActiveView("photos");
    if (fullscreen) setLightboxRecord(record);
  }, []);

  const photoSet = useMemo(() => {
    const list = [];
    if (item.modeledImage) list.push({ id: "modeled", image: item.modeledImage, kind: "modeled" });
    for (const record of appearanceRecords) list.push({ id: record.id, image: record.image, kind: record.source, record });
    return list;
  }, [item.modeledImage, appearanceRecords]);

  const activePhotoIndex = Math.max(0, photoSet.findIndex((photo) => photo.id === activeRecordId));
  const activePhotoEntry = photoSet[activePhotoIndex] || null;
  const stepPhoto = (delta) => {
    if (photoSet.length < 2) return;
    setActiveRecordId(photoSet[(activePhotoIndex + delta + photoSet.length) % photoSet.length].id);
  };

  const activePhoto = activeView === "photos" ? (activePhotoEntry?.image || item.image) : item.image;
  const photoAlt = activeView === "photos" && activePhotoEntry
    ? (activePhotoEntry.kind === "modeled" ? `${draft.name || type} na modelu` : `${activePhotoEntry.record?.name || draft.name || type} na meni`)
    : `Čisti prikaz: ${draft.name || type}`;

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div className="viewer-entry">
        <aside className={`viewer viewer--redesign${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="Detalj odabranog komada">
          <header className="viewer-heading viewer-heading--redesign">
            <div>
              <p className="viewer-heading__meta">
                <span>{[draft.brand, draft.subcategory || TYPE_MAP[draft.part]?.singular || type].filter(Boolean).join(" · ")}</span>
                <span className="viewer-color-swatches" aria-label="Boje komada">
                  {draft.color && <i style={{ backgroundColor: draft.color }} title={`Glavna boja ${draft.color}`} />}
                  {draft.secondaryColor && <i style={{ backgroundColor: draft.secondaryColor }} title={`Dodatna boja ${draft.secondaryColor}`} />}
                </span>
              </p>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
            <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="Zatvori detalj" ref={closeButtonRef}>
              <X size={22} aria-hidden="true" />
            </button>
          </header>

          <nav className="viewer-tabs" aria-label="Prikaz fotografije">
            <button type="button" className={activeView === "garment" ? "active" : ""} aria-pressed={activeView === "garment"} onClick={() => setActiveView("garment")}>Komad</button>
            <button type="button" className={activeView === "photos" ? "active" : ""} aria-pressed={activeView === "photos"} onClick={() => setActiveView("photos")} disabled={!photoSet.length}>Fotografije</button>
          </nav>

          <div className={`viewer-visual viewer-visual--${activeView}${sampling ? " sampling" : ""}`}>
            <OptimizedImage
              src={activePhoto}
              alt={photoAlt}
              sizes="(max-width: 860px) 100vw, 600px"
              breakpoints={[320, 480, 640, 800, 1040, 1280]}
              quality={84}
              priority
              onLoad={activeView === "garment" ? handleImageLoad : undefined}
              onClick={activeView === "garment" ? handleImageClick : activePhotoEntry?.record ? () => setLightboxRecord(activePhotoEntry.record) : undefined}
            />
            {sampling && <span className="sample-hint">Klikni na odjeću za odabir boje</span>}
            {activeView === "photos" && photoSet.length > 1 && (
              <>
                <div className="viewer-photo-thumbs" role="tablist" aria-label="Odaberi fotografiju">
                  {photoSet.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      role="tab"
                      className={photo.id === activeRecordId ? "active" : ""}
                      aria-selected={photo.id === activeRecordId}
                      onClick={() => setActiveRecordId(photo.id)}
                      aria-label={photo.kind === "modeled" ? "Na modelu" : photo.kind === "ai" ? "AI prikaz" : "Moja fotografija"}
                    >
                      <img src={photo.image} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
                <button type="button" className="viewer-photo-nav viewer-photo-nav--prev" onClick={() => stepPhoto(-1)} aria-label="Prethodna fotografija">
                  <CaretLeft size={18} weight="bold" />
                </button>
                <button type="button" className="viewer-photo-nav viewer-photo-nav--next" onClick={() => stepPhoto(1)} aria-label="Sljedeća fotografija">
                  <CaretRight size={18} weight="bold" />
                </button>
              </>
            )}
            {activeView !== "garment" && (
              <button className="viewer-cutout-preview" type="button" onClick={() => setActiveView("garment")} aria-label="Prikaži čisti komad">
                <OptimizedImage src={item.image} alt="" sizes="120px" breakpoints={[120, 180, 240]} />
              </button>
            )}
          </div>

          <div className="viewer-details editing">
            <ItemAppearanceStudio item={item} onOpenSettings={onOpenSettings} onRecordsChange={handleRecordsChange} onOpenRecord={openRecord} />

            <section className={`piece-editor${editorOpen ? " is-open" : ""}`}>
              <button className="piece-editor__toggle" type="button" onClick={toggleEditor} aria-expanded={editorOpen}>
                <span><strong>Uredi podatke o komadu</strong><small>Naziv, kategorija, boje i tagovi</small></span>
                <CaretDown size={17} aria-hidden="true" />
              </button>
              {editorOpen && (
                <div className="piece-editor__body">
                  <ItemEditor draft={draft} setDraft={setDraft} palette={palette} sampling={sampling} setSampling={setSampling} sampleStatus={sampleStatus} />
                  {closeBlocked && <p className="unsaved-notice" role="status">Spremi ili otkaži promjene prije zatvaranja.</p>}
                  <div className="viewer-actions viewer-actions--edit">
                    <button className="secondary-button" type="button" onClick={cancelEditing}>Odustani</button>
                    <button className="primary-button" type="button" onClick={saveEditing} disabled={!isDirty}>
                      <Check size={15} weight="bold" aria-hidden="true" /> Spremi promjene
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="viewer-danger">
              <div><strong>Upravljanje komadom</strong><p>Brisanje je odvojeno od uređivanja podataka.</p></div>
              <div>
                {hasModeledImage && <button className="delete-button" type="button" disabled={deleting} onClick={() => onDeleteModeled(item.id)}><Trash size={15} /> Obriši stari prikaz na modelu</button>}
                <button className="delete-button" type="button" disabled={deleting} aria-busy={deleting} onClick={() => onDelete(item.id)}>
                  {deleting ? <SpinnerGap className="wardrobe-state__spinner" size={15} /> : <Trash size={15} />}
                  {deleting ? "Brišem…" : "Obriši komad"}
                </button>
                {deleteError && <p className="viewer-danger__error" role="alert">{deleteError}</p>}
              </div>
            </section>
          </div>
        </aside>
      </div>
      {lightboxRecord && <LookLightbox look={lightboxRecord} onClose={() => setLightboxRecord(null)} />}
    </div>
  );
}

export function App() {
  const [items, setItems] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultView, setDefaultView] = useState(() => readDefaultViewPreference());
  const [rememberLocation, setRememberLocation] = useState(() => readWeatherLocationPreference());
  const [manualWeatherDraft, setManualWeatherDraft] = useState(() => readStoredManualWeather() || { temperature: 18, precipitation: "none", wind: "light" });
  const [activeSection, setActiveSection] = useState("wardrobe");
  const [usage, setUsage] = useState(null);
  const [referenceConfigured, setReferenceConfigured] = useState(null);
  const [settingsNotice, setSettingsNotice] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [deletingItemId, setDeletingItemId] = useState(null);
  const [deleteItemError, setDeleteItemError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer;
    let attempt = 0;
    const load = async () => {
      try {
        const response = await fetch("/api/import/wardrobe", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the wardrobe.");
        const loadedItems = await response.json();
        if (cancelled) return;
        const edits = readEdits();
        const deleted = readDeletedItems();
        const visibleItems = loadedItems.filter((item) => !deleted.has(item.id));
        setItems(visibleItems.map((item) => ({ ...item, ...(edits[item.id] || {}) })));
        setError("");
        setLoading(false);
      } catch {
        if (cancelled) return;
        attempt += 1;
        if (attempt < 5) timer = setTimeout(load, Math.min(5_000, 750 * (2 ** (attempt - 1))));
        else { setError("Could not reach the wardrobe server. Your saved pieces are not lost."); setLoading(false); }
      }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const loadUsage = useCallback(() => {
    fetch("/api/usage", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((value) => { if (value) setUsage(value); }).catch(() => {});
  }, []);

  useEffect(() => {
    loadUsage();
    window.addEventListener("wardrobe:usage-refresh", loadUsage);
    return () => window.removeEventListener("wardrobe:usage-refresh", loadUsage);
  }, [loadUsage]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.replace("/auth/login");
  };

  const openImporter = () => window.dispatchEvent(new Event("wardrobe:add-clothes"));

  const openSettings = () => {
    setSettingsOpen(true);
    setSettingsNotice(null);
    setReferenceConfigured(null);
    loadUsage();
    fetch("/api/import/config", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error()))
      .then((setup) => setReferenceConfigured(Boolean(setup.hasModelReference)))
      .catch(() => setSettingsNotice({ tone: "error", text: "Could not check the reference photo right now." }));
  };

  const retryWardrobe = () => {
    setLoading(true); setError("");
    fetch("/api/import/wardrobe", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((loadedItems) => {
        const edits = readEdits();
        const deleted = readDeletedItems();
        setItems(loadedItems.filter((item) => !deleted.has(item.id)).map((item) => ({ ...item, ...(edits[item.id] || {}) })));
      })
      .catch(() => setError("Could not reach the wardrobe server. Try again in a moment."))
      .finally(() => setLoading(false));
  };

  const selectedItem = items.find((item) => item.id === selectedId) || null;

  useEffect(() => setDeleteItemError(""), [selectedId]);

  const openSection = (section) => {
    setActiveSection(section);
    setSelectedId(null);
  };

  const visibleItems = useMemo(() => {
    const query = normalizeSearchValue(searchQuery);
    const filtered = items.filter((item) => {
      if (activeType !== "all" && item.part !== activeType) return false;
      if (!query) return true;
      const searchable = [
        item.name,
        TYPE_MAP[item.part]?.label,
        TYPE_MAP[item.part]?.singular,
        item.color,
        item.secondaryColor,
        ...(item.tags || []),
      ].map(normalizeSearchValue).join(" ");
      return searchable.includes(query);
    });
    return [...filtered].sort((a, b) => {
      if (activeType === "all") {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      return a.id.localeCompare(b.id);
    });
  }, [activeType, items, searchQuery]);

  const galleryEntries = useMemo(() => {
    const groupingEnabled = activeType === "all" && !searchQuery;
    const counts = groupingEnabled
      ? visibleItems.reduce((map, item) => map.set(item.part, (map.get(item.part) || 0) + 1), new Map())
      : null;
    const entries = [];
    let lastPart = null;
    let itemIndex = 0;
    for (const item of visibleItems) {
      if (groupingEnabled && item.part !== lastPart) {
        entries.push({ type: "heading", part: item.part, count: counts.get(item.part), key: `heading-${item.part}` });
        lastPart = item.part;
      }
      entries.push({ type: "item", item, index: itemIndex });
      itemIndex += 1;
    }
    return entries;
  }, [activeType, searchQuery, visibleItems]);

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
  };

  const saveItem = (updatedItem) => {
    setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item));
    persistEdit(updatedItem);
  };

  const deleteItem = async (id) => {
    const item = items.find((candidate) => candidate.id === id);
    const itemName = item?.name || "ovaj komad";
    if (!window.confirm(`Trajno obrisati “${itemName}” iz ormara? Obrisat će se zapis i sve njegove spremljene slike. Ovu radnju nije moguće poništiti.`)) return;
    setDeletingItemId(id);
    setDeleteItemError("");
    try {
      if (id.startsWith("import-")) {
        const response = await fetch(`/api/import/wardrobe/${id}`, { method: "DELETE" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok && response.status !== 404) throw new Error(body.error || "Komad trenutačno nije moguće obrisati.");
      }
      setItems((current) => current.filter((candidate) => candidate.id !== id));
      removePersistedEdit(id);
      persistDeletedItem(id);
      setSelectedId(null);
    } catch (requestError) {
      setDeleteItemError(requestError.message || "Komad trenutačno nije moguće obrisati.");
    } finally {
      setDeletingItemId(null);
    }
  };

  const addImportedItem = useCallback((newItem) => {
    setItems((current) => current.some((item) => item.id === newItem.id) ? current : [...current, newItem]);
  }, []);

  const attachImportedModeledImage = useCallback((jobId, modeledImage) => {
    const id = `import-${jobId}`;
    setItems((current) => current.map((item) => item.id === id ? { ...item, modeledImage } : item));
  }, []);

  const deleteModeledImage = async (id) => {
    if (!id.startsWith("import-") || !window.confirm("Delete only the modeled photo and keep the garment?")) return;
    const response = await fetch(`/api/import/wardrobe/${id}/modeled`, { method: "DELETE" });
    if (!response.ok) return setError("Could not delete the modeled photo.");
    setItems((current) => current.map((item) => item.id === id ? { ...item, modeledImage: null } : item));
  };

  return (
    <div className={`app-shell${selectedItem && activeSection === "wardrobe" ? " has-selection" : ""}${activeSection === "outfits" ? " app-shell--plain" : ""}`}>
      <header className="site-header">
        <button className="site-brand" type="button" onClick={() => openSection("wardrobe")}>
          <strong>Noa's Wardrobe</strong><span>Privatni modni arhiv</span>
        </button>
        <nav className="site-nav" aria-label="Glavna navigacija">
          <button className={activeSection === "wardrobe" ? "active" : ""} aria-current={activeSection === "wardrobe" ? "page" : undefined} type="button" onClick={() => openSection("wardrobe")}>Ormar</button>
          <button className={activeSection === "outfits" ? "active" : ""} aria-current={activeSection === "outfits" ? "page" : undefined} type="button" onClick={() => openSection("outfits")}>Kombinacije</button>
          <button className={activeSection === "looks" ? "active" : ""} aria-current={activeSection === "looks" ? "page" : undefined} type="button" onClick={() => openSection("looks")}>Na meni</button>
        </nav>
        <div className="site-actions">
          <button type="button" onClick={openSettings} aria-label="Postavke"><GearSix size={19} /></button>
          <button type="button" onClick={logout} aria-label="Odjava"><SignOut size={19} /></button>
        </div>
      </header>
      {activeSection === "wardrobe" && (
        <main className="gallery-pane">
          <header className="gallery-header">
            <div className="gallery-meta-row">
              <div>
                <p className="private-label">Moja kolekcija</p>
                <h1 className="wardrobe-title">Ormar</h1>
                <p className="wardrobe-intro">Brzo pronađi komad, složi kombinaciju ili pogledaj kako ti stoji.</p>
              </div>
              <div className="collection-count" aria-label={`${items.length} komada u ormaru`}>
                <strong>{items.length}</strong>
                <span>{items.length === 1 ? "komad" : "komada"}</span>
              </div>
            </div>
            <div className="wardrobe-actions" aria-label="Radnje ormara">
              <div className="wardrobe-actions__primary">
                <button className="wardrobe-action wardrobe-action--primary" type="button" onClick={openImporter}><Plus size={17} weight="bold" /> Dodaj odjeću</button>
                <button className="wardrobe-action" type="button" onClick={() => openSection("outfits")}><Sparkle size={17} /> Složi kombinaciju</button>
              </div>
              <div className="wardrobe-actions__meta">
                <p><strong>Možeš odabrati više fotografija odjednom.</strong> Svaki prepoznati komad potvrđuješ prije spremanja.</p>
                {usage && <span className="usage-pill" title={usage.note}><ChartLine size={15} /> {usageValue(usage, "today", "images")}{usage.dailyImageLimit > 0 ? `/${usage.dailyImageLimit}` : ""} AI generacija danas</span>}
              </div>
            </div>
            <div className="wardrobe-search-row">
              <label className="wardrobe-search">
                <MagnifyingGlass size={18} aria-hidden="true" />
                <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Pretraži naziv, kategoriju ili tag" autoComplete="off" />
                {searchQuery && <button type="button" onClick={() => setSearchQuery("")} aria-label="Očisti pretragu"><X size={16} /></button>}
              </label>
              <span className="wardrobe-search-status" aria-live="polite">{searchQuery ? `${visibleItems.length} ${visibleItems.length === 1 ? "rezultat" : "rezultata"}` : "Brza pretraga cijele kolekcije"}</span>
            </div>
            <nav className="category-nav" aria-label="Filtriraj ormar po kategoriji">
              {TYPES.map((type) => (
                <button key={type.id} type="button" className={activeType === type.id ? "active" : ""} onClick={() => chooseType(type.id)} aria-pressed={activeType === type.id}>{type.label}</button>
              ))}
            </nav>
          </header>

          {error && <div className="wardrobe-state wardrobe-state--error"><h2>Ormar trenutačno nije dostupan</h2><p>{error}</p><button onClick={retryWardrobe}>Pokušaj ponovno</button></div>}
          {!error && loading && <div className="wardrobe-state"><SpinnerGap className="wardrobe-state__spinner" size={22} /><h2>Učitavam ormar</h2><p>Ako se server ponovno pokreće, povezivanje će se automatski nastaviti.</p></div>}
          {!error && !loading && !items.length && <div className="wardrobe-state wardrobe-state--empty"><TShirt size={30} /><h2>Tvoj ormar je spreman</h2><p>Dodaj jednu ili više fotografija odjeće. Svaki ćeš komad potvrditi prije spremanja.</p><button onClick={openImporter}><Plus size={16} /> Dodaj prve komade</button></div>}

          {!error && !loading && !!items.length && !visibleItems.length && (
            <div className="wardrobe-state wardrobe-state--empty">
              <MagnifyingGlass size={30} />
              <h2>Nema pronađenih komada</h2>
              <p>Promijeni pojam pretrage ili odaberi drugu kategoriju.</p>
              <button type="button" onClick={() => { setSearchQuery(""); setActiveType("all"); }}>Prikaži cijeli ormar</button>
            </div>
          )}

          {!!visibleItems.length && (
            <section className="gallery-grid" aria-label={`${TYPE_MAP[activeType]?.label || "Svi"} komadi`}>
              {galleryEntries.map((entry) => entry.type === "heading" ? (
                <h2 className="gallery-group-heading" key={entry.key}>
                  <span>{TYPE_MAP[entry.part]?.label || "Komadi"}</span>
                  <small>{entry.count}</small>
                </h2>
              ) : (
                <GalleryItem key={entry.item.id} item={entry.item} index={entry.index} selected={selectedId === entry.item.id} onOpen={setSelectedId} />
              ))}
            </section>
          )}
        </main>
      )}

      {activeSection === "outfits" && <Suspense fallback={<div className="section-loading"><SpinnerGap className="wardrobe-state__spinner" size={22} /> Učitavam kombinacije…</div>}><OutfitPlanner embedded items={items} usage={usage} onClose={() => openSection("wardrobe")} onOpenSettings={openSettings} onOpenLooks={() => openSection("looks")} /></Suspense>}
      {activeSection === "looks" && <LooksCollection onOpenWardrobe={() => openSection("wardrobe")} items={items} />}

      {activeSection === "wardrobe" && selectedItem && <ItemViewer item={selectedItem} onClose={() => setSelectedId(null)} onSave={saveItem} onDelete={deleteItem} onDeleteModeled={deleteModeledImage} onOpenSettings={openSettings} deleting={deletingItemId === selectedItem.id} deleteError={deleteItemError} />}
      <Suspense fallback={null}>
        <WardrobeImportFlow launcherVisible={activeSection === "wardrobe"} onGarmentApproved={addImportedItem} onModeledApproved={attachImportedModeledImage} />
      </Suspense>
      {settingsOpen && (
        <div className="settings-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings-heading"><div><p className="private-label">Owner controls</p><h2 id="settings-title">Privacy & data</h2></div><button className="viewer-icon-close" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={20} /></button></div>
            <p>Your images are stored in your private storage. Images required for analysis or generation are sent to the OpenAI API. This single-user application has no analytics, ads, or tracking.</p>
            <div className="settings-card"><h3>API usage estimate</h3><p>Today · analysis: {usageValue(usage, "today", "analysis")} requested, {usageValue(usage, "today", "analysis", "succeeded")} succeeded, {usageValue(usage, "today", "analysis", "failed")} failed.</p><p>Today · images: {usageValue(usage, "today", "images")} requested, {usageValue(usage, "today", "images", "succeeded")} succeeded, {usageValue(usage, "today", "images", "failed")} failed.</p><p>App generation limit: {usage?.dailyImageLimit > 0 ? `${usage.dailyImageLimit} requested generations per day` : "unlimited"}. Change <code>DAILY_IMAGE_GENERATION_LIMIT</code> in the server environment and restart the app.</p><p>This month · images: {usageValue(usage, "monthly", "images")} requested, {usageValue(usage, "monthly", "images", "succeeded")} succeeded, {usageValue(usage, "monthly", "images", "failed")} failed. OpenAI Billing is the final source of actual spend.</p></div>
            <div className="settings-card"><div className="settings-card__title"><h3>Reference photograph</h3><span data-ready={referenceConfigured === true}>{referenceConfigured === null ? "Checking…" : referenceConfigured ? "Ready for try-on" : "Not added"}</span></div><p>The reference image is used only for an outfit try-on and is never served back to the browser after upload.</p><label className="reference-upload">Upload or replace photo<input type="file" accept={IMAGE_ACCEPT} onChange={async (event) => {
              const file = event.target.files?.[0]; if (!file) return;
              try {
                setSettingsNotice({ tone: "progress", text: isHeicFile(file) ? "Converting HEIC privately in your browser…" : "Saving the private reference photo…" });
                const prepared = await prepareImageFile(file);
                const response = await fetch("/api/settings/model-reference", { method: "PUT", headers: { "Content-Type": prepared.type }, body: prepared });
                if (!response.ok) throw new Error("Could not store the reference photo. Use PNG, JPEG, WebP, HEIC or HEIF under the upload limit.");
                setReferenceConfigured(true); setSettingsNotice({ tone: "success", text: "Reference photo saved. Outfit try-on is ready." }); window.dispatchEvent(new Event("wardrobe:setup-refresh"));
              } catch (uploadError) {
                setSettingsNotice({ tone: "error", text: uploadError.message });
              } finally {
                event.target.value = "";
              }
            }} /></label>
            <button className="reference-camera-button" type="button" onClick={() => setCameraOpen(true)}><Camera size={15} weight="bold" /> Take a photo of yourself</button>
            <button className="delete-button" type="button" onClick={async () => {
              if (!window.confirm("Delete the private model reference photo?")) return;
              const response = await fetch("/api/settings/model-reference", { method: "DELETE" });
              if (response.ok) { setReferenceConfigured(false); setSettingsNotice({ tone: "success", text: "Reference photo deleted. Your wardrobe remains unchanged." }); window.dispatchEvent(new Event("wardrobe:setup-refresh")); }
              else setSettingsNotice({ tone: "error", text: "Could not delete the reference photo." });
            }}><Trash size={15} /> Delete reference</button></div>
            <div className="settings-card">
              <h3>Prikaz komada u Ormaru</h3>
              <p>Koji prikaz se prvo otvori kad klikneš na komad odjeće.</p>
              <div className="settings-toggle-row">
                <button type="button" className={defaultView === "photos" ? "active" : ""} aria-pressed={defaultView === "photos"} onClick={() => { setDefaultView("photos"); writeDefaultViewPreference("photos"); }}>Kako mi stoji</button>
                <button type="button" className={defaultView === "garment" ? "active" : ""} aria-pressed={defaultView === "garment"} onClick={() => { setDefaultView("garment"); writeDefaultViewPreference("garment"); }}>Komad</button>
              </div>
            </div>
            <div className="settings-card">
              <h3>Lokacija za vrijeme</h3>
              <p>Ako uključiš, Kombinacije će same pokušati dohvatiti vrijeme prema tvojoj lokaciji čim otvoriš stranicu, bez klika na "Koristi moju lokaciju".</p>
              <label className="settings-checkbox">
                <input type="checkbox" checked={rememberLocation} onChange={(event) => { setRememberLocation(event.target.checked); writeWeatherLocationPreference(event.target.checked); }} />
                Zapamti korištenje lokacije za vrijeme
              </label>
            </div>
            <div className="settings-card">
              <h3>Ručni unos vremena</h3>
              <p>Približni uvjeti koje Kombinacije koriste kad lokacija nije uključena — spremaju se ovdje pa ih ne moraš unositi svaki put iznova.</p>
              <div className="settings-weather">
                <label className="settings-weather__temp">
                  <span>Temperatura otprilike</span>
                  <span className="settings-weather__number">
                    <input type="number" min="-30" max="50" step="1" inputMode="numeric" value={manualWeatherDraft.temperature} onChange={(event) => setManualWeatherDraft((current) => ({ ...current, temperature: event.target.value }))} aria-label="Približna temperatura u Celzijevim stupnjevima" />
                    <b>°C</b>
                  </span>
                </label>
                <fieldset>
                  <legend>Oborine</legend>
                  <div className="settings-weather__segments">
                    {[{ value: "none", label: "Nema" }, { value: "rain", label: "Kiša" }, { value: "snow", label: "Snijeg" }].map((option) => (
                      <button key={option.value} type="button" className={manualWeatherDraft.precipitation === option.value ? "active" : ""} aria-pressed={manualWeatherDraft.precipitation === option.value} onClick={() => setManualWeatherDraft((current) => ({ ...current, precipitation: option.value }))}>{option.label}</button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Vjetar</legend>
                  <div className="settings-weather__segments">
                    {[{ value: "light", label: "Slab" }, { value: "moderate", label: "Umjeren" }, { value: "strong", label: "Jak" }].map((option) => (
                      <button key={option.value} type="button" className={manualWeatherDraft.wind === option.value ? "active" : ""} aria-pressed={manualWeatherDraft.wind === option.value} onClick={() => setManualWeatherDraft((current) => ({ ...current, wind: option.value }))}>{option.label}</button>
                    ))}
                  </div>
                </fieldset>
              </div>
              <button type="button" className="reference-camera-button" onClick={() => {
                const temperature = Number(manualWeatherDraft.temperature);
                if (!Number.isFinite(temperature) || temperature < -30 || temperature > 50) {
                  setSettingsNotice({ tone: "error", text: "Unesi temperaturu između −30 i 50 °C." });
                  return;
                }
                writeStoredManualWeather({ temperature, precipitation: manualWeatherDraft.precipitation, wind: manualWeatherDraft.wind });
                setSettingsNotice({ tone: "success", text: "Ručni uvjeti su spremljeni za Kombinacije." });
              }}>Spremi ručne uvjete</button>
            </div>
            {settingsNotice && <p className="settings-notice" data-tone={settingsNotice.tone} role="status" aria-live="polite">{settingsNotice.text}</p>}
            <div className="settings-actions"><a className="secondary-button export-link" href="/api/export">Download wardrobe export</a></div>
            <div className="settings-card danger-zone"><h3>Destructive controls</h3><button className="delete-button" type="button" onClick={async () => {
              if (!window.confirm("Delete the entire wardrobe and all generated images? This cannot be undone.")) return;
              const response = await fetch("/api/data/wardrobe", { method: "DELETE", headers: { "X-Confirm-Action": "DELETE WARDROBE" } });
              if (response.ok) { setItems([]); setSelectedId(null); setSettingsOpen(false); }
              else setError("Could not delete the wardrobe.");
            }}><Trash size={15} /> Delete entire wardrobe</button><button className="secondary-button" type="button" onClick={async () => {
              const response = await fetch("/api/maintenance/cleanup", { method: "POST" });
              if (!response.ok) setError("Could not clean old temporary jobs.");
            }}>Clean old temporary jobs</button></div>
          </section>
        </div>
      )}
      {cameraOpen && (
        <Suspense fallback={null}>
          <CameraCapture
            onClose={() => setCameraOpen(false)}
            onSaved={() => {
              setCameraOpen(false);
              setReferenceConfigured(true);
              setSettingsNotice({ tone: "success", text: "Reference photo saved. Outfit try-on is ready." });
              window.dispatchEvent(new Event("wardrobe:setup-refresh"));
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
