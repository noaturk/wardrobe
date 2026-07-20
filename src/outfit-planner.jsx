import { useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "@phosphor-icons/react/Camera";
import { Check } from "@phosphor-icons/react/Check";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Trash } from "@phosphor-icons/react/Trash";
import { UploadSimple } from "@phosphor-icons/react/UploadSimple";
import { X } from "@phosphor-icons/react/X";
import { CameraCapture, uploadModelReference } from "./camera-capture.jsx";
import { IMAGE_ACCEPT, isHeicFile } from "./image-files.mjs";
import { CATEGORY_LABELS, buildOutfitSuggestions } from "./outfit-suggestions.mjs";
import "./outfit-planner.css";

export { buildOutfitSuggestions } from "./outfit-suggestions.mjs";

async function request(path, options) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The outfit request could not be completed.");
  return body;
}

function OutfitPieces({ items }) {
  return <div className="outfit-pieces">{items.map((item) => <figure key={item.id}><img src={item.thumbnail || item.image} alt="" /><figcaption>{item.name || CATEGORY_LABELS[item.part]}</figcaption></figure>)}</div>;
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
          <strong>Add a photo of yourself first</strong>
          <p>Take a selfie or upload one photo. It is stored privately, used only for a try-on, and never shown in your wardrobe.</p>
        </div>
      </div>
      <div className="outfit-reference__actions">
        <button type="button" className="outfit-reference__primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <><SpinnerGap size={15} className="outfit-spin" /> {uploadLabel}</> : <><UploadSimple size={16} weight="bold" /> Upload your photo</>}
        </button>
        <button type="button" className="outfit-reference__secondary" onClick={() => setCameraOpen(true)} disabled={uploading}>
          <Camera size={15} /> Use camera
        </button>
        <button type="button" className="outfit-reference__link" onClick={onOpenSettings}>
          <GearSix size={14} /> Manage in Settings
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

export function OutfitPlanner({ items, usage, onClose, onOpenSettings }) {
  const suggestions = useMemo(() => buildOutfitSuggestions(items), [items]);
  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState([]);
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

  useEffect(() => {
    Promise.all([request("/api/outfits"), request("/api/import/config")])
      .then(([stored, setup]) => { setSaved(stored); setReferenceReady(Boolean(setup.hasModelReference)); })
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
    setError(""); setGenerating(true); setStartedAt(Date.now()); setElapsed(0);
    try {
      const result = await request("/api/outfits/generate", {
        method: "POST",
        body: JSON.stringify({ itemIds: selected.items.map((item) => item.id), name: selected.name, direction }),
      });
      setSaved((current) => [result, ...current]);
      setGeneratedNow((current) => current + 1);
      setSelected(null);
      setDirection("");
    } catch (requestError) { setError(requestError.message); }
    finally { setGenerating(false); window.dispatchEvent(new Event("wardrobe:usage-refresh")); }
  };

  const remove = async (outfit) => {
    if (!window.confirm(`Delete the generated preview “${outfit.name}”?`)) return;
    try {
      await request(`/api/outfits/${outfit.id}`, { method: "DELETE" });
      setSaved((current) => current.filter((item) => item.id !== outfit.id));
    } catch (requestError) { setError(requestError.message); }
  };

  const elapsedLabel = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`;

  return (
    <div className="outfit-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !generating && onClose()}>
      <section className="outfit-panel" role="dialog" aria-modal="true" aria-labelledby="outfit-title" aria-busy={generating}>
        <header className="outfit-heading">
          <div>
            <p><Sparkle size={12} weight="fill" /> Outfit studio</p>
            <h2 id="outfit-title">Plan first. Try on only what you choose.</h2>
          </div>
          <button onClick={onClose} disabled={generating} aria-label="Close outfit studio"><X size={21} /></button>
        </header>
        <ol className="outfit-flow">
          <li className="active"><span>1</span>Choose</li>
          <li className={selected ? "active" : ""}><span>2</span>Review</li>
          <li className={generating || saved.length ? "active" : ""}><span>3</span>Try on yourself</li>
        </ol>

        {generating ? (
          <div className="outfit-generating">
            <SpinnerGap size={30} />
            <div>
              <h3>Trying this outfit on your photo</h3>
              <p>OpenAI is placing {selected.items.length} exact wardrobe pieces onto your private reference. Usually 30–120 seconds.</p>
              <strong>{elapsedLabel} elapsed</strong>
            </div>
            <OutfitPieces items={selected.items} />
          </div>
        ) : selected ? (
          <div className="outfit-selection">
            <button className="outfit-back" onClick={() => setSelected(null)}>← Back to suggestions</button>
            <div className="outfit-selection__copy">
              <div>
                <p>Selected combination</p>
                <h3>{selected.name}</h3>
                <span>{selected.reason}</span>
              </div>
              <OutfitPieces items={selected.items} />
            </div>
            <label className="outfit-direction">
              <span>Optional direction</span>
              <textarea value={direction} onChange={(event) => setDirection(event.target.value)} maxLength={500} rows={3} placeholder="Example: full-body photo, quiet city street, natural daylight" />
            </label>
            {referenceReady === false ? (
              <ReferenceGate referenceReady={referenceReady} onOpenSettings={onOpenSettings} onReferenceSaved={markReferenceReady} />
            ) : (
              <div className="outfit-confirm">
                <div className="outfit-confirm__meta">
                  {referenceReady === true && (
                    <span className="outfit-reference-chip">
                      <Check size={12} weight="bold" /> Your photo is ready
                      <button type="button" onClick={() => setRetakeOpen(true)}>Replace photo</button>
                    </span>
                  )}
                  <p><strong>This button uses 1 image generation.</strong> Nothing is generated while you browse suggestions.</p>
                </div>
                <button className="outfit-confirm__go" disabled={referenceReady !== true} onClick={generate}>
                  {referenceReady === null ? "Checking your photo…" : <><Sparkle size={16} weight="fill" /> Try this outfit on me</>}
                </button>
              </div>
            )}
            {referenceNotice && <p className="outfit-reference-notice" role="status">{referenceNotice}</p>}
          </div>
        ) : (
          <>
            <section className="outfit-intro">
              <div>
                <h3>Suggested from your wardrobe</h3>
                <p>Suggestions use the categories and colors already saved in your wardrobe. They do not call OpenAI and cost nothing.</p>
              </div>
              <span>{items.length} pieces available</span>
            </section>
            {suggestions.length ? (
              <div className="outfit-suggestions">
                {suggestions.map((suggestion) => (
                  <article key={suggestion.id}>
                    <OutfitPieces items={suggestion.items} />
                    <div>
                      <h3>{suggestion.name}</h3>
                      <p>{suggestion.reason}</p>
                      <small>{suggestion.items.map((item) => item.name || CATEGORY_LABELS[item.part]).join(" · ")}</small>
                    </div>
                    <button onClick={() => setSelected(suggestion)}>Choose this combination</button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="outfit-empty">
                <h3>Add pieces from at least two categories</h3>
                <p>For useful combinations, start with at least one top and one bottom. Shoes, jackets and accessories make suggestions richer.</p>
                <button onClick={() => { onClose(); window.dispatchEvent(new Event("wardrobe:add-clothes")); }}>Add more clothes</button>
              </div>
            )}
          </>
        )}

        {!!saved.length && !generating && !selected && (
          <section className="outfit-saved">
            <div>
              <h3>Yourself in these outfits</h3>
              <p>Try-on results generated on your photo, stored privately on your Hostinger server.</p>
            </div>
            <div className="outfit-saved__grid">
              {saved.map((outfit) => (
                <article key={outfit.id}>
                  <img src={outfit.image} alt={`${outfit.name} on your reference photo`} />
                  <div><strong>{outfit.name}</strong><small>{new Date(outfit.createdAt).toLocaleDateString()}</small></div>
                  <button onClick={() => remove(outfit)} aria-label={`Delete ${outfit.name}`}><Trash size={15} /></button>
                </article>
              ))}
            </div>
          </section>
        )}
        {loading && <p className="outfit-status"><SpinnerGap size={16} /> Loading saved try-ons…</p>}
        {error && <p className="outfit-error" role="alert">{error}</p>}
        {usage && <footer className="outfit-usage">Today: {(typeof usage.today.images === "number" ? usage.today.images : usage.today.images?.requested || 0) + generatedNow}{usage.dailyImageLimit > 0 ? `/${usage.dailyImageLimit}` : ""} image generations started{usage.dailyImageLimit > 0 ? "." : " · no app limit."}</footer>}
      </section>
      {retakeOpen && <CameraCapture title="Retake your photo" onClose={() => setRetakeOpen(false)} onSaved={() => { setRetakeOpen(false); markReferenceReady(); }} />}
    </div>
  );
}
