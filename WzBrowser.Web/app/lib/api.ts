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
  /** "quest" for a quest archive (QuestInfo.img + Check.img at the root, or a modular QuestData with one {id}.img per quest);
   * "etc" when Commodity.img is at the root. */
  kind: "quest" | "etc" | "generic";
  /** Changes whenever the file's contents change, so views know to refetch. */
  revision: number;
}

export interface QuestSummary { id: number; name: string }

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
/** After setting values: each edited entry once, as it is now. */
export interface CommodityRowsResult { columns: CommodityColumn[]; rows: CommodityRow[]; file: OpenedFile }
export interface CommoditySet { entry: string; property: string; type: string; value: string }

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

export interface FsEntry { name: string; path: string; isDirectory: boolean; size: number | null }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }
/** A file a pinned server offers; `name` is its path relative to the library folder. `kind` is set in browse-only mode. */
export interface LibraryFile { name: string; path: string; size: number; kind?: "quest" | "etc" | null }

/** One skill. `levels` is what each level does (or a single shared template); `hidden` skills are client-internal helpers. */
export interface Skill { id: number; name: string | null; desc: string | null; maxLevel: number; hidden: boolean; levels: string[] }
/** A job's skills (0 Beginner, 100 Warrior, 110 Fighter, ...) and its skill book's title. */
export interface SkillBook { job: number; book: string | null; hasIcon: boolean; skills: Skill[] }

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

/** A mob in a map: `count` spawn points in its life, or 0 when only Etc's MobLocation.img lists it there. */
export interface MapMob { id: number; count: number }
/** A map with the mobs that spawn in it and the NPCs standing in it. `name` is "Street : Map". */
export interface MapInfo { id: number; name: string | null; mobs: MapMob[]; npcs: number[] }
/** `mobNames`/`npcNames`: id -> name for every mob and NPC in any map. */
export interface Maps { maps: MapInfo[]; mobNames: Record<string, string>; npcNames: Record<string, string> }

/** The inventory tabs items are grouped in. */
export type ItemCategory = "equip" | "use" | "setup" | "etc" | "cash";
/**
 * An item. `slot`: for equipment, the Character folder it's in (Cap, Coat, Weapon, ...). `price`: what a shop pays (0
 * when it doesn't say). `stats`: every number directly under its info (reqLevel, incSTR, tuc, slotMax, cash, ...);
 * `effects`: every number under spec, for items used up (hp, mpR, pad, time, moveTo, ...).
 */
export interface Item {
  id: number; slot: string | null; name: string | null; desc: string | null; price: number;
  stats: Record<string, number>; effects: Record<string, number> | null;
}

/** A quest an NPC hands out (`starts`) and/or completes (`ends`). `archive` is the quest archive's library name. */
export interface NpcQuest { id: number; name: string; archive: string; starts: boolean; ends: boolean }
/** An NPC that at least one quest in the library starts or ends at. */
export interface NpcQuests { id: number; name: string | null; quests: NpcQuest[] }

export const ENCRYPTIONS =["Auto", "GMS", "EMS", "BMS", "CLASSIC", "GETFROMZLZ"] as const;

/**
 * The default address for this deployment: `apiBase` in /config.json next to index.html (editable after a build,
 * e.g. `{ "apiBase": "/" }` for an API proxied under this site's own /api), else {@link DEFAULT_API_BASE}.
 */
