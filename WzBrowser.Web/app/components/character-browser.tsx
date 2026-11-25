import {
    memo,
    useEffect,
    useMemo,
    useState,
    type MouseEvent,
    type ReactNode,
    type SyntheticEvent,
} from "react";
import type { CharacterItem, CharacterItems, CharacterSection, CharacterText, PropTree } from "../lib/api";
import { useConnection } from "../lib/connection";
import { errorMessage } from "../lib/errors";
import { attackSpeed, BONUS, FLAGS, jobs, REQUIRE } from "../lib/item-format";
import { parentPath } from "../lib/paths";
import { EDITABLE, invalid } from "../lib/values";
import { useActions, useWorkspaceData } from "../lib/workspace";
import { InlineEdit } from "./node-tree";
import { PaneResizer, usePaneWidth, type PaneWidth } from "./pane-resizer";
import { SizePicker, SIZES, Thumbnail, useThumbnailSize } from "./canvas-gallery";
import { Photo, Search, XMark } from "./icons";

type Kind = "character" | "item" | "skill";

/** Saves a value at a path in the file; resolves false when the save failed. */
type EditValue = (path: string, value: string) => Promise<boolean>;

interface Listing extends CharacterItems {
    section: string;
}

/** Pictures, positions and sounds: nothing to read in a list of values. */
const HIDDEN_TYPES = new Set(["canvas", "uol", "vector", "convex", "sound"]);

const SECTION_BUTTON = [
    "mx-1.5 flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-left outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400",
].join(" ");
const SECTION_ACTIVE = "bg-accent-50 font-medium text-accent-800 dark:bg-accent-600/15 dark:text-accent-200";
const SECTION_IDLE = "hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60";
const DELETE_BUTTON = [
    "btn-secondary px-4 py-2 text-[13px] text-rose-600 hover:bg-rose-50",
    "dark:text-rose-400 dark:hover:bg-rose-950/40",
].join(" ");
const HEADING = "text-[11px] font-semibold uppercase tracking-wide text-zinc-400";
const DIVIDER = "border-b border-zinc-100 dark:border-zinc-800";
const SECONDARY_BUTTON = "btn-secondary px-4 py-2 text-[13px]";

/** The section picked last, per kind of file (each has its own menu). */
function sectionKey(kind: Kind) {
    return kind === "character" ? "wzbrowser.characterSection" : `wzbrowser.${kind}Section`;
}

function rememberedSection(kind: Kind) {
    try {
        return localStorage.getItem(sectionKey(kind));
    } catch {
        return null;
    }
}

function rememberSection(kind: Kind, path: string) {
    try {
        localStorage.setItem(sectionKey(kind), path);
    } catch { /* not persisted */ }
}

const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The values worth listing under a node: everything but pictures, positions and sounds. */
const shownChildren = (node: PropTree) => (node.children ?? []).filter((child) => !HIDDEN_TYPES.has(child.type));

function Skeleton({ rows, className }: { rows: number; className: string }) {
    const rowClass = `skeleton rounded bg-zinc-100 dark:bg-zinc-800 ${className}`;
    return Array.from({ length: rows }, (_, index) => <div key={index} className={rowClass} />);
}

