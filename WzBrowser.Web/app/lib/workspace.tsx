import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { FilePicker } from "../components/file-picker";
import { buttonPrimary, buttonSecondary } from "../components/ui";
import type { LookupKind, NodeEdit, OpenedFile, WzNode } from "./api";
import { useConnection } from "./connection";
import { parentPath } from "./paths";

// ------------------------------------------------------------------ windows

export interface Win { fileId: string; x: number; y: number; w: number; h: number; z: number; collapsed: boolean }
type Layout = Pick<Win, "x" | "y" | "w" | "h" | "collapsed">;

interface State { wins: Win[]; zTop: number; pan: { x: number; y: number } }

type Action =
  | { type: "add"; fileId: string; layout: Layout }
  | { type: "remove"; id: string }
  | { type: "keep"; ids: string[] }
  | { type: "focus"; id: string }
  | { type: "patch"; id: string; patch: Partial<Layout> }
  | { type: "pan"; x: number; y: number }
  | { type: "tidy" };

export const MIN_W = 380;
export const MIN_H = 280;
const LAYOUT_KEY = "wzbrowser.layout.v1";

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "add":
      return { ...s, zTop: s.zTop + 1, wins: [...s.wins, { fileId: a.fileId, ...a.layout, z: s.zTop + 1 }] };
    case "remove":
      return { ...s, wins: s.wins.filter((w) => w.fileId !== a.id) };
    case "keep":
      return { ...s, wins: s.wins.filter((w) => a.ids.includes(w.fileId)) };
    case "focus": {
      const top = s.wins.reduce((m, w) => Math.max(m, w.z), 0);
      const cur = s.wins.find((w) => w.fileId === a.id);
      if (!cur || cur.z === top) return s; // already on top: keep object identity so nothing re-renders
      return { ...s, zTop: top + 1, wins: s.wins.map((w) => (w.fileId === a.id ? { ...w, z: top + 1 } : w)) };
    }
    case "patch":
      return { ...s, wins: s.wins.map((w) => (w.fileId === a.id ? { ...w, ...a.patch } : w)) };
    case "pan":
      return { ...s, pan: { x: a.x, y: a.y } };
    case "tidy":
      return {
        ...s,
        pan: { x: 0, y: 0 },
        wins: s.wins.map((w, i) => ({ ...w, x: 32 + (i % 10) * 36, y: 32 + (i % 10) * 36, collapsed: false })),
      };
  }
}

function readLayouts(): { pan: { x: number; y: number }; wins: Record<string, Layout> } {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null");
    if (raw && typeof raw === "object") return { pan: raw.pan ?? { x: 0, y: 0 }, wins: raw.wins ?? {} };
  } catch { /* ignore */ }
  return { pan: { x: 0, y: 0 }, wins: {} };
}

// ------------------------------------------------------------------ clipboard, events, toasts

export interface ClipItem { fileId: string; path: string; name: string; type: WzNode["type"]; cut: boolean }

export interface TreeEvent {
  /** Folders whose children should be re-fetched. */
  reload?: string[];
  /** Node to expand to, select and scroll into view. */
  reveal?: string;
  /** Drop everything and reload from the root (after a revert). */
  reset?: boolean;
}

/** The node being dragged right now. Drag data can't be read during dragover, so it's kept here. */
export const dnd: { current: ClipItem | null } = { current: null };

interface Toast { id: number; kind: "info" | "success" | "error"; text: string }
interface ConfirmOptions { title: string; body: string; confirmLabel: string; danger?: boolean }

