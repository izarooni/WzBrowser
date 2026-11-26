// All traffic goes straight from the browser to the WzBrowser API exe on the user's machine, unless the host
// configures an address of its own (see loadDefaultApiBase), e.g. a reverse proxy in front of a shared library.

/** The built-in default address: VITE_API_URL at build time, else the exe's own default. */
export const DEFAULT_API_BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:5178";
const STORAGE_KEY = "wzbrowser.apiBase";

export type NodeType =
    | "file" | "directory" | "image" | "sub" | "convex" | "canvas" | "vector" | "sound" | "uol"
    | "string" | "int" | "short" | "long" | "float" | "double" | "null" | (string & {});

export interface WzNode {
    name: string;
    type: NodeType;
    hasChildren: boolean;
    value: string | null;
    width: number | null;
    height: number | null;
    /** A canvas' pixel format, e.g. "argb4444" (see lib/image-quality). */
    format?: string | null;
}

export interface OpenedFile {
    id: string;
    name: string;
    path: string;
    encryption: string;
    version: number;
    childCount: number;
    /** In-memory edits not yet saved to a new file. */
    dirty: boolean;
    savedTo: string | null;
    /**
     * "quest" for a quest archive (QuestInfo.img + Check.img at the root, or a modular QuestData with one {id}.img per
     * quest); "etc" when Commodity.img is at the root; "canvas" for a modular install's picture file
     * (Data/Mob/_Canvas/_Canvas_000.wz); "character" for Character.wz or one of its modular parts; "item" for Item.wz
     * or one of its; "skill" for Skill.wz or one of its; "map" for Map.wz or a
     * modular part holding maps.
     */
    kind: "quest" | "etc" | "canvas" | "character" | "item" | "skill" | "map" | "generic";
    /** Changes whenever the file's contents change, so views know to refetch. */
    revision: number;
    /** The classic file this one is or is part of: "Mob" for Mob.wz, Data/Mob/Mob_000.wz or Packs/Mob_000.ms. */
    top: string;
}

export interface QuestSummary { id: number; name: string }

/**
 * One thumbnail of a _Canvas file. `path`: the thing it stands for (an .img, a skill, an item, an animation); `label`: the
 * text under it (the .img's name, else the name from String, else the path); `title`: more for the tooltip; `picture`:
 * the canvas to show; `frames`: set when it's an animation, each frame with its delay in milliseconds.
 */
export interface GalleryItem {
    path: string;
    label: string;
    title: string | null;
    picture: string;
    frames: { picture: string; delay: number }[] | null;
}

/**
 * One entry of a Character or Item file's menu: a root directory ("Weapon", "Consume"), or "" for the .imgs at the root.
 * `count` is null for Item and Skill, where counting would mean reading each .img.
 */
export interface CharacterSection { path: string; label: string; count: number | null }

/**
 * One .img of a Character file. Its picture comes from `characterPictureUrl` and its stats from `characterInfo`, fetched
 * as needed. `name`/`desc`: String's; `stringPath`: where String keeps them, or null when it has no entry for the item.
 */
export interface CharacterItem {
    path: string;
    id: number | null;
    name: string | null;
    desc: string | null;
    stringPath: string | null;
    /** String's other text for it, in order: a skill's per-level descriptions ("h", "h1", "h2", ...), or anything else
     * the entry holds. Null when there's none (an older server leaves it out). */
    texts?: CharacterText[] | null;
}

export interface CharacterText { key: string; value: string }

/** One section's items; `stringFileId` is the String file their names came from. */
export interface CharacterItems { items: CharacterItem[]; stringFileId: string | null }

/** Which of an item's texts to open String at: "name", "desc", "h1", ..., or the entry when left out. */
export interface CharacterStringOpenRequest {
    id: number;
    section: string;
    key?: string;
}

/** The String file (now open), the text's node in it, and whether it was missing and added, unsaved. */
export interface CharacterStringOpenResult {
    file: OpenedFile;
    path: string;
    added: boolean;
}

/** A property and everything below it, in file order. */
export interface PropTree { name: string; type: NodeType; value: string | null; children: PropTree[] | null }