/**
 * Character.wz, Item.wz or Skill.wz as thumbnails, one section (Weapon, Cap, ... or Consume, Etc, ... or a job) at a
 * time, picked from a menu down the side. Clicking an item shows it beside the grid with its info (stats, price,
 * requirements, or a skill's properties) and String's name, description and other text, which can be edited: that
 * opens String.wz, where the change waits to be saved. The list comes from names alone; each picture is fetched as
 * its thumbnail scrolls into view. Double-click (or Enter, or the details' button) shows the item in the raw tree.
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
    const [listing, setListing] = useState<Listing | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [size, changeSize] = useThumbnailSize();
    const menuPane = usePaneWidth("sections", 176, 120, 480);
    const detailsPane = usePaneWidth("details", 336, 260, 900);
    const stringRevision = listing?.stringFileId ? files[listing.stringFileId]?.revision : undefined;

    useEffect(function loadSections() {
        if (status !== "online") return;
        let cancelled = false;

        function showSections(list: CharacterSection[]) {
            if (cancelled) return;
            setSections(list);
            setSection(function keepOrRemember(current) {
                if (current != null && list.some((entry) => entry.path === current)) return current;
                const remembered = rememberedSection(kind);
                return list.find((entry) => entry.path === remembered)?.path ?? list[0]?.path ?? null;
            });
        }

        function showError(reason: unknown) {
            if (!cancelled) setError(errorMessage(reason));
        }

        api.characterSections(fileId).then(showSections, showError);
        return () => { cancelled = true; };
    }, [api, status, fileId, kind, revision]);

    useEffect(function loadItems() {
        if (status !== "online" || section == null) return;
        let cancelled = false;
        const shownSection = section;

        function showItems(loaded: CharacterItems) {
            if (cancelled) return;
            setListing({ section: shownSection, ...loaded });
            setError(null);
        }

        function showError(reason: unknown) {
            if (!cancelled) setError(errorMessage(reason));
        }

        api.characterItems(fileId, section).then(showItems, showError);
        return () => { cancelled = true; };
    }, [api, status, fileId, revision, section, stringRevision]);

    function pick(path: string) {
        setSection(path);
        setSelected(null);
        rememberSection(kind, path);
    }

    const items = listing?.section === section ? listing.items : null;
    const shown = useMemo(() => filterItems(items, filter), [items, filter]);
    const current = items?.find((item) => item.path === selected) ?? null;
    const box = SIZES[size];
    const tile = Math.max(box, 76);
    const pictureUrl = (path: string) => api.characterPictureUrl(fileId, path, revision);

    function deselectOnBackground(event: MouseEvent<HTMLDivElement>) {
        if (event.target === event.currentTarget) setSelected(null);
    }

    function removeFromList(path: string) {
        setSelected(null);
        // Character's revision changes too, which refetches the menu's counts and the list.
        setListing(function withoutRemoved(previous) {
            if (!previous) return previous;
            return { ...previous, items: previous.items.filter((item) => item.path !== path) };
        });
    }

    return (
        <div className="flex min-h-0 flex-1">
            <SectionMenu
                sections={sections}
                section={section}
                error={error}
                width={menuPane.width}
                onPick={pick}
            />
            <PaneResizer pane={menuPane} side="left" label="Resize the section menu" />

            <div className="flex min-w-0 flex-1 flex-col">
                <div className={`flex shrink-0 items-center gap-3 px-4 py-2 ${DIVIDER}`}>
                    <label className="relative min-w-0 max-w-64 flex-1">
                        <Search className="search-icon" />
                        <input
                            value={filter}
                            onChange={(event) => setFilter(event.target.value)}
                            placeholder="Filter by id or name"
                            aria-label="Filter"
                            className="search-input py-1.5 text-xs"
                        />
                        {filter && (
                            <button
                                type="button"
                                aria-label="Clear filter"
                                onClick={() => setFilter("")}
                                className="search-clear"
                            >
                                <XMark className="size-3.5" />
                            </button>
                        )}
                    </label>
                    <span className="flex-1 truncate text-xs text-zinc-500">{itemCountText(shown, items, error)}</span>
                    <SizePicker size={size} onChange={changeSize} />
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-3" onClick={deselectOnBackground}>
                    {error && <p className="error-text text-center">{error}</p>}
                    {shown?.length === 0 && (
                        <p className="p-6 text-center text-sm text-zinc-500">
                            {items?.length ? "Nothing matches the filter." : "This section is empty."}
                        </p>
                    )}
                    {shown && shown.length > 0 && (
                        <div
                            role="listbox"
                            aria-label="Items"
                            className="grid gap-1"
                            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tile + 12}px, 1fr))` }}
                        >
                            {shown.map((item) => (
                                <Thumbnail
                                    key={item.path}
                                    item={{
                                        path: item.path,
                                        label: item.name ?? fileName(item.path),
                                        title: item.name ? fileName(item.path) : null,
                                        picture: item.path,
                                        frames: null,
                                    }}
                                    box={box}
                                    url={pictureUrl}
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
                <>
                    <PaneResizer pane={detailsPane} side="right" label="Resize the details" />
                    <Details
                        key={current.path}
                        pane={detailsPane}
                        fileId={fileId}
                        kind={kind}
                        revision={revision}
                        section={section}
                        item={current}
                        onOpenRaw={onOpenRaw}
                        onClose={() => setSelected(null)}
                        onDeleted={() => removeFromList(current.path)}
                    />
                </>
            )}
        </div>
    );
});

function filterItems(items: CharacterItem[] | null, filter: string) {
    const query = filter.trim().toLowerCase();
    if (!items || !query) return items;
    return items.filter(function matches(item) {
        return String(item.id ?? "").includes(query)
            || item.name?.toLowerCase().includes(query)
            || item.path.toLowerCase().includes(query);
    });
}

/** "12 items", "3 of 12 items" while filtered, or "Loading…". */
function itemCountText(shown: CharacterItem[] | null, items: CharacterItem[] | null, error: string | null) {
    if (!shown) return error ? "" : "Loading…";
    const noun = shown.length === 1 ? "item" : "items";
    if (shown === items || !items) return `${shown.length.toLocaleString()} ${noun}`;
    return `${shown.length.toLocaleString()} of ${items.length.toLocaleString()} ${noun}`;
}

