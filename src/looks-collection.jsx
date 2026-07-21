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

export function LookLightbox({ look, onClose, onDelete }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
    };
  }, [onClose]);

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
        <img src={look.image} alt={look.name} />
        <footer>
          <time dateTime={look.createdAt}>{new Date(look.createdAt).toLocaleDateString("hr-HR")}</time>
          {onDelete && <button type="button" onClick={() => onDelete(look)}><Trash size={16} /> Obriši fotografiju</button>}
        </footer>
      </section>
    </div>
  );
}

export function LooksCollection({ onOpenWardrobe }) {
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

  const visibleLooks = useMemo(() => filter === "all" ? looks : looks.filter((look) => look.source === filter), [filter, looks]);
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

      <nav className="looks-filters" aria-label="Filtriraj prikaze na meni">
        {FILTERS.map((item) => (
          <button key={item.id} type="button" className={filter === item.id ? "active" : ""} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>
        ))}
      </nav>

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

      {!!visibleLooks.length && (
        <section className="looks-grid" aria-label="Spremljeni prikazi na meni">
          {visibleLooks.map((look) => (
            <article className="look-card" key={look.id}>
              <button className="look-card__image" type="button" onClick={() => setSelected(look)} aria-label={`Otvori ${look.name} preko cijelog ekrana`}>
                <img src={look.image} alt="" />
                <span>{look.source === "ai" ? <><Sparkle size={13} weight="fill" /> AI prikaz</> : <><Camera size={14} weight="bold" /> Moja fotografija</>}</span>
              </button>
              <div className="look-card__copy">
                <div><h2>{look.name}</h2><time dateTime={look.createdAt}>{new Date(look.createdAt).toLocaleDateString("hr-HR")}</time></div>
                <button type="button" onClick={() => removeLook(look)} aria-label={`Obriši ${look.name}`}><Trash size={16} /></button>
              </div>
            </article>
          ))}
        </section>
      )}

      {selected && <LookLightbox look={selected} onClose={() => setSelected(null)} onDelete={removeLook} />}
    </main>
  );
}
