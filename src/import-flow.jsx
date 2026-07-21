import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { Check } from "@phosphor-icons/react/Check";
import { ClipboardText } from "@phosphor-icons/react/ClipboardText";
import { Plus } from "@phosphor-icons/react/Plus";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { Trash } from "@phosphor-icons/react/Trash";
import { UploadSimple } from "@phosphor-icons/react/UploadSimple";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { X } from "@phosphor-icons/react/X";
import { fileToDataUrl, IMAGE_ACCEPT, isHeicFile, isSupportedImageFile, prepareImageFile } from "./image-files.mjs";
import "./import-flow.css";

const API = "/api/import/jobs";
const CONFIG_API = "/api/import/config";
const PARTS = [
  ["upperbody", "Tops"],
  ["wholebody_up", "Jackets"],
  ["lowerbody", "Bottoms"],
  ["onepiece", "Suits & sets"],
  ["accessories_up", "Accessories"],
  ["shoes", "Shoes"],
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

async function api(path, options) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    });
  } catch {
    throw Object.assign(new Error("Connection interrupted. We’ll keep checking automatically."), { transient: true });
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status >= 500
      ? "The server could not finish that step. Your import is preserved; try again in a moment."
      : "The import job could not be updated.";
    throw Object.assign(new Error(value.error || fallback), { status: response.status, transient: response.status >= 500 });
  }
  return value;
}

const WORKFLOW_STEPS = ["Add photos", "Detect items", "Confirm crops", "Create cutouts", "Save pieces"];
const QUEUE_BUSY = new Set(["queued", "converting", "reading", "analyzing"]);
const QUEUE_LABELS = {
  queued: "Waiting",
  converting: "Converting HEIC",
  reading: "Preparing",
  analyzing: "Detecting items",
  complete: "Ready for review",
  empty: "No clothing found",
  error: "Needs attention",
};

function visibleJobs(jobs) {
  return jobs.filter((job) => job.status !== "complete"
    && job.stages?.crop?.status !== "rejected"
    && job.stages?.garment?.status !== "rejected"
    && job.stages?.modeled?.status !== "rejected");
}

function isProcessing(job) {
  return (job.stages?.crop?.status === "approved" && ["pending", "queued", "processing"].includes(job.stages?.garment?.status))
    || (job.stages?.garment?.status === "approved" && ["pending", "queued", "processing"].includes(job.stages?.modeled?.status))
    || ["queued", "processing"].includes(job.stages?.modeled?.status);
}

function formatElapsed(startedAt, now) {
  if (!startedAt) return "Starting…";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s elapsed`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s elapsed`;
}

function processingDetails(job) {
  const garment = job.stages?.garment;
  const modeled = job.stages?.modeled;
  if (garment?.status === "approved" && ["pending", "queued", "processing"].includes(modeled?.status)) {
    if (modeled.phase === "storing_result") {
      return {
        title: "Saving your modeled preview",
        detail: "Generation is complete. The server is securely saving the final image to your private wardrobe.",
        step: 5,
        startedAt: modeled.startedAt || modeled.updatedAt || job.updatedAt,
      };
    }
    return {
      title: "Creating your modeled preview",
      detail: "OpenAI is styling the approved garment on your private reference photo. This usually takes 30–120 seconds.",
      step: 5,
      startedAt: modeled.startedAt || modeled.updatedAt || job.updatedAt,
    };
  }
  if (garment?.phase === "removing_background") {
      return {
        title: "Removing the background",
        detail: "The AI image is ready. Your server is cleaning the edges and saving the transparent garment locally.",
        step: 4,
        startedAt: garment.startedAt || garment.updatedAt || job.updatedAt,
      };
  }
  return {
    title: "Creating a clean garment image",
    detail: "OpenAI is reconstructing the item, then the server removes the background and stores the result privately. This usually takes 30–90 seconds.",
    step: 4,
    startedAt: garment?.startedAt || garment?.updatedAt || job.updatedAt,
  };
}

function deriveStatus(job) {
  const crop = job.stages?.crop;
  const garment = job.stages?.garment;
  const modeled = job.stages?.modeled;
  if (job.error || crop?.status === "failed" || garment?.status === "failed" || modeled?.status === "failed") return { tone: "error", text: "Import needs attention", detail: crop?.error || garment?.error || modeled?.error || job.error };
  if (modeled?.status === "review") return { tone: "ready", text: "Modeled preview ready", detail: "Review the final styled image before saving it." };
  if (["pending", "queued", "processing"].includes(modeled?.status) && garment?.status === "approved") return { tone: "processing", text: "Creating modeled preview", detail: "The garment is approved; the final styled image is being generated." };
  if (garment?.status === "review") return { tone: "ready", text: "Cutout ready to review", detail: "Check the edges, color and garment details before continuing." };
  if (garment?.status === "approved") return { tone: "processing", text: "Creating modeled preview", detail: "The garment is approved; the final styled image is being generated." };
  if (crop?.status === "review") return { tone: "ready", text: "Crop ready to review", detail: "Confirm that the complete intended item is visible." };
  if (crop?.status === "approved") return { tone: "processing", text: "Creating clean garment", detail: "The approved crop is being converted into a transparent product image." };
  if (crop?.status === "rejected" || garment?.status === "rejected" || modeled?.status === "rejected") return { tone: "complete", text: "Import declined" };
  return { tone: "processing", text: "Preparing import", detail: "The server is preparing this image." };
}

