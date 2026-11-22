import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

const STORAGE_PREFIX = "wzbrowser.pane.";
/** How wide the row's middle stays while a pane is dragged wider. */
const MIDDLE_MIN_WIDTH = 200;

/** A side pane's width, remembered per pane (every window with that pane shares it). */
export interface PaneWidth {
    width: number;
    setWidth: (width: number) => void;
    initial: number;
    min: number;
    max: number;
}

export function usePaneWidth(key: string, initial: number, min: number, max: number): PaneWidth {
    const [width, setStoredWidth] = useState(() => readWidth(key, initial, min, max));
    const setWidth = (next: number) => setStoredWidth(clamp(Math.round(next), min, max));
    // Written once the drag settles rather than on every move.
    useEffect(function rememberWidth() {
        const timer = setTimeout(() => writeWidth(key, width, initial), 250);
        return () => clearTimeout(timer);
    }, [key, width, initial]);
    return { width, setWidth, initial, min, max };
}

function readWidth(key: string, initial: number, min: number, max: number) {
    try {
        const stored = Number(localStorage.getItem(STORAGE_PREFIX + key));
        if (stored > 0) return clamp(stored, min, max);
    } catch { /* not persisted */ }
    return initial;
}

function writeWidth(key: string, width: number, initial: number) {
    try {
        if (width === initial) localStorage.removeItem(STORAGE_PREFIX + key);
        else localStorage.setItem(STORAGE_PREFIX + key, String(width));
    } catch { /* not persisted */ }
}

/** The width as a CSS variable, for panes that only take it at some container sizes (`@xl:w-(--pane-w)`). */
export function paneVar(pane: PaneWidth) {
    return { "--pane-w": `${pane.width}px` } as CSSProperties;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

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
    const drag = useRef<{ startX: number; startWidth: number; maxWidth: number } | null>(null);
    const direction = side === "left" ? 1 : -1;

    function startDrag(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: pane.width, maxWidth: widestAllowed(handle, pane) };
        setDragging(true);
    }

    function moveDrag(event: PointerEvent<HTMLDivElement>) {
        const current = drag.current;
        if (!current) return;
        const width = current.startWidth + direction * (event.clientX - current.startX);
        pane.setWidth(Math.min(current.maxWidth, width));
    }

    function endDrag() {
        drag.current = null;
        setDragging(false);
    }

    function resizeWithKeys(event: KeyboardEvent<HTMLDivElement>) {
        const step = event.shiftKey ? 64 : 16;
        let width: number;
        if (event.key === "ArrowLeft") width = pane.width - direction * step;
        else if (event.key === "ArrowRight") width = pane.width + direction * step;
        else if (event.key === "Home" || event.key === "Enter") width = pane.initial;
        else return;
        event.preventDefault();
        pane.setWidth(width);
    }

    const resetWidth = () => pane.setWidth(pane.initial);
    const line = dragging ? "bg-accent-500" : "group-hover:bg-accent-400/70 group-focus-visible:bg-accent-500";

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
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onDoubleClick={resetWidth}
                onKeyDown={resizeWithKeys}
                className="group absolute inset-y-0 -left-1.5 w-3 cursor-col-resize touch-none outline-none"
            >
                <span className={`absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${line}`} />
            </div>
            {/* Keeps the cursor and stops text selection while the pointer is off the edge. */}
            {dragging && <div className="fixed inset-0 z-[999] cursor-col-resize select-none" />}
        </div>
    );
}

/** The widest the pane may get: as wide as leaves the row's middle its minimum, and no wider than its max. */
function widestAllowed(handle: HTMLElement, pane: PaneWidth) {
    const wrapper = handle.parentElement;
    const row = wrapper?.parentElement;
    if (!wrapper || !row) return pane.max;
    return pane.width + Math.max(0, middleWidth(row, wrapper) - MIDDLE_MIN_WIDTH);
}

/** The width of the row's flexible middle: the row less every other child, the handle's wrapper excluded. */
function middleWidth(row: HTMLElement, wrapper: HTMLElement) {
    let fixed = 0;
    let flexible = 0;
    for (const child of Array.from(row.children) as HTMLElement[]) {
        if (child === wrapper) continue;
        if (getComputedStyle(child).flexGrow !== "0") flexible += child.offsetWidth;
        else fixed += child.offsetWidth;
    }
    return flexible || row.clientWidth - fixed;
}
