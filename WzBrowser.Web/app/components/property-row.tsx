import type { KeyboardEvent, ReactNode } from "react";

const ROW = "-mx-1.5 flex items-baseline justify-between gap-3 rounded-md px-1.5 outline-none";
const SELECTABLE = "cursor-default focus:bg-accent-50 focus:ring-1 focus:ring-accent-400 dark:focus:bg-accent-600/15";

/** Whether a key press asks to delete what's selected. */
export const isDeleteKey = (event: KeyboardEvent) => event.key === "Delete" || event.key === "Backspace";

/**
 * A property's name and value. With `onDelete`, clicking it selects (focuses) it, and Delete or Backspace then deletes
 * it. Keys typed into its value's input are left to the input.
 */
export function PropertyRow({ name, title, onDelete, children }: {
    name: string;
    title: string;
    onDelete?: () => void;
    children: ReactNode;
}) {
    function handleKey(event: KeyboardEvent<HTMLElement>) {
        if (!isDeleteKey(event)) return;
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        event.stopPropagation();
        // Holding the key down deletes one property, not one per repeat.
        if (!event.repeat) onDelete?.();
    }

    return (
        <span
            tabIndex={onDelete ? 0 : undefined}
            onKeyDown={onDelete && handleKey}
            className={`${ROW} ${onDelete ? SELECTABLE : ""}`}
        >
            <span className="max-w-[50%] shrink-0 truncate text-zinc-500" title={title}>{name}</span>
            {children}
        </span>
    );
}