function failedStageFor(job) {
  if (job.stages?.garment?.status === "failed") return "garment";
  if (job.stages?.modeled?.status === "failed") return "modeled";
  return null;
}

function latestOpenAIAttempt(job, stageName) {
  const attempts = job.stages?.[stageName]?.openAIAttempts;
  return Array.isArray(attempts) ? attempts.at(-1) : null;
}

function WorkflowSteps({ step }) {
  const progress = Math.max(8, Math.round((step / WORKFLOW_STEPS.length) * 100));
  return (
    <>
      <div className="import-progress__track" aria-hidden="true"><div className="import-progress__bar" style={{ "--import-progress": `${progress}%` }} /></div>
      <ol className="import-steps" aria-label={`Import step ${step} of ${WORKFLOW_STEPS.length}`}>
        {WORKFLOW_STEPS.map((label, index) => {
          const number = index + 1;
          const state = number < step ? "complete" : number === step ? "current" : "pending";
          return <li key={label} data-state={state}><span>{state === "complete" ? <Check size={11} weight="bold" /> : number}</span><small>{label}</small></li>;
        })}
      </ol>
    </>
  );
}

function ProcessingSummary({ work, elapsed }) {
  return (
    <section className="import-working" aria-live="polite" aria-atomic="true">
      <div className="import-working__lead">
        <span className="import-working__spinner"><SpinnerGap size={22} /></span>
        <div><strong>{work.title}</strong><p>{work.detail}</p></div>
        <span className="import-working__time">{elapsed}</span>
      </div>
      <WorkflowSteps step={work.step} />
      <p className="import-working__hint">You can close this window. Processing continues safely in the background.</p>
    </section>
  );
}

function UploadQueue({ entries, onClearFinished }) {
  if (!entries.length) return null;
  const busy = entries.filter((entry) => QUEUE_BUSY.has(entry.status)).length;
  const finished = entries.length - busy;
  return (
    <section className="upload-queue" aria-label="Photo upload queue">
      <header>
        <div><strong>{busy ? `${busy} photo${busy === 1 ? "" : "s"} in progress` : "Photo queue complete"}</strong><span>{entries.length} total</span></div>
        {!!finished && <button type="button" onClick={onClearFinished}>Clear finished</button>}
      </header>
      <ol>
        {entries.map((entry, index) => (
          <li key={entry.id} data-status={entry.status}>
            <span className="upload-queue__number">{QUEUE_BUSY.has(entry.status) && entry.status !== "queued" ? <SpinnerGap size={13} /> : index + 1}</span>
            <div><strong>{entry.fileName}</strong><small>{entry.detail || QUEUE_LABELS[entry.status]}</small></div>
            <span className="upload-queue__status">{QUEUE_LABELS[entry.status]}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function reviewStageFor(job) {
  if (job.stages?.modeled?.status === "review") return "modeled";
  if (job.stages?.garment?.status === "review") return "garment";
  if (job.stages?.crop?.status === "review") return "crop";
  return null;
}

function hasCleanupFailure(job) {
  return job.stages?.garment?.status === "failed" && Boolean(job.stages?.garment?.failedAssetUrl);
}

function defaultDraft(job) {
  const metadata = job.metadata || {};
  return {
    name: metadata.name || "New piece",
    part: metadata.part || "upperbody",
    subcategory: metadata.subcategory || "",
    brand: metadata.brand || "",
    color: metadata.color || "#d8d0c2",
    secondaryColor: metadata.secondaryColor || "",
    tags: Array.isArray(metadata.tags) ? metadata.tags.join(", ") : (metadata.tags || ""),
  };
}

function clampBox(box) {
  const x = Math.max(0, Math.min(999, Math.round(box.x)));
  const y = Math.max(0, Math.min(999, Math.round(box.y)));
  const width = Math.max(40, Math.min(1000 - x, Math.round(box.width)));
  const height = Math.max(40, Math.min(1000 - y, Math.round(box.height)));
  return { x, y, width, height };
}

function CropEditor({ job, busy, onCancel, onSubmit }) {
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const [box, setBox] = useState(() => clampBox(job.metadata?.boundingBox || { x: 100, y: 100, width: 800, height: 800 }));

  const onDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPct = ((event.clientX - drag.startX) / drag.rect.width) * 1000;
    const dyPct = ((event.clientY - drag.startY) / drag.rect.height) * 1000;
    const start = drag.startBox;
    if (drag.mode === "move") {
      const x = Math.max(0, Math.min(1000 - start.width, start.x + dxPct));
      const y = Math.max(0, Math.min(1000 - start.height, start.y + dyPct));
      setBox(clampBox({ ...start, x, y }));
      return;
    }
    let { x, y, width, height } = start;
    if (drag.handle.includes("e")) width = start.width + dxPct;
    if (drag.handle.includes("s")) height = start.height + dyPct;
    if (drag.handle.includes("w")) { x = start.x + dxPct; width = start.width - dxPct; }
    if (drag.handle.includes("n")) { y = start.y + dyPct; height = start.height - dyPct; }
    setBox(clampBox({ x, y, width, height }));
  }, []);

  const stopDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onDrag);
    window.removeEventListener("pointerup", stopDrag);
  }, [onDrag]);

  const startDrag = useCallback((mode, handle) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { mode, handle, rect, startBox: box, startX: event.clientX, startY: event.clientY };
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", stopDrag);
  }, [box, onDrag, stopDrag]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onDrag);
    window.removeEventListener("pointerup", stopDrag);
  }, [onDrag, stopDrag]);

  return (
    <div className="crop-editor">
      <div className="crop-editor__stage" ref={stageRef}>
        <img src={job.originalAssetUrl} alt="Original photo" draggable={false} />
        <div
          className="crop-editor__box"
          style={{ left: `${box.x / 10}%`, top: `${box.y / 10}%`, width: `${box.width / 10}%`, height: `${box.height / 10}%` }}
          onPointerDown={startDrag("move")}
        >
          {["nw", "ne", "sw", "se"].map((handle) => (
            <span key={handle} className={`crop-editor__handle crop-editor__handle--${handle}`} onPointerDown={startDrag("resize", handle)} />
          ))}
        </div>
      </div>
      <p className="import-card__detail">Drag the box to move it, drag a corner to resize it. This uses no OpenAI credit.</p>
      <div className="import-actions">
        <button className="import-button" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="import-button import-button--primary" type="button" disabled={busy} onClick={() => onSubmit(box)}>
          <Check size={14} weight="bold" /> Use this crop
        </button>
      </div>
    </div>
  );
}

