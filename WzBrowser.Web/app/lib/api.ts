// All traffic goes straight from the browser to the WzBrowser API exe on the user's machine.
// The host serving this web app is never in the path.

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
  /** "quest" for a quest archive (QuestInfo.img + Check.img at the root); "etc" when Commodity.img is at the root. */
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
}

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

export interface FsEntry { name: string; path: string; isDirectory: boolean; size: number | null }
export interface FsListing { path: string; parent: string | null; entries: FsEntry[] }

export const ENCRYPTIONS = ["Auto", "GMS", "EMS", "BMS", "CLASSIC", "GETFROMZLZ"] as const;

export function loadApiBase(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_API_BASE;
  } catch {
    return DEFAULT_API_BASE;
  }
}

export function saveApiBase(base: string) {
  try {
    if (base === DEFAULT_API_BASE) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, base);
  } catch {
    /* storage unavailable: setting just won't persist */
  }
}

export function normalizeBase(input: string): string {
  let v = input.trim();
  if (!v) return DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(v)) v = "http://" + v;
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
    health: () => request<{ status: string; port: number; version: string }>("/api/health"),
    fs: (path = "") => request<FsListing>(`/api/fs?path=${q(path)}`),
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
    save: (id: string) =>
      request<SaveResult>(`/api/files/${id}/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
    revert: (id: string) => request<OpenedFile>(`/api/files/${id}/revert`, { method: "POST" }),
    pngUrl: (id: string, path: string) => `${base}/api/files/${id}/png?path=${q(path)}`,
    /** For a placed map object (`.../obj/N` or one of its children), the sprite it refers to in `Obj/`. */
    /** Undefined when the node isn't a map object; throws when it is but the sprite can't be found. */
    objRef: (id: string, path: string) => request<ObjRef | undefined>(`/api/files/${id}/objref?path=${q(path)}`),
    soundUrl: (id: string, path: string) => `${base}/api/files/${id}/sound?path=${q(path)}`,
  };
}

export type Api = ReturnType<typeof createApi>;