export interface QuestDetail {
    id: number;
    name: string;
    info: PropTree | null;
    check: PropTree | null;
    say: PropTree | null;
    act: PropTree | null;
    /** Where each section is in the raw tree: "QuestInfo.img/1000" (classic) or "1000.img/QuestInfo" (modular). */
    paths: { info: string; check: string; say: string; act: string };
}

/**
 * The run of quests a quest belongs to, in play order (just the one quest when it isn't part of a chain).
 * `before`/`after` are where the chain branches off: several ways in or out, or a neighbour shared with other quests.
 */
export interface QuestChain { quests: QuestDetail[]; before: QuestSummary[]; after: QuestSummary[] }

export interface CommodityCell { type: NodeType; value: string | null }
/** One Commodity.img entry. `cells` follow the table's columns; null where the entry lacks that property. */
export interface CommodityRow { name: string; cells: (CommodityCell | null)[] }
export interface CommodityColumn { name: string; type: NodeType }
export interface CommodityTable { columns: CommodityColumn[]; rows: CommodityRow[] }
/** After an edit: the (possibly grown) column list, the entry as it is now, and the file (now unsaved). */
export interface CommodityRowResult { columns: CommodityColumn[]; row: CommodityRow; file: OpenedFile }
/** After setting values: each edited entry once, as it is now. `renumbered`: an SN edit moved entries between tabs and
 * other entries were renamed, so reload the table. `packageRefs`: package contents switched to the edited entries' new SNs. */
export interface CommodityRowsResult { columns: CommodityColumn[]; rows: CommodityRow[]; file: OpenedFile; renumbered: boolean; packageRefs: number }
/** `packageRefs`: package contents (CashPackage.img) removed with the entries. */
export interface CommodityDeleteResult { file: OpenedFile; deleted: number; packageRefs: number }
export interface CommoditySet { entry: string; property: string; type: string; value: string }

/** One Category.img entry: a Cash Shop sub tab. `entry` is the numbered property that holds it. */
export interface CategorySub { entry: string; sub: number; name: string }
/** A top Cash Shop tab (fixed by the client) and its sub tabs, in CategorySub order. */
export interface CategoryGroup { category: number; subs: CategorySub[] }
export interface CategoryTable { categories: CategoryGroup[] }
/** `deletedCommodity`: Commodity.img entries removed along with deleted sub tabs; `packageRefs`: package contents removed with them. */
export interface CategoryResult { table: CategoryTable; file: OpenedFile; deletedCommodity: number; packageRefs: number }

export type LookupKind = "npc" | "item" | "mob" | "map" | "skill" | "quest";

/** Where a link leads: the file that holds the thing, and its node inside that file. */
export interface RefOpenResult { file: OpenedFile; path: string }
export type LookupRequest = Partial<Record<LookupKind, number[]>>;
export type LookupResult = Record<LookupKind, Record<string, string>>;

export interface PasteResult {
    path: string;
    node: WzNode;
    file: OpenedFile;
    sourceFile: OpenedFile | null;
}

/** The sprite a map object points at. `link` is set when that sprite is a link (UOL, _inlink, _outlink). */
export interface ObjRef { path: string; node: WzNode; link: string | null }

export interface SaveResult { path: string; size: number; file: OpenedFile }

/** `name`/`value` left out stay as they are. `value` is written the way `WzNode.value` shows it (a vector as "x, y"). */
export interface NodeEdit { name?: string; value?: string }
/** A property to add; `value` is left out for the types that hold none (sub, null). */
export interface NodeCreate { name: string; type: string; value?: string }
/** `path` is where the property is now, which changes on a rename. */
export interface NodeEditResult { path: string; node: WzNode; file: OpenedFile }
/** What an import changed: canvases given a picture, values set, nodes created; `warnings` lists what was skipped (at most 50). */
export interface ImportResult { path: string; file: OpenedFile; images: number; properties: number; created: number; warnings: string[] }

export interface FsEntry { name: string; path: string; isDirectory: boolean; size: number | null }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }
/** A file's root nodes, read without parsing any image: how many, and the first few names (folders end in "/"). */
export interface FilePeek { count: number; names: string[] }
/** A file a pinned server offers; `name` is its path relative to the library folder. `kind` is set in browse-only mode. */
export interface LibraryFile { name: string; path: string; size: number; kind?: "quest" | "etc" | null }


