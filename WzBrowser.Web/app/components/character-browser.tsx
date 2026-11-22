import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CharacterItem, CharacterSection, PropTree } from "../lib/api";
import { useConnection } from "../lib/connection";
import { parentPath } from "../lib/paths";
import { EDITABLE, invalid } from "../lib/values";
import { useActions, useWorkspaceData } from "../lib/workspace";
import { InlineEdit } from "./node-tree";
import { PaneResizer, usePaneWidth, type PaneWidth } from "./pane-resizer";
import { SizePicker, SIZES, Thumbnail, useThumbnailSize } from "./canvas-gallery";
import { Photo, Search, XMark } from "./icons";
import { attackSpeed, BONUS, FLAGS, jobs, REQUIRE } from "./item-table";

type Kind = "character" | "item" | "skill";

/** The section picked last, per kind of file (each has its own menu). */
const sectionKey = (kind: Kind) => (kind === "character" ? "wzbrowser.characterSection" : `wzbrowser.${kind}Section`);

/**
 * Character.wz or Item.wz as thumbnails, one section (Weapon, Cap, Coat, ... or Consume, Etc, Cash, ...) at a time,
 * picked from a menu down the side. Clicking
 * an item shows it beside the grid with its info (stats, price, requirements) and String's name and description, which can
 * be edited: that opens String.wz, where the change waits to be saved. The list comes from names alone; each picture is
 * fetched as its thumbnail scrolls into view. Double-click (or Enter, or the details' button) shows the item in the raw tree.
 */