function ReviewEditor({ job, stage, draft, setDraft, regenPrompt, setRegenPrompt, busy, onAction, onRecrop }) {
  const [cropEditing, setCropEditing] = useState(false);
  const asset = job.stages[stage]?.assetUrl;
  const isCrop = stage === "crop";
  const isGarment = stage === "garment";
  const primaryValid = HEX_COLOR.test(draft.color);
  const secondaryValid = !draft.secondaryColor || HEX_COLOR.test(draft.secondaryColor);
  if (isCrop && cropEditing) {
    return (
      <div className="import-editor">
        <div className="import-editor__milestone">
          <div><strong>Adjust the crop</strong><p>Move or resize the box around the complete item, then use this crop instead of the detected one.</p></div>
          <WorkflowSteps step={3} />
        </div>
        <CropEditor job={job} busy={busy} onCancel={() => setCropEditing(false)} onSubmit={(box) => { onRecrop(box); setCropEditing(false); }} />
      </div>
    );
  }
  return (
    <div className="import-editor">
      <div className="import-editor__milestone">
        <div><strong>{isCrop ? "Item detected — confirm the crop" : isGarment ? "Cutout created — check and save it" : "Legacy modeled preview"}</strong><p>{isCrop ? "This is the smooth handoff from detection to cutout creation. Review one item at a time; the remaining items stay safely in the queue." : isGarment ? "Check the details below. Saving adds the piece to its wardrobe category without another generation." : "Review the existing preview before saving it."}</p></div>
        <WorkflowSteps step={isCrop ? 3 : 5} />
      </div>
      <img className="import-editor__preview" src={asset} alt={isCrop ? "Detected item crop" : isGarment ? "Extracted garment" : "Generated modeled look"} />
      <div className="import-fields">
        <p className="import-editor__stage">{isCrop ? "Detected item" : isGarment ? "Garment image" : "Modeled image"}</p>
        {isCrop ? <p className="import-card__detail">Check that the complete item is visible. Not quite right? <button type="button" className="import-inline-link" onClick={() => setCropEditing(true)}>Adjust the crop manually</button> — no extra generation used. The next button starts one image generation for its clean cutout; you can keep reviewing other detected items while it runs.</p> : isGarment ? (
          <>
            <div className="import-field"><label htmlFor={`name-${job.id}`}>Name</label><input id={`name-${job.id}`} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
            <div className="import-field"><label htmlFor={`part-${job.id}`}>Category</label><select id={`part-${job.id}`} value={draft.part} onChange={(event) => setDraft({ ...draft, part: event.target.value })}>{PARTS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></div>
            <div className="import-field"><label htmlFor={`subcategory-${job.id}`}>Type <span>optional</span></label><input id={`subcategory-${job.id}`} value={draft.subcategory} placeholder="e.g. majica, traperice, sako" onChange={(event) => setDraft({ ...draft, subcategory: event.target.value })} /></div>
            <div className="import-field"><label htmlFor={`brand-${job.id}`}>Brand <span>optional</span></label><input id={`brand-${job.id}`} value={draft.brand} placeholder="e.g. Zara, Nike" onChange={(event) => setDraft({ ...draft, brand: event.target.value })} /></div>
            <div className="import-field"><label htmlFor={`primary-${job.id}`}>Primary color</label><div className="import-color-row"><input id={`primary-${job.id}`} type="color" value={primaryValid ? draft.color : "#000000"} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><input aria-label="Primary color hex" aria-invalid={!primaryValid} value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></div>{!primaryValid && <small className="import-field-error">Use a six-digit hex color, such as #d8d0c2.</small>}</div>
            <div className="import-field"><label htmlFor={`secondary-${job.id}`}>Secondary color <span>optional</span></label><input id={`secondary-${job.id}`} type="text" aria-invalid={!secondaryValid} placeholder="#hex or leave blank" value={draft.secondaryColor} onChange={(event) => setDraft({ ...draft, secondaryColor: event.target.value })} />{!secondaryValid && <small className="import-field-error">Use a six-digit hex color or leave this empty.</small>}</div>
            <div className="import-field"><label htmlFor={`tags-${job.id}`}>Details</label><input id={`tags-${job.id}`} value={draft.tags} placeholder="casual, cotton, striped" onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></div>
          </>
        ) : <p className="import-card__detail">Approve this editorial image to attach it to the new wardrobe piece, or regenerate it with a more specific direction.</p>}
        {!isCrop && <div className="import-field import-regenerate-field">
          <label htmlFor={`regenerate-${job.id}-${stage}`}>Regeneration direction <span>optional</span></label>
          <textarea id={`regenerate-${job.id}-${stage}`} rows="3" value={regenPrompt} onChange={(event) => setRegenPrompt(event.target.value)} placeholder={isGarment ? "Example: preserve the original zipper and remove the retail tag" : "Example: use a quiet evening street and show the full garment"} />
        </div>}
        <div className="import-actions">
          <button className="import-button" disabled={busy} onClick={() => onAction("reject")}><Trash size={14} /> {isCrop ? "Discard crop" : "Discard"}</button>
          {!isCrop && <button className="import-button" disabled={busy} onClick={() => onAction("regenerate", regenPrompt)}><ArrowCounterClockwise size={14} /> Regenerate · 1 generation</button>}
          <button className="import-button import-button--primary" disabled={busy || (isGarment && (!draft.name.trim() || !primaryValid || !secondaryValid))} onClick={() => onAction("approve")}><Check size={14} weight="bold" /> {isCrop ? "Create cutout · 1 generation" : isGarment ? "Save to wardrobe" : "Save preview"}</button>
        </div>
      </div>
    </div>
  );
}

function CleanupEditor({ job, tolerance, setTolerance, busy, onPreview, onAccept }) {
  const stage = job.stages.garment;
  const contaminated = stage.cleanupDiagnostics?.contaminatedPixels;
  const previewTimer = useRef(null);
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  const updateTolerance = (next) => {
    setTolerance(next);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => onPreview(next), 300);
  };
  return (
    <div className="import-cleanup-editor">
      <p className="import-editor__stage">Background cleanup</p>
      <p className="import-card__detail">The generated garment is preserved below. Adjust the cleanup locally—this does not call the image model again.</p>
      <div className="import-cleanup-comparison">
        <figure><img src={stage.failedAssetUrl} alt="Generated garment on its chroma background" /><figcaption>Generated source</figcaption></figure>
        <figure><img src={stage.cleanupPreviewUrl || stage.failedAssetUrl} alt="Transparent garment cleanup preview" /><figcaption>{stage.cleanupPreviewUrl ? "Cleanup preview" : "Preview appears here"}</figcaption></figure>
      </div>
      <div className="import-field import-cleanup-strength">
        <label htmlFor={`cleanup-${job.id}`}>Cleanup strength <strong>{tolerance}</strong></label>
        <input id={`cleanup-${job.id}`} type="range" min="18" max="110" step="2" value={tolerance} onChange={(event) => updateTolerance(Number(event.target.value))} />
        <div className="import-cleanup-scale"><span>Preserve more edge detail</span><span>Remove more background</span></div>
      </div>
      {Number.isFinite(contaminated) && <p className="import-card__detail">The automated check sees {contaminated.toLocaleString()} tinted edge {contaminated === 1 ? "pixel" : "pixels"}. If the preview looks clean, you can still use it.</p>}
      <div className="import-actions">
        <button className="import-button" disabled={busy} onClick={() => onPreview(tolerance)}><ArrowCounterClockwise size={14} /> Preview cleanup</button>
        <button className="import-button import-button--primary" disabled={busy} onClick={onAccept}><Check size={14} weight="bold" /> Use this cleanup</button>
      </div>
    </div>
  );
}

export function WardrobeImportFlow({ onGarmentApproved, onModeledApproved, launcherVisible = true }) {
  const inputRef = useRef(null);
  const [jobs, setJobs] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [regenerationPrompts, setRegenerationPrompts] = useState({});
  const [cleanupTolerances, setCleanupTolerances] = useState({});
  const [dragging, setDragging] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedReviewId, setSelectedReviewId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [syncIssue, setSyncIssue] = useState("");
  const [notice, setNotice] = useState(null);
  const [setup, setSetup] = useState(null);
  const [uploadState, setUploadState] = useState(null);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [retryingIds, setRetryingIds] = useState(() => new Set());
  const [now, setNow] = useState(Date.now());
  const uploadChainRef = useRef(Promise.resolve());
  const retryLocksRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    let setupTimer;
    const loadSetup = () => api(CONFIG_API)
      .then((value) => { if (!cancelled) setSetup(value); })
      .catch(() => { if (!cancelled) { setSetup(null); setupTimer = setTimeout(loadSetup, 1_500); } });
    void loadSetup();
    window.addEventListener("wardrobe:setup-refresh", loadSetup);
    api(API)
      .then((storedJobs) => {
        const storedVisibleJobs = visibleJobs(storedJobs);
        setJobs(storedVisibleJobs);
        setDrafts(Object.fromEntries(storedVisibleJobs.map((job) => [job.id, defaultDraft(job)])));
      })
      .catch((requestError) => { setError(requestError.message); setOpen(true); });
    return () => { cancelled = true; clearTimeout(setupTimer); window.removeEventListener("wardrobe:setup-refresh", loadSetup); };
  }, []);

  useEffect(() => {
    const openImporter = () => setup?.ready ? inputRef.current?.click() : setOpen(true);
    window.addEventListener("wardrobe:add-clothes", openImporter);
    return () => window.removeEventListener("wardrobe:add-clothes", openImporter);
  }, [setup]);

  const hasProcessingJobs = jobs.some(isProcessing);
  useEffect(() => {
    if (!hasProcessingJobs) { setSyncIssue(""); return undefined; }
    let cancelled = false;
    let timer;
    let failures = 0;
    const poll = async () => {
      try {
        const storedJobs = visibleJobs(await api(API));
        if (cancelled) return;
        setJobs(storedJobs);
        setDrafts((current) => {
          const next = { ...current };
          for (const job of storedJobs) next[job.id] ||= defaultDraft(job);
          return next;
        });
        failures = 0;
        setSyncIssue("");
        window.dispatchEvent(new Event("wardrobe:usage-refresh"));
      } catch {
        if (cancelled) return;
        failures += 1;
        setSyncIssue(failures > 1 ? "Could not refresh the latest server status. Retrying automatically…" : "Status check interrupted. Reconnecting automatically…");
      } finally {
        if (!cancelled) timer = setTimeout(poll, failures ? Math.min(8_000, 1_500 * (2 ** (failures - 1))) : 1_500);
      }
    };
    timer = setTimeout(poll, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hasProcessingJobs]);

  useEffect(() => {
    if (!hasProcessingJobs && !uploadState) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [hasProcessingJobs, uploadState]);

  const updateQueueEntry = useCallback((id, update) => {
    setUploadQueue((current) => current.map((entry) => entry.id === id ? { ...entry, ...update } : entry));
  }, []);

  const submitFiles = useCallback((files) => {
    if (!setup?.ready) { setOpen(true); return; }
    const selected = [...files];
    const images = selected.filter(isSupportedImageFile).slice(0, 20);
    if (!images.length) {
      setError("Choose PNG, JPEG, WebP, HEIC or HEIF photos.");
      setOpen(true);
      return;
    }
    const entries = images.map((file, index) => ({
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      fileName: file.name || `Photo ${index + 1}`,
      status: "queued",
      detail: isHeicFile(file) ? "Waiting for private HEIC conversion" : "Waiting in line",
    }));
    setDragging(false); setError(""); setSyncIssue(""); setNotice(null); setOpen(true);
    setUploadQueue((current) => [...current, ...entries]);
    if (selected.length > images.length) {
      setNotice({ tone: "complete", text: `${images.length} photos added`, detail: "Up to 20 supported photos are accepted per selection; unsupported or extra files were skipped." });
    }

    uploadChainRef.current = uploadChainRef.current.catch(() => undefined).then(async () => {
      let detectedItems = 0;
      let failed = 0;
      for (const [index, file] of images.entries()) {
        const entry = entries[index];
        const startedAt = new Date().toISOString();
        try {
          if (isHeicFile(file)) {
            updateQueueEntry(entry.id, { status: "converting", detail: "Converting privately in this browser" });
            setUploadState({ fileName: entry.fileName, index: index + 1, total: images.length, phase: "converting", startedAt });
          }
          const prepared = await prepareImageFile(file);
          updateQueueEntry(entry.id, { status: "reading", detail: isHeicFile(file) ? "HEIC converted to JPEG" : "Preparing secure upload" });
          setUploadState({ fileName: entry.fileName, index: index + 1, total: images.length, phase: "reading", startedAt });
          const imageDataUrl = await fileToDataUrl(prepared);
          updateQueueEntry(entry.id, { status: "analyzing", detail: "OpenAI is detecting wearable items" });
          setUploadState({ fileName: entry.fileName, index: index + 1, total: images.length, phase: "analyzing", startedAt });
          const result = await api(API, { method: "POST", body: JSON.stringify({ imageDataUrl, metadata: { name: entry.fileName.replace(/\.[^.]+$/, "") } }) });
          const createdJobs = result.jobs || [result];
          if (!createdJobs.length && result.noClothingDetected) {
            updateQueueEntry(entry.id, { status: "empty", detail: "Try a clearer or more tightly framed photo" });
            continue;
          }
          detectedItems += createdJobs.length;
          updateQueueEntry(entry.id, { status: "complete", detail: `${createdJobs.length} item${createdJobs.length === 1 ? "" : "s"} waiting for crop review` });
          setJobs((current) => [...current, ...createdJobs]);
          setDrafts((current) => ({ ...current, ...Object.fromEntries(createdJobs.map((job) => [job.id, defaultDraft(job)])) }));
        } catch (requestError) {
          failed += 1;
          updateQueueEntry(entry.id, { status: "error", detail: requestError.message });
        }
      }
      setUploadState(null);
      setNotice({
        tone: failed ? "error" : "complete",
        text: failed ? `${failed} photo${failed === 1 ? " needs" : "s need"} attention` : "All photos processed",
        detail: detectedItems ? `${detectedItems} detected item${detectedItems === 1 ? " is" : "s are"} now lined up for review.` : "No wardrobe items were added from this batch.",
      });
      window.dispatchEvent(new Event("wardrobe:usage-refresh"));
    });
  }, [setup, updateQueueEntry]);

  useEffect(() => {
    let depth = 0;
    const onDragEnter = (event) => { if (![...event.dataTransfer.types].includes("Files")) return; event.preventDefault(); depth += 1; setDragging(true); };
    const onDragOver = (event) => { if ([...event.dataTransfer.types].includes("Files")) event.preventDefault(); };
    const onDragLeave = (event) => { event.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const onDrop = (event) => { event.preventDefault(); depth = 0; setDragging(false); submitFiles(event.dataTransfer.files); };
    const onPaste = (event) => { const files = [...event.clipboardData.files]; if (files.some(isSupportedImageFile)) { event.preventDefault(); submitFiles(files); } };
    window.addEventListener("dragenter", onDragEnter); window.addEventListener("dragover", onDragOver); window.addEventListener("dragleave", onDragLeave); window.addEventListener("drop", onDrop); window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragover", onDragOver); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("drop", onDrop); window.removeEventListener("paste", onPaste); };
  }, [submitFiles]);

  const perform = async (job, stage, action, prompt = "") => {
    const retryKey = `${job.id}:${stage}`;
    if (action === "regenerate") {
      if (isProcessing(job) || retryLocksRef.current.has(retryKey)) return;
      retryLocksRef.current.add(retryKey);
      setRetryingIds((current) => new Set(current).add(job.id));
    }
    setBusyId(job.id); setError("");
    try {
      if (stage === "garment" && action === "approve") {
        const draft = drafts[job.id];
        const metadata = { ...draft, secondaryColor: draft.secondaryColor || null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
        await api(`${API}/${job.id}/metadata`, { method: "PATCH", body: JSON.stringify({ metadata }) });
        await api(`${API}/${job.id}/stages/garment/approve`, { method: "POST" });
        const garmentPath = `/api/import/library/import-${job.id}-garment.png`;
        onGarmentApproved?.({ id: `import-${job.id}`, ...metadata, image: garmentPath, thumbnail: garmentPath, modeledImage: null, palette: [metadata.color, metadata.secondaryColor].filter(Boolean), importJobId: job.id });
        const remaining = jobs.filter((item) => item.id !== job.id);
        setJobs((current) => current.filter((item) => item.id !== job.id));
        setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== job.id)));
        setSelectedReviewId(null);
        setNotice({ tone: "complete", text: "Saved to wardrobe", detail: `${metadata.name} is ready to use in Outfit Studio.` });
        if (!remaining.length) setOpen(false);
      } else {
        const updated = await api(`${API}/${job.id}/stages/${stage}/${action}`, { method: "POST", body: action === "regenerate" ? JSON.stringify({ prompt }) : action === "recrop" ? JSON.stringify({ boundingBox: prompt }) : undefined });
        const removeFromQueue = action === "reject" || (stage === "modeled" && action === "approve");
        const remainingJobs = removeFromQueue ? jobs.filter((item) => item.id !== job.id) : null;
        setJobs((current) => removeFromQueue ? current.filter((item) => item.id !== job.id) : current.map((item) => item.id === job.id ? updated : item));
        if (removeFromQueue) {
          setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== job.id)));
          setSelectedReviewId(null);
          if (!remainingJobs.length) setOpen(false);
        }
        if (action === "regenerate") setRegenerationPrompts((current) => ({ ...current, [`${job.id}:${stage}`]: "" }));
        if (stage === "modeled" && action === "approve") onModeledApproved?.(job.id, `/api/import/library/import-${job.id}-modeled.jpg`);
      }
    } catch (requestError) {
      if (action === "regenerate" && requestError.status === 409) {
        try {
          const currentJob = await api(`${API}/${job.id}`);
          setJobs((current) => current.map((item) => item.id === job.id ? currentJob : item));
        } catch { /* The poller will retry when the server is reachable. */ }
      }
      setError(requestError.message);
    } finally {
      if (action === "regenerate") {
        retryLocksRef.current.delete(retryKey);
        setRetryingIds((current) => { const next = new Set(current); next.delete(job.id); return next; });
      }
      setBusyId(null);
    }
  };

  const performCleanup = async (job, action, requestedTolerance) => {
    setBusyId(job.id); setError("");
    try {
      const tolerance = requestedTolerance ?? cleanupTolerances[job.id] ?? job.stages?.garment?.cleanupTolerance ?? 46;
      const updated = await api(`${API}/${job.id}/stages/garment/cleanup-${action}`, { method: "POST", body: JSON.stringify({ tolerance }) });
      setJobs((current) => current.map((item) => item.id === job.id ? updated : item));
      setCleanupTolerances((current) => ({ ...current, [job.id]: updated.stages?.garment?.cleanupTolerance ?? tolerance }));
      setSelectedReviewId(job.id);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyId(null); }
  };

  const deleteJob = async (job) => {
    setBusyId(job.id); setError("");
    try {
      await api(`${API}/${job.id}`, { method: "DELETE" });
      const remaining = jobs.filter((item) => item.id !== job.id);
      setJobs(remaining);
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== job.id)));
      if (selectedReviewId === job.id) setSelectedReviewId(null);
      if (!remaining.length) setOpen(false);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusyId(null); }
  };

  const processingJob = [...jobs].reverse().find(isProcessing);
  const active = processingJob || jobs[jobs.length - 1];
  const setupRequired = setup?.ready === false;
  const uploadWork = uploadState ? {
    title: uploadState.phase === "converting" ? "Converting your iPhone photo" : uploadState.phase === "reading" ? "Preparing your photo" : "Identifying clothing in your photo",
    detail: uploadState.phase === "converting"
      ? `${uploadState.fileName} is being converted from HEIC to JPEG privately in your browser. Photo ${uploadState.index} of ${uploadState.total}.`
      : uploadState.phase === "reading"
        ? `Preparing ${uploadState.fileName} securely. Photo ${uploadState.index} of ${uploadState.total}.`
        : `OpenAI is detecting each wearable item and its boundaries. Photo ${uploadState.index} of ${uploadState.total}; this usually takes 10–40 seconds.`,
    step: uploadState.phase === "analyzing" ? 2 : 1,
    startedAt: uploadState.startedAt,
  } : null;
  const work = uploadWork || (processingJob ? processingDetails(processingJob) : null);
  const activeStatus = setupRequired
    ? { tone: "error", text: "Setup required" }
    : uploadState
      ? { tone: "processing", text: uploadWork.title }
      : active ? deriveStatus(active) : notice;
  const readyCount = jobs.filter((job) => deriveStatus(job).tone === "ready").length;
  const selectedReviewJob = jobs.find((job) => job.id === selectedReviewId && (reviewStageFor(job) || hasCleanupFailure(job)));
  const reviewJob = selectedReviewJob || jobs.find((job) => reviewStageFor(job)) || jobs.find((job) => hasCleanupFailure(job)) || active;
  const reviewStage = reviewJob ? reviewStageFor(reviewJob) : null;
  const queuedPhotos = uploadQueue.filter((entry) => QUEUE_BUSY.has(entry.status)).length;
  const hasImportActivity = Boolean(jobs.length || uploadQueue.length || uploadState || notice || setupRequired || error);
  const heading = readyCount
    ? `${readyCount} ready for review`
    : activeStatus?.tone === "error"
      ? "Import needs attention"
      : work?.title || (queuedPhotos ? `${queuedPhotos} photos in line` : jobs.length ? "Preparing new pieces" : notice?.text || "Add to your wardrobe");

  return (
    <>
      <input ref={inputRef} type="file" accept={IMAGE_ACCEPT} multiple hidden disabled={!setup?.ready} onChange={(event) => { submitFiles(event.target.files); event.target.value = ""; }} />
      <div className="import-drop-overlay" data-active={dragging && !setupRequired} aria-hidden={!dragging || setupRequired}><div className="import-drop-target is-over"><UploadSimple size={34} weight="light" /><h2>Add photos to the queue</h2><p>Drop several PNG, JPEG, WebP, HEIC or HEIF photos. They will be detected one at a time in the order you added them.</p></div></div>
      <aside className={`import-tray${hasImportActivity ? " is-expanded" : ""}${!launcherVisible && !hasImportActivity ? " is-context-hidden" : ""}`} aria-label="Wardrobe imports">
        <button className="import-tray__button" type="button" onClick={() => setupRequired || hasImportActivity ? setOpen(true) : inputRef.current?.click()} aria-label={setupRequired ? "Open setup instructions" : hasImportActivity ? "Open import progress" : "Add clothes"}>{activeStatus?.tone === "processing" ? <SpinnerGap size={19} className="import-spinner" /> : activeStatus?.tone === "error" ? <WarningCircle size={19} /> : readyCount ? <span>{readyCount}</span> : notice ? <X size={18} /> : <Plus size={19} />}</button>
        <div className="import-tray__actions">{active && <img className="import-tray__preview" src={active.stages?.garment?.assetUrl || active.stages?.garment?.failedAssetUrl || active.stages?.crop?.assetUrl || active.originalAssetUrl} alt="" />}<span className="import-tray__label">{activeStatus?.text || "Add clothes"}</span>{!setupRequired && <button className="import-icon-button" type="button" onClick={() => inputRef.current?.click()} aria-label="Choose images"><UploadSimple size={17} /></button>}</div>
      </aside>
      <div className="import-popover-backdrop" data-open={open} onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
        <section className="import-popover" role="dialog" aria-modal="true" aria-labelledby="import-title" aria-busy={Boolean(work)}>
          <header className="import-popover__header"><div><p className="import-popover__eyebrow">Wardrobe import</p><h2 className="import-popover__title" id="import-title">{heading}</h2></div><button className="import-icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close import progress"><X size={20} /></button></header>
          <UploadQueue entries={uploadQueue} onClearFinished={() => setUploadQueue((current) => current.filter((entry) => QUEUE_BUSY.has(entry.status)))} />
          {!jobs.length && !uploadState ? setupRequired ? <div className="import-drop-target import-setup-warning"><WarningCircle size={30} /><h2>Setup required</h2><p>The owner must configure the server-side OpenAI key. A reference photo is needed only later, when you choose to try on an outfit.</p></div> : <div className="import-drop-target"><UploadSimple size={28} /><h2>{!setup ? "Checking your private setup…" : notice ? "Add more clothes" : "Choose one or several photos"}</h2><p>{!setup ? "Reconnecting automatically if the local server just restarted." : notice?.detail || "Select up to 20 PNG, JPEG, WebP, HEIC or HEIF photos. They appear in a queue and are detected one at a time."}</p><button className="import-button import-button--primary" disabled={!setup?.ready} onClick={() => { setNotice(null); inputRef.current?.click(); }}>{setup?.ready ? "Choose photos" : "Checking…"}</button>{setup?.ready && <div className="import-paste-zone" contentEditable suppressContentEditableWarning role="textbox" aria-label="Paste a photo here, for example after Copy Subject on iPhone" onInput={(event) => { event.currentTarget.textContent = ""; }}><ClipboardText size={16} weight="bold" aria-hidden="true" /> Or paste a photo here — works with iPhone's "Copy Subject"</div>}</div> : (
            <>
              {work && <ProcessingSummary work={work} elapsed={formatElapsed(work.startedAt, now)} />}
              {syncIssue && <p className="import-connection" role="status"><SpinnerGap size={15} /> {syncIssue}</p>}
              {reviewJob && reviewStage ? <ReviewEditor job={reviewJob} stage={reviewStage} draft={drafts[reviewJob.id] || defaultDraft(reviewJob)} setDraft={(draft) => setDrafts((current) => ({ ...current, [reviewJob.id]: draft }))} regenPrompt={regenerationPrompts[`${reviewJob.id}:${reviewStage}`] || ""} setRegenPrompt={(prompt) => setRegenerationPrompts((current) => ({ ...current, [`${reviewJob.id}:${reviewStage}`]: prompt }))} busy={busyId === reviewJob.id} onAction={(action, prompt) => perform(reviewJob, reviewStage, action, prompt)} onRecrop={(box) => perform(reviewJob, "crop", "recrop", box)} /> : reviewJob && hasCleanupFailure(reviewJob) ? <CleanupEditor job={reviewJob} tolerance={cleanupTolerances[reviewJob.id] ?? reviewJob.stages.garment.cleanupTolerance ?? 46} setTolerance={(tolerance) => setCleanupTolerances((current) => ({ ...current, [reviewJob.id]: tolerance }))} busy={busyId === reviewJob.id} onPreview={(tolerance) => performCleanup(reviewJob, "preview", tolerance)} onAccept={() => performCleanup(reviewJob, "accept")} /> : null}
              {!!jobs.length && <div className="import-card-list">{jobs.map((job) => { const status = deriveStatus(job); const itemName = drafts[job.id]?.name || job.metadata?.name || "New piece"; const failedStage = failedStageFor(job); const failedAttempt = failedStage ? latestOpenAIAttempt(job, failedStage) : null; const retrying = retryingIds.has(job.id); return <article className={`import-card is-${status.tone}${reviewJob?.id === job.id ? " is-selected" : ""}`} key={job.id}><img className="import-card__image" src={job.stages?.garment?.assetUrl || job.stages?.garment?.failedAssetUrl || job.stages?.crop?.assetUrl || job.originalAssetUrl} alt="" /><div className="import-card__body"><h3 className="import-card__title">{itemName}</h3><p className="import-card__detail import-card__detail--status" data-tone={status.tone} role={status.tone === "error" ? "alert" : undefined}>{status.tone === "error" ? status.detail : status.text}</p>{status.tone !== "error" && status.detail && <p className="import-card__subdetail">{status.detail}</p>}{status.tone === "error" && failedAttempt && <p className="import-card__subdetail">Attempt {failedAttempt.attempt}{failedAttempt.status ? ` · HTTP ${failedAttempt.status}` : " · network error"}{failedAttempt.requestId ? ` · Request ID ${failedAttempt.requestId}` : ""}</p>}</div><div className="import-card__actions">{status.tone === "ready" && <button className="import-icon-button" onClick={() => { setSelectedReviewId(job.id); setOpen(true); }} aria-label={`Review ${itemName}`}><Check size={17} /></button>}{failedStage && <button className="import-button import-card__retry" disabled={retrying || busyId === job.id || isProcessing(job)} onClick={() => perform(job, failedStage, "regenerate", "")}><ArrowCounterClockwise size={14} /> {retrying ? "Retrying…" : "Retry"}</button>}<button className="import-icon-button import-card__delete" disabled={busyId === job.id || retrying} onClick={() => window.confirm(`Remove ${itemName} from the import queue?`) && deleteJob(job)} aria-label={`Delete ${itemName} from import queue`}><Trash size={16} /></button></div></article>; })}</div>}
              <div className="import-actions"><button className="import-button" onClick={() => inputRef.current?.click()}><Plus size={14} /> Add more photos to queue</button></div>
            </>
          )}
          {error && <p className="import-status is-error" role="alert">{error}</p>}
        </section>
      </div>
    </>
  );
}
