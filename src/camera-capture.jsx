import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react/ArrowCounterClockwise";
import { Camera } from "@phosphor-icons/react/Camera";
import { CameraRotate } from "@phosphor-icons/react/CameraRotate";
import { Check } from "@phosphor-icons/react/Check";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { UploadSimple } from "@phosphor-icons/react/UploadSimple";
import { X } from "@phosphor-icons/react/X";
import { IMAGE_ACCEPT, isHeicFile, prepareImageFile } from "./image-files.mjs";
import "./camera-capture.css";

// Uploads a captured or selected photo as the private model reference.
// The global fetch wrapper (main.jsx) attaches the CSRF token and credentials.
export async function uploadModelReference(blob) {
  const prepared = typeof File !== "undefined" && blob instanceof File ? await prepareImageFile(blob) : blob;
  const response = await fetch("/api/settings/model-reference", {
    method: "PUT",
    headers: { "Content-Type": prepared.type || "image/png" },
    body: prepared,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || "Could not save the reference photo. Use a clear photo under the upload limit.");
  }
  return true;
}

// A self-portrait capture dialog. The captured still becomes the private
// reference photo, so an outfit try-on can immediately be generated on you.
export function CameraCapture({ onSaved, onClose, title = "Take a photo of yourself" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const closeButtonRef = useRef(null);
  const fileInputRef = useRef(null);
  const [captured, setCaptured] = useState(null);
  const [facingMode, setFacingMode] = useState("user");
  const [status, setStatus] = useState("starting");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingLabel, setSavingLabel] = useState("Saving…");

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (captured) return undefined;
    let active = true;
    setStatus("starting");
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("This browser cannot open the camera. Close this and upload a photo instead.");
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 1600 } }, audio: false })
      .then((stream) => {
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        stopStream();
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        }
        setStatus("live");
      })
      .catch((mediaError) => {
        if (!active) return;
        setStatus("error");
        setError(mediaError?.name === "NotAllowedError" || mediaError?.name === "SecurityError"
          ? "Camera access was blocked. Allow the camera in your browser, or upload a photo instead."
          : "No camera is available on this device. You can upload a photo instead.");
      });
    return () => { active = false; };
  }, [facingMode, captured, stopStream]);

  useEffect(() => () => stopStream(), [stopStream]);
  useEffect(() => () => { if (captured?.url) URL.revokeObjectURL(captured.url); }, [captured]);

  useEffect(() => {
    closeButtonRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event) => { if (event.key === "Escape" && !saving) onClose?.(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (facingMode === "user") {
      // Mirror the selfie so the saved photo matches the on-screen preview.
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { setError("Could not capture the photo. Try again."); return; }
      stopStream();
      setCaptured({ url: URL.createObjectURL(blob), blob });
    }, "image/png");
  };

  const retake = () => {
    if (captured?.url) URL.revokeObjectURL(captured.url);
    setCaptured(null);
    setError("");
  };

  const usePhoto = async () => {
    if (!captured) return;
    setSaving(true); setSavingLabel("Saving…"); setError("");
    try {
      await uploadModelReference(captured.blob);
      onSaved?.();
    } catch (uploadError) {
      setError(uploadError.message);
      setSaving(false);
    }
  };

  const useExistingPhoto = async (file) => {
    if (!file) return;
    setSaving(true);
    setSavingLabel(isHeicFile(file) ? "Converting HEIC…" : "Saving…");
    setError("");
    try {
      await uploadModelReference(file);
      onSaved?.();
    } catch (uploadError) {
      setError(uploadError.message);
      setSaving(false);
    }
  };

  return (
    <div className="camera-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose?.()}>
      <section className="camera-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="camera-dialog__header">
          <div>
            <p className="camera-dialog__eyebrow">Private reference photo</p>
            <h2>{title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="camera-dialog__close" onClick={() => !saving && onClose?.()} aria-label="Close camera">
            <X size={20} />
          </button>
        </header>

        <div className="camera-stage">
          {captured ? (
            <img className="camera-preview" src={captured.url} alt="Captured reference photo preview" />
          ) : (
            <>
              <video
                ref={videoRef}
                className={`camera-video${facingMode === "user" ? " is-mirrored" : ""}`}
                playsInline
                muted
                autoPlay
                aria-label="Live camera preview"
              />
              {status !== "live" && (
                <div className="camera-stage__overlay">
                  {status === "error"
                    ? <p>{error}</p>
                    : <p><SpinnerGap size={22} className="camera-spinner" /> Opening the camera…</p>}
                </div>
              )}
            </>
          )}
        </div>

        {error && <p className="camera-error" role="alert">{error}</p>}

        <p className="camera-hint">
          {captured
            ? "Happy with this photo? It is stored privately and used only when you generate a try-on."
            : "Frame your head and upper body in good light. The photo never leaves your private server."}
        </p>

        <div className="camera-actions">
          {captured ? (
            <>
              <button type="button" className="camera-button" onClick={retake} disabled={saving}>
                <ArrowCounterClockwise size={16} /> Retake
              </button>
              <button type="button" className="camera-button camera-button--primary" onClick={usePhoto} disabled={saving}>
                {saving ? <><SpinnerGap size={16} className="camera-spinner" /> {savingLabel}</> : <><Check size={16} weight="bold" /> Use this photo</>}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="camera-button" onClick={() => setFacingMode((mode) => mode === "user" ? "environment" : "user")} disabled={status !== "live"}>
                <CameraRotate size={16} /> Flip camera
              </button>
              <button type="button" className="camera-button camera-button--primary" onClick={takePhoto} disabled={status !== "live"}>
                <Camera size={16} weight="bold" /> Capture
              </button>
            </>
          )}
        </div>
        <button type="button" className="camera-upload-alternative" onClick={() => fileInputRef.current?.click()} disabled={saving}>
          <UploadSimple size={16} /> Choose an existing photo instead
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(event) => {
            void useExistingPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </section>
    </div>
  );
}
