import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera } from "@phosphor-icons/react/Camera";
import { ImageSquare } from "@phosphor-icons/react/ImageSquare";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { Sparkle } from "@phosphor-icons/react/Sparkle";
import { Trash } from "@phosphor-icons/react/Trash";
import { X } from "@phosphor-icons/react/X";

const FILTERS = [
  { id: "all", label: "Sve" },
  { id: "ai", label: "AI prikazi" },
  { id: "owner-photo", label: "Moje fotografije" },
];

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

function LookCard({ look, index, isOutfit, onOpen, onDelete }) {
  return (
    <article className="look-card">
      <button className="look-card__image" type="button" onClick={() => onOpen(look)} aria-label={`Otvori ${look.name} preko cijelog ekrana`}>
        <img src={look.image} alt="" loading={index < 2 ? "eager" : "lazy"} decoding="async" fetchPriority={index === 0 ? "high" : "auto"} />
        <span>
          {isOutfit
            ? <><Sparkle size={13} weight="fill" /> Kombinacija · {look.itemIds.length} komada</>
            : look.source === "ai" ? <><Sparkle size={13} weight="fill" /> AI prikaz</> : <><Camera size={14} weight="bold" /> Moja fotografija</>}
        </span>
      </button>
      <div className="look-card__copy">
        <div><h2>{look.name}</h2><time dateTime={look.createdAt}>{new Date(look.createdAt).toLocaleDateString("hr-HR")}</time></div>
        <button type="button" onClick={() => onDelete(look)} aria-label={`Obriši ${look.name}`}><Trash size={16} /></button>
      </div>
    </article>
  );
}

export function LooksCollection({ onOpenWardrobe, items = [] }) {
  const [looks, setLooks] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  const loadLooks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/outfits", { cache: "no-store" });
      if (!response.ok) throw new Error("Zbirku trenutačno nije moguće učitati.");
      setLooks(await response.json());
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLooks(); }, [loadLooks]);

  const outfitLooks = useMemo(() => looks.filter((look) => (look.itemIds?.length || 0) > 1), [looks]);
  const singleLooks = useMemo(() => looks.filter((look) => (look.itemIds?.length || 0) <= 1), [looks]);
  const visibleSingleLooks = useMemo(() => filter === "all" ? singleLooks : singleLooks.filter((look) => look.source === filter), [filter, singleLooks]);
  const aiCount = looks.filter((look) => look.source === "ai").length;
  const photoCount = looks.filter((look) => look.source === "owner-photo").length;

  const removeLook = async (look) => {
    if (!window.confirm(`Obrisati “${look.name}”?`)) return;
    const response = await fetch(`/api/outfits/${look.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Fotografiju trenutačno nije moguće obrisati.");
      return;
    }
    setLooks((current) => current.filter((candidate) => candidate.id !== look.id));
    setSelected(null);
  };

  return (
    <main className="looks-page">
      <header className="section-heading">
        <div>
          <p className="section-kicker">Privatna zbirka</p>
          <h1>Na meni</h1>
          <p>Svi AI prikazi i tvoje stvarne fotografije na jednom mjestu, odvojeno od uređivanja odjeće.</p>
        </div>
        <div className="looks-summary" aria-label={`${looks.length} spremljenih prikaza`}>
          <span><Sparkle size={15} weight="fill" /> {aiCount} AI</span>
          <span><Camera size={16} weight="bold" /> {photoCount} mojih</span>
        </div>
      </header>

      {loading && <div className="looks-state"><SpinnerGap className="wardrobe-state__spinner" size={24} /><p>Učitavam tvoju zbirku…</p></div>}
      {error && <div className="looks-state looks-state--error" role="alert"><p>{error}</p><button type="button" onClick={loadLooks}>Pokušaj ponovno</button></div>}
      {!loading && !error && !looks.length && (
        <div className="looks-state looks-state--empty">
          <ImageSquare size={34} weight="light" />
          <h2>Ovdje će biti tvoji prikazi</h2>
          <p>Otvori komad u Ormaru, isprobaj ga uz AI ili dodaj svoju stvarnu fotografiju.</p>
          <button type="button" onClick={onOpenWardrobe}>Otvori ormar</button>
        </div>
      )}

      {!loading && !error && !!looks.length && (
        <>
          <section className="looks-section" aria-labelledby="looks-outfits-title">
            <div className="looks-section__heading">
              <h2 id="looks-outfits-title">Kombinacije</h2>
              <span>{outfitLooks.length ? `${outfitLooks.length} ${outfitLooks.length === 1 ? "cijeli outfit" : "cijelih outfita"}` : "Još nema spremljenih kombinacija"}</span>
            </div>
            {outfitLooks.length ? (
              <div className="looks-grid">
                {outfitLooks.map((look, index) => <LookCard key={look.id} look={look} index={index} isOutfit onOpen={setSelected} onDelete={removeLook} />)}
              </div>
            ) : (
              <p className="looks-section__empty">Cijele kombinacije nastaju kad u Kombinacijama isprobaš više komada odjednom uz AI.</p>
            )}
          </section>

          <section className="looks-section" aria-labelledby="looks-single-title">
            <div className="looks-section__heading">
              <h2 id="looks-single-title">Pojedinačni komadi</h2>
              <nav className="looks-filters" aria-label="Filtriraj pojedinačne komade">
                {FILTERS.map((item) => (
                  <button key={item.id} type="button" className={filter === item.id ? "active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
                ))}
              </nav>
            </div>
            {visibleSingleLooks.length ? (
              <div className="looks-grid">
                {visibleSingleLooks.map((look, index) => <LookCard key={look.id} look={look} index={index} onOpen={setSelected} onDelete={removeLook} />)}
              </div>
            ) : (
              <p className="looks-section__empty">Nema pojedinačnih isprobaja za ovaj filter.</p>
            )}
          </section>
        </>
      )}

      {selected && <LookLightbox look={selected} items={items} onClose={() => setSelected(null)} onDelete={removeLook} />}
    </main>
  );
}