function SectionMenu({ sections, section, error, width, onPick }: {
    sections: CharacterSection[] | null;
    section: string | null;
    error: string | null;
    width: number;
    onPick: (path: string) => void;
}) {
    return (
        <nav
            aria-label="Sections"
            style={{ width }}
            className={"flex shrink-0 flex-col overflow-y-auto border-r border-zinc-100 py-2 text-[13px]"
                + " dark:border-zinc-800"}
        >
            {!sections && !error && (
                <div className="space-y-1.5 px-3 py-2"><Skeleton rows={10} className="h-6" /></div>
            )}
            {sections?.length === 0 && <p className="px-3 py-2 text-xs text-zinc-500">This file has no folders.</p>}
            {sections?.map((entry) => {
                const active = entry.path === section;
                return (
                    <button
                        key={entry.path}
                        type="button"
                        onClick={() => onPick(entry.path)}
                        aria-current={active || undefined}
                        title={entry.path || "The .imgs at the root of the file"}
                        className={`${SECTION_BUTTON} ${active ? SECTION_ACTIVE : SECTION_IDLE}`}
                    >
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.count != null && (
                            <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                                {entry.count.toLocaleString()}
                            </span>
                        )}
                    </button>
                );
            })}
        </nav>
    );
}

/**
 * The picture as large as the box allows, scaled by whole steps (up to 4x) so pixel art stays sharp; one larger
 * than the box is shrunk to fit.
 */
function Picture({ src, width, height }: { src: string; width: number; height: number }) {
    const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(function retryNewPicture() {
        setFailed(false);
    }, [src]);

    let scale = 1;
    if (natural) {
        const fit = Math.min((width - 16) / natural.width, (height - 16) / natural.height);
        scale = fit >= 1 ? Math.min(4, Math.floor(fit)) : fit;
    }

    function measure(event: SyntheticEvent<HTMLImageElement>) {
        const image = event.currentTarget;
        setNatural({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 });
    }

    const frame = "grid w-full place-items-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
        + " dark:border-zinc-800 dark:bg-zinc-950";
    return (
        <span style={{ height }} className={frame}>
            {failed ? <Photo className="size-8 text-zinc-300 dark:text-zinc-600" /> : (
                <img
                    src={src}
                    alt=""
                    draggable={false}
                    onLoad={measure}
                    onError={() => setFailed(true)}
                    style={{
                        imageRendering: "pixelated",
                        maxWidth: "none",
                        width: natural ? natural.width * scale : undefined,
                        height: natural ? natural.height * scale : undefined,
                        visibility: natural ? undefined : "hidden",
                    }}
                />
            )}
        </span>
    );
}

