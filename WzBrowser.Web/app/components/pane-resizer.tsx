import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

const STORAGE = "wzbrowser.pane.";

/** A side pane's width, remembered per pane (every window with that pane shares it). */
export type PaneWidth = { width: number; setWidth: (w: number) => void; initial: number; min: number; max: number };

export function usePaneWidth(key: string, initial: number, min: number, max: number): PaneWidth {
    const [width, setWidthState] = useState(() => {
        try {
            const v = Number(localStorage.getItem(STORAGE + key));
            if (v > 0) return clamp(v, min, max);
        } catch { /* not persisted */ }
        return initial;
    });
    const setWidth = (w: number) => setWidthState(clamp(Math.round(w), min, max));
    // Written once the drag settles rather than on every move.
    useEffect(() => {
        const t = setTimeout(() => {
            try {
                if (width === initial) localStorage.removeItem(STORAGE + key);
                else localStorage.setItem(STORAGE + key, String(width));
            } catch { /* not persisted */ }
        }, 250);
        return () => clearTimeout(t);
    }, [key, width, initial]);
    return { width, setWidth, initial, min, max };
}

/** The width as a CSS variable, for panes that only take it at some container sizes (`@xl:w-(--pane-w)`). */
export const paneVar = (pane: PaneWidth) => ({ "--pane-w": `${pane.width}px` }) as CSSProperties;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * A draggable edge between a side pane and the rest, placed between them in the flex row. `side` is where the pane
 * is: a left pane grows as the edge is dragged right, a right pane as it's dragged left. Double-click restores the
 * default width; with focus, the arrow keys move it.
 */
export function PaneResizer({ pane, side, label, className = "" }: {
    pane: PaneWidth;
    side: "left" | "right";
    label: string;
    className?: string;
}) {
    const [dragging, setDragging] = useState(false);
    const drag = useRef<{ x: number; width: number; room: number } | null>(null);
    const sign = side === "left" ? 1 : -1;

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        // Leave the middle at least 200px of the row.
        const row = e.currentTarget.parentElement?.parentElement;
        const room = row ? pane.width + Math.max(0, middleWidth(row, e.currentTarget.parentElement!) - 200) : pane.max;
        drag.current = { x: e.clientX, width: pane.width, room };
        setDragging(true);
    };
    const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d) return;
        pane.setWidth(Math.min(d.room, d.width + sign * (e.clientX - d.x)));
    };
    const end = () => { drag.current = null; setDragging(false); };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") { e.preventDefault(); pane.setWidth(pane.width - sign * step); }
        else if (e.key === "ArrowRight") { e.preventDefault(); pane.setWidth(pane.width + sign * step); }
        else if (e.key === "Home" || e.key === "Enter") { e.preventDefault(); pane.setWidth(pane.initial); }
    };

    return (
        <div className={`relative z-10 w-0 shrink-0 ${className}`}>
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label={label}
                aria-valuenow={pane.width}
                aria-valuemin={pane.min}
                aria-valuemax={pane.max}
                tabIndex={0}
                title="Drag to resize · double-click to reset"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={end}
                onPointerCancel={end}
                onLostPointerCapture={end}
                onDoubleClick={() => pane.setWidth(pane.initial)}
                onKeyDown={onKeyDown}
                className="group absolute inset-y-0 -left-1.5 w-3 cursor-col-resize touch-none outline-none"
            >
                <span className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${
                    dragging ? "bg-accent-500" : "group-hover:bg-accent-400/70 group-focus-visible:bg-accent-500"
                }`} />
            </div>
            {/* Keeps the cursor and stops text selection while the pointer is off the edge. */}
            {dragging && <div className="fixed inset-0 z-[999] cursor-col-resize select-none" />}
        </div>
    );
}

/** The width of the row's flexible middle: the row less every other child, the handle's wrapper excluded. */
function middleWidth(row: HTMLElement, handle: HTMLElement) {
    let fixed = 0;
    let flexible = 0;
    for (const child of Array.from(row.children) as HTMLElement[]) {
        if (child === handle) continue;
        if (getComputedStyle(child).flexGrow !== "0") flexible += child.offsetWidth;
        else fixed += child.offsetWidth;
    }
    return flexible || row.clientWidth - fixed;
}
