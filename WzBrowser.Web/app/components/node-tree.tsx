import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { WzNode } from "../lib/api";
import { useConnection } from "../lib/connection";
import { baseName, canPaste, joinPath, parentPath } from "../lib/paths";
import { dnd, useActions, useWorkspaceData, type ClipItem, type TreeEvent } from "../lib/workspace";
import { ChevronRight, Copy, Document, Folder, Music, Photo, Search, XMark } from "./icons";
import { inputClass } from "./ui";

type Level =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; nodes: WzNode[] };

type Row =
  | { kind: "node"; path: string; node: WzNode; depth: number }
  | { kind: "status"; path: string; depth: number; level: Level };

const ROOT: WzNode = { name: "", type: "file", hasChildren: true, value: null, width: null, height: null };

function TypeIcon({ type }: { type: string }) {
  const cls = "size-5 shrink-0";
  switch (type) {
    case "directory": return <Folder className={`${cls} text-amber-500`} />;
    case "image": return <Document className={`${cls} text-accent-500`} />;
    case "sub":
    case "convex": return <Folder className={`${cls} text-zinc-400`} />;
    case "canvas": return <Photo className={`${cls} text-emerald-500`} />;
    case "sound": return <Music className={`${cls} text-pink-500`} />;
    default:
      return (
        <span className="grid h-5 min-w-9 shrink-0 place-items-center rounded-md bg-zinc-100 px-1.5 font-mono text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {type === "string" ? "str" : type === "vector" ? "vec" : type.slice(0, 3)}
        </span>
      );
  }
}