/** What String's other text is: for a skill, "h" is the description shown for every level and "hN" level N's. */
function textLabel(kind: Kind, key: string) {
    if (kind !== "skill") return null;
    if (key === "h") return "Every level";
    const level = /^h(\d+)$/.exec(key);
    if (level) return `Level ${level[1]}`;
    if (key === "pdesc") return "Passive description";
    if (key === "ph") return "Passive, every level";
    return null;
}

/** Where the details' name and description come from, or why there's nothing. */
function stringSource(item: CharacterItem): ReactNode {
    if (item.stringPath) return <>From String: <span className="break-all font-mono">{item.stringPath}</span></>;
    if (item.id == null) return "This isn't an item, so String has nothing for it.";
    return "String has no entry for this item yet; clicking its name or description adds one.";
}

function textsByKey(texts: CharacterText[] | null | undefined): Record<string, string> {
    return Object.fromEntries((texts ?? []).map((text) => [text.key, text.value]));
}

const LEVEL_TEXT = /^h(\d+)$/;

/** Where each of a skill's level texts ("hN") shows among its properties: level/N's path, to the text's key. */
function levelTextPaths(info: PropTree | null | undefined, path: string, texts: CharacterText[] | null | undefined) {
    const paths = new Map<string, string>();
    const levels = info?.children?.find((child) => child.name === "level");
    const numbers = new Set((levels?.children ?? []).map((child) => child.name));
    for (const text of texts ?? []) {
        const level = LEVEL_TEXT.exec(text.key);
        if (level && numbers.has(level[1])) paths.set(`${path}/level/${level[1]}`, text.key);
    }
    return paths;
}

/** What a level's properties show first: String's text for it, which opens String there when clicked. */
interface LevelTexts {
    paths: Map<string, string>;
    values: Record<string, string>;
    onOpen?: (key: string) => void;
}

/** Loads one of an item's trees, again after edits. `tree` is undefined while loading, null when the item has none. */
function usePropTree(
    load: (fileId: string, path: string) => Promise<PropTree | undefined>,
    fileId: string,
    path: string,
    revision: number,
) {
    const [tree, setTree] = useState<PropTree | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    useEffect(function loadTree() {
        let cancelled = false;
        setError(null);

        function showTree(loaded: PropTree | undefined) {
            if (!cancelled) setTree(loaded ?? null);
        }

        function showError(reason: unknown) {
            if (!cancelled) setError(errorMessage(reason));
        }

        load(fileId, path).then(showTree, showError);
        return () => { cancelled = true; };
    }, [load, fileId, path, revision]);

    return { tree, error };
}