export const CharacterBrowser = memo(function CharacterBrowser({ fileId, kind, revision, onOpenRaw }: {
    fileId: string;
    /** Character and Item show an item's info; Skill (sections are jobs) shows the whole skill's properties. */
    kind: Kind;
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
    const menuPane = usePaneWidth("sections", 176, 120, 480);
    const detailsPane = usePaneWidth("details", 336, 260, 900);
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
                    try { remembered = localStorage.getItem(sectionKey(kind)); } catch { /* not persisted */ }
                    return list.find((s) => s.path === remembered)?.path ?? list[0]?.path ?? null;
                });
            },
            (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
        );
        return () => { cancelled = true; };
    }, [api, status, fileId, kind, revision]);

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
        try { localStorage.setItem(sectionKey(kind), path); } catch { /* not persisted */ }
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
            <nav aria-label="Sections" style={{ width: menuPane.width }} className="flex shrink-0 flex-col overflow-y-auto border-r border-zinc-100 py-2 text-[13px] dark:border-zinc-800">
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
                            {s.count != null && <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{s.count.toLocaleString()}</span>}
                        </button>
                    );
                })}
            </nav>
            <PaneResizer pane={menuPane} side="left" label="Resize the section menu" />

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
                                        picture: item.path,
                                        frames: null,
                                    }}
                                    box={box}
                                    url={(path) => api.characterPictureUrl(fileId, path, revision)}
                                    selected={selected === item.path}
                                    onSelect={() => setSelected(item.path)}
                                    onOpen={onOpenRaw ? () => onOpenRaw(item.path) : undefined}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {current && section != null && <PaneResizer pane={detailsPane} side="right" label="Resize the details" />}
            {current && section != null && (
                <Details
                    pane={detailsPane}
                    key={current.path}
                    fileId={fileId}
                    kind={kind}
                    revision={revision}
                    section={section}
                    item={current}
                    onOpenRaw={onOpenRaw}
                    onClose={() => setSelected(null)}
                    onDeleted={() => {
                        setSelected(null);
                        // Character's revision changes too, which refetches the menu's counts and the list.
                        setListing((l) => l && { ...l, items: l.items.filter((i) => i.path !== current.path) });
                    }}
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

/**
 * The picture as large as the box allows, scaled by whole steps (up to 4x) so pixel art stays sharp; one larger
 * than the box is shrunk to fit.
 */
function Picture({ src, width, height }: { src: string; width: number; height: number }) {
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => { setFailed(false); }, [src]);
    const room = { w: width - 16, h: height - 16 };
    let scale = 1;
    if (natural) {
        const fit = Math.min(room.w / natural.w, room.h / natural.h);
        if (fit >= 1) scale = Math.min(4, Math.floor(fit));
        else scale = fit;
    }
    return (
        <span style={{ height }} className="grid w-full place-items-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            {!failed ? (
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
                    onError={() => setFailed(true)}
                    style={{
                        imageRendering: "pixelated",
                        maxWidth: "none",
                        width: natural ? natural.w * scale : undefined,
                        height: natural ? natural.h * scale : undefined,
                        visibility: natural ? undefined : "hidden",
                    }}
                />
            ) : <Photo className="size-8 text-zinc-300 dark:text-zinc-600" />}
        </span>
    );
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function Details({ pane, fileId, kind, revision, section, item, onOpenRaw, onClose, onDeleted, onSaved }: {
    pane: PaneWidth;
    fileId: string;
    kind: Kind;
    revision: number;
    section: string;
    item: CharacterItem;
    onOpenRaw?: (path: string) => void;
    onClose: () => void;
    onDeleted: () => void;
    onSaved: (item: CharacterItem, stringFileId: string, stringRevision: number) => void;
}) {
    const { api, readOnly } = useConnection();
    const actions = useActions();
    const [name, setName] = useState(item.name ?? "");
    const [desc, setDesc] = useState(item.desc ?? "");
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const changed = name !== (item.name ?? "") || desc !== (item.desc ?? "");
    const editable = !readOnly && item.id != null;
    // undefined while loading; null when the item has no info.
    const [info, setInfo] = useState<PropTree | null | undefined>(undefined);
    const [infoError, setInfoError] = useState<string | null>(null);
    // Where the info's values are in the file, to edit them: an item's info node, or the skill itself.
    const infoPath = kind === "skill" ? item.path : `${item.path}/info`;
    const editValue = readOnly ? undefined : (path: string, value: string) => actions.editNode(fileId, path, { value });

    useEffect(() => {
        let cancelled = false;
        setInfoError(null);
        api.characterInfo(fileId, item.path).then(
            (t) => { if (!cancelled) setInfo(t ?? null); },
            (e) => { if (!cancelled) setInfoError(e instanceof Error ? e.message : String(e)); },
        );
        return () => { cancelled = true; };
    }, [api, fileId, item.path, revision]);

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

    const remove = async () => {
        setDeleting(true);
        const deleted = await actions.deleteNode(fileId, item.path, item.name ? `${item.name} (${fileName(item.path)})` : fileName(item.path), {
            strings: true,
            body: `${item.path.endsWith(".img") ? "Its .img" : "It"} is removed from this file${item.stringPath ? ", and its name and description from String" : ""}, in memory only. Nothing on disk changes until you save${item.stringPath ? " each file" : ""}, and Revert discards the edits.`,
        });
        if (deleted) onDeleted();
        else setDeleting(false);
    };

    const infoSection = (
        <section aria-label={kind === "skill" ? "Properties" : "Info"} className="border-b border-zinc-100 p-4 dark:border-zinc-800">
            {infoError ? <p className="error-text text-xs">{infoError}</p>
                : info === undefined ? <div className="space-y-1.5">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-4 rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>
                : info === null ? <p className="text-xs text-zinc-400">This has no info.</p>
                : kind === "skill" ? <SkillProperties info={info} path={infoPath} onEdit={editValue} />
                : <InfoView info={info} path={infoPath} onEdit={editValue} />}
        </section>
    );

    return (
        <aside aria-label={kind === "skill" ? "Skill details" : "Item details"} style={{ width: pane.width }} className="flex shrink-0 flex-col overflow-y-auto border-l border-zinc-100 dark:border-zinc-800">
            <div className="flex items-start gap-3 border-b border-zinc-100 p-4 pb-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-semibold" title={item.name ?? undefined}>{item.name ?? <i className="font-normal text-zinc-400">No name</i>}</p>
                    {item.id != null && <p className="font-mono text-xs tabular-nums text-zinc-500">{item.id}</p>}
                    <p className="break-all font-mono text-[11px] text-zinc-400">{item.path}</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Close details" className="btn-icon -mr-1 -mt-1"><XMark className="size-4" /></button>
            </div>
            <div className="border-b border-zinc-100 p-4 dark:border-zinc-800">
                <Picture
                    src={api.characterPictureUrl(fileId, item.path, revision)}
                    width={pane.width - 32}
                    height={Math.round(Math.min(360, Math.max(160, (pane.width - 32) * 0.6)))}
                />
            </div>

            {/* A skill's properties run long (a set of values per level), so its name and description come first. */}
            {kind !== "skill" && infoSection}
            <form className="flex flex-col gap-4 border-b border-zinc-100 p-4 dark:border-zinc-800" onSubmit={(e) => { e.preventDefault(); void save(); }}>
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
                    {!readOnly && (
                        <button type="button" onClick={() => void remove()} disabled={deleting} className="btn-secondary px-4 py-2 text-[13px] text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                            title={`Deletes the ${kind === "skill" ? "skill" : "item"} and String's entry for it, in memory, to be saved from each file's window`}>
                            {deleting ? "Deleting…" : "Delete"}
                        </button>
                    )}
                </div>
            </form>
            {kind === "skill" && infoSection}
        </aside>
    );
}

/** A skill's properties (common, level/1, ..., its flags), every value editable in place unless the server is read only. */
function SkillProperties({ info, path, onEdit }: { info: PropTree; path: string; onEdit?: (path: string, value: string) => Promise<boolean> }) {
    const all = (info.children ?? []).filter((c) => !HIDDEN_TYPES.has(c.type));
    if (all.length === 0) return <p className="text-xs text-zinc-400">This skill has no properties.</p>;
    return (
        <div className="space-y-1.5 text-[12px]">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Properties</h3>
            <ul className="space-y-0.5 font-mono">{all.map((c) => <InfoNode key={c.name} node={c} path={`${path}/${c.name}`} onEdit={onEdit} />)}</ul>
        </div>
    );
}

