import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { EditHistory, HistoryStep } from "../lib/api";
import { useConnection } from "../lib/connection";
import { errorMessage } from "../lib/errors";
import { useStored } from "../lib/stored";
import { useActions, useWorkspaceData } from "../lib/workspace";
import { ChevronDown } from "./icons";

const WIDTH = 224;
const ROW_HEIGHT = 28;
/** Actions shown until the window's expanded. */
const ROWS = 8;
const EXPANDED_ROWS = 20;
/** How much of it stays inside the page, however the page is resized. */
const EDGE = 48;

const NOTHING: EditHistory = { steps: [], done: 0 };

/** Inputs have an undo of their own, for what's being typed. */
function isTyping(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || target.matches("textarea, select, input:not([type=checkbox], [type=radio])");
}

/**
 * Recent edits to any file, in a small window that can be dragged around and fades while it's not used. The ones that
 * were undone are dark; clicking one undoes or redoes everything up to it. Ctrl+Z and Ctrl+Y work anywhere on the page.
 */
export function HistoryWindow() {
    const { api, status, readOnly } = useConnection();
    const { files } = useWorkspaceData();
    const actions = useActions();
    const [history, setHistory] = useState(NOTHING);
    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useStored("history.expanded", false);
    const [place, setPlace] = useStored("history.place", { right: 24, bottom: 24 });
    const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);
    const current = useRef<HTMLButtonElement>(null);

    // Every edit changes a file's revision, and closing one takes its edits out of the history.
    const revisions = Object.values(files).map((file) => `${file.id}:${file.revision}`).sort().join();
    useEffect(function loadHistory() {
        if (status !== "online" || readOnly) return;
        let cancelled = false;
        function show(loaded: EditHistory) {
            if (!cancelled) setHistory(loaded);
        }
        function showNothing() {
            // An older server has no history.
        }
        api.history().then(show, showNothing);
        return () => { cancelled = true; };
    }, [api, status, readOnly, revisions]);

    useEffect(function showCurrent() {
        current.current?.scrollIntoView({ block: "nearest" });
    }, [history, expanded]);

    const goTo = useCallback(async function goTo(step: number) {
        if (busy || step < 0 || step > history.steps.length || step === history.done) return;
        setBusy(true);
        try {
            const moved = await api.goToHistory(step === 0 ? 0 : history.steps[step - 1].id);
            setHistory(moved.history);
            actions.refreshed(moved.files);
        } catch (reason) {
            actions.toast("error", errorMessage(reason));
        } finally {
            setBusy(false);
        }
    }, [api, actions, busy, history]);

    useEffect(function watchKeys() {
        function undoOrRedo(event: KeyboardEvent) {
            if (!(event.ctrlKey || event.metaKey) || event.altKey || isTyping(event.target)) return;
            const key = event.key.toLowerCase();
            if (key !== "z" && key !== "y") return;
            event.preventDefault();
            const isRedo = key === "y" || event.shiftKey;
            void goTo(history.done + (isRedo ? 1 : -1));
        }
        addEventListener("keydown", undoOrRedo);
        return () => removeEventListener("keydown", undoOrRedo);
    }, [goTo, history.done]);

    if (readOnly || history.steps.length === 0) return null;

    function startDrag(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0 || (event.target as Element).closest("button")) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, ...place };
    }

    function moveDrag(event: PointerEvent<HTMLElement>) {
        const from = drag.current;
        if (!from) return;
        const keepInside = (value: number, size: number) => Math.max(0, Math.min(value, size - EDGE));
        setPlace({
            right: keepInside(from.right + from.x - event.clientX, innerWidth),
            bottom: keepInside(from.bottom + from.y - event.clientY, innerHeight),
        });
    }

    function endDrag() {
        drag.current = null;
    }

    function stepButton(step: number, label: string, title: string) {
        const isCurrent = step === history.done;
        let look = "hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70";
        if (isCurrent) look = "bg-accent-600 text-white";
        else if (step > history.done) look = "bg-black/15 opacity-40 hover:opacity-70 dark:bg-black/50";
        return (
            <li key={step} style={{ height: ROW_HEIGHT }}>
                <button
                    ref={isCurrent ? current : undefined}
                    type="button"
                    aria-current={isCurrent ? "step" : undefined}
                    title={title}
                    disabled={busy}
                    onClick={() => void goTo(step)}
                    className={`block w-full truncate rounded-md px-2.5 py-1 text-left text-xs transition ${look}`}
                >
                    {label}
                </button>
            </li>
        );
    }

    function rowOf({ label, files: names }: HistoryStep, index: number) {
        return stepButton(index + 1, label, `${label} · ${names.join(", ")}`);
    }

    const rows = expanded ? EXPANDED_ROWS : ROWS;
    const hasMore = history.steps.length + 1 > ROWS;
    return (
        <section
            aria-label="History"
            style={{
                width: WIDTH,
                right: `clamp(0px, ${place.right}px, calc(100vw - ${EDGE}px))`,
                bottom: `clamp(0px, ${place.bottom}px, calc(100vh - ${EDGE}px))`,
            }}
            className="fixed z-40 overflow-hidden rounded-xl border border-zinc-300 bg-white opacity-20 shadow-xl transition-opacity focus-within:opacity-100 hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900"
        >
            <header
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="flex cursor-grab touch-none select-none items-center justify-between px-3 py-1.5 active:cursor-grabbing"
            >
                <h2 className="text-xs font-semibold">History</h2>
                {hasMore && (
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        aria-expanded={expanded}
                        aria-label={expanded ? "Show fewer actions" : "Show more actions"}
                        title={expanded ? "Show fewer actions" : "Show more actions"}
                        className="btn-icon p-0.5"
                    >
                        <ChevronDown className={`size-4 transition ${expanded ? "rotate-180" : ""}`} />
                    </button>
                )}
            </header>
            <ol
                className="overflow-y-auto px-1 pb-1"
                style={{ maxHeight: `min(${rows * ROW_HEIGHT + 4}px, calc(100vh - 8rem))` }}
            >
                {stepButton(0, "Start", "As the files were before these actions")}
                {history.steps.map(rowOf)}
            </ol>
        </section>
    );
}
