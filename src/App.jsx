import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "@phosphor-icons/react/Check";
import { ChartLine } from "@phosphor-icons/react/ChartLine";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { Plus } from "@phosphor-icons/react/Plus";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { SignOut } from "@phosphor-icons/react/SignOut";
import { TShirt } from "@phosphor-icons/react/TShirt";
import { Trash } from "@phosphor-icons/react/Trash";
import { Camera } from "@phosphor-icons/react/Camera";
import { X } from "@phosphor-icons/react/X";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { IMAGE_ACCEPT, isHeicFile, prepareImageFile } from "./image-files.mjs";

const CameraCapture = lazy(() => import("./camera-capture.jsx").then((module) => ({ default: module.CameraCapture })));

const WardrobeImportFlow = lazy(() => import("./import-flow.jsx").then((module) => ({ default: module.WardrobeImportFlow })));
const OutfitPlanner = lazy(() => import("./outfit-planner.jsx").then((module) => ({ default: module.OutfitPlanner })));

const STORAGE_KEY = "open-wardrobe-edits-v1";
const DELETED_STORAGE_KEY = "open-wardrobe-deleted-v1";

const TYPES = [
  { id: "all", label: "All" },
  { id: "upperbody", label: "Tops", singular: "Top" },
  { id: "wholebody_up", label: "Jackets", singular: "Jacket" },
  { id: "lowerbody", label: "Bottoms", singular: "Bottom" },
  { id: "accessories_up", label: "Accessories", singular: "Accessory" },
  { id: "shoes", label: "Shoes", singular: "Shoes" },
];

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));