const isEditable = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export const NodeTree = memo(function NodeTree({ fileId }: { fileId: string }) {
  const { api, status } = useConnection();
    const ws = useActions();
  const { files, clipboard } = useWorkspaceData();
  const file = files[fileId];

  const [levels, setLevels] = useState<Record<string, Level>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<{ needle: string; paths: Set<string>; ancestors: Set<string> } | null>(null);
  const [dropPath, setDropPath] = useState<string | null>(null);
  const [revealTick, setRevealTick] = useState(0);

  const rowRefs = useRef(new Map<string, HTMLElement>());
  const revealRef = useRef<string | null>(null);
  const hoverTimer = useRef<{ path: string; id: ReturnType<typeof setTimeout> } | null>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  // Folders the filter opened on its own (not by the user), closed again when the filter is cleared.
  const filterOpened = useRef(new Set<string>());
  // A node to scroll to the middle of the tree once the rows have re-rendered.
  const centerRef = useRef<string | null>(null);

  // ------------------------------------------------------------ loading

  const loadLevel = useCallback((path: string, force = false) => {
    setLevels((cur) => {
      const s = cur[path]?.status;
      if (!force && (s === "ready" || s === "loading")) return cur;
      // A forced reload keeps showing the old rows instead of flashing a skeleton.
      return force && s === "ready" ? cur : { ...cur, [path]: { status: "loading" } };
    });
    api.children(fileId, path).then(
      (nodes) => setLevels((cur) => ({ ...cur, [path]: { status: "ready", nodes } })),
      (e) => setLevels((cur) => ({ ...cur, [path]: { status: "error", message: e instanceof Error ? e.message : String(e) } })),
    );
  }, [api, fileId]);

  useEffect(() => {
    if (status !== "online") return;
    setLevels({});
    setExpanded(new Set());
    filterOpened.current = new Set();
    setSelected(null);
    loadLevel("");
  }, [status, fileId, loadLevel]);

  const typeAt = useCallback((path: string): WzNode => {
    if (!path) return ROOT;
    const level = levelsRef.current[parentPath(path)];
    return (level?.status === "ready" ? level.nodes.find((n) => n.name === baseName(path)) : undefined) ?? { ...ROOT, type: "unknown", hasChildren: false };
  }, []);

  // Edits made through the workspace (paste, delete, revert) and links from other windows tell the open tree what to do.
  const applyEvent = useCallback((e: TreeEvent) => {
    if (e.reset) {
      setLevels({});
      setExpanded(new Set());
      filterOpened.current = new Set();
      setSelected(null);
      loadLevel("");
      return;
    }
    e.reload?.forEach((p) => loadLevel(p, true));
    if (e.reveal) {
      const target = e.reveal;
      revealRef.current = target;
      // Re-run the "finish reveal" effect even when no level changes (a root-level target is already loaded).
      setRevealTick((n) => n + 1);
      setExpanded((cur) => {
        const next = new Set(cur);
        for (let p = parentPath(target); p; p = parentPath(p)) { next.add(p); filterOpened.current.delete(p); loadLevel(p); }
        return next;
      });
    }
  }, [loadLevel]);

  useEffect(() => ws.subscribe(fileId, applyEvent), [ws.subscribe, fileId, applyEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link may have opened this window and asked to reveal a node before the tree existed.
  // Declared after the initial-load effect so the reveal isn't wiped by its reset.
  useEffect(() => {
    if (status !== "online") return;
    const pending = ws.takePendingReveal(fileId);
    if (pending) applyEvent({ reveal: pending });
  }, [status, fileId, applyEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Finish a "reveal" once the level holding the new node has loaded.
  useEffect(() => {
    const target = revealRef.current;
    if (!target) return;
    const level = levels[parentPath(target)];
    if (level?.status === "ready" && level.nodes.some((n) => n.name === baseName(target))) {
      revealRef.current = null;
      setSelected(target);
      requestAnimationFrame(() => rowRefs.current.get(target)?.scrollIntoView({ block: "nearest" }));
    }
  }, [levels, revealTick]);

  // ------------------------------------------------------------ rows

  const needle = filter.trim().toLowerCase();

  // The server searches every directory and .img, plus 3 levels of properties inside each .img, so the filter
  // finds entries (e.g. quest 21010 in Check.img, Act.img, ...) without those levels being opened first.
  useEffect(() => {
    if (!needle || status !== "online") { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => {
      api.search(fileId, needle, 3).then((found) => {
        if (!live) return;
        const paths = new Set(found);
        const ancestors = new Set<string>();
        for (const p of found) for (let a = parentPath(p); a; a = parentPath(a)) ancestors.add(a);
        setHits({ needle, paths, ancestors });
        // Open the way to every hit, and the hits themselves so their sub-properties show.
        const open = [...ancestors, ...found];
        setExpanded((cur) => {
          for (const p of open) if (!cur.has(p)) filterOpened.current.add(p);
          return new Set([...cur, ...open]);
        });
        loadLevel("");
        open.forEach((p) => loadLevel(p));
      }, () => { if (live) setHits(null); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [needle, status, api, fileId, loadLevel]);

  const rows = useMemo(() => {
    const memo = new Map<string, boolean>();
    const h = hits && hits.needle === needle ? hits : null;
    const keep = (path: string, node: WzNode): boolean => {
      if (!needle) return true;
      if (h) {
        if (h.paths.has(path) || h.ancestors.has(path)) return true;
        for (let a = parentPath(path); a; a = parentPath(a)) if (h.paths.has(a)) return true; // inside a hit: show whole subtree
        return false;
      }
      const cached = memo.get(path);
      if (cached !== undefined) return cached;
      let result = node.name.toLowerCase().includes(needle);
      const level = levels[path];
      if (!result && level?.status === "ready") result = level.nodes.some((n) => keep(joinPath(path, n.name), n));
      memo.set(path, result);
      return result;
    };
    const out: Row[] = [];
    const walk = (path: string, depth: number) => {
      const level = levels[path];
      if (!level) return;
      if (level.status !== "ready") { out.push({ kind: "status", path, depth, level }); return; }
      for (const node of level.nodes) {
        const p = joinPath(path, node.name);
        if (!keep(p, node)) continue;
        out.push({ kind: "node", path: p, node, depth });
        if (expanded.has(p)) walk(p, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [levels, expanded, needle, hits]);

  const nodeRows = useMemo(() => rows.filter((r): r is Extract<Row, { kind: "node" }> => r.kind === "node"), [rows]);

  // Opening or closing a folder by hand makes it the user's, so clearing the filter leaves it as they set it.
  const expand = (path: string) => {
    filterOpened.current.delete(path);
    setExpanded((cur) => (cur.has(path) ? cur : new Set(cur).add(path)));
    loadLevel(path);
  };
  const collapse = (path: string) => {
    filterOpened.current.delete(path);
    setExpanded((cur) => { const n = new Set(cur); n.delete(path); return n; });
  };

  // Close the folders the filter opened, except the way to the selected node, and keep that node centred.
  const restoreFolders = useCallback(() => {
    const opened = filterOpened.current;
    if (!opened.size) return;
    const sel = selectedRef.current;
    centerRef.current = sel;
    filterOpened.current = new Set();
    const keep = new Set<string>();
    if (sel != null) for (let a = parentPath(sel); a; a = parentPath(a)) keep.add(a);
    setExpanded((cur) => new Set([...cur].filter((p) => !opened.has(p) || keep.has(p))));
  }, []);

  // Runs before the restore effect below, so it scrolls once the restored rows are on screen rather than before.
  useEffect(() => {
    const target = centerRef.current;
    if (target == null) return;
    centerRef.current = null;
    rowRefs.current.get(target)?.scrollIntoView({ block: "center" });
  }, [rows]);

  // Also restore when the filter is emptied by typing rather than with the clear button or Esc.
  useEffect(() => { if (!needle) restoreFolders(); }, [needle, restoreFolders]);

  const select = (path: string, focus = false) => {
    setSelected(path);
    if (focus) requestAnimationFrame(() => {
      const el = rowRefs.current.get(path);
      el?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
    });
  };

  const clearFilter = () => {
    if (!filter) return;
    setFilter("");
    restoreFolders();
    centerRef.current = selected;
  };

  const onRowClick = (path: string, node: WzNode) => {
    setSelected(path);
    if (!node.hasChildren) return;
    if (expanded.has(path)) collapse(path); else expand(path);
  };

  // ------------------------------------------------------------ clipboard actions

  const selectedNode = selected != null ? typeAt(selected) : null;

  const clipOf = (path: string, cut: boolean): ClipItem => {
    const n = typeAt(path);
    return { fileId, path, name: n.name, type: n.type, cut };
  };

  const copySelected = (cut: boolean) => {
    if (selected == null) return;
    ws.setClipboard(clipOf(selected, cut));
    ws.toast("info", `${cut ? "Cut" : "Copied"} “${baseName(selected)}”. Click into another window and press Ctrl+V.`);
  };

  /** Where Ctrl+V lands: the selected node if it can hold the clipboard, else its parent, else the file root. */
  const pasteTarget = (clip: ClipItem): string | null => {
    const candidates = selected != null ? [selected, parentPath(selected), ""] : [""];
    for (const p of candidates) if (canPaste(clip, typeAt(p))) return p;
    return null;
  };

  const pasteHere = () => {
    const clip = clipboard;
    if (!clip) return ws.toast("info", "Nothing copied yet. Select a node and press Ctrl+C.");
    const target = pasteTarget(clip);
    if (target == null) return ws.toast("error", `A ${clip.type} can't be pasted here. Select an image or sub-property to paste properties into.`);
    if (clip.cut && clip.fileId === fileId && (target === clip.path || target.startsWith(clip.path + "/")))
      return ws.toast("error", "A node can't be moved into itself.");
    void ws.paste(fileId, target, clip, clip.cut);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void ws.save(fileId); return; }
    if (isEditable(e.target)) return;

    if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); copySelected(false); return; }
    if (mod && e.key.toLowerCase() === "x") { e.preventDefault(); copySelected(true); return; }
    if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteHere(); return; }
    if (e.key === "Delete" && selected != null) { e.preventDefault(); void ws.deleteNode(fileId, selected, baseName(selected)); return; }

    const idx = nodeRows.findIndex((r) => r.path === selected);
    const cur = idx >= 0 ? nodeRows[idx] : undefined;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); { const n = nodeRows[Math.min(idx + 1, nodeRows.length - 1)]; if (n) select(n.path, true); } break;
      case "ArrowUp": e.preventDefault(); { const n = nodeRows[Math.max(idx - 1, 0)]; if (n) select(n.path, true); } break;
      case "Home": e.preventDefault(); if (nodeRows[0]) select(nodeRows[0].path, true); break;
      case "End": e.preventDefault(); if (nodeRows.length) select(nodeRows[nodeRows.length - 1].path, true); break;
      case "ArrowRight":
        e.preventDefault();
        if (cur?.node.hasChildren) { if (!expanded.has(cur.path)) expand(cur.path); else if (nodeRows[idx + 1]) select(nodeRows[idx + 1].path, true); }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (cur && expanded.has(cur.path)) collapse(cur.path);
        else if (cur && parentPath(cur.path)) select(parentPath(cur.path), true);
        break;
      case "Enter":
      case " ":
        if (cur) { e.preventDefault(); onRowClick(cur.path, cur.node); }
        break;
    }
  };

  // ------------------------------------------------------------ drag & drop

  const endHover = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current.id); hoverTimer.current = null; };

  const dropAllowed = (targetPath: string, target: WzNode) => {
    const src = dnd.current;
    if (!src || !canPaste(src, target)) return false;
    // Dragging a node onto itself or into its own subtree makes no sense.
    return !(src.fileId === fileId && (targetPath === src.path || targetPath.startsWith(src.path + "/")));
  };

  const dragOverTarget = (e: DragEvent, targetPath: string, target: WzNode) => {
    e.stopPropagation();
    if (!dnd.current) return;
    if (!dropAllowed(targetPath, target)) { e.dataTransfer.dropEffect = "none"; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = e.shiftKey ? "move" : "copy";
    setDropPath(targetPath);
    // Hovering over a closed folder for a moment opens it, like a file manager.
    if (target.hasChildren && !expanded.has(targetPath) && hoverTimer.current?.path !== targetPath) {
      endHover();
      hoverTimer.current = { path: targetPath, id: setTimeout(() => expand(targetPath), 700) };
    }
  };

  const dropOnTarget = (e: DragEvent, targetPath: string, target: WzNode) => {
    e.stopPropagation();
    const src = dnd.current;
    endHover();
    setDropPath(null);
    if (!src || !dropAllowed(targetPath, target)) return;
    e.preventDefault();
    dnd.current = null;
    void ws.paste(fileId, targetPath, src, e.shiftKey);
  };

  // ------------------------------------------------------------ render

  const rootLevel = levels[""];

  return (
    // A container query can only react to an ancestor, so the layout switch lives on the inner div.
    <div className="@container flex min-h-0 flex-1 flex-col">
    <div className="flex min-h-0 flex-1 flex-col @xl:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") clearFilter(); }}
              placeholder="Filter entries (searches inside .img files)…"
              aria-label="Filter entries"
              className={`${inputClass} !rounded-lg !py-2 pl-10 ${filter ? "pr-10" : ""}`}
            />
            {filter && (
              <button
                type="button"
                onClick={(e) => { clearFilter(); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); }}
                aria-label="Clear filter"
                title="Clear filter (Esc)"
                className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <XMark className="size-4" />
              </button>
            )}
          </label>
        </div>

        <div
          role="tree"
          aria-label={`${file?.name ?? "WZ"} contents`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onDragOver={(e) => dragOverTarget(e, "", ROOT)}
          onDrop={(e) => dropOnTarget(e, "", ROOT)}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDropPath(null); endHover(); } }}
          className={`min-h-0 flex-1 overflow-auto p-2 outline-none transition ${dropPath === "" ? "bg-accent-50/70 ring-2 ring-inset ring-accent-400 dark:bg-accent-600/10" : ""}`}
        >
          {!rootLevel && <TreeSkeleton />}
          {rows.map((row) => {
            if (row.kind === "status") {
              const pad = { paddingLeft: 16 + row.depth * 20 };
              return row.level.status === "loading"
                ? <div key={`s:${row.path}`} style={pad} className="py-1"><div className="skeleton h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800" /></div>
                : <p key={`s:${row.path}`} style={pad} className="px-3 py-3 text-sm text-rose-600 dark:text-rose-400">{row.level.status === "error" && row.level.message}</p>;
            }
            const { node, path, depth } = row;
            const isOpen = expanded.has(path);
            const isSelected = selected === path;
            const isCut = clipboard?.cut && clipboard.fileId === fileId && clipboard.path === path;
            return (
              <button
                key={path}
                ref={(el) => { if (el) rowRefs.current.set(path, el); else rowRefs.current.delete(path); }}
                data-path={path}
                role="treeitem"
                aria-expanded={node.hasChildren ? isOpen : undefined}
                aria-selected={isSelected}
                type="button"
                draggable
                tabIndex={isSelected || (selected == null && path === nodeRows[0]?.path) ? 0 : -1}
                onClick={() => onRowClick(path, node)}
                onDragStart={(e) => {
                  const item: ClipItem = { fileId, path, name: node.name, type: node.type, cut: false };
                  dnd.current = item;
                  e.dataTransfer.effectAllowed = "copyMove";
                  e.dataTransfer.setData("application/x-wzbrowser-node", JSON.stringify(item));
                  e.dataTransfer.setData("text/plain", `${file?.name ?? ""}/${path}`);
                  setSelected(path);
                }}
                onDragEnd={() => { dnd.current = null; setDropPath(null); endHover(); }}
                onDragOver={(e) => dragOverTarget(e, path, node)}
                onDrop={(e) => dropOnTarget(e, path, node)}
                style={{ paddingLeft: 8 + depth * 20 }}
                className={`flex h-10 w-full items-center gap-2.5 rounded-lg pr-3 text-left text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-accent-500/60 ${
                  dropPath === path
                    ? "bg-accent-100 ring-2 ring-accent-500 dark:bg-accent-600/25"
                    : isSelected
                      ? "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                } ${isCut ? "opacity-45" : ""}`}
              >
                <ChevronRight className={`size-4 shrink-0 text-zinc-400 transition-transform ${node.hasChildren ? "" : "invisible"} ${isOpen ? "rotate-90" : ""}`} />
                <TypeIcon type={node.type} />
                <span className="min-w-0 truncate font-medium">{node.name}</span>
                {node.value != null && (
                  <span className="ml-auto max-w-[45%] shrink-0 truncate pl-3 font-mono text-xs text-zinc-500">{node.value}</span>
                )}
              </button>
            );
          })}
          {rootLevel?.status === "ready" && rows.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-zinc-500">{needle ? "Nothing matches in the loaded entries." : "This file is empty."}</p>
          )}
        </div>
      </div>

      <Detail
        fileId={fileId}
        path={selected}
        node={selectedNode}
        fileName={file?.name ?? ""}
        childCount={selected != null && levels[selected]?.status === "ready" ? (levels[selected] as { nodes: WzNode[] }).nodes.length : null}
        canPasteHere={!!clipboard && pasteTarget(clipboard) != null}
        onCopy={() => copySelected(false)}
        onCut={() => copySelected(true)}
        onPaste={pasteHere}
        onDelete={() => selected != null && void ws.deleteNode(fileId, selected, baseName(selected))}
      />
    </div>
    </div>
  );
});

