import { memo, useEffect, useRef, useState, type RefObject } from "react";
import type { GalleryItem } from "../lib/api";
import { useConnection } from "../lib/connection";
import { Photo } from "./icons";

/** Thumbnail sizes, like Explorer's View menu. */
const SIZES = { small: 32, medium: 64, large: 128, xl: 256 } as const;
type Size = keyof typeof SIZES;
const SIZE_LABEL: Record<Size, string> = { small: "Small icons", medium: "Medium icons", large: "Large icons", xl: "Extra large icons" };
const SIZE_KEY = "wzbrowser.gallerySize";

function loadSize(): Size {
    try { const v = localStorage.getItem(SIZE_KEY); if (v && v in SIZES) return v as Size; } catch { /* not persisted */ }
    return "large";
}

/**
 * A _Canvas file as a folder of thumbnails, named underneath like files. Each thing shows its first stand, move or fly
 * frame, else its icon; any other numbered series of pictures plays as an animation. Double-click (or Enter) shows the
 * thing in the raw tree.
 */
export const CanvasGallery = memo(function CanvasGallery({ fileId, revision, onOpenRaw }: {
    fileId: string;
    revision: number;
    onOpenRaw?: (path: string) => void;
}) {
    const { api, status } = useConnection();
    const [listing, setListing] = useState<{ items: GalleryItem[]; truncated: boolean } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [size, setSize] = useState<Size>(loadSize);
    const [selected, setSelected] = useState<string | null>(null);

    useEffect(() => {
        if (status !== "online") return;
        let cancelled = false;
        api.gallery(fileId).then(
            (l) => { if (!cancelled) { setListing(l); setError(null); } },
            (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
        );
        return () => { cancelled = true; };
    }, [api, status, fileId, revision]);

    const changeSize = (s: Size) => {
        setSize(s);
        try { localStorage.setItem(SIZE_KEY, s); } catch { /* not persisted */ }
    };

    const items = listing?.items;
    const box = SIZES[size];
    // Labels need some room even when the pictures are small.
    const tile = Math.max(box, 76);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
                <span className="flex-1 text-xs text-zinc-500">
                    {items
                        ? `${items.length.toLocaleString()} item${items.length === 1 ? "" : "s"}${listing!.truncated ? " (the rest are left out)" : ""}`
                        : error ? "" : "Loading…"}
                </span>
                <label className="flex items-center gap-2 text-xs text-zinc-500">
                    View
                    <select
                        value={size}
                        onChange={(e) => changeSize(e.target.value as Size)}
                        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                    >
                        {(Object.keys(SIZES) as Size[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                    </select>
                </label>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
                {error && <p className="p-6 text-center text-sm text-rose-600 dark:text-rose-400">{error}</p>}
                {items?.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">This file has no pictures.</p>}
                {items && items.length > 0 && (
                    <div role="listbox" aria-label="Pictures" className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tile + 12}px, 1fr))` }}>
                        {items.map((item) => (
                            <Thumbnail
                                key={item.path}
                                item={item}
                                box={box}
                                url={(path) => api.pngUrl(fileId, path, revision)}
                                selected={selected === item.path}
                                onSelect={() => setSelected(item.path)}
                                onOpen={onOpenRaw ? () => onOpenRaw(item.path) : undefined}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

function Thumbnail({ item, box, url, selected, onSelect, onOpen }: {
    item: GalleryItem;
    box: number;
    url: (path: string) => string;
    selected: boolean;
    onSelect: () => void;
    onOpen?: () => void;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    const frame = useAnimation(ref, item.frames);
    const picture = item.frames ? item.frames[frame].picture : item.picture;

    // Pictures smaller than the box are scaled up with hard pixel edges, like the game draws them; bigger ones shrink to fit.
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [failed, setFailed] = useState(false);
    const upscaled = natural != null && natural.w < box && natural.h < box;

    return (
        <button
            ref={ref}
            type="button"
            role="option"
            aria-selected={selected}
            title={item.title && item.title !== item.label ? `${item.label}\n${item.title}` : item.label}
            onClick={onSelect}
            onDoubleClick={onOpen}
            onKeyDown={(e) => { if (e.key === "Enter" && onOpen) { e.preventDefault(); onOpen(); } }}
            className={`flex flex-col items-center gap-1.5 rounded-lg border p-1.5 text-center transition focus-visible:outline-2 focus-visible:outline-accent-500 ${
                selected
                    ? "border-accent-300 bg-accent-50 dark:border-accent-500/50 dark:bg-accent-600/15"
                    : "border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
            }`}
        >
            <span className="grid shrink-0 place-items-center" style={{ width: box, height: box }}>
                {!failed ? (
                    <img
                        src={url(picture)}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                        onError={() => setFailed(true)}
                        className="max-h-full max-w-full object-contain"
                        style={upscaled ? { width: "100%", height: "100%", imageRendering: "pixelated" } : undefined}
                    />
                ) : (
                    <Photo className="size-1/2 max-h-8 max-w-8 text-zinc-300 dark:text-zinc-600" />
                )}
            </span>
            <span className={`line-clamp-2 w-full break-all text-xs leading-tight ${selected ? "text-accent-800 dark:text-accent-200" : "text-zinc-700 dark:text-zinc-300"}`}>
                {item.label}
            </span>
        </button>
    );
}

/** The frame an animation is on. It only plays while its thumbnail is on screen, so a big file doesn't fetch every frame. */
function useAnimation(ref: RefObject<HTMLElement | null>, frames: GalleryItem["frames"]): number {
    const [visible, setVisible] = useState(false);
    const [index, setIndex] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!frames || !el) return;
        const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref, frames]);

    useEffect(() => {
        if (!frames || !visible) return;
        const timer = setTimeout(() => setIndex((i) => (i + 1) % frames.length), frames[index % frames.length].delay);
        return () => clearTimeout(timer);
    }, [frames, visible, index]);

    return frames ? index % frames.length : 0;
}
