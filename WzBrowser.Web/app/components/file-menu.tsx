import { useEffect, useRef, useState } from "react";
import type { OpenedFile } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useActions, useWorkspaceData } from "../lib/workspace";
import { ChevronDown, Document, Download, XMark } from "./icons";

const ITEM = [
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition",
    "disabled:opacity-40 enabled:hover:bg-zinc-100 enabled:focus-visible:bg-zinc-100",
    "dark:enabled:hover:bg-zinc-800 dark:enabled:focus-visible:bg-zinc-800",
].join(" ");
const PANEL = "rounded-xl border border-zinc-200 bg-white p-1 text-[13px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900";

/**
 * The header's File menu: every open file, with buttons to save it to a new file or close it, which lets the server let
 * go of it and leaves the menu open for closing more. Clicking a file opens its window, or brings it to the front if it has one.
 */
export function FileMenu() {
    const { files } = useWorkspaceData();
    const actions = useActions();
    const { api, status, readOnly } = useConnection();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const list = Object.values(files).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

    useEffect(function closeWhenLeft() {
        if (!open) return;

        function away(event: Event) {
            // Answering whether to close a file with unsaved changes leaves the menu open too.
            if (event.target instanceof Element && event.target.closest("#headlessui-portal-root")) return;
            if (!ref.current?.contains(event.target as Node)) setOpen(false);
        }

        function escape(event: KeyboardEvent) {
            if (event.key === "Escape" && !document.querySelector("#headlessui-portal-root [role=dialog]")) setOpen(false);
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

    function run(action: () => void) {
        setOpen(false);
        action();
    }

    function releaseUnlisted() {
        void api.releaseUnlisted().catch(() => {});
    }

    function show(file: OpenedFile) {
        // A file the server already had open before a reload has no window until it's opened here.
        actions.openFile(file);
        actions.showWindow(file.id);
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
                    role="menu"
                    aria-label="Open files"
                    className={`absolute left-0 top-full z-50 mt-1.5 w-72 ${PANEL}`}
                >
                    <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-zinc-400">
                        {list.length ? `Open files (${list.length})` : "No files open"}
                    </p>
                    <ul className="max-h-[70vh] overflow-y-auto">
                        {list.map((file) => (
                            <FileRow
                                key={file.id}
                                file={file}
                                readOnly={readOnly}
                                onShow={() => run(() => show(file))}
                                onSave={() => run(() => void actions.save(file.id))}
                                onClose={() => void actions.closeWindow(file.id)}
                            />
                        ))}
                    </ul>
                    {list.length === 0 && (
                        <button type="button" role="menuitem" className={ITEM} onClick={() => run(actions.openPicker)}>
                            Open file…
                        </button>
                    )}
                    <button
                        type="button"
                        role="menuitem"
                        title="Lets go of the files the server is holding without listing them here (String.wz read for names, sprites' pictures, ...), so they can be replaced on disk. They're read again when next needed."
                        className={`${ITEM} text-zinc-500 dark:text-zinc-400`}
                        onClick={() => run(releaseUnlisted)}
                    >
                        Release unlisted files
                    </button>
                </div>
            )}
        </div>
    );
}

/** One open file, with what can be done with it on the right. */
function FileRow({ file, readOnly, onShow, onSave, onClose }: {
    file: OpenedFile;
    readOnly: boolean;
    onShow: () => void;
    onSave: () => void;
    onClose: () => void;
}) {
    return (
        <li role="none" className="flex items-center gap-0.5">
            <button
                type="button"
                role="menuitem"
                title={`${file.path}

Click to open its window or bring it to the front`}
                onClick={onShow}
                className={`${ITEM} min-w-0 flex-1 text-zinc-700 dark:text-zinc-200`}
            >
                <Document className="size-4 shrink-0 text-zinc-400" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                {file.dirty && <span title="Unsaved changes" className="size-2 shrink-0 rounded-full bg-amber-500" />}
            </button>
            {!readOnly && (
                <button
                    type="button"
                    role="menuitem"
                    disabled={!file.dirty}
                    aria-label={`Save ${file.name}`}
                    title={file.dirty ? "Save: writes the changes to a new file; the original is untouched" : "Nothing to save"}
                    onClick={onSave}
                    className="btn-icon shrink-0 disabled:opacity-40"
                >
                    <Download className="size-4" />
                </button>
            )}
            <button
                type="button"
                role="menuitem"
                aria-label={`Close and release ${file.name}`}
                title="Close and release: closes its window and lets the server let go of the file"
                onClick={onClose}
                className="btn-icon shrink-0 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/20"
            >
                <XMark className="size-4" />
            </button>
        </li>
    );
}