function Details({ pane, fileId, kind, revision, section, item, onOpenRaw, onClose, onDeleted }: {
    pane: PaneWidth;
    fileId: string;
    kind: Kind;
    revision: number;
    section: string;
    item: CharacterItem;
    onOpenRaw?: (path: string) => void;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const { api, readOnly, browseOnly } = useConnection();
    const actions = useActions();
    const [deleting, setDeleting] = useState(false);
    const texts = useMemo(() => textsByKey(item.texts), [item.texts]);
    const { tree: info, error: infoError } = usePropTree(api.characterInfo, fileId, item.path, revision);
    // Where the info's values are in the file, to edit them: an item's info node, or the skill itself.
    const infoPath = kind === "skill" ? item.path : `${item.path}/info`;
    const editValue: EditValue | undefined = readOnly
        ? undefined
        : (path, value) => actions.editNode(fileId, path, { value });
    const levelPaths = useMemo(
        () => (kind === "skill" ? levelTextPaths(info, infoPath, item.texts) : new Map<string, string>()),
        [kind, info, infoPath, item.texts],
    );
    const inLevels = new Set(levelPaths.values());
    // While a skill's properties load, its level texts wait for them rather than show here and then move.
    const loadingLevels = kind === "skill" && info === undefined && !infoError;
    const otherTexts = (item.texts ?? []).filter(
        (text) => !inLevels.has(text.key) && !(loadingLevels && LEVEL_TEXT.test(text.key)),
    );
    // A browse-only server has no raw tree to show String in.
    const openText = item.id != null && !browseOnly ? (key: string) => void openInString(key) : undefined;

    /** Opens String's window at one of the item's texts, to edit it there; a missing one is added, empty. */
    async function openInString(key: string) {
        if (item.id == null) return;
        try {
            const result = await api.openCharacterString(fileId, { id: item.id, section, key });
            actions.openFile(result.file);
            if (result.added) {
                // The text, and maybe the entry holding it, are new: the tree reloads what holds them.
                const entry = parentPath(result.path);
                actions.edited(result.file, [parentPath(entry), entry]);
                actions.toast("success", `Added ${key} for ${item.id} in ${result.file.name}. Save that file to keep it.`);
            }
            actions.reveal(result.file.id, result.path);
            // The window may have just been created; wait a frame so it exists before measuring it.
            requestAnimationFrame(() => actions.showWindow(result.file.id));
        } catch (error) {
            actions.toast("error", errorMessage(error));
        }
    }

    async function remove() {
        setDeleting(true);
        const label = item.name ? `${item.name} (${fileName(item.path)})` : fileName(item.path);
        const what = item.path.endsWith(".img") ? "Its .img" : "It";
        const fromString = item.stringPath ? ", and its name and description from String" : "";
        const eachFile = item.stringPath ? " each file" : "";
        const deleted = await actions.deleteNode(fileId, item.path, label, {
            strings: true,
            body: `${what} is removed from this file${fromString}, in memory only. `
                + `Nothing on disk changes until you save${eachFile}, and Revert discards the edits.`,
        });
        if (deleted) onDeleted();
        else setDeleting(false);
    }

    const pictureWidth = pane.width - 32;
    const pictureHeight = Math.round(Math.min(360, Math.max(160, pictureWidth * 0.6)));
    const infoSection = (
        <section aria-label={kind === "skill" ? "Properties" : "Info"} className={`p-4 ${DIVIDER}`}>
            <InfoSection
                kind={kind}
                info={info}
                error={infoError}
                path={infoPath}
                onEdit={editValue}
                levelTexts={{ paths: levelPaths, values: texts, onOpen: openText }}
            />
        </section>
    );

    return (
        <aside
            aria-label={kind === "skill" ? "Skill details" : "Item details"}
            style={{ width: pane.width }}
            className="flex shrink-0 flex-col overflow-y-auto border-l border-zinc-100 dark:border-zinc-800"
        >
            <div className={`flex items-start gap-3 p-4 pb-3 ${DIVIDER}`}>
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-semibold" title={item.name ?? undefined}>
                        {item.name ?? <i className="font-normal text-zinc-400">No name</i>}
                    </p>
                    {item.id != null && <p className="font-mono text-xs tabular-nums text-zinc-500">{item.id}</p>}
                    <p className="break-all font-mono text-[11px] text-zinc-400">{item.path}</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Close details" className="btn-icon -mr-1 -mt-1">
                    <XMark className="size-4" />
                </button>
            </div>
            <div className={`p-4 ${DIVIDER}`}>
                <Picture
                    src={api.characterPictureUrl(fileId, item.path, revision)}
                    width={pictureWidth}
                    height={pictureHeight}
                />
            </div>

            {/* A skill's properties run long (a set of values per level), so its name and description come first. */}
            {kind !== "skill" && infoSection}
            {kind === "item" && (
                <SpecSection fileId={fileId} path={item.path} revision={revision} onEdit={editValue} />
            )}
            <div className={`flex flex-col gap-3 p-4 ${DIVIDER}`}>
                <dl className="space-y-2">
                    <StringText label="Name" textKey="name" value={item.name} onOpen={openText} />
                    <StringText label="Description" textKey="desc" value={item.desc} onOpen={openText} />
                </dl>
                {otherTexts.length > 0 && <OtherTexts kind={kind} texts={otherTexts} onOpen={openText} />}
                <p className="text-[11px] leading-4 text-zinc-400">
                    {stringSource(item)}
                    {openText && " Click a text to edit it in String's window."}
                </p>
                <div className="flex flex-wrap gap-2">
                    {onOpenRaw && (
                        <button type="button" onClick={() => onOpenRaw(item.path)} className={SECONDARY_BUTTON}>
                            Show in raw tree
                        </button>
                    )}
                    {!readOnly && (
                        <button
                            type="button"
                            onClick={() => void remove()}
                            disabled={deleting}
                            className={DELETE_BUTTON}
                            title={`Deletes the ${kind === "skill" ? "skill" : "item"} and String's entry for it, `
                                + "in memory, to be saved from each file's window"}
                        >
                            {deleting ? "Deleting…" : "Delete"}
                        </button>
                    )}
                </div>
            </div>
            {kind === "skill" && infoSection}
        </aside>
    );
}

/** One of String's texts for an item, on one line; clicking it opens String's window at it. */
function StringText({ label, textKey, value, onOpen }: {
    label: ReactNode;
    textKey: string;
    value: string | null | undefined;
    onOpen?: (key: string) => void;
}) {
    return (
        <div className="min-w-0 space-y-0.5">
            <dt className="flex items-baseline gap-1.5 text-[11px] text-zinc-500">
                {label}
                <span className="font-mono text-zinc-400">{textKey}</span>
            </dt>
            <dd className="min-w-0 text-[13px]">
                <TextLine textKey={textKey} value={value} onOpen={onOpen} className="block w-full text-left" />
            </dd>
        </div>
    );
}

/**
 * A text from String on one line (its line breaks as spaces), the whole of it on hover. With `onOpen`, a button that
 * opens String's window at it; without, the whole text, wrapped.
 */
function TextLine({ textKey, value, onOpen, className }: {
    textKey: string;
    value: string | null | undefined;
    onOpen?: (key: string) => void;
    className: string;
}) {
    const text = value ?? "";
    const shown = text === "" ? <i className="font-sans text-zinc-400">(empty)</i> : text.replace(/\s*\n\s*/g, " ");
    if (!onOpen)
        return <span className={`${className} whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200`}>{text}</span>;
    const button = [
        "-mx-1.5 min-w-0 cursor-pointer truncate rounded-md px-1.5 font-sans outline-none",
        "text-zinc-800 hover:bg-zinc-100 hover:text-accent-700 focus-visible:ring-2 focus-visible:ring-accent-500/60",
        "dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-accent-300",
    ].join(" ");
    return (
        <button
            type="button"
            title={text ? `${text}\n\nClick to edit ${textKey} in String` : `Click to edit ${textKey} in String`}
            onClick={() => onOpen(textKey)}
            className={`${button} ${className}`}
        >
            {shown}
        </button>
    );
}

/** String's other text for an item, each opening String at it: a skill's "h", or levels it has no properties for. */
function OtherTexts({ kind, texts, onOpen }: {
    kind: Kind;
    texts: CharacterText[];
    onOpen?: (key: string) => void;
}) {
    return (
        <div className="space-y-1.5">
            <h3 className="text-xs font-medium text-zinc-500">{kind === "skill" ? "Level text" : "Other text"}</h3>
            <dl className="space-y-2">
                {texts.map((text) => (
                    <StringText
                        key={text.key}
                        label={textLabel(kind, text.key)}
                        textKey={text.key}
                        value={text.value}
                        onOpen={onOpen}
                    />
                ))}
            </dl>
        </div>
    );
}

/** The details' info: loading, an error, nothing, a skill's properties, or an item's info. */
function InfoSection({ kind, info, error, path, onEdit, levelTexts }: {
    kind: Kind;
    info: PropTree | null | undefined;
    error: string | null;
    path: string;
    onEdit?: EditValue;
    levelTexts: LevelTexts;
}) {
    if (error) return <p className="error-text text-xs">{error}</p>;
    if (info === undefined) return <div className="space-y-1.5"><Skeleton rows={4} className="h-4" /></div>;
    if (info === null) return <p className="text-xs text-zinc-400">This has no info.</p>;
    if (kind === "skill") return <SkillProperties info={info} path={path} onEdit={onEdit} levelTexts={levelTexts} />;
    return <InfoView info={info} path={path} onEdit={onEdit} />;
}

/** What using an item does (its spec), every value editable in place unless read only; nothing when it has no spec. */
function SpecSection({ fileId, path, revision, onEdit }: {
    fileId: string;
    path: string;
    revision: number;
    onEdit?: EditValue;
}) {
    const { api } = useConnection();
    const { tree: spec, error } = usePropTree(api.characterSpec, fileId, path, revision);
    const properties = spec ? shownChildren(spec) : [];
    if (!error && properties.length === 0) return null;

    return (
        <section aria-label="Spec" className={`space-y-1.5 p-4 text-[12px] ${DIVIDER}`}>
            <h3 className={HEADING}>Spec</h3>
            {error && <p className="error-text text-xs">{error}</p>}
            <InfoNodes
                nodes={properties}
                path={`${path}/spec`}
                onEdit={onEdit}
                className="space-y-0.5 font-mono"
            />
        </section>
    );
}

/**
 * A skill's properties (common, level/1, ..., its flags), every value editable in place unless the server is read
 * only. Each level starts with String's text for it (hN).
 */
function SkillProperties({ info, path, onEdit, levelTexts }: {
    info: PropTree;
    path: string;
    onEdit?: EditValue;
    levelTexts: LevelTexts;
}) {
    function lead(nodePath: string) {
        const key = levelTexts.paths.get(nodePath);
        return key ? <LevelText key={key} textKey={key} texts={levelTexts} /> : null;
    }

    const properties = shownChildren(info);
    if (properties.length === 0) return <p className="text-xs text-zinc-400">This skill has no properties.</p>;
    return (
        <div className="space-y-1.5 text-[12px]">
            <h3 className={HEADING}>Properties</h3>
            <InfoNodes nodes={properties} path={path} onEdit={onEdit} lead={lead} className="space-y-0.5 font-mono" />
        </div>
    );
}

/** A level's text from String (hN), first among its properties; clicking it opens String's window at it. */
function LevelText({ textKey, texts }: { textKey: string; texts: LevelTexts }) {
    return (
        <li>
            <span className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 text-zinc-500" title={`String · ${textKey}`}>{textKey}</span>
                <TextLine
                    textKey={textKey}
                    value={texts.values[textKey]}
                    onOpen={texts.onOpen}
                    className="flex-1 text-right"
                />
            </span>
        </li>
    );
}

/** info's numbers directly under it, by trimmed name (some installs write "reqLevel " beside "reqLevel"). */
function numbers(info: PropTree): Record<string, number> {
    const found: Record<string, number> = {};
    for (const child of info.children ?? []) {
        const key = child.name.trim();
        const isNumber = !child.children && child.value != null && /^-?\d+$/.test(child.value.trim());
        if (isNumber && !(key in found)) found[key] = Number(child.value);
    }
    return found;
}

const formatNumber = (value: number) => value.toLocaleString();
const signed = (value: number) => (value < 0 ? formatNumber(value) : `+${formatNumber(value)}`);

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
            <h3 className={HEADING}>{title}</h3>
            <dl className="text-[13px]">{children}</dl>
        </div>
    );
}

