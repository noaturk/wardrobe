import { useEffect, useMemo, useState } from "react";
import { Trash } from "@phosphor-icons/react/Trash";
import { X } from "@phosphor-icons/react/X";

function PieceLightbox({ piece, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="piece-lightbox" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <figure className="piece-lightbox__dialog" role="dialog" aria-modal="true" aria-label={piece.name || "Komad"}>
        <button type="button" className="piece-lightbox__close" onClick={onClose} aria-label="Zatvori"><X size={20} /></button>
        <img src={piece.image} alt="" />
        <figcaption>{piece.name || "Komad"}</figcaption>
      </figure>
    </div>
  );
}

export function LookLightbox({ look, items = [], onClose, onDelete }) {
  const [enlargedPiece, setEnlargedPiece] = useState(null);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape" && !enlargedPiece) onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
    };
  }, [onClose, enlargedPiece]);

  const pieces = useMemo(
    () => (look.itemIds || []).map((id) => items.find((item) => item.id === id)).filter(Boolean),
    [look.itemIds, items],
  );

  return (
    <div className="look-lightbox" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="look-lightbox__dialog" role="dialog" aria-modal="true" aria-label={look.name}>
        <header>
          <div>
            <span>{look.source === "ai" ? "AI prikaz" : "Moja fotografija"}</span>
            <h2>{look.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Zatvori fotografiju"><X size={22} /></button>
        </header>
        <div className="look-lightbox__stage">
          <img src={look.image} alt={look.name} />
          {pieces.length === 1 && (
            <button type="button" className="look-lightbox__piece" onClick={() => setEnlargedPiece(pieces[0])} aria-label={`Prikaži ${pieces[0].name || "komad"} veće`}>
              <img src={pieces[0].thumbnail || pieces[0].image} alt="" />
            </button>
          )}
          {pieces.length > 1 && (
            <div className="look-lightbox__pieces" aria-label="Komadi u kombinaciji">
              {pieces.map((piece) => (
                <button type="button" key={piece.id} onClick={() => setEnlargedPiece(piece)} aria-label={`Prikaži ${piece.name || "komad"} veće`}>
                  <img src={piece.thumbnail || piece.image} alt="" />
                  <span>{piece.name || "Komad"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <footer>
          <time dateTime={look.createdAt}>{new Date(look.createdAt).toLocaleDateString("hr-HR")}</time>
          {onDelete && <button type="button" onClick={() => onDelete(look)}><Trash size={16} /> Obriši fotografiju</button>}
        </footer>
      </section>
      {enlargedPiece && <PieceLightbox piece={enlargedPiece} onClose={() => setEnlargedPiece(null)} />}
    </div>
  );
}