/**
 * A mob's stats from its info node in Mob data (anything it doesn't set is 0).
 * `elements` is info/elemAttr as written: a letter per element (F fire, I ice, L lightning, S poison, H holy, D dark,
 * P physical) followed by 1 immune, 2 resists or 3 weak, e.g. "F2I3". `link`: the mob it borrows its animations from.
 */
export interface Mob {
    id: number; name: string | null; level: number; maxHp: number; maxMp: number; exp: number;
    physicalAttack: number; magicAttack: number; physicalDefense: number; magicDefense: number;
    accuracy: number; avoid: number; speed: number; boss: boolean; undead: boolean; elements: string | null; link: number | null;
}

/**
 * A mob and the maps it spawns in (Etc's MobLocation.img, plus the maps whose life places it).
 * `known`: the library's Mob data has it, so it has a sprite; Etc can list mobs an install no longer has.
 */
export interface MobLocation { id: number; name: string | null; maps: number[]; known: boolean }
/** `mapNames`: map id -> "Street : Map" for every map listed. */
export interface MobLocations { mobs: MobLocation[]; mapNames: Record<string, string> }

/** A map with the NPCs standing in it. `name` is "Street : Map". */
export interface MapNpcs { id: number; name: string | null; npcs: number[] }

/** A quest an NPC hands out (`starts`) and/or completes (`ends`). `archive` is the quest archive's library name. */
export interface NpcQuest { id: number; name: string; archive: string; starts: boolean; ends: boolean }
/** An NPC that at least one quest in the library starts or ends at. */
export interface NpcQuests { id: number; name: string | null; quests: NpcQuest[] }

/** An edit to one or more files, by name. */
export interface HistoryStep { id: number; label: string; files: string[] }
/** Edits to any file, oldest first, with the undone ones last; `done`: how many of them are in place. */
export interface EditHistory { steps: HistoryStep[]; done: number }

/** A map in an open Map file; `path` is its .img. */
export interface MapEntry { id: number; path: string; name: string | null }
export type MapItemKind = "back" | "tile" | "obj" | "life" | "reactor" | "portal" | "foothold" | "ladder" | "seat"
    | "area" | "misc" | "bounds";
/**
 * One thing a map places. `path` is inside the map's .img; `layer` is -1 for what isn't in one; `sprite` is the key of
 * its picture; `values` are its scalar properties.
 */
export interface MapItem {
    path: string;
    kind: MapItemKind;
    layer: number;
    sprite: string | null;
    values: Record<string, string>;
}
export interface MapSprite { originX: number; originY: number; z: number }
/**
 * `tileSets`: each layer's tile set, "" when it has none; `tileScales`: how many times the usual size its tiles are.
 * `minimap`: its width, centerX, mag, ...; null when the map has none.
 */
export interface MapLayout {
    info: Record<string, string>;
    tileSets: string[];
    tileScales: number[];
    minimap: Record<string, string> | null;
    items: MapItem[];
}
export type MapSetKind = "tile" | "obj" | "back";
export interface NamedId { id: number; name: string }
/** A tile ("bsc/0"), object ("house/wall/3") or background ("back/0", "ani/0") that can be placed. */
export interface MapPiece { path: string; sprite: string }
/**
 * `path` is inside the map's .img. "set" with a `type` adds the property, and the folders it's in, when missing; "copy"
 * and "move" put the node at `target`, a copy optionally coming `from` another map of the file.
 */
export interface MapEdit {
    op: "set" | "copy" | "move" | "delete";
    path: string;
    value?: string;
    type?: string;
    target?: string;
    from?: string;
}

export type QuestSection = "QuestInfo" | "Check" | "Say" | "Act";
/**
 * `path` is inside the quest's section. "set" with a `type` adds the property, and the folders it's in, when missing;
 * "remove" takes out a numbered entry of a list and moves the ones after it up.
 */
export interface QuestEdit {
    op: "set" | "folder" | "delete" | "remove";
    quest: number;
    section: QuestSection;
    path: string;
    value?: string;
    type?: string;
}