/** Window geometry. Changes on every pointer move while dragging, so it lives in its own context. */
interface LayoutState { wins: Win[]; pan: { x: number; y: number } }
/** Open files and the clipboard. Rarely changes. */
interface DataState { files: Record<string, OpenedFile>; clipboard: ClipItem | null }
/** Stable for the lifetime of the connection, so consumers never re-render because of it. */
interface Actions {
  setClipboard: (item: ClipItem | null) => void;
  openFile: (file: OpenedFile) => void;
  closeWindow: (id: string) => Promise<void>;
  focusWindow: (id: string) => void;
  patchWindow: (id: string, patch: Partial<Layout>) => void;
  setPan: (x: number, y: number) => void;
  tidy: () => void;
  openPicker: () => void;
  paste: (targetFileId: string, targetPath: string, src: ClipItem, move: boolean) => Promise<void>;
  deleteNode: (fileId: string, path: string, name: string) => Promise<void>;
  /** Renames a property and/or sets its value, then selects it at its (possibly new) path. False if it failed. */
  editNode: (fileId: string, path: string, edit: NodeEdit) => Promise<boolean>;
  /** Replaces a canvas' picture with an image file. */
  setCanvasImage: (fileId: string, path: string, image: Blob, quality?: string) => Promise<boolean>;
  save: (fileId: string) => Promise<void>;
  revert: (fileId: string) => Promise<void>;
  subscribe: (fileId: string, cb: (e: TreeEvent) => void) => () => void;
  /**
   * Expand the raw tree of a file to a node and select it. If the file's window hasn't mounted its tree yet
   * (it was just opened), the request is kept and handed over by `takePendingReveal`.
   */
  reveal: (fileId: string, path: string) => void;
  takePendingReveal: (fileId: string) => string | undefined;
  /** Pans the canvas if the file's window is off screen, and focuses it. */
  showWindow: (fileId: string) => void;
  /** Records an edit made by a view other than the raw tree: updates the file and refreshes those tree folders. */
  edited: (file: OpenedFile, reload: string[]) => void;
  /** Follows a link from a quest archive: opens the file holding the item/NPC/mob/map/skill and reveals it there. */
  followRef: (questFileId: string, kind: LookupKind, id: number) => Promise<void>;
  toast: (kind: Toast["kind"], text: string) => void;
  /** Asks in the shared dialog; resolves true when confirmed. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const LayoutCtx = createContext<LayoutState | null>(null);
const DataCtx = createContext<DataState | null>(null);
const ActionsCtx = createContext<Actions | null>(null);

function need<T>(v: T | null): T {
  if (!v) throw new Error("Workspace hooks must be used inside <WorkspaceProvider>");
  return v;
}
export const useLayout = () => need(useContext(LayoutCtx));
export const useWorkspaceData = () => need(useContext(DataCtx));
export const useActions = () => need(useContext(ActionsCtx));

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { api, status } = useConnection();
  const [state, dispatch] = useReducer(reducer, { wins: [], zTop: 0, pan: { x: 0, y: 0 } });
  const [files, setFiles] = useState<Record<string, OpenedFile>>({});
  const [clipboard, setClipboard] = useState<ClipItem | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const layouts = useRef<Record<string, Layout>>({});
  const listeners = useRef(new Map<string, Set<(e: TreeEvent) => void>>());
  const stateRef = useRef(state);
  stateRef.current = state;
  const filesRef = useRef(files);
  filesRef.current = files;
  const loaded = useRef(false);

  // Restore remembered window positions and pan once on the client.
  useEffect(() => {
    const saved = readLayouts();
    layouts.current = saved.wins;
    dispatch({ type: "pan", x: saved.pan.x, y: saved.pan.y });
    loaded.current = true;
  }, []);

  // Remember layout (debounced).
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      const wins: Record<string, Layout> = { ...layouts.current };
      for (const w of state.wins) wins[w.fileId] = { x: w.x, y: w.y, w: w.w, h: w.h, collapsed: w.collapsed };
      layouts.current = wins;
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify({ pan: state.pan, wins })); } catch { /* not persisted */ }
    }, 300);
    return () => clearTimeout(t);
  }, [state.wins, state.pan]);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);

  const upsert = useCallback((...list: (OpenedFile | null | undefined)[]) => {
    setFiles((cur) => {
      const next = { ...cur };
      for (const f of list) if (f) next[f.id] = f;
      return next;
    });
  }, []);

  const emit = useCallback((fileId: string, e: TreeEvent) => {
    listeners.current.get(fileId)?.forEach((cb) => cb(e));
  }, []);

  const pendingReveals = useRef(new Map<string, string>());

  const reveal = useCallback((fileId: string, path: string) => {
    if (listeners.current.get(fileId)?.size) emit(fileId, { reveal: path });
    else pendingReveals.current.set(fileId, path);
  }, [emit]);

  const takePendingReveal = useCallback((fileId: string) => {
    const path = pendingReveals.current.get(fileId);
    pendingReveals.current.delete(fileId);
    return path;
  }, []);

  const showWindow = useCallback((fileId: string) => {
    const s = stateRef.current;
    const w = s.wins.find((x) => x.fileId === fileId);
    if (!w) return;
    dispatch({ type: "focus", id: fileId });
    // Keep the title bar in view: if the window sits (mostly) off screen, pan so it's near the top left.
    const sx = w.x + s.pan.x, sy = w.y + s.pan.y;
    if (sx < 0 || sy < 0 || sx > window.innerWidth - 240 || sy > window.innerHeight - 160)
      dispatch({ type: "pan", x: 48 - w.x, y: 32 - w.y });
  }, []);

  const subscribe = useCallback((fileId: string, cb: (e: TreeEvent) => void) => {
    let set = listeners.current.get(fileId);
    if (!set) listeners.current.set(fileId, (set = new Set()));
    set.add(cb);
    return () => { set!.delete(cb); };
  }, []);

  const addWindow = useCallback((file: OpenedFile) => {
    const s = stateRef.current;
    const n = s.wins.length % 8;
    const layout = layouts.current[file.id] ?? {
      // Quest archives show a list beside a detail pane and Etc.wz a wide table, so they open bigger than a plain tree.
      x: 48 + n * 36 - s.pan.x, y: 32 + n * 36 - s.pan.y, w: file.kind === "generic" ? 680 : 980, h: file.kind === "generic" ? 560 : 620, collapsed: false,
    };
    dispatch({ type: "add", fileId: file.id, layout });
  }, []);

  // Sync with what the API has open, closing windows for files it no longer has. Files it already had open
  // (e.g. before a page reload) don't get windows: the page starts empty until a file is opened.
  useEffect(() => {
    if (status !== "online") return;
    let cancelled = false;
    api.files().then((list) => {
      if (cancelled) return;
      setFiles(Object.fromEntries(list.map((f) => [f.id, f])));
      dispatch({ type: "keep", ids: list.map((f) => f.id) });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, status]);

  const openFile = useCallback((file: OpenedFile) => {
    upsert(file);
    if (stateRef.current.wins.some((w) => w.fileId === file.id)) dispatch({ type: "focus", id: file.id });
    else addWindow(file);
  }, [upsert, addWindow]);

  const followRef = useCallback<Actions["followRef"]>(async (questFileId, kind, id) => {
    try {
      const r = await api.openRef(questFileId, kind, id);
      upsert(r.file);
      openFile(r.file);
      reveal(r.file.id, r.path);
      // The window may have just been created; wait a frame so it exists before measuring it.
      requestAnimationFrame(() => showWindow(r.file.id));
    } catch (e) {
      toast("error", errText(e));
    }
  }, [api, upsert, openFile, reveal, showWindow, toast]);

  const edited = useCallback<Actions["edited"]>((file, reload) => {
    upsert(file);
    emit(file.id, { reload });
  }, [upsert, emit]);

  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ opts, resolve })), []);
  const answer = (v: boolean) => { confirmState?.resolve(v); setConfirmState(null); };

  const closeWindow = useCallback(async (id: string) => {
    const f = filesRef.current[id];
    if (f?.dirty && !(await confirm({
      title: `Close ${f.name}?`,
      body: "It has unsaved changes that will be lost. Use Save first to write them to a new file.",
      confirmLabel: "Close and discard",
      danger: true,
    }))) return;
    await api.close(id).catch(() => {});
    dispatch({ type: "remove", id });
    setFiles((cur) => { const { [id]: _gone, ...rest } = cur; return rest; });
    setClipboard((c) => (c?.fileId === id ? null : c));
  }, [api, confirm]);

  const paste = useCallback<Actions["paste"]>(async (targetFileId, targetPath, src, move) => {
    try {
      const r = await api.paste(targetFileId, { sourceId: src.fileId, sourcePath: src.path, targetPath, move });
      upsert(r.file, r.sourceFile);
      emit(targetFileId, { reload: [targetPath], reveal: r.path });
      if (move) {
        emit(src.fileId, { reload: [parentPath(src.path)] });
        setClipboard((c) => (c && c.fileId === src.fileId && c.path === src.path ? null : c));
      }
      toast("success", `${move ? "Moved" : "Copied"} “${src.name}” into ${r.file.name}${targetPath ? "/" + targetPath : ""}`);
    } catch (e) {
      toast("error", errText(e));
    }
  }, [api, upsert, emit, toast]);

  const deleteNode = useCallback<Actions["deleteNode"]>(async (fileId, path, name) => {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      body: "It is removed from the open file in memory only. Nothing on disk changes until you save, and you can discard all edits with Revert.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      upsert(await api.deleteNode(fileId, path));
      emit(fileId, { reload: [parentPath(path)] });
    } catch (e) {
      toast("error", errText(e));
    }
  }, [api, confirm, upsert, emit, toast]);

  const editNode = useCallback<Actions["editNode"]>(async (fileId, path, edit) => {
    try {
      const r = await api.editNode(fileId, path, edit);
      upsert(r.file);
      emit(fileId, { reload: [parentPath(path)], reveal: r.path });
      return true;
    } catch (e) {
      toast("error", errText(e));
      return false;
    }
  }, [api, upsert, emit, toast]);

  const setCanvasImage = useCallback<Actions["setCanvasImage"]>(async (fileId, path, image, quality) => {
    try {
      const r = await api.setPng(fileId, path, image, quality);
      upsert(r.file);
      emit(fileId, { reload: [parentPath(path), path], reveal: r.path });
      return true;
    } catch (e) {
      toast("error", errText(e));
      return false;
    }
  }, [api, upsert, emit, toast]);

  const save = useCallback(async (fileId: string) => {
    try {
      const r = await api.save(fileId);
      upsert(r.file);
      toast("success", `Saved a new file: ${r.path} (${(r.size / 1048576).toFixed(1)} MB). The original is untouched.`);
    } catch (e) {
      toast("error", errText(e));
    }
  }, [api, upsert, toast]);

  const revert = useCallback(async (fileId: string) => {
    const ok = await confirm({
      title: "Discard all unsaved changes?",
      body: "The file is reloaded from disk and every edit made in this window is lost.",
      confirmLabel: "Discard changes",
      danger: true,
    });
    if (!ok) return;
    try {
      upsert(await api.revert(fileId));
      emit(fileId, { reset: true });
    } catch (e) {
      toast("error", errText(e));
    }
  }, [api, confirm, upsert, emit, toast]);

  const layout = useMemo<LayoutState>(() => ({ wins: state.wins, pan: state.pan }), [state.wins, state.pan]);
  const data = useMemo<DataState>(() => ({ files, clipboard }), [files, clipboard]);
  const actions = useMemo<Actions>(() => ({
    setClipboard,
    openFile,
    closeWindow,
    focusWindow: (id) => dispatch({ type: "focus", id }),
    patchWindow: (id, patch) => dispatch({ type: "patch", id, patch }),
    setPan: (x, y) => dispatch({ type: "pan", x, y }),
    tidy: () => dispatch({ type: "tidy" }),
    openPicker: () => setPickerOpen(true),
    paste, deleteNode, editNode, setCanvasImage, save, revert, subscribe, toast,
    reveal, takePendingReveal, showWindow, followRef, edited, confirm,
  }), [openFile, closeWindow, paste, deleteNode, editNode, setCanvasImage, save, revert, subscribe, toast, reveal, takePendingReveal, showWindow, followRef, edited, confirm]);

  return (
    <ActionsCtx.Provider value={actions}>
    <DataCtx.Provider value={data}>
    <LayoutCtx.Provider value={layout}>
      {children}

      <FilePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onOpened={(f) => { setPickerOpen(false); openFile(f); }} />

      <div className="pointer-events-none fixed bottom-6 right-6 z-[70] flex w-full max-w-sm flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto rounded-2xl border px-5 py-4 text-sm leading-6 shadow-lg backdrop-blur ${
              t.kind === "error"
                ? "border-rose-200 bg-rose-50/95 text-rose-800 dark:border-rose-900 dark:bg-rose-950/90 dark:text-rose-200"
                : t.kind === "success"
                  ? "border-emerald-200 bg-emerald-50/95 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/90 dark:text-emerald-200"
                  : "border-zinc-200 bg-white/95 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      <Dialog open={confirmState !== null} onClose={() => answer(false)} className="relative z-[80]">
        <DialogBackdrop transition className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm transition duration-150 data-[closed]:opacity-0" />
        <div className="fixed inset-0 flex items-center justify-center p-6">
          <DialogPanel
            transition
            className="w-full max-w-md space-y-8 rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="space-y-3">
              <DialogTitle className="text-lg font-semibold">{confirmState?.opts.title}</DialogTitle>
              <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">{confirmState?.opts.body}</p>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" className={buttonSecondary} onClick={() => answer(false)}>Cancel</button>
              <button
                type="button"
                autoFocus
                className={confirmState?.opts.danger ? `${buttonPrimary} !bg-rose-600 hover:!bg-rose-700 focus-visible:!outline-rose-600` : buttonPrimary}
                onClick={() => answer(true)}
              >
                {confirmState?.opts.confirmLabel}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </LayoutCtx.Provider>
    </DataCtx.Provider>
    </ActionsCtx.Provider>
  );
}
