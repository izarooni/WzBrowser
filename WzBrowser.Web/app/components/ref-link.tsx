import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LookupKind } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useActions } from "../lib/workspace";

/** What a link needs to know: which quest archive it belongs to, and how to jump to another quest in it. */
export interface RefContext {
  fileId: string;
  openQuest: (id: number) => void;
}
export const RefCtx = createContext<RefContext | null>(null);

const KIND_LABEL: Record<LookupKind, string> = { npc: "NPC", item: "Item", mob: "Mob", map: "Map", skill: "Skill", quest: "Quest" };

// Whether a picture exists is looked up once per URL; the browser then has the image cached for the tooltip itself.
type Probe = { w: number; h: number } | null;
const probes = new Map<string, Promise<Probe>>();
function probe(url: string): Promise<Probe> {
  let p = probes.get(url);
  if (!p) {
    p = new Promise<Probe>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
    probes.set(url, p);
  }
  return p;
}

interface Tip { left: number; top: number; anchorTop: number; above: boolean; w: number; h: number }

/**
 * A link to an item, NPC, mob, map, skill or quest. Clicking opens it (quests jump within the quest window; everything
 * else opens the WZ file that holds it and reveals the node). Hovering shows its picture, when it has one.
 */
export function RefLink({ kind, id, name, children }: { kind: LookupKind; id: number; name?: string; children: ReactNode }) {
  const ctx = useContext(RefCtx);
  const { api } = useConnection();
  const actions = useActions();
  const [tip, setTip] = useState<Tip | null>(null);
  const anchor = useRef<HTMLAnchorElement>(null);
  const hovering = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  const hide = useCallback(() => {
    hovering.current = false;
    clearTimeout(timer.current);
    setTip(null);
  }, []);

  if (!ctx) return <>{children}</>;

  const url = kind === "quest" ? null : api.previewUrl(ctx.fileId, kind, id);

  const show = () => {
    if (!url || hovering.current) return;
    hovering.current = true;
    // A short delay so sweeping the mouse across a paragraph doesn't fire a request per link.
    timer.current = setTimeout(async () => {
      const found = await probe(url);
      const el = anchor.current;
      if (!found || !el || !hovering.current) return;
      const r = el.getBoundingClientRect();
      // Below the link by default; above it when there isn't room.
      setTip({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 276)),
        top: r.bottom + 8,
        anchorTop: r.top,
        above: r.bottom + 320 > window.innerHeight,
        w: found.w,
        h: found.h,
      });
    }, 180);
  };

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    hide();
    if (kind === "quest") ctx.openQuest(id);
    else void actions.followRef(ctx.fileId, kind, id);
  };

  // Small sprites (32px icons) are blown up so they're actually visible; big ones are capped.
  const scale = tip ? (Math.max(tip.w, tip.h) <= 48 ? 4 : Math.max(tip.w, tip.h) <= 110 ? 2 : 1) : 1;

  return (
    <>
      <a
        ref={anchor}
        href="#"
        onClick={onClick}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="cursor-pointer underline decoration-current/40 decoration-dotted underline-offset-4 transition hover:decoration-solid hover:decoration-current focus-visible:rounded focus-visible:outline-2 focus-visible:outline-accent-500"
      >
        {children}
      </a>
      {tip && url && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed", left: tip.left, zIndex: 90, pointerEvents: "none",
            ...(tip.above ? { bottom: window.innerHeight - tip.anchorTop + 8 } : { top: tip.top }),
          }}
          className="w-max max-w-[260px] space-y-2.5 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="checker grid place-items-center overflow-hidden rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
            <img
              src={url}
              alt=""
              style={{ imageRendering: "pixelated", width: tip.w * scale, maxWidth: 220, maxHeight: 220, objectFit: "contain" }}
            />
          </div>
          <p className="text-xs leading-5">
            <span className="text-zinc-500">{KIND_LABEL[kind]}</span>{" "}
            {name && <span className="font-medium">{name}</span>} <span className="font-mono text-zinc-500">{id}</span>
          </p>
        </div>,
        document.body,
      )}
    </>
  );
}

/** An inline picture (e.g. the item icon behind `#i4031003#`) that is itself a link. Falls back to a label if there is no image. */
export function RefIcon({ kind, id, label }: { kind: LookupKind; id: number; label: string }) {
  const ctx = useContext(RefCtx);
  const { api } = useConnection();
  const [failed, setFailed] = useState(false);
  const url = ctx && kind !== "quest" ? api.previewUrl(ctx.fileId, kind, id) : null;

  if (!url || failed) {
    return <span className="mx-0.5 rounded bg-zinc-100 px-1.5 py-0.5 align-baseline font-mono text-[11px] text-zinc-500 dark:bg-zinc-800">{label}</span>;
  }
  return (
    <RefLink kind={kind} id={id}>
      <img
        src={url}
        alt={label}
        onError={() => setFailed(true)}
        style={{ imageRendering: "pixelated" }}
        className="mx-0.5 inline-block h-7 max-w-[56px] object-contain align-middle"
      />
    </RefLink>
  );
}
