import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Link } from "@remix-run/react";
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_API_BASE } from "../lib/api";
import { useConnection, type ConnectionStatus } from "../lib/connection";
import { useActions, useWorkspaceData } from "../lib/workspace";
import { FileMenu } from "./file-menu";
import { Moon, Sliders, Sun, XMark } from "./icons";
import { XmlExportDialog } from "./xml-export-dialog";

const THEME_KEY = "wzbrowser.theme";

function ThemeToggle() {
    const [dark, setDark] = useState(false);
    useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

    const toggle = () => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* not persisted */ }
        setDark(next);
    };

    return (
        <button
            type="button"
            onClick={toggle}
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            className="rounded-xl p-2.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
            {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </button>
    );
}

const statusStyle: Record<ConnectionStatus, { dot: string; label: string }> = {
    checking: { dot: "bg-amber-400 animate-pulse", label: "Connecting…" },
    online: { dot: "bg-emerald-500", label: "Connected" },
    offline: { dot: "bg-rose-500", label: "API offline" },
};

export function StatusPill({ onClick }: { onClick?: () => void }) {
    const { status, base } = useConnection();
    const s = statusStyle[status];
    return (
        <button
            type="button"
            onClick={onClick}
            title={base}
            className="flex items-center gap-2.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
            <span className={`size-2.5 rounded-full ${s.dot}`} />
            <span>{s.label}</span>
        </button>
    );
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { base, defaultBase, setBase, status, apiVersion, library, recheck } = useConnection();
    const [draft, setDraft] = useState(base);
    useEffect(() => { if (open) setDraft(base); }, [open, base]);

    const save = (value: string) => {
        setBase(value);
        recheck();
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} className="relative z-50">
            <DialogBackdrop transition className="dialog-backdrop" />
            <div className="fixed inset-0 flex items-center justify-center p-6">
                <DialogPanel
                    transition
                    className="w-full max-w-lg space-y-8 rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl transition duration-200 data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-zinc-800 dark:bg-zinc-900"
                >
                    <div className="flex items-start justify-between gap-6">
                        <div className="space-y-2">
                            <DialogTitle className="text-xl font-semibold">Connection</DialogTitle>
                            <p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                                WzBrowser reads files through a small program running on your computer. This page talks to it directly, so your files never leave your machine.
                            </p>
                        </div>
                        <button type="button" onClick={onClose} aria-label="Close" className="btn-close">
                            <XMark className="size-5" />
                        </button>
                    </div>

                    <form
                        className="space-y-6"
                        onSubmit={(e) => { e.preventDefault(); if (!library) save(draft); }}
                    >
                        <label className="block space-y-2.5">
                            <span className="text-sm font-medium">API address</span>
                            <input
                                value={library ? base : draft}
                                onChange={(e) => setDraft(e.target.value)}
                                readOnly={library}
                                spellCheck={false}
                                placeholder={defaultBase}
                                className={`input font-mono ${library ? "cursor-default opacity-70" : ""}`}
                            />
                            {library && <p className="text-xs text-zinc-500 dark:text-zinc-400">This server is set up to serve its own folder of files, so the address is fixed.</p>}
                        </label>

                        <div className="rounded-xl bg-zinc-50 p-5 text-sm leading-6 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                            {status === "online" ? (
                                <>Connected to WzBrowser API <span className="font-mono">v{apiVersion}</span>.</>
                            ) : (
                                <>
                                    Not connected. Start <span className="font-mono text-zinc-900 dark:text-zinc-200">WzBrowser.exe</span> on this computer
                                    {" "}— it listens on <span className="font-mono text-zinc-900 dark:text-zinc-200">{DEFAULT_API_BASE}</span> by default.
                                    If this page is hosted online, start it with{" "}
                                    <span className="font-mono text-zinc-900 dark:text-zinc-200">--allow-origin {typeof location !== "undefined" ? location.origin : "https://your-site"}</span>.
                                </>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2">
                            {library ? (
                                <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
                            ) : (
                                <>
                                    <button type="button" className="btn-secondary" onClick={() => save(defaultBase)}>Reset to default</button>
                                    <button type="submit" className="btn-primary">Save</button>
                                </>
                            )}
                        </div>
                    </form>
                </DialogPanel>
            </div>
        </Dialog>
    );
}

/** Shows what Ctrl+V would paste, so it's clear that copying in one window carries over to the next. */
function ClipboardChip() {
    const { clipboard, files } = useWorkspaceData();
    const { setClipboard } = useActions();
    if (!clipboard) return null;
    return (
        <div className="hidden max-w-xs items-center gap-2 rounded-full border border-accent-200 bg-accent-50 py-1.5 pl-4 pr-2 text-sm text-accent-700 md:flex dark:border-accent-600/40 dark:bg-accent-600/15 dark:text-accent-200">
            <span className="truncate" title={`${files[clipboard.fileId]?.name ?? ""}/${clipboard.path}`}>
                <span className="font-semibold">{clipboard.cut ? "Cut" : "Copied"}</span> {clipboard.name}
            </span>
            <button type="button" onClick={() => setClipboard(null)} aria-label="Clear clipboard" className="rounded-full p-1 transition hover:bg-accent-100 dark:hover:bg-accent-600/30">
                <XMark className="size-3.5" />
            </button>
        </div>
    );
}

export function AppShell({ children }: { children: ReactNode }) {
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [xmlOpen, setXmlOpen] = useState(false);
    const { status, readOnly, browseOnly } = useConnection();
    const { openPicker } = useActions();

    return (
        <div className="flex h-dvh flex-col">
            <header className="z-30 shrink-0 border-b border-zinc-200/80 bg-white/80 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/80">
                <div className="flex h-16 items-center justify-between gap-6 px-6">
                    <div className="flex items-center gap-4">
                        <Link to="/" className="flex items-center gap-3.5">
                            <img src="/icon-48.png" alt="" width={36} height={36} className="size-9" />
                            <span className="text-lg font-semibold tracking-tight">WzBrowser</span>
                        </Link>
                        <FileMenu />
                    </div>
                    <div className="flex items-center gap-3">
                        {readOnly && (
                            <span title="The server was started with --read-only, so files can be viewed but not changed" className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                View only
                            </span>
                        )}
                        {/* Browse-only viewers have no raw tree, so there's nothing to copy. */}
                        {!browseOnly && <ClipboardChip />}
                        <button type="button" className="btn-primary py-2" disabled={status !== "online"} onClick={openPicker}>
                            Open file…
                        </button>
                        {/* Converting writes to the server's disk, which a read only server never does. */}
                        {!readOnly && <button type="button" className="btn-secondary py-2" disabled={status !== "online"} onClick={() => setXmlOpen(true)}>Convert to XML…</button>}
                        <StatusPill onClick={() => setSettingsOpen(true)} />
                        <button
                            type="button"
                            onClick={() => setSettingsOpen(true)}
                            aria-label="Connection settings"
                            className="rounded-xl p-2.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                            <Sliders className="size-5" />
                        </button>
                        <ThemeToggle />
                    </div>
                </div>
            </header>

            <main className="relative min-h-0 flex-1">{children}</main>

            <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            <XmlExportDialog open={xmlOpen} onClose={() => setXmlOpen(false)} />
        </div>
    );
}