/** What an item needs: level, stats (REQUIRE) and job. */
function requirementRows(values: Record<string, number>) {
    const rows: ReactNode[] = [];
    if (values.reqLevel)
        rows.push(<Row key="reqLevel" label="Level" title="info/reqLevel">{formatNumber(values.reqLevel)}</Row>);
    for (const [key, label] of REQUIRE)
        if (values[key])
            rows.push(<Row key={key} label={label} title={`info/${key}`}>{formatNumber(values[key])}</Row>);
    const job = jobs(values.reqJob);
    if (job) rows.push(<Row key="reqJob" label="Job" title="info/reqJob">{job}</Row>);
    return rows;
}

/** What an item adds (BONUS). */
function bonusRows(values: Record<string, number>) {
    const rows: ReactNode[] = [];
    for (const [key, label] of BONUS)
        if (values[key])
            rows.push(<Row key={key} label={label} title={`info/${key}`}>{signed(values[key])}</Row>);
    return rows;
}

/** Upgrade slots, attack speed, price and stack size. */
function otherRows(values: Record<string, number>) {
    const rows: ReactNode[] = [];
    if (values.tuc)
        rows.push(<Row key="tuc" label="Upgrade slots" title="info/tuc">{formatNumber(values.tuc)}</Row>);
    if (values.attackSpeed)
        rows.push(
            <Row key="attackSpeed" label="Attack speed" title="info/attackSpeed">{attackSpeed(values.attackSpeed)}</Row>,
        );
    if (values.price)
        rows.push(
            <Row key="price" label="Price" title="info/price: what a shop pays for it">
                {formatNumber(values.price)} mesos
            </Row>,
        );
    if (values.slotMax && values.slotMax > 1)
        rows.push(<Row key="slotMax" label="Stacks to" title="info/slotMax">{formatNumber(values.slotMax)}</Row>);
    return rows;
}