function TreeSkeleton() {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: 7 }, (_, i) => <div key={i} className="skeleton h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}
    </div>
  );
}

function Detail({ fileId, path, node, fileName, childCount, canPasteHere, onCopy, onCut, onPaste, onDelete }: {
  fileId: string;
  path: string | null;
  node: WzNode | null;
  fileName: string;
  childCount: number | null;
  canPasteHere: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
}) {
  const { api } = useConnection();
  const [zoom, setZoom] = useState(1);
  const [imgFailed, setImgFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setZoom(1); setImgFailed(false); setCopied(false); }, [path]);

  const shell = "max-h-[42%] shrink-0 overflow-auto border-t border-zinc-100 @xl:max-h-none @xl:w-72 @xl:border-l @xl:border-t-0 dark:border-zinc-800";

  if (path == null || !node) {
    return (
      <aside className={`${shell} grid place-items-center p-6 text-center`}>
        <p className="text-sm leading-6 text-zinc-500">Select a node to see details.<br />Drag nodes to another window to copy them, hold <kbd className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-zinc-800">Shift</kbd> to move.</p>
      </aside>
    );
  }

  const copyPath = async () => {
    try { await navigator.clipboard.writeText(path); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const act = "rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <aside className={`${shell} space-y-5 p-5`}>
      <div className="space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-base font-semibold">{node.name}</h3>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{node.type}</span>
        </div>
        <button type="button" onClick={copyPath} title="Copy path" className="flex w-full items-start gap-2 text-left font-mono text-[11px] leading-5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <span className="min-w-0 flex-1 break-all">{fileName}/{path}</span>
          <span className="flex shrink-0 items-center gap-1"><Copy className="size-3.5" />{copied ? "Copied" : ""}</span>
        </button>
      </div>

      <div className="-mx-1 flex flex-wrap gap-1">
        <button type="button" className={act} onClick={onCopy} title="Ctrl+C">Copy</button>
        <button type="button" className={act} onClick={onCut} title="Ctrl+X">Cut</button>
        <button type="button" className={act} onClick={onPaste} disabled={!canPasteHere} title="Ctrl+V">Paste</button>
        <button type="button" className={`${act} !text-rose-600 dark:!text-rose-400`} onClick={onDelete} title="Delete">Delete</button>
      </div>

      {node.type === "canvas" && (
        <div className="space-y-3">
          <div className="checker grid max-h-64 min-h-24 place-items-center overflow-auto rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
            {imgFailed ? (
              <p className="text-sm text-zinc-500">Couldn't render this image.</p>
            ) : (
              <img
                key={`${fileId}/${path}`}
                src={api.pngUrl(fileId, path)}
                alt={node.name}
                draggable={false}
                onError={() => setImgFailed(true)}
                style={{ imageRendering: "pixelated", width: node.width ? node.width * zoom : undefined, maxWidth: "none" }}
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500">{node.width} × {node.height} px</span>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
              {[1, 2, 4].map((z) => (
                <button key={z} type="button" onClick={() => setZoom(z)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${zoom === z ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
                  {z}×
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {node.type !== "canvas" && node.hasChildren && <FrameAnimation key={`${fileId}/${path}`} fileId={fileId} path={path} />}

      {node.type === "sound" && (
        <div className="space-y-2.5 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-950">
          <audio key={`${fileId}/${path}`} controls preload="none" src={api.soundUrl(fileId, path)} className="w-full" />
          <a href={api.soundUrl(fileId, path)} download={node.name} className="inline-block text-xs font-medium text-accent-600 hover:underline dark:text-accent-400">Download</a>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-[13px]">
        {node.value != null && node.type !== "canvas" && <Field label="Value"><span className="whitespace-pre-wrap break-words font-mono">{node.value}</span></Field>}
        {childCount != null && <Field label="Children"><span className="font-mono">{childCount.toLocaleString()}</span></Field>}
      </dl>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

const MAX_FRAMES = 128;
const DEFAULT_DELAY = 100;

/** Plays the numbered canvas children of a property (e.g. `smile0`, `effect/skill/overSwingDouble/0`) as an animation. */
function FrameAnimation({ fileId, path }: { fileId: string; path: string }) {
  const { api } = useConnection();
  const [frames, setFrames] = useState<{ name: string; width: number; delay: number }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kids = await api.children(fileId, path);
        const canvases = kids
          .filter((k) => k.type === "canvas" && /^\d+$/.test(k.name))
          .sort((a, b) => Number(a.name) - Number(b.name))
          .slice(0, MAX_FRAMES);
        if (canvases.length < 2) return;
        // A frame's own "delay" child (ms) sets how long it shows; missing or unreadable falls back to the default.
        const delays = await Promise.all(canvases.map(async (c) => {
          try {
            const props = await api.children(fileId, joinPath(path, c.name));
            const d = Number(props.find((p) => p.name === "delay")?.value);
            return d > 0 ? d : DEFAULT_DELAY;
          } catch { return DEFAULT_DELAY; }
        }));
        if (!cancelled) setFrames(canvases.map((c, i) => ({ name: c.name, width: c.width ?? 0, delay: delays[i] })));
      } catch { /* not an animation */ }
    })();
    return () => { cancelled = true; };
  }, [api, fileId, path]);

  const count = frames?.length ?? 0;
  useEffect(() => {
    if (!playing || count < 2) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), frames![index % count].delay);
    return () => clearTimeout(t);
  }, [playing, count, index, frames]);

  if (!frames) return null;
  const cur = frames[index % count];
  const btn = "rounded-md px-2.5 py-1 text-xs font-semibold transition";

  return (
    <div className="space-y-3">
      <div className="checker grid max-h-64 min-h-24 place-items-center overflow-auto rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
        <img
          src={api.pngUrl(fileId, joinPath(path, cur.name))}
          alt={`Frame ${cur.name}`}
          draggable={false}
          style={{ imageRendering: "pixelated", width: cur.width ? cur.width * zoom : undefined, maxWidth: "none" }}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPlaying((p) => !p)}
            className={`${btn} bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700`}>
            {playing ? "Pause" : "Play"}
          </button>
          <span className="font-mono text-xs text-zinc-500">{(index % count) + 1}/{count}</span>
        </div>
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
          {[1, 2, 4].map((z) => (
            <button key={z} type="button" onClick={() => setZoom(z)}
              className={`${btn} ${zoom === z ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>
              {z}×
            </button>
          ))}
        </div>
      </div>
      <input type="range" min={0} max={count - 1} value={index % count} aria-label="Frame"
        onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} className="w-full" />
    </div>
  );
}
