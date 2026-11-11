import type { MetaFunction } from "@remix-run/react";
import { useRef, type PointerEvent, type WheelEvent } from "react";
import { Squares } from "../components/icons";
import { buttonPrimary } from "../components/ui";
import { LibraryWiki } from "../components/library-wiki";
import { WzWindow } from "../components/wz-window";
import { useConnection } from "../lib/connection";
import { useActions, useLayout } from "../lib/workspace";

export const meta: MetaFunction = () => [{ title: "WzBrowser" }];

/** Viewers who may only browse get the library as one page; everyone else gets the window workspace. */
export default function Index() {
  const { browseOnly } = useConnection();
  return browseOnly ? <LibraryWiki /> : <Workspace />;
}

/** The workspace: a pannable canvas with one floating window per open WZ file. */
function Workspace() {
  const { status, recheck } = useConnection();
  const { wins, pan } = useLayout();
  const actions = useActions();
  const panning = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);

  const focusedId = wins.reduce<{ id: string; z: number } | null>((best, w) => (!best || w.z > best.z ? { id: w.fileId, z: w.z } : best), null)?.id;

  // Set when a middle-button pan moved, so the auxclick that follows doesn't open a link the drag began on.
  const middleDragged = useRef(false);

  const startPan = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    panning.current = { sx: e.clientX, sy: e.clientY, x: pan.x, y: pan.y };
  };
  // Middle-button drag pans from anywhere, windows included: caught on the way down so windows never see it.
  const onPointerDownCapture = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    middleDragged.current = false;
    startPan(e);
  };
  // Left-button drag pans only from empty canvas. Events from windows never reach here as target === currentTarget.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    startPan(e);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = panning.current;
    if (!p) return;
    if (e.clientX !== p.sx || e.clientY !== p.sy) middleDragged.current = true;
    actions.setPan(p.x + e.clientX - p.sx, p.y + e.clientY - p.sy);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    panning.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) actions.setPan(pan.x - e.deltaX, pan.y - e.deltaY);
  };

  return (
    <div
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      // Stops the browser's middle-click autoscroll, and a link click after a middle-button pan.
      onMouseDownCapture={(e) => { if (e.button === 1) e.preventDefault(); }}
      onAuxClickCapture={(e) => { if (e.button === 1 && middleDragged.current) { e.preventDefault(); e.stopPropagation(); } }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ backgroundPosition: `${pan.x}px ${pan.y}px` }}
      className="canvas-dots absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
    >
      <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        {wins.map((w) => <WzWindow key={w.fileId} win={w} focused={w.fileId === focusedId} />)}
      </div>

      {wins.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-8">
          <div className="pointer-events-auto max-w-md space-y-6 rounded-2xl border border-zinc-200 bg-white/90 p-10 text-center shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
            {status === "offline" ? (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">WzBrowser isn't running</h1>
                <p className="leading-7 text-zinc-600 dark:text-zinc-400">
                  Start <span className="font-mono text-zinc-900 dark:text-zinc-100">WzBrowser.exe</span> on this computer. This page connects automatically as soon as it's up.
                </p>
                <button type="button" onClick={recheck} className="text-sm font-semibold text-accent-600 hover:underline dark:text-accent-400">Check again</button>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">Open a WZ file</h1>
                <p className="leading-7 text-zinc-600 dark:text-zinc-400">
                  Each file opens in its own window. Drag nodes from one window to another to copy them, or use Ctrl+C, Ctrl+X and Ctrl+V.
                </p>
                <button type="button" className={buttonPrimary} disabled={status !== "online"} onClick={actions.openPicker}>Open WZ file…</button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-6 left-6 flex items-center gap-3">
        <button
          type="button"
          onClick={actions.tidy}
          disabled={wins.length === 0}
          className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-white/90 px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm backdrop-blur transition hover:bg-white disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900/90 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <Squares className="size-4" />Tidy windows
        </button>
        <p className="hidden rounded-xl border border-zinc-200 bg-white/90 px-4 py-2.5 text-xs text-zinc-500 shadow-sm backdrop-blur md:block dark:border-zinc-800 dark:bg-zinc-900/90">
          Drag to copy · <kbd className="font-mono">Shift</kbd> to move · <kbd className="font-mono">Ctrl+C/X/V</kbd> · <kbd className="font-mono">Ctrl+S</kbd> save · <kbd className="font-mono">Del</kbd> delete
        </p>
      </div>
    </div>
  );
}
