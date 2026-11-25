import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Fragment } from "react";
import { XMark } from "./icons";

/** `keys` holds alternatives split with " / ", each a key or keys pressed together. */
interface Shortcut { keys: string; does: string }
interface Group { title: string; shortcuts: Shortcut[] }

const GENERAL: Group[] = [
    {
        title: "Workspace",
        shortcuts: [
            { keys: "Drag", does: "Pan, on the empty background" },
            { keys: "Middle drag", does: "Pan from anywhere but the map" },
            { keys: "Double-click", does: "Maximize or restore, on a title bar" },
            { keys: "Ctrl+Z", does: "Undo" },
            { keys: "Ctrl+Y / Ctrl+Shift+Z", does: "Redo" },
        ],
    },
    {
        title: "Raw tree",
        shortcuts: [
            { keys: "Drag", does: "Copy nodes to another node or window" },
            { keys: "Shift+Drag", does: "Move them instead" },
            { keys: "Ctrl+Click", does: "Add a node to the selection or remove it" },
            { keys: "Shift+Click", does: "Select the nodes between" },
            { keys: "Ctrl+C / Ctrl+X / Ctrl+V", does: "Copy, cut, paste" },
            { keys: "Ctrl+S", does: "Save as a new file" },
            { keys: "Del", does: "Delete" },
            { keys: "↑ / ↓", does: "Previous or next node" },
            { keys: "← / →", does: "Collapse or expand" },
            { keys: "Home / End", does: "First or last node" },
        ],
    },
];

const MAP: Group[] = [
    {
        title: "View",
        shortcuts: [
            { keys: "Wheel", does: "Zoom at the pointer" },
            { keys: "Drag / Middle drag", does: "Pan" },
            { keys: "← / → / ↑ / ↓", does: "Pan, with nothing selected" },
        ],
    },
    {
        title: "Select",
        shortcuts: [
            { keys: "Click", does: "Select what's on top" },
            { keys: "Ctrl+Click / Shift+Click", does: "Add to the selection or remove from it" },
            { keys: "Alt+Click", does: "Select the next thing underneath" },
            { keys: "Shift+Drag", does: "Select everything in a box" },
            { keys: "Ctrl+A", does: "Select all that's shown" },
            { keys: "Esc", does: "Drop the drawing, then the tool, then the selection" },
        ],
    },
    {
        title: "Edit the selection",
        shortcuts: [
            { keys: "Drag", does: "Move" },
            { keys: "Alt+Drag", does: "Move without snapping" },
            { keys: "← / → / ↑ / ↓", does: "Move 1 pixel, or 10 with Shift" },
            { keys: "Ctrl+C / Ctrl+X / Ctrl+V", does: "Copy, cut, paste" },
            { keys: "Ctrl+D", does: "Duplicate" },
            { keys: "Ctrl+F", does: "Flip" },
            { keys: "+ / -", does: "Raise or lower an object's z" },
            { keys: "Del", does: "Delete" },
            { keys: "Right-click", does: "More actions" },
            { keys: "Ctrl+S", does: "Save as a new file" },
        ],
    },
    {
        title: "Draw shapes",
        shortcuts: [
            { keys: "Click", does: "Add a point" },
            { keys: "Enter / Right-click", does: "Finish" },
            { keys: "Esc", does: "Cancel" },
        ],
    },
];

function Keys({ keys }: { keys: string }) {
    return (
        <span className="flex flex-wrap items-center gap-1">
            {keys.split(" / ").map((combo, index) => (
                <Fragment key={combo}>
                    {index > 0 && <span className="text-zinc-400">/</span>}
                    <kbd className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                        {combo}
                    </kbd>
                </Fragment>
            ))}
        </span>
    );
}

function Column({ title, groups }: { title: string; groups: Group[] }) {
    return (
        <section className="space-y-5">
            <h3 className="text-sm font-semibold text-accent-700 dark:text-accent-200">{title}</h3>
            {groups.map((group) => (
                <div key={group.title} className="space-y-2">
                    <h4 className="text-xs font-medium text-zinc-500">{group.title}</h4>
                    <dl className="space-y-1.5">
                        {group.shortcuts.map(({ keys, does }) => (
                            <div key={keys} className="grid grid-cols-[11rem_1fr] items-baseline gap-3 text-[13px]">
                                <dt><Keys keys={keys} /></dt>
                                <dd className="text-zinc-600 dark:text-zinc-300">{does}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            ))}
        </section>
    );
}

/** Every keyboard and mouse shortcut, the map editor's in a column of their own. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    return (
        <Dialog open={open} onClose={onClose} className="relative z-50">
            <DialogBackdrop transition className="dialog-backdrop" />
            <div className="fixed inset-0 flex items-center justify-center p-6">
                <DialogPanel
                    transition
                    className="flex max-h-full w-full max-w-4xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl transition duration-200 data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-zinc-800 dark:bg-zinc-900"
                >
                    <div className="flex items-center justify-between gap-6 px-8 pt-6 pb-4">
                        <DialogTitle className="text-xl font-semibold">Shortcuts</DialogTitle>
                        <button type="button" onClick={onClose} aria-label="Close" className="btn-close">
                            <XMark className="size-5" />
                        </button>
                    </div>
                    <div className="grid gap-8 overflow-y-auto px-8 pb-8 md:grid-cols-2">
                        <Column title="General" groups={GENERAL} />
                        <Column title="Map editor" groups={MAP} />
                    </div>
                </DialogPanel>
            </div>
        </Dialog>
    );
}
