import { useState, type InputHTMLAttributes } from "react";
import { Folder, XMark } from "./icons";

// Folders files were opened from or written to, most recent first. Kept in the browser only; the server never sees
// them.
const RECENT_DIRS_KEY = "wzbrowser.recentDirs";
const MAX_RECENT_DIRS = 10;

export function readRecentDirs(): string[] {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(RECENT_DIRS_KEY) ?? "[]");
        return Array.isArray(value) ? value.filter((dir): dir is string => typeof dir === "string") : [];
    } catch {
        return [];
    }
}

function writeRecentDirs(dirs: string[]) {
    try {
        localStorage.setItem(RECENT_DIRS_KEY, JSON.stringify(dirs));
    } catch {
        // Not persisted.
    }
}

const sameDir = (a: string, b: string) =>
    a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

/** Puts a folder first in the recent list. */
export function rememberRecentDir(dir: string) {
    if (!dir.trim()) return;
    writeRecentDirs([dir, ...readRecentDirs().filter((known) => !sameDir(known, dir))].slice(0, MAX_RECENT_DIRS));
}

export function forgetRecentDir(dir: string) {
    writeRecentDirs(readRecentDirs().filter((known) => !sameDir(known, dir)));
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className">;

/**
 * A path box that lists the recent folders while it has focus. Picking one calls `onPick`; when that resolves false
 * (the folder is gone), it's dropped from the list. `above` opens the list upward, for a box near the bottom of a
 * dialog.
 */
export function RecentPathInput({ value, onChange, onPick, above = false, className = "", ...input }: InputProps & {
    value: string;
    onChange: (value: string) => void;
    onPick: (dir: string) => unknown;
    above?: boolean;
    className?: string;
}) {
    const [dirs, setDirs] = useState<string[]>([]);
    const [shown, setShown] = useState(false);
    const listed = shown && dirs.length > 0;

    function show() {
        setDirs(readRecentDirs());
        setShown(true);
    }

    function pick(dir: string) {
        setShown(false);
        Promise.resolve(onPick(dir)).then((ok) => {
            if (ok === false) forget(dir);
        });
    }

    function forget(dir: string) {
        forgetRecentDir(dir);
        setDirs(readRecentDirs());
    }

    const place = above ? "bottom-full mb-1.5" : "top-full mt-1.5";
    return (
        <div className={`relative min-w-0 flex-1 ${className}`}>
            <input
                {...input}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onFocus={show}
                onClick={show}
                onBlur={() => setShown(false)}
                onKeyDown={(event) => {
                    // Close the list first; a second Escape closes the dialog.
                    if (event.key === "Escape" && listed) {
                        event.preventDefault();
                        event.stopPropagation();
                        setShown(false);
                    } else if (event.key === "Enter") {
                        setShown(false);
                    }
                }}
                spellCheck={false}
                autoComplete="off"
                className="input font-mono"
            />
            {listed && (
                // mousedown is cancelled so clicking an item doesn't blur the input (which would hide the list first).
                <div
                    onMouseDown={(event) => event.preventDefault()}
                    className={[
                        `absolute inset-x-0 ${place} z-20 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg`,
                        "dark:border-zinc-700 dark:bg-zinc-900",
                    ].join(" ")}
                >
                    <p className="px-3 pb-1.5 pt-1 text-xs font-medium text-zinc-400">Recent folders</p>
                    <ul className="max-h-72 overflow-y-auto">
                        {dirs.map((dir) => (
                            <li
                                key={dir}
                                className="group flex items-center rounded-lg hover:bg-accent-50 dark:hover:bg-zinc-800"
                            >
                                <button
                                    type="button"
                                    title={dir}
                                    onClick={() => pick(dir)}
                                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm"
                                >
                                    <Folder className="size-4 shrink-0 text-amber-500" />
                                    <span className="truncate font-mono">{dir}</span>
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Remove ${dir} from recent folders`}
                                    onClick={() => forget(dir)}
                                    className={[
                                        "mr-1 rounded-md p-1.5 text-zinc-400 opacity-0 transition hover:bg-zinc-200",
                                        "hover:text-zinc-700 focus:opacity-100 group-hover:opacity-100",
                                        "dark:hover:bg-zinc-700 dark:hover:text-zinc-200",
                                    ].join(" ")}
                                >
                                    <XMark className="size-3.5" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