/** One file of an XML conversion. `total` is its image count, known once it's open; `folder` is e.g. "Mob.wz". */
export interface XmlExportFile { name: string; folder: string; images: number; total: number; state: "waiting" | "running" | "done" | "failed" | "cancelled"; error: string | null }
/** A conversion running on the server. `failed`: it finished, but at least one file couldn't be converted. */
export interface XmlExportJob { id: string; state: "running" | "done" | "failed" | "cancelled"; output: string; files: XmlExportFile[] }

export const ENCRYPTIONS =["Auto", "GMS", "EMS", "BMS", "CLASSIC", "GETFROMZLZ"] as const;

/**
 * The default address for this deployment: `apiBase` in /config.json next to index.html (editable after a build,
 * e.g. `{ "apiBase": "/" }` for an API proxied under this site's own /api), else {@link DEFAULT_API_BASE}.
 */
export async function loadDefaultApiBase(): Promise<string> {
    // The dev server has no config.json and would log a failed route match for it.
    if (import.meta.env.DEV) return DEFAULT_API_BASE;
    try {
        const res = await fetch("/config.json", { cache: "no-store" });
        if (res.ok) {
            const config = await res.json();
            if (typeof config?.apiBase === "string" && config.apiBase.trim()) return normalizeBase(config.apiBase, DEFAULT_API_BASE);
        }
    } catch {
        /* no config.json (or not JSON): use the built-in default */
    }
    return DEFAULT_API_BASE;
}

/** The address the user saved, else `fallback` (the deployment's default). */
export function loadApiBase(fallback: string): string {
    try {
        return localStorage.getItem(STORAGE_KEY) || fallback;
    } catch {
        return fallback;
    }
}

/** Saving the default clears the saved value, so a later change to the deployment's default reaches this browser. */
export function saveApiBase(base: string, defaultBase: string) {
    try {
        if (base === defaultBase) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, base);
    } catch {
        /* storage unavailable: setting just won't persist */
    }
}

