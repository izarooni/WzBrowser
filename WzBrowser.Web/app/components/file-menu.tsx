import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { OpenedFile } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useActions, useWorkspaceData } from "../lib/workspace";
import { ChevronDown, ChevronRight, Document, Download, XMark } from "./icons";

const ITEM = [
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition",
    "disabled:opacity-40 enabled:hover:bg-zinc-100 enabled:focus-visible:bg-zinc-100",
    "dark:enabled:hover:bg-zinc-800 dark:enabled:focus-visible:bg-zinc-800",
].join(" ");
const PANEL = "rounded-xl border border-zinc-200 bg-white p-1 text-[13px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900";

/**
 * The header's File menu: every open file; hovering one shows what can be done with it (save it to a new file, or
 * close it, which lets the server let go of it). Clicking a file brings its window to the front.
 */
export function FileMenu() {
    const { files } = useWorkspaceData();
    const actions = useActions();
    const { status, readOnly } = useConnection();
    const [open, setOpen] = useState(false);
    // The hovered file, and how far down the panel its row is: its menu is drawn beside the panel rather than inside
    // the scrolling list, which would clip it.
    const [active, setActive] = useState<{ id: string; top: number } | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const activeFile = active ? files[active.id] : undefined;
    const list = Object.values(files).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

    useEffect(function closeWhenLeft() {
        if (!open) return;

        function away(event: Event) {
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        }

        function escape(event: globalThis.KeyboardEvent) {
            if (event.key === "Escape") setOpen(false);
        }

        addEventListener("pointerdown", away, true);
        addEventListener("keydown", escape);
        addEventListener("blur", away);
        return () => {
            removeEventListener("pointerdown", away, true);
            removeEventListener("keydown", escape);
            removeEventListener("blur", away);
        };
    }, [open]);

    useEffect(function forgetActive() {
        if (!open) setActive(null);
    }, [open]);

    function hover(id: string, row: HTMLElement) {
        const top = row.getBoundingClientRect().top - (panel.current?.getBoundingClientRect().top ?? 0);
        setActive({ id, top });
    }

    function run(action: () => void) {
        setOpen(false);
        action();
    }

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={status !== "online"}
                onClick={() => setOpen((shown) => !shown)}
                className={[
                    "flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-zinc-600 transition",
                    "hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-300",
                    "dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                    open ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" : "",
                ].join(" ")}
            >
                File
                <ChevronDown className="size-3.5" />
            </button>
            {open && (
                <div
                    ref={panel}
                    role="menu"
                    aria-label="Open files"
                    className={`absolute left-0 top-full z-50 mt-1.5 w-72 ${PANEL}`}
                >
                    <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-zinc-400">
                        {list.length ? `Open files (${list.length})` : "No files open"}
                    </p>
                    <ul className="max-h-[70vh] overflow-y-auto" onScroll={() => setActive(null)}>
                        {list.map((file) => (
                            <FileRow
                                key={file.id}
                                file={file}
                                active={active?.id === file.id}
                                onHover={(row) => hover(file.id, row)}
                                onShow={() => run(() => actions.showWindow(file.id))}
                            />
                        ))}
                    </ul>
                    {activeFile && active && (
                        <FileActions
                            file={activeFile}
                            top={active.top}
                            readOnly={readOnly}
                            onSave={() => run(() => void actions.save(activeFile.id))}
                            onClose={() => run(() => void actions.closeWindow(activeFile.id))}
                        />
                    )}
                    {list.length === 0 && (
                        <button type="button" role="menuitem" className={ITEM} onClick={() => run(actions.openPicker)}>
                            Open file…
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

/** One open file; hovering or focusing it shows its menu beside the list. */
function FileRow({ file, active, onHover, onShow }: {
    file: OpenedFile;
    active: boolean;
    onHover: (row: HTMLElement) => void;
    onShow: () => void;
}) {
    function openActions(event: KeyboardEvent<HTMLButtonElement>) {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        const row = event.currentTarget;
        onHover(row);
        const menu = () => row.closest("[role=menu]")?.querySelector<HTMLElement>(
            "[data-file-actions] [role=menuitem]:not([disabled])",
        );
        requestAnimationFrame(() => menu()?.focus());
    }

    return (
        <li>
            <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={active}
                title={`${file.path}

Click to bring its window to the front`}
                onMouseEnter={(event) => onHover(event.currentTarget)}
                onFocus={(event) => onHover(event.currentTarget)}
                onClick={onShow}
                onKeyDown={openActions}
                className={`${ITEM} text-zinc-700 dark:text-zinc-200 ${active ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
            >
                <Document className="size-4 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {file.dirty && <span title="Unsaved changes" className="size-2 shrink-0 rounded-full bg-amber-500" />}
                <ChevronRight className="size-3.5 shrink-0 text-zinc-400" />
            </button>
        </li>
    );
}

/** What can be done with an open file: save it to a new file, or close it so the server lets go of it. */
function FileActions({ file, top, readOnly, onSave, onClose }: {
    file: OpenedFile;
    top: number;
    readOnly: boolean;
    onSave: () => void;
    onClose: () => void;
}) {
    return (
        // Overlaps the list by a little, so the pointer can cross to it without leaving both.
        <div data-file-actions style={{ top: top - 5 }} className="absolute left-full -ml-1 pl-1">
            <div role="menu" aria-label={file.name} className={`w-56 ${PANEL}`}>
                <p className="truncate px-2.5 pb-1 pt-1.5 font-mono text-[11px] text-zinc-400" title={file.path}>
                    {file.path}
                </p>
                {!readOnly && (
                    <button
                        type="button"
                        role="menuitem"
                        disabled={!file.dirty}
                        title={file.dirty ? "Writes the changes to a new file; the original is untouched" : "Nothing to save"}
                        onClick={onSave}
                        className={`${ITEM} text-zinc-700 dark:text-zinc-200`}
                    >
                        <Download className="size-4 shrink-0 text-zinc-400" />
                        Save
                    </button>
                )}
                <button
                    type="button"
                    role="menuitem"
                    title="Closes its window and lets the server let go of the file"
                    onClick={onClose}
                    className={`${ITEM} text-rose-600 dark:text-rose-400`}
                >
                    <XMark className="size-4 shrink-0" />
                    Close and release
                </button>
            </div>
        </div>
    );
}
