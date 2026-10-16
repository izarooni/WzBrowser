import { memo, useRef, useState, type PointerEvent } from "react";
import { MIN_H, MIN_W, useActions, useWorkspaceData, type Win } from "../lib/workspace";
import { Archive, Download, Minus, Plus, Undo, XMark } from "./icons";
import { CommodityEditor } from "./commodity-editor";
import { NodeTree } from "./node-tree";
import { QuestBrowser } from "./quest-browser";

type Gesture =
  | { kind: "move"; sx: number; sy: number; x: number; y: number }
  | { kind: "resize"; sx: number; sy: number; w: number; h: number; dx: boolean; dy: boolean };

const iconButton =
  "rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700/70 dark:hover:text-zinc-100";

/** A floating, draggable, resizable window showing one open WZ file. */
export const WzWindow = memo(function WzWindow({ win, focused }: { win: Win; focused: boolean }) {
  const actions = useActions();
  const { files } = useWorkspaceData();
  const file = files[win.fileId];
  const gesture = useRef<Gesture | null>(null);
  // Quest archives open on the quest browser and Etc.wz on the Commodity table; the raw tree is one tab away.
  const [tab, setTab] = useState<"main" | "raw">("main");
  const mainLabel = file?.kind === "quest" ? "Quests" : file?.kind === "etc" ? "Commodity" : null;
  const openRaw = (path: string) => { setTab("raw"); actions.reveal(win.fileId, path); };

  const begin = (e: PointerEvent<HTMLElement>, g: Gesture) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = g;
  };

  const track = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (g.kind === "move") actions.patchWindow(win.fileId, { x: g.x + dx, y: g.y + dy });
    else actions.patchWindow(win.fileId, {
      ...(g.dx ? { w: Math.max(MIN_W, g.w + dx) } : {}),
      ...(g.dy ? { h: Math.max(MIN_H, g.h + dy) } : {}),
    });
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handle = (dx: boolean, dy: boolean, cls: string) => (
    <div
      onPointerDown={(e) => begin(e, { kind: "resize", sx: e.clientX, sy: e.clientY, w: win.w, h: win.h, dx, dy })}
      onPointerMove={track}
      onPointerUp={end}
      onPointerCancel={end}
      className={`absolute z-10 touch-none ${cls}`}
    />
  );

  return (
    <section
      aria-label={file?.name ?? "WZ file"}
      onPointerDownCapture={() => actions.focusWindow(win.fileId)}
      style={{ left: win.x, top: win.y, width: win.w, height: win.collapsed ? undefined : win.h, zIndex: win.z }}
      className={`absolute flex flex-col rounded-2xl border bg-white transition-shadow dark:bg-zinc-900 ${
        focused
          ? "border-accent-400/70 shadow-2xl shadow-zinc-900/20 ring-1 ring-accent-400/40 dark:shadow-black/60"
          : "border-zinc-200 shadow-lg shadow-zinc-900/10 dark:border-zinc-800 dark:shadow-black/40"
      }`}
    >
      {/* Clipping lives here, not on the frame, so the resize handles can overhang the rounded border. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[15px]">
      <header
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          begin(e, { kind: "move", sx: e.clientX, sy: e.clientY, x: win.x, y: win.y });
        }}
        onPointerMove={track}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) actions.patchWindow(win.fileId, { collapsed: !win.collapsed }); }}
        className="flex h-14 shrink-0 cursor-grab touch-none select-none items-center gap-3 border-b border-zinc-100 bg-zinc-50/80 px-4 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-950/50"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600 dark:bg-accent-600/15 dark:text-accent-400">
          <Archive className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h2 className="truncate text-sm font-semibold" title={file?.path}>{file?.name ?? "…"}</h2>
          {file && <span className="hidden shrink-0 text-xs text-zinc-500 sm:inline">{file.encryption} · v{file.version}</span>}
          {file?.dirty && (
            <span
              title="Edits are in memory only. Save writes a new file; the original is never changed."
              className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
            >
              Unsaved
            </span>
          )}
        </div>

        {file?.dirty && (
          <>
            <button type="button" onClick={() => void actions.save(win.fileId)} title="Save as a new file (Ctrl+S)"
              className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-700">
              <Download className="size-3.5" />Save
            </button>
            <button type="button" onClick={() => void actions.revert(win.fileId)} aria-label="Discard changes" title="Discard all unsaved changes" className={iconButton}>
              <Undo className="size-4" />
            </button>
          </>
        )}
        <button type="button" onClick={() => actions.patchWindow(win.fileId, { collapsed: !win.collapsed })}
          aria-label={win.collapsed ? "Expand window" : "Collapse window"} className={iconButton}>
          {win.collapsed ? <Plus className="size-4" /> : <Minus className="size-4" />}
        </button>
        <button type="button" onClick={() => void actions.closeWindow(win.fileId)} aria-label="Close file" className={`${iconButton} hover:!bg-rose-100 hover:!text-rose-700 dark:hover:!bg-rose-500/20`}>
          <XMark className="size-4" />
        </button>
      </header>

      {!win.collapsed && mainLabel && (
        <div role="tablist" aria-label="View" className="flex shrink-0 gap-1 border-b border-zinc-100 px-4 pt-2 dark:border-zinc-800">
          {(["main", "raw"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-[13px] font-medium transition ${
                tab === t
                  ? "border-accent-500 text-accent-700 dark:text-accent-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {t === "main" ? mainLabel : "Raw tree"}
            </button>
          ))}
        </div>
      )}
      {/* Both views stay mounted (the inactive one is hidden) so the raw tree keeps its state and can be revealed from the main view. */}
      {!win.collapsed && mainLabel && (
        <div className={tab === "main" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          {file?.kind === "quest"
            ? <QuestBrowser fileId={win.fileId} revision={file.revision} onOpenRaw={openRaw} />
            : <CommodityEditor fileId={win.fileId} revision={file!.revision} onOpenRaw={openRaw} />}
        </div>
      )}
      {!win.collapsed && (
        <div className={mainLabel && tab === "main" ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
          <NodeTree fileId={win.fileId} />
        </div>
      )}
      </div>

      {!win.collapsed && (
        <>
          {handle(true, false, "-right-1.5 top-14 bottom-4 w-3 cursor-ew-resize")}
          {handle(false, true, "-bottom-1.5 left-4 right-4 h-3 cursor-ns-resize")}
          {handle(true, true, "-bottom-2 -right-2 size-6 cursor-nwse-resize")}
        </>
      )}
    </section>
  );
});