function usageValue(usage, period, kind, outcome = "requested") {
  const value = usage?.[period]?.[kind];
  return typeof value === "number" ? (outcome === "requested" ? value : 0) : Number(value?.[outcome] || 0);
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
  const type = TYPE_MAP[item.part]?.singular || "wardrobe item";

  return (
    <button
      className={`gallery-item${selected ? " selected" : ""}`}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`View ${item.name || type}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
    >
      <span className="gallery-item__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
      <span className="gallery-item__art"><OptimizedImage
          src={item.thumbnail || item.image}
          alt=""
          sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
          breakpoints={[120, 180, 240, 320, 480]}
        /></span>
      <span className="gallery-item__copy"><strong>{item.name || type}</strong><small>{TYPE_MAP[item.part]?.singular || type}</small></span>
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

function ItemAppearanceStudio({ item, onOpenSettings }) {
  const libraryRef = useRef(null);
  const cameraRef = useRef(null);
  const [records, setRecords] = useState([]);
  const [referenceReady, setReferenceReady] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState(null);

  const loadStudio = useCallback(async () => {
    try {
      const [outfitsResponse, configResponse] = await Promise.all([
        fetch("/api/outfits", { cache: "no-store" }),
        fetch("/api/import/config", { cache: "no-store" }),
      ]);
      if (!outfitsResponse.ok || !configResponse.ok) throw new Error("Could not load your try-on studio.");
      const [outfits, config] = await Promise.all([outfitsResponse.json(), configResponse.json()]);
      setRecords(outfits.filter((record) => record.itemIds?.includes(item.id)));
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

  const addResult = (record, text) => {
    setRecords((current) => [record, ...current]);
    setNotice({ tone: "success", text });
  };

  const generateWithAI = async () => {
    if (referenceReady !== true || busy) return;
    setBusy("ai");
    setStartedAt(Date.now());
    setElapsed(0);
    setNotice({ tone: "progress", text: "Preparing your private reference and this exact garment…" });
    try {
      const response = await fetch("/api/outfits/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: [item.id], name: `${item.name || "Wardrobe piece"} on me` }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The AI try-on could not be created.");
      addResult(body, "AI try-on finished and was saved privately.");
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
    setNotice({ tone: "progress", text: isHeicFile(file) ? "Converting your iPhone photo privately…" : "Saving your photo privately…" });
    try {
      const prepared = await prepareImageFile(file);
      const response = await fetch(`/api/outfits/photos?itemId=${encodeURIComponent(item.id)}`, {
        method: "POST",
        headers: { "Content-Type": prepared.type },
        body: prepared,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Your wearing photo could not be saved.");
      addResult(body, "Your real photo was saved privately. No AI generation was used.");
    } catch (uploadError) {
      setNotice({ tone: "error", text: uploadError.message });
    } finally {
      setBusy("");
    }
  };

  const removeResult = async (record) => {
    if (!window.confirm(`Delete “${record.name}”?`)) return;
    const response = await fetch(`/api/outfits/${record.id}`, { method: "DELETE" });
    if (response.ok) setRecords((current) => current.filter((candidate) => candidate.id !== record.id));
    else setNotice({ tone: "error", text: "That result could not be deleted." });
  };

  const elapsedLabel = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`;

  return (
    <section className="appearance-studio" aria-labelledby={`appearance-${item.id}`} aria-busy={Boolean(busy)}>
      <div className="appearance-studio__heading">
        <div>
          <p>On you</p>
          <h3 id={`appearance-${item.id}`}>See it worn, your way.</h3>
        </div>
        {loading && <SpinnerGap className="wardrobe-state__spinner" size={18} aria-label="Loading try-ons" />}
      </div>

      <div className="appearance-choices">
        <article className="appearance-choice appearance-choice--ai">
          <span className="appearance-choice__number">01</span>
          <Sparkle size={22} weight="fill" aria-hidden="true" />
          <div><strong>Try with AI</strong><p>Uses your saved reference photo and this garment.</p></div>
          {referenceReady === false ? (
            <button type="button" onClick={onOpenSettings}>Add reference photo</button>
          ) : (
            <button type="button" onClick={generateWithAI} disabled={referenceReady !== true || Boolean(busy)}>
              {busy === "ai" ? <><SpinnerGap className="wardrobe-state__spinner" size={15} /> Generating · {elapsedLabel}</> : "Create AI try-on"}
            </button>
          )}
        </article>

        <article className="appearance-choice appearance-choice--photo">
          <span className="appearance-choice__number">02</span>
          <Camera size={22} weight="bold" aria-hidden="true" />
          <div><strong>Add my real photo</strong><p>Photograph yourself wearing it. No AI or OpenAI cost.</p></div>
          <div className="appearance-choice__photo-actions">
            <button type="button" onClick={() => cameraRef.current?.click()} disabled={Boolean(busy)}>Take photo</button>
            <button type="button" onClick={() => libraryRef.current?.click()} disabled={Boolean(busy)}>Choose photo</button>
          </div>
        </article>
      </div>

      {busy === "photo" && <p className="appearance-notice" data-tone="progress"><SpinnerGap className="wardrobe-state__spinner" size={14} /> Saving photo · {elapsedLabel}</p>}
      {notice && <p className="appearance-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>}

      {!!records.length && (
        <div className="appearance-history">
          <div className="appearance-history__heading"><strong>Your looks</strong><span>{records.length} saved</span></div>
          <div className="appearance-history__rail">
            {records.map((record) => (
              <figure key={record.id}>
                <img src={record.image} alt={`${record.name}, ${record.source === "ai" ? "AI try-on" : "your real photo"}`} />
                <figcaption><span>{record.source === "ai" ? "AI try-on" : "My photo"}</span><time>{new Date(record.createdAt).toLocaleDateString()}</time></figcaption>
                <button type="button" onClick={() => removeResult(record)} aria-label={`Delete ${record.name}`}><Trash size={14} /></button>
              </figure>
            ))}
          </div>
        </div>
      )}

      <input ref={libraryRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(event) => { void uploadWearingPhoto(event.target.files?.[0]); event.target.value = ""; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="user" hidden onChange={(event) => { void uploadWearingPhoto(event.target.files?.[0]); event.target.value = ""; }} />
    </section>
  );
}

function ItemViewer({ item, onClose, onSave, onDelete, onDeleteModeled, onOpenSettings }) {
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

export function App() {
  const [items, setItems] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [outfitsOpen, setOutfitsOpen] = useState(false);
  const [usage, setUsage] = useState(null);
  const [referenceConfigured, setReferenceConfigured] = useState(null);
  const [settingsNotice, setSettingsNotice] = useState(null);
  const [cameraOpen, setCameraOpen] = useState(false);

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
    setOutfitsOpen(false);
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

  const visibleItems = useMemo(() => {
    const filtered = activeType === "all" ? items : items.filter((item) => item.part === activeType);
    return [...filtered].sort((a, b) => {
      if (activeType === "all") {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      return a.id.localeCompare(b.id);
    });
  }, [activeType, items]);

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
  };

  const saveItem = (updatedItem) => {
    setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item));
    persistEdit(updatedItem);
  };

  const deleteItem = async (id) => {
    if (!window.confirm("Delete this wardrobe item and all of its stored images?")) return;
    if (id.startsWith("import-")) {
      try {
        const response = await fetch(`/api/import/wardrobe/${id}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error("Could not delete the imported item.");
      } catch (requestError) {
        setError(requestError.message);
        return;
      }
    }
    setItems((current) => current.filter((item) => item.id !== id));
    removePersistedEdit(id);
    persistDeletedItem(id);
    setSelectedId(null);
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
    <div className={`app-shell${selectedItem ? " has-selection" : ""}`}>
      <header className="site-header">
        <button className="site-brand" type="button" onClick={() => { setSelectedId(null); setOutfitsOpen(false); }}>
          <strong>Noa's Wardrobe</strong><span>Private dressing archive</span>
        </button>
        <nav className="site-nav" aria-label="Main navigation">
          <button className="active" type="button" onClick={() => { setSelectedId(null); setOutfitsOpen(false); }}>Wardrobe</button>
          <button type="button" onClick={() => setOutfitsOpen(true)}>Outfits</button>
          <button type="button" onClick={() => setOutfitsOpen(true)}>On me</button>
        </nav>
        <div className="site-actions">
          <button className="site-add" type="button" onClick={openImporter}><Plus size={17} weight="bold" /> Add clothes</button>
          <button type="button" onClick={openSettings} aria-label="Settings"><GearSix size={19} /></button>
          <button type="button" onClick={logout} aria-label="Log out"><SignOut size={19} /></button>
        </div>
      </header>
      <main className="gallery-pane">
        <header className="gallery-header">
          <div className="collection-rule"><span>Collection / 01</span><span>Private &amp; server-stored</span></div>
          <div className="gallery-meta-row">
            <div>
              <p className="private-label">Wardrobe index</p>
              <h1 className="wardrobe-title">The everyday archive.</h1>
              <p className="wardrobe-intro">Upload the pieces you actually own, build combinations, then see the chosen look on you.</p>
            </div>
            <div className="collection-count" aria-label={`${items.length} wardrobe pieces`}>
              <strong>{String(items.length).padStart(2, "0")}</strong>
              <span>{items.length === 1 ? "piece" : "pieces"}<br />catalogued</span>
            </div>
          </div>
          <div className="wardrobe-actions" aria-label="Wardrobe actions">
            <button className="wardrobe-action wardrobe-action--primary" type="button" onClick={openImporter}><Plus size={17} weight="bold" /> Add clothes</button>
            <button className="wardrobe-action" type="button" onClick={() => setOutfitsOpen(true)}><Sparkle size={17} /> Plan outfits</button>
            <p><strong>You can select several photos at once.</strong> Each detected item waits for your review before it is added.</p>
            {usage && <span className="usage-pill" title={usage.note}><ChartLine size={15} /> {usageValue(usage, "today", "images")}{usage.dailyImageLimit > 0 ? `/${usage.dailyImageLimit}` : ""} AI images today</span>}
          </div>
          <nav className="category-nav" aria-label="Filter wardrobe by item type">
            {TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className={activeType === type.id ? "active" : ""}
                onClick={() => chooseType(type.id)}
                aria-pressed={activeType === type.id}
              >
                {type.label}
              </button>
            ))}
          </nav>
        </header>

        {error && <div className="wardrobe-state wardrobe-state--error"><h2>Wardrobe temporarily unavailable</h2><p>{error}</p><button onClick={retryWardrobe}>Try again</button></div>}
        {!error && loading && <div className="wardrobe-state"><SpinnerGap className="wardrobe-state__spinner" size={22} /><h2>Loading your wardrobe</h2><p>Reconnecting automatically if the local server is restarting.</p></div>}
        {!error && !loading && !items.length && <div className="wardrobe-state wardrobe-state--empty"><TShirt size={30} /><h2>Your wardrobe is ready</h2><p>Add one or several clothing photos. You will approve each piece before it is saved.</p><button onClick={openImporter}><Plus size={16} /> Add your first clothes</button></div>}

        {!!items.length && (
          <section className="gallery-grid" aria-label={`${TYPE_MAP[activeType]?.label || "All"} wardrobe items`}>
            {visibleItems.map((item, index) => (
              <GalleryItem
                key={item.id}
                item={item}
                index={index}
                selected={selectedId === item.id}
                onOpen={setSelectedId}
              />
            ))}
          </section>
        )}
      </main>

      {selectedItem && <ItemViewer item={selectedItem} onClose={() => setSelectedId(null)} onSave={saveItem} onDelete={deleteItem} onDeleteModeled={deleteModeledImage} onOpenSettings={openSettings} />}
      <Suspense fallback={null}>
        <WardrobeImportFlow onGarmentApproved={addImportedItem} onModeledApproved={attachImportedModeledImage} />
      </Suspense>
      {outfitsOpen && <Suspense fallback={null}><OutfitPlanner items={items} usage={usage} onClose={() => setOutfitsOpen(false)} onOpenSettings={openSettings} /></Suspense>}
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