/**
 * An item's info as the game words it (flags, requirements, what it adds, price), then every value as written, each
 * editable in place when `onEdit` is given. `path` is the info node's in the file.
 */
function InfoView({ info, path, onEdit }: { info: PropTree; path: string; onEdit?: EditValue }) {
    const values = numbers(info);
    const flags = FLAGS.filter(([key]) => values[key]);
    const all = shownChildren(info);
    const summary = "cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-300";

    return (
        <div className="space-y-4">
            {flags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {flags.map(([key, label, className]) => (
                        <span key={key} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${className}`}>
                            {label}
                        </span>
                    ))}
                </div>
            )}
            <Group title="Requires">{requirementRows(values)}</Group>
            <Group title="Stats">{bonusRows(values)}</Group>
            <Group title="Other">{otherRows(values)}</Group>
            {all.length > 0 && (
                <details className="text-[12px]">
                    <summary className={`${HEADING} ${summary}`}>
                        All info ({all.length})
                        {onEdit && (
                            <span className="font-normal normal-case tracking-normal"> · click a value to edit</span>
                        )}
                    </summary>
                    <InfoNodes nodes={all} path={path} onEdit={onEdit} className="mt-1.5 space-y-0.5 font-mono" />
                </details>
            )}
        </div>
    );
}

/** What a list shows before the values below a path, if anything. */
type Lead = (path: string) => ReactNode;

/** Raw values below `path`, as a list, after what `lead` gives for `path`. */
function InfoNodes({ nodes, path, onEdit, lead, className }: {
    nodes: PropTree[];
    path: string;
    onEdit?: EditValue;
    lead?: Lead;
    className: string;
}) {
    return (
        <ul className={className}>
            {lead?.(path)}
            {nodes.map((node) => (
                <InfoNode key={node.name} node={node} path={`${path}/${node.name}`} onEdit={onEdit} lead={lead} />
            ))}
        </ul>
    );
}

/**
 * One raw value at `path`, editable in place when `onEdit` is given and its type holds a value, with what's below it
 * indented.
 */
function InfoNode({ node, path, onEdit, lead }: { node: PropTree; path: string; onEdit?: EditValue; lead?: Lead }) {
    const children = shownChildren(node);
    return (
        <li>
            <span className="flex items-baseline justify-between gap-3">
                <span className="shrink-0 truncate text-zinc-500" title={`${node.type} · ${path}`}>{node.name}</span>
                <InfoValue node={node} path={path} onEdit={onEdit} />
            </span>
            {children.length > 0 && (
                <InfoNodes
                    nodes={children}
                    path={path}
                    onEdit={onEdit}
                    lead={lead}
                    className="ml-3 space-y-0.5 border-l border-zinc-100 pl-2 dark:border-zinc-800"
                />
            )}
        </li>
    );
}

function InfoValue({ node, path, onEdit }: { node: PropTree; path: string; onEdit?: EditValue }) {
    if (node.value == null || node.children) return null;
    if (!onEdit || !EDITABLE.has(node.type))
        return <span className="break-all text-right text-zinc-800 dark:text-zinc-200">{node.value}</span>;
    return (
        <span className="min-w-0 flex-1 text-right text-zinc-800 dark:text-zinc-200">
            <InlineEdit
                key={`${path}:${node.value}`}
                label={node.name}
                value={node.value}
                multiline={node.type === "string"}
                check={(value) => invalid(node.type, value)}
                onSave={(value) => onEdit(path, value)}
            />
        </span>
    );
}