export async function loadDefaultApiBase(): Promise<string> {
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

export function createApi(base: string) {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base + path, init);
    } catch {
      throw new ApiError(`Cannot reach the WzBrowser API at ${base}`, 0);
    }
    if (!res.ok) {
      let message = res.statusText;
      try { message = (await res.json()).error ?? message; } catch { /* not json */ }
      throw new ApiError(message, res.status);
    }
    return res.status === 204 ? (undefined as T) : res.json();
  }

  const q = (path: string) => encodeURIComponent(path);

  return {
    base,
    /**
     * `library`: the server is pinned to a folder, so files come from `library()` and `fs` is refused.
     * `readOnly`: this computer isn't the server's own, so it may view but not change anything.
     * `browseOnly`: both, so only quest archives and Etc.wz are offered, through their own views (no raw tree).
     * `skills`: the library has skill data, so `skills()` has something to show.
     * `mobs`: the library has Mob data, so `mobs()` has something to show.
     * `mobLocations`: the library's Etc has MobLocation.img, so `mobLocations()` has something to show.
     * `maps`: the library has Map files, so `maps()` has something to show.
     * `items`: the library has Item or Character files, so `items()` has something to show.
     * `npcs`: the library has a quest archive, so `npcQuests()` has something to show.
     */
    health: () => request<{ status: string; port: number; version: string; library?: boolean; readOnly?: boolean; browseOnly?: boolean; skills?: boolean; mobs?: boolean; mobLocations?: boolean; maps?: boolean; items?: boolean; npcs?: boolean }>("/api/health"),
    fs: (path = "") => request<FsListing>(`/api/fs?path=${q(path)}`),
    library: () => request<LibraryFile[]>("/api/library"),
    /** Every job's skills in the library, ordered by job id. */
    skills: () => request<SkillBook[]>("/api/skills"),
    skillIconUrl: (id: number) => `${base}/api/skills/${id}/icon`,
    skillBookIconUrl: (job: number) => `${base}/api/skills/books/${job}/icon`,
    /** Every mob in the library's Mob data with its stats, ordered by mob id. */
    mobs: () => request<Mob[]>("/api/mobs"),
    /** Every mob with the maps it spawns in, ordered by mob id. */
    mobLocations: () => request<MobLocations>("/api/mobs/locations"),
    mobSpriteUrl: (id: number) => `${base}/api/mobs/${id}/sprite`,
    /** Every map with its mobs and NPCs, ordered by map id. */
    maps: () => request<Maps>("/api/maps"),
    mapMinimapUrl: (id: number) => `${base}/api/maps/${id}/minimap`,
    /** Every item in one inventory tab with its stats, name and description, ordered by item id. */
    items: (category: ItemCategory) => request<Item[]>(`/api/items/${category}`),
    itemIconUrl: (id: number) => `${base}/api/items/${id}/icon`,
    /** Every NPC the library's quests start or end at, ordered by NPC id. */
    npcQuests: () => request<NpcQuests[]>("/api/npcs/quests"),
    npcSpriteUrl: (id: number) => `${base}/api/npcs/${id}/sprite`,
    files: () => request<OpenedFile[]>("/api/files"),
    open: (path: string, encryption: string) =>
      request<OpenedFile>("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, encryption }),
      }),
    close: (id: string) => request<void>(`/api/files/${id}`, { method: "DELETE" }),
    children: (id: string, path = "") => request<WzNode[]>(`/api/files/${id}/children?path=${q(path)}`),
    /** Paths of nodes named like `q`: all directories/.imgs plus properties up to `depth` levels inside each .img. */
    search: (id: string, query: string, depth = 3) => request<string[]>(`/api/files/${id}/search?q=${q(query)}&depth=${depth}`),
    quests: (id: string) => request<QuestSummary[]>(`/api/files/${id}/quests`),
    quest: (id: string, questId: number) => request<QuestDetail>(`/api/files/${id}/quests/${questId}`),
    questChain: (id: string, questId: number) => request<QuestChain>(`/api/files/${id}/quests/${questId}/chain`),
    commodity: (id: string) => request<CommodityTable>(`/api/files/${id}/commodity`),
    /** Sets each `entry/property`, creating it as `type` when the entry doesn't have it. All or nothing. */
    setCommodity: (id: string, sets: CommoditySet[]) =>
      request<CommodityRowsResult>(`/api/files/${id}/commodity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sets),
      }),
    /** Adds an entry with default values and a generated SN (donor items 1xxxxxxx, regular 2xxxxxxx). */
    addCommodity: (id: string, body: { itemId: number; donor: boolean }) =>
      request<CommodityRowResult>(`/api/files/${id}/commodity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    /** Removes these Commodity.img entries; all must exist, or nothing is removed. */
    deleteCommodity: (id: string, entries: string[]) =>
      request<OpenedFile>(`/api/files/${id}/commodity/delete`, {
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
    deleteNode: (id: string, path: string) => request<OpenedFile>(`/api/files/${id}/node?path=${q(path)}`, { method: "DELETE" }),
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
    /**
     * Replaces a canvas' picture with this image file (PNG, JPEG, BMP or GIF), stored as `quality` (an IMAGE_QUALITIES
     * value; lossless when left out). Removes any _inlink/_outlink.
     */
    setPng: (id: string, path: string, image: Blob, quality?: string) =>
      request<NodeEditResult>(`/api/files/${id}/png?path=${q(path)}${quality ? `&quality=${q(quality)}` : ""}`, {
        method: "PUT",
        headers: { "Content-Type": image.type || "application/octet-stream" },
        body: image,
      }),
    /** For a placed map object (`.../obj/N` or one of its children), the sprite it refers to in `Obj/`. */
    /** Undefined when the node isn't a map object; throws when it is but the sprite can't be found. */
    objRef: (id: string, path: string) => request<ObjRef | undefined>(`/api/files/${id}/objref?path=${q(path)}`),
    soundUrl: (id: string, path: string) => `${base}/api/files/${id}/sound?path=${q(path)}`,
  };
}

export type Api = ReturnType<typeof createApi>;