/** info's numbers directly under it, by trimmed name (some installs write "reqLevel " beside "reqLevel"). */
function numbers(info: PropTree): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of info.children ?? []) {
        const key = c.name.trim();
        if (!c.children && c.value != null && /^-?\d+$/.test(c.value.trim()) && !(key in out)) out[key] = Number(c.value);
    }
    return out;
}

/** Pictures, positions and sounds: nothing to read in a list of values. */
const HIDDEN_TYPES = new Set(["canvas", "uol", "vector", "convex", "sound"]);

const num = (n: number) => n.toLocaleString();
const signed = (n: number) => (n < 0 ? num(n) : `+${num(n)}`);

function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 py-0.5" title={title}>
            <dt className="text-zinc-500">{label}</dt>
            <dd className="text-right font-medium tabular-nums text-zinc-800 dark:text-zinc-200">{children}</dd>
        </div>
    );
}

function Group({ title, children }: { title: string; children: ReactNode[] }) {
    if (children.length === 0) return null;
    return (
        <div className="space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
            <dl className="text-[13px]">{children}</dl>
        </div>
    );
}

/**
 * An item's info as the game words it (flags, requirements, what it adds, price), then every value as written, each
 * editable in place when `onEdit` is given. `path` is the info node's in the file.
 */
function InfoView({ info, path, onEdit }: { info: PropTree; path: string; onEdit?: (path: string, value: string) => Promise<boolean> }) {
    const s = numbers(info);
    const flags = FLAGS.filter(([key]) => s[key]);

    const required: ReactNode[] = [];
    if (s.reqLevel) required.push(<Row key="reqLevel" label="Level" title="info/reqLevel">{num(s.reqLevel)}</Row>);
    for (const [key, label] of REQUIRE) if (s[key]) required.push(<Row key={key} label={label} title={`info/${key}`}>{num(s[key])}</Row>);
    const job = jobs(s.reqJob);
    if (job) required.push(<Row key="reqJob" label="Job" title="info/reqJob">{job}</Row>);

    const bonus: ReactNode[] = [];
    for (const [key, label] of BONUS) if (s[key]) bonus.push(<Row key={key} label={label} title={`info/${key}`}>{signed(s[key])}</Row>);

    const other: ReactNode[] = [];
    if (s.tuc) other.push(<Row key="tuc" label="Upgrade slots" title="info/tuc">{num(s.tuc)}</Row>);
    if (s.attackSpeed) other.push(<Row key="attackSpeed" label="Attack speed" title="info/attackSpeed">{attackSpeed(s.attackSpeed)}</Row>);
    if (s.price) other.push(<Row key="price" label="Price" title="info/price: what a shop pays for it">{num(s.price)} mesos</Row>);
    if (s.slotMax && s.slotMax > 1) other.push(<Row key="slotMax" label="Stacks to" title="info/slotMax">{num(s.slotMax)}</Row>);

    const all = (info.children ?? []).filter((c) => !HIDDEN_TYPES.has(c.type));

    return (
        <div className="space-y-4">
            {flags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {flags.map(([key, label, cls]) => <span key={key} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>)}
                </div>
            )}
            <Group title="Requires">{required}</Group>
            <Group title="Stats">{bonus}</Group>
            <Group title="Other">{other}</Group>
            {all.length > 0 && (
                <details className="text-[12px]">
                    <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                        All info ({all.length}){onEdit && <span className="font-normal normal-case tracking-normal"> · click a value to edit</span>}
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 font-mono">{all.map((c) => <InfoNode key={c.name} node={c} path={`${path}/${c.name}`} onEdit={onEdit} />)}</ul>
                </details>
            )}
        </div>
    );
}

/** One raw value at `path`, editable in place when `onEdit` is given and its type holds a value, with what's below it indented. */
function InfoNode({ node, path, onEdit }: { node: PropTree; path: string; onEdit?: (path: string, value: string) => Promise<boolean> }) {
    const kids = (node.children ?? []).filter((c) => !HIDDEN_TYPES.has(c.type));
    const shows = node.value != null && !node.children;
    return (
        <li>
            <span className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 truncate text-zinc-500" title={`${node.type} · ${path}`}>{node.name}</span>
                {shows && (onEdit && EDITABLE.has(node.type) ? (
                    <span className="min-w-0 flex-1 text-right text-zinc-800 dark:text-zinc-200">
                        <InlineEdit key={`${path}:${node.value}`} label={node.name} value={node.value!} multiline={node.type === "string"}
                            check={(v) => invalid(node.type, v)} onSave={(v) => onEdit(path, v)} />
                    </span>
                ) : <span className="break-all text-right text-zinc-800 dark:text-zinc-200">{node.value}</span>)}
            </span>
            {kids.length > 0 && <ul className="ml-3 space-y-0.5 border-l border-zinc-100 pl-2 dark:border-zinc-800">{kids.map((c) => <InfoNode key={c.name} node={c} path={`${path}/${c.name}`} onEdit={onEdit} />)}</ul>}
        </li>
    );
}