/** A full address without a trailing slash. A path ("/", "/wz") is on this site's own origin. */
export function normalizeBase(input: string, defaultBase: string): string {
    let v = input.trim();
    if (!v) return defaultBase;
    if (v.startsWith("/")) v = location.origin + v;
    else if (!/^https?:\/\//i.test(v)) v = "http://" + v;
    return v.replace(/\/+$/, "");
}

export class ApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

/** The open file whose install the library tables read; null or left out for the pinned library. */
export type Scope = string | null;

/** What the server can show, from its health check. The table flags are only set by a server pinned to a library. */
export interface Health {
    status: string;
    port: number;
    version: string;
    /** The server is pinned to a folder, so files come from `library()` and `fs` is refused. */
    library?: boolean;
    /** The server was started with --read-only, so files may be viewed but not changed. */
    readOnly?: boolean;
    /** Read only and pinned to a library folder: only files with a view or table of their own, and no raw tree. */
    browseOnly?: boolean;
    /** The library has Mob data, so `mobs()` has something to show. */
    mobs?: boolean;
    /** The library's Etc has MobLocation.img, so `mobLocations()` has something to show. */
    mobLocations?: boolean;
    /** The library has Map files, so `maps()` has something to show. */
    maps?: boolean;
    /** The library has a quest archive, so `npcQuests()` has something to show. */
    npcs?: boolean;
}

type FilesReadListener = (paths: string[]) => void;

/**
 * Called with the other files a request read on behalf of the file it was about (String.wz for names, Npc.wz for a
 * sprite, ...), as the server reports them, so each can get a window.
 */
const readListeners = new Set<FilesReadListener>();

export function onFilesRead(listener: FilesReadListener) {
    readListeners.add(listener);
    return function stopListening() {
        readListeners.delete(listener);
    };
}

function decodePath(encoded: string) {
    try {
        return decodeURIComponent(encoded);
    } catch {
        return "";
    }
}

function reportReads(response: Response) {
    const value = response.headers.get("X-Wz-Read");
    if (!value || readListeners.size === 0) return;
    const paths = value.split(",").map(decodePath).filter(Boolean);
    if (paths.length === 0) return;
    for (const listener of readListeners) listener(paths);
}

export function createApi(base: string) {
    async function request<T>(path: string, init?: RequestInit): Promise<T> {
        let response: Response;
        try {
            response = await fetch(base + path, init);
        } catch {
            throw new ApiError(`Cannot reach the WzBrowser API at ${base}`, 0);
        }
        if (!response.ok) {
            let message = response.statusText;
            try { message = (await response.json()).error ?? message; } catch { /* not json */ }
            throw new ApiError(message, response.status);
        }
        reportReads(response);
        return response.status === 204 ? (undefined as T) : response.json();
    }

    const q = (path: string) => encodeURIComponent(path);
    const scope = (file?: Scope) => (file ? `?file=${q(file)}` : "");

    return {
        base,
        health: () => request<Health>("/api/health"),
        fs: (path = "") => request<FsListing>(`/api/fs?path=${q(path)}`),
        /** The names at a .wz file's or .ms pack's root, for the picker. */
        peek: (path: string) => request<FilePeek>(`/api/fs/peek?path=${q(path)}`),
        library: () => request<LibraryFile[]>("/api/library"),
        // The library tables. `file` is an open file whose install they read when the server isn't pinned to a
        // folder (components get these bound to their window's file from useLibraryApi); a pinned server ignores it.
        /** Every mob in the library's Mob data with its stats, ordered by mob id. */
        mobs: (file?: Scope) => request<Mob[]>(`/api/mobs${scope(file)}`),
        /** Every mob with the maps it spawns in, ordered by mob id. */
        mobLocations: (file?: Scope) => request<MobLocations>(`/api/mobs/locations${scope(file)}`),
        mobSpriteUrl: (id: number, file?: Scope) => `${base}/api/mobs/${id}/sprite${scope(file)}`,
        /** Every map with NPCs in it, ordered by map id. */
        maps: (file?: Scope) => request<MapNpcs[]>(`/api/maps${scope(file)}`),
        mapMinimapUrl: (id: number, file?: Scope) => `${base}/api/maps/${id}/minimap${scope(file)}`,
        /** Every NPC the library's quests start or end at, ordered by NPC id. */
        npcQuests: (file?: Scope) => request<NpcQuests[]>(`/api/npcs/quests${scope(file)}`),
        npcSpriteUrl: (id: number, file?: Scope) => `${base}/api/npcs/${id}/sprite${scope(file)}`,
        history: () => request<EditHistory>("/api/history"),
        /** Undoes or redoes until the action is the last in place (0: none is). `files` are the ones it changed. */
        goToHistory: (id: number) =>
            request<{ history: EditHistory; files: OpenedFile[] }>(`/api/history/${id}`, { method: "POST" }),
        files: () => request<OpenedFile[]>("/api/files"),
        /** `encryption` null (or empty) detects it. */
        open: (path: string, encryption: string | null) =>
            request<OpenedFile>("/api/files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path, encryption }),
            }),
        close: (id: string) => request<void>(`/api/files/${id}`, { method: "DELETE" }),
        /** Lets go of the files the server holds without listing them (String.wz for names, ...); resolves how many. */
        releaseUnlisted: () => request<{ released: number }>("/api/files/release", { method: "POST" }),
        children: (id: string, path = "") => request<WzNode[]>(`/api/files/${id}/children?path=${q(path)}`),
        /** Paths of nodes named like `q`: all directories/.imgs plus properties up to `depth` levels inside each .img. */
        search: (id: string, query: string, depth = 3) => request<string[]>(`/api/files/${id}/search?q=${q(query)}&depth=${depth}`),
        quests: (id: string) => request<QuestSummary[]>(`/api/files/${id}/quests`),
        /**
         * A _Canvas file's thumbnails: each thing's first stand, move or fly frame, else its icon or iconRaw; other numbered
         * series of pictures as animations, passed to `onChunk` as the server finds them; the last chunk has `done`.
         * `truncated`: there were too many, and the rest were left out. Resolves after the last chunk.
         */
        gallery: async (id: string, onChunk: (chunk: { items: GalleryItem[]; done: boolean; truncated: boolean }) => void, signal: AbortSignal) => {
            // The server sends a JSON chunk per line as it reads the file, so the first thumbnails show before the last are found.
            let res: Response;
            try {
                res = await fetch(`${base}/api/files/${id}/gallery`, { signal });
            } catch (e) {
                if (signal.aborted) throw e;
                throw new ApiError(`Cannot reach the WzBrowser API at ${base}`, 0);
            }
            if (!res.ok || !res.body) {
                let message = res.statusText;
                try { message = (await res.json()).error ?? message; } catch { /* not json */ }
                throw new ApiError(message, res.status);
            }
            const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffered = "";
            const line = (text: string) => {
                if (!text.trim()) return;
                const chunk = JSON.parse(text);
                if (chunk.error) throw new ApiError(chunk.error, 500);
                onChunk(chunk);
            };
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffered += value;
                let end;
                while ((end = buffered.indexOf("\n")) >= 0) {
                    line(buffered.slice(0, end));
                    buffered = buffered.slice(end + 1);
                }
            }
            line(buffered);
        },
        /**
         * A Character, Item or Skill file's menu: each directory at its root and the root itself when it holds .imgs,
         * or a job's .img each.
         */
        characterSections: (id: string) => request<CharacterSection[]>(`/api/files/${id}/character`),
        /** One section's items with String's names. */
        characterItems: (id: string, section: string) =>
            request<CharacterItems>(`/api/files/${id}/character/items?section=${q(section)}`),
        /**
         * An item's picture (its icon, else its first picture); 404 when it has none. `revision` busts the browser's
         * cache after edits.
         */
        characterPictureUrl: (id: string, path: string, revision?: number) =>
            `${base}/api/files/${id}/character/picture?path=${q(path)}${revision != null ? `&v=${revision}` : ""}`,
        /**
         * An item's info node (stats, price, requirements, ...) with everything below it, or a skill's whole node;
         * undefined when it has none.
         */
        characterInfo: (id: string, path: string) =>
            request<PropTree | undefined>(`/api/files/${id}/character/info?path=${q(path)}`),
        /** An item's spec node (what using it does: hp, mp, time, ...); undefined when it has none. */
        characterSpec: (id: string, path: string) =>
            request<PropTree | undefined>(`/api/files/${id}/character/spec?path=${q(path)}`),
        /** Opens String at an item's text, adding it (empty, unsaved) when missing unless the server is read only. */
        openCharacterString: (id: string, body: CharacterStringOpenRequest) =>
            request<CharacterStringOpenResult>(`/api/files/${id}/character/strings/open`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }),
        /** The maps in a Map file, by id, with String's names. */
        editorMaps: (id: string) => request<MapEntry[]>(`/api/files/${id}/maps`),
        mapLayout: (id: string, path: string) => request<MapLayout>(`/api/files/${id}/maps/layout?path=${q(path)}`),
        mapItemSpriteUrl: (id: string, key: string) => `${base}/api/files/${id}/maps/sprite?key=${q(key)}`,
        mapSets: (id: string, kind: MapSetKind) => request<string[]>(`/api/files/${id}/maps/sets?kind=${kind}`),
        mapPieces: (id: string, kind: MapSetKind, set: string) =>
            request<MapPiece[]>(`/api/files/${id}/maps/pieces?kind=${kind}&set=${q(set)}`),
        /** Where each picture sits; those that can't be found are left out. */
        mapSprites: (id: string, keys: string[]) =>
            request<Record<string, MapSprite>>(
                `/api/files/${id}/maps/sprites?${keys.map((key) => `key=${q(key)}`).join("&")}`),
        /** The things whose id or String name contains the text. */
        searchNames: (id: string, kind: Exclude<LookupKind, "quest">, text: string) =>
            request<NamedId[]>(`/api/files/${id}/names?kind=${kind}&q=${q(text)}`),
        mapMusicUrl: (id: string, name: string) => `${base}/api/files/${id}/maps/music?name=${q(name)}`,
        /** Adds a blank map, or a copy of the one at `from`. */
        createMap: (id: string, mapId: number, from: string | null) =>
            request<{ map: MapEntry; file: OpenedFile }>(`/api/files/${id}/maps/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: mapId, from }),
            }),
        /** Stores a picture of the map as its minimap; the center is how far the map's 0, 0 is from its top left. */
        setMinimap: (
            id: string,
            path: string,
            picture: Blob,
            area: { width: number; height: number; centerX: number; centerY: number },
        ) => {
            const place = new URLSearchParams(Object.entries(area).map(([name, value]) => [name, String(value)]));
            return request<OpenedFile>(`/api/files/${id}/maps/minimap?path=${q(path)}&${place}`, {
                method: "PUT",
                headers: { "Content-Type": picture.type },
                body: picture,
            });
        },
        /** Applies edits inside one map, all or nothing, as one step that can be undone. */
        editMap: (id: string, path: string, label: string, ops: MapEdit[]) =>
            request<OpenedFile>(`/api/files/${id}/maps/edit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path, label, ops }),
            }),
        quest: (id: string, questId: number) => request<QuestDetail>(`/api/files/${id}/quests/${questId}`),
        questChain: (id: string, questId: number) => request<QuestChain>(`/api/files/${id}/quests/${questId}/chain`),
        /** Adds a quest, as a copy of `from` and leading on from `after` when given. Refused when the id is used. */
        createQuest: (id: string, quest: { id: number; from?: number; after?: number }) =>
            request<OpenedFile>(`/api/files/${id}/quests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(quest),
            }),
        /** Applies edits to quests, all or nothing, as one step that can be undone. */
        editQuests: (id: string, label: string, ops: QuestEdit[]) =>
            request<OpenedFile>(`/api/files/${id}/quests/edit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label, ops }),
            }),
        deleteQuest: (id: string, questId: number) =>
            request<OpenedFile>(`/api/files/${id}/quests/${questId}`, { method: "DELETE" }),
        commodity: (id: string) => request<CommodityTable>(`/api/files/${id}/commodity`),
        /** Sets each `entry/property`, creating it as `type` when the entry doesn't have it. All or nothing. */
        setCommodity: (id: string, sets: CommoditySet[]) =>
            request<CommodityRowsResult>(`/api/files/${id}/commodity`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sets),
            }),
        /** Adds an entry with default values and a generated SN: in the given Cash Shop tab (category/sub), or else
         * donor items 1xxxxxxx and regular 2xxxxxxx. */
        addCommodity: (id: string, body: { itemId: number; donor: boolean; category?: number; sub?: number }) =>
            request<CommodityRowResult>(`/api/files/${id}/commodity`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }),
        /** Removes these Commodity.img entries (and their SNs from every package), renumbering the rest; all must exist,
         * or nothing is removed. */
        deleteCommodity: (id: string, entries: string[]) =>
            request<CommodityDeleteResult>(`/api/files/${id}/commodity/delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entries),
            }),
        categories: (id: string) => request<CategoryTable>(`/api/files/${id}/category`),
        /** Adds a sub tab under `category`, with the lowest CategorySub that category doesn't use yet. */
        addCategorySub: (id: string, body: { category: number; name: string }) =>
            request<CategoryResult>(`/api/files/${id}/category`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }),
        renameCategorySub: (id: string, body: { entry: string; name: string }) =>
            request<CategoryResult>(`/api/files/${id}/category`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }),
        /** Removes these Category.img entries; all must exist and no category may lose its last sub tab, or nothing is removed. */
        deleteCategorySubs: (id: string, entries: string[]) =>
            request<CategoryResult>(`/api/files/${id}/category/delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entries),
            }),
        lookup: (id: string, ids: LookupRequest) =>
            request<LookupResult>(`/api/files/${id}/lookup`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(ids),
            }),
        /** Opens (if needed) the file holding an item/NPC/mob/map/skill next to this quest archive. */
        openRef: (id: string, kind: LookupKind, refId: number) =>
            request<RefOpenResult>(`/api/files/${id}/ref/open`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ kind, id: refId }),
            }),
        /** A small picture for the thing (icon, sprite, minimap). 404 when there isn't one. */
        previewUrl: (id: string, kind: LookupKind, refId: number) => `${base}/api/files/${id}/preview?kind=${kind}&refId=${refId}`,
        paste: (targetId: string, body: { sourceId: string; sourcePath: string; targetPath: string; move: boolean }) =>
            request<PasteResult>(`/api/files/${targetId}/paste`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            }),
        /**
         * Deletes a node. `strings`: also delete String's names for what it is (an item, mob, NPC, map or skill, or a folder
         * of them); `strings` in the result lists the String files changed, each now open with unsaved changes.
         */
        deleteNode: (id: string, path: string, strings = false) =>
            request<{ file: OpenedFile; strings: { file: OpenedFile; paths: string[] }[] }>(
                `/api/files/${id}/node?path=${q(path)}${strings ? "&strings=true" : ""}`, { method: "DELETE" }),
        /** Renames a property and/or sets its value. */
        editNode: (id: string, path: string, edit: NodeEdit) =>
            request<NodeEditResult>(`/api/files/${id}/node`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path, ...edit }),
            }),
        createNode: (id: string, parent: string, create: NodeCreate) =>
            request<NodeEditResult>(`/api/files/${id}/node`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: parent, ...create }),
            }),
        save: (id: string) =>
            request<SaveResult>(`/api/files/${id}/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
        revert: (id: string) => request<OpenedFile>(`/api/files/${id}/revert`, { method: "POST" }),
        /** `revision` (the file's) makes the address change after an edit, so the browser doesn't show a cached picture. */
        pngUrl: (id: string, path: string, revision?: number) =>
            `${base}/api/files/${id}/png?path=${q(path)}${revision != null ? `&v=${revision}` : ""}`,
        /** Every canvas under a node (folder, .img or property; the whole file for ""), as PNGs in a zip laid out like the tree. */
        pngsUrl: (id: string, path: string) => `${base}/api/files/${id}/pngs?path=${q(path)}`,
        /** An .img as server XML, canvases without their pixels; unsaved edits included. */
        xmlUrl: (id: string, path: string) => `${base}/api/files/${id}/xml?path=${q(path)}`,
        /**
         * Replaces a canvas' picture with this image file (PNG, JPEG, BMP or GIF), stored as `quality` (an IMAGE_QUALITIES
         * value; lossless when left out). Removes any _inlink/_outlink.
         */
        /**
         * Puts a zip of folders and PNGs (an "Export all images" zip, or one made by hand) into a node: folders become
         * directories, .imgs and sub-properties (created when missing), PNGs canvases, and each folder's .props restores
         * delay, origin, pixel formats and the other values. `quality` as for setPng; by default the exported format.
         */
        importZip: (id: string, path: string, zip: Blob, quality?: string) =>
            request<ImportResult>(`/api/files/${id}/import?path=${q(path)}${quality ? `&quality=${q(quality)}` : ""}`, {
                method: "POST",
                headers: { "Content-Type": "application/zip" },
                body: zip,
            }),
        setPng: (id: string, path: string, image: Blob, quality?: string) =>
            request<NodeEditResult>(`/api/files/${id}/png?path=${q(path)}${quality ? `&quality=${q(quality)}` : ""}`, {
                method: "PUT",
                headers: { "Content-Type": image.type || "application/octet-stream" },
                body: image,
            }),
        /** For a placed map object (`.../obj/N` or one of its children), the sprite it refers to in `Obj/`. */
        /** Undefined when the node isn't a map object; throws when it is but the sprite can't be found. */
        objRef: (id: string, path: string) => request<ObjRef | undefined>(`/api/files/${id}/objref?path=${q(path)}`),
        /** Starts converting .wz files to server XML under `output` ({output}/Mob.wz/0100100.img.xml); poll `xmlExport`. */
        startXmlExport: (paths: string[], output: string, encryption: string) =>
            request<XmlExportJob>("/api/xml-export", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths, output, encryption }),
            }),
        xmlExport: (id: string) => request<XmlExportJob>(`/api/xml-export/${id}`),
        cancelXmlExport: (id: string) => request<XmlExportJob>(`/api/xml-export/${id}`, { method: "DELETE" }),
        soundUrl: (id: string, path: string) => `${base}/api/files/${id}/sound?path=${q(path)}`,
    };
}

export type Api = ReturnType<typeof createApi>;
