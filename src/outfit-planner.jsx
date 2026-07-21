import { useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "@phosphor-icons/react/Camera";
import { Check } from "@phosphor-icons/react/Check";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { Plus } from "@phosphor-icons/react/Plus";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { UploadSimple } from "@phosphor-icons/react/UploadSimple";
import { X } from "@phosphor-icons/react/X";
import { CameraCapture, uploadModelReference } from "./camera-capture.jsx";
import { IMAGE_ACCEPT, isHeicFile } from "./image-files.mjs";
import { CATEGORY_LABELS, buildOutfitSuggestions } from "./outfit-suggestions.mjs";
import "./outfit-planner.css";

export { buildOutfitSuggestions } from "./outfit-suggestions.mjs";

const CATEGORY_NAMES = {
  upperbody: "Gornji dio",
  wholebody_up: "Jakna",
  lowerbody: "Donji dio",
  accessories_up: "Dodatak",
  shoes: "Obuća",
};

function categoryName(item) {
  return CATEGORY_NAMES[item.part] || CATEGORY_LABELS[item.part] || "Komad";
}

async function request(path, options) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options?.headers || {}) } });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || "The outfit request could not be completed.");
  return body;
}

function OutfitPieces({ items }) {
  return <div className="outfit-pieces">{items.map((item) => <figure key={item.id}><img src={item.thumbnail || item.image} alt="" /><figcaption>{item.name || categoryName(item)}</figcaption></figure>)}</div>;
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
    setError(""); setGenerating(true); setStartedAt(Date.now()); setElapsed(0);
    try {
      const result = await request("/api/outfits/generate", {
        method: "POST",
        body: JSON.stringify({ itemIds: selected.items.map((item) => item.id), name: selected.name, direction }),
      });
      setGeneratedResult(result);
      setGeneratedNow((current) => current + 1);
      setSelected(null);
      setDirection("");
    } catch (requestError) { setError(requestError.message); }
    finally { setGenerating(false); window.dispatchEvent(new Event("wardrobe:usage-refresh")); }
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
            <OutfitPieces items={selected.items} />
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
              <OutfitPieces items={selected.items} />
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
          </div>
        ) : (
          <>
            {generatedResult && (
              <section className="outfit-complete" role="status">
                <img src={generatedResult.image} alt="" />
                <div><p>Privatno spremljeno</p><h3>Kombinacija je spremna</h3><span>Rezultat se nalazi u tvojoj zbirci “Na meni”.</span></div>
                <button type="button" onClick={onOpenLooks}>Otvori Na meni</button>
              </section>
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
                      <img src={item.thumbnail || item.image} alt="" />
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

            <section className="outfit-intro">
              <div>
                <p>Brzi početak</p>
                <h3>Prijedlozi iz tvog ormara</h3>
                <p>Prijedlozi koriste samo spremljene kategorije i boje. Ne pozivaju OpenAI i ne troše generacije.</p>
              </div>
              <span>{items.length} komada dostupno</span>
            </section>
            {suggestions.length ? (
              <div className="outfit-suggestions">
                {suggestions.map((suggestion) => (
                  <article key={suggestion.id}>
                    <OutfitPieces items={suggestion.items} />
                    <div>
                      <h3>{suggestion.name}</h3>
                      <p>{suggestion.reason}</p>
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
          </>
        )}

        {loading && <p className="outfit-status"><SpinnerGap size={16} /> Učitavam spremljene prikaze…</p>}
        {error && <p className="outfit-error" role="alert">{error}</p>}
        {usage && <footer className="outfit-usage">Danas pokrenuto: {(typeof usage.today.images === "number" ? usage.today.images : usage.today.images?.requested || 0) + generatedNow}{usage.dailyImageLimit > 0 ? `/${usage.dailyImageLimit}` : ""} image generacija.</footer>}
      </section>
      {retakeOpen && <CameraCapture title="Retake your photo" onClose={() => setRetakeOpen(false)} onSaved={() => { setRetakeOpen(false); markReferenceReady(); }} />}
    </div>
  );
}
