import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CharacterItem, CharacterSection } from "../lib/api";
import { useConnection } from "../lib/connection";
import { parentPath } from "../lib/paths";
import { useActions, useWorkspaceData } from "../lib/workspace";
import { SizePicker, SIZES, Thumbnail, useThumbnailSize } from "./canvas-gallery";
import { Photo, Search, XMark } from "./icons";

const SECTION_KEY = "wzbrowser.characterSection";

/**
 * Character.wz as thumbnails, one section (Weapon, Cap, Coat, ...) at a time, picked from a menu down the side. Clicking
 * an item shows it beside the grid with String's name and description, which can be edited: that opens String.wz, where
 * the change waits to be saved. Double-click (or Enter, or the details' button) shows the item in the raw tree.
 */
export const CharacterBrowser = memo(function CharacterBrowser({ fileId, revision, onOpenRaw }: {
    fileId: string;
    revision: number;
    onOpenRaw?: (path: string) => void;
}) {
    const { api, status } = useConnection();
    const { files } = useWorkspaceData();
    const [sections, setSections] = useState<CharacterSection[] | null>(null);
    const [section, setSection] = useState<string | null>(null);
    const [listing, setListing] = useState<{ section: string; items: CharacterItem[]; stringFileId: string | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [size, changeSize] = useThumbnailSize();
    // String revisions caused by edits made here; the list already shows those, so they don't refetch it.
    const ownRevisions = useRef(new Set<number>());
    const stringRevision = listing?.stringFileId ? files[listing.stringFileId]?.revision : undefined;

    useEffect(() => {
        if (status !== "online") return;
        let cancelled = false;
        api.characterSections(fileId).then(
            (list) => {
                if (cancelled) return;
                setSections(list);
                setSection((cur) => {
                    if (cur != null && list.some((s) => s.path === cur)) return cur;
                    let remembered: string | null = null;
                    try { remembered = localStorage.getItem(SECTION_KEY); } catch { /* not persisted */ }
                    return list.find((s) => s.path === remembered)?.path ?? list[0]?.path ?? null;
                });
            },
            (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
        );
        return () => { cancelled = true; };
    }, [api, status, fileId, revision]);

    useEffect(() => {
        if (status !== "online" || section == null) return;
        if (stringRevision != null && ownRevisions.current.has(stringRevision) && listing?.section === section) return;
        let cancelled = false;
        api.characterItems(fileId, section).then(
            (l) => { if (!cancelled) { setListing({ section, ...l }); setError(null); } },
            (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
        );
        return () => { cancelled = true; };
        // `listing` is only read to tell a section switch apart from a String edit; it mustn't refetch by itself.
    }, [api, status, fileId, revision, section, stringRevision]);

    const pick = (path: string) => {
        setSection(path);
        setSelected(null);
        try { localStorage.setItem(SECTION_KEY, path); } catch { /* not persisted */ }
    };

    const items = listing?.section === section ? listing.items : null;
    const shown = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!items || !q) return items;
        return items.filter((i) => String(i.id ?? "").includes(q) || i.name?.toLowerCase().includes(q) || i.path.toLowerCase().includes(q));
    }, [items, filter]);
    const current = items?.find((i) => i.path === selected) ?? null;

    const box = SIZES[size];
    const tile = Math.max(box, 76);

    return (
        <div className="flex min-h-0 flex-1">
            <nav aria-label="Sections" className="flex w-44 shrink-0 flex-col overflow-y-auto border-r border-zinc-100 py-2 text-[13px] dark:border-zinc-800">
                {!sections && !error && <div className="space-y-1.5 px-3 py-2">{Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton h-6 rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>}
                {sections?.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">This file has no folders.</p>}
                {sections?.map((s) => {
                    const active = s.path === section;
                    return (
                        <button
                            key={s.path}
                            type="button"
                            onClick={() => pick(s.path)}
                            aria-current={active || undefined}
                            title={s.path || "The .imgs at the root of the file"}
                            className={`mx-1.5 flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400 ${
                                active ? "bg-accent-50 font-medium text-accent-800 dark:bg-accent-600/15 dark:text-accent-200" : "hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60"
                            }`}
                        >
                            <span className="min-w-0 flex-1 truncate">{s.label}</span>
                            <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{s.count.toLocaleString()}</span>
                        </button>
                    );
                })}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
                    <label className="relative min-w-0 max-w-64 flex-1">
                        <Search className="search-icon" />
                        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by id or name" aria-label="Filter" className="search-input py-1.5 text-xs" />
                        {filter && <button type="button" aria-label="Clear filter" onClick={() => setFilter("")} className="search-clear"><XMark className="size-3.5" /></button>}
                    </label>
                    <span className="flex-1 truncate text-xs text-zinc-500">
                        {shown ? `${shown.length.toLocaleString()}${shown !== items ? ` of ${items!.length.toLocaleString()}` : ""} item${shown.length === 1 ? "" : "s"}` : error ? "" : "Loading…"}
                    </span>
                    <SizePicker size={size} onChange={changeSize} />
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-3" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
                    {error && <p className="error-text text-center">{error}</p>}
                    {shown?.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">{items?.length ? "Nothing matches the filter." : "This section is empty."}</p>}
                    {shown && shown.length > 0 && (
                        <div role="listbox" aria-label="Items" className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tile + 12}px, 1fr))` }}>
                            {shown.map((item) => (
                                <Thumbnail
                                    key={item.path}
                                    item={{
                                        path: item.path,
                                        label: item.name ?? fileName(item.path),
                                        title: item.name ? `${fileName(item.path)}` : null,
                                        picture: item.picture,
                                        frames: null,
                                    }}
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

            {current && section != null && (
                <Details
                    key={current.path}
                    fileId={fileId}
                    revision={revision}
                    section={section}
                    item={current}
                    onOpenRaw={onOpenRaw}
                    onClose={() => setSelected(null)}
                    onSaved={(updated, stringFileId, stringRev) => {
                        ownRevisions.current.add(stringRev);
                        setListing((l) => l && {
                            ...l,
                            stringFileId,
                            items: l.items.map((i) => (i.path === updated.path ? updated : i)),
                        });
                    }}
                />
            )}
        </div>
    );
});

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function Details({ fileId, revision, section, item, onOpenRaw, onClose, onSaved }: {
    fileId: string;
    revision: number;
    section: string;
    item: CharacterItem;
    onOpenRaw?: (path: string) => void;
    onClose: () => void;
    onSaved: (item: CharacterItem, stringFileId: string, stringRevision: number) => void;
}) {
    const { api, readOnly } = useConnection();
    const actions = useActions();
    const [name, setName] = useState(item.name ?? "");
    const [desc, setDesc] = useState(item.desc ?? "");
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const changed = name !== (item.name ?? "") || desc !== (item.desc ?? "");
    const editable = !readOnly && item.id != null;

    const save = async () => {
        if (item.id == null || !changed) return;
        setSaving(true);
        try {
            const r = await api.setCharacterStrings(fileId, { id: item.id, section, name, desc });
            onSaved({ ...item, name: r.name, desc: r.desc, stringPath: r.path }, r.file.id, r.file.revision);
            // String opens in its own window, where the change waits to be saved; this window stays in front.
            actions.openFile(r.file);
            actions.edited(r.file, [parentPath(r.path), r.path]);
            requestAnimationFrame(() => actions.focusWindow(fileId));
            actions.toast("success", `Changed ${item.id} in ${r.file.name}. Save that file to keep it.`);
        } catch (e) {
            actions.toast("error", e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    return (
        <aside aria-label="Item details" className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-zinc-100 dark:border-zinc-800">
            <div className="flex items-start gap-3 border-b border-zinc-100 p-4 dark:border-zinc-800">
                <span className="grid size-20 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                    {item.picture && !failed ? (
                        <img
                            src={api.pngUrl(fileId, item.picture, revision)}
                            alt=""
                            draggable={false}
                            onError={() => setFailed(true)}
                            className="max-h-16 max-w-16 object-contain"
                            style={{ imageRendering: "pixelated" }}
                        />
                    ) : <Photo className="size-8 text-zinc-300 dark:text-zinc-600" />}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-semibold" title={item.name ?? undefined}>{item.name ?? <i className="font-normal text-zinc-400">No name</i>}</p>
                    {item.id != null && <p className="font-mono text-xs tabular-nums text-zinc-500">{item.id}</p>}
                    <p className="break-all font-mono text-[11px] text-zinc-400">{item.path}</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Close details" className="btn-icon -mr-1 -mt-1"><XMark className="size-4" /></button>
            </div>

            <form className="flex flex-col gap-4 p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <label className="space-y-1.5">
                    <span className="text-xs font-medium text-zinc-500">Name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} readOnly={!editable} className="input py-2 text-[13px]" />
                </label>
                <label className="space-y-1.5">
                    <span className="text-xs font-medium text-zinc-500">Description</span>
                    <textarea value={desc} onChange={(e) => setDesc(e.target.value)} readOnly={!editable} rows={6} className="input resize-y py-2 text-[13px] leading-5" />
                </label>
                <p className="text-[11px] leading-4 text-zinc-400">
                    {item.stringPath ? <>From String: <span className="break-all font-mono">{item.stringPath}</span></>
                        : item.id == null ? "This isn't an item, so String has nothing for it."
                        : "String has no entry for this item yet; saving adds one."}
                </p>
                <div className="flex flex-wrap gap-2">
                    {editable && (
                        <button type="submit" disabled={!changed || saving} className="btn-primary px-4 py-2 text-[13px]"
                            title="Changes String.wz in memory and opens it, so it can be saved from its window">
                            {saving ? "Saving…" : "Save to String"}
                        </button>
                    )}
                    {editable && changed && (
                        <button type="button" onClick={() => { setName(item.name ?? ""); setDesc(item.desc ?? ""); }} className="btn-secondary px-4 py-2 text-[13px]">Reset</button>
                    )}
                    {onOpenRaw && (
                        <button type="button" onClick={() => onOpenRaw(item.path)} className="btn-secondary px-4 py-2 text-[13px]">Show in raw tree</button>
                    )}
                </div>
            </form>
        </aside>
    );
}
