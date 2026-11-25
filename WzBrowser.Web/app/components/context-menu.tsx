import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "./icons";

export type MenuItem =
    | { kind?: "item"; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
    | Submenu
    | { kind: "separator" };

/** Opens a menu of its own beside it. */
interface Submenu { kind: "submenu"; label: string; icon?: ReactNode; disabled?: boolean; items: MenuItem[] }

const PANEL = [
    "min-w-48 rounded-xl border border-zinc-200 bg-white p-1 text-[13px] shadow-lg outline-none",
    "dark:border-zinc-700 dark:bg-zinc-900",
].join(" ");
const ROW = [
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition disabled:opacity-40",
    "enabled:hover:bg-zinc-100 enabled:focus:bg-zinc-100",
    "dark:enabled:hover:bg-zinc-800 dark:enabled:focus:bg-zinc-800",
].join(" ");
const PLAIN = "text-zinc-700 dark:text-zinc-200";
const DANGER = "text-rose-600 dark:text-rose-400";
const ENABLED_ROW = "[role=menuitem]:not([disabled])";
/** A menu's own rows, not its submenus'. The row that opens a submenu is in a wrapper. */
const OWN_ROWS = `:scope > ${ENABLED_ROW}, :scope > [role=none] > ${ENABLED_ROW}`;
/** How close to the viewport's edges a menu gets. */
const MARGIN = 4;

function focusFirstRow(menu: HTMLElement | null) {
    menu?.querySelector<HTMLElement>(ENABLED_ROW)?.focus({ preventScroll: true });
}

/**
 * A menu at the pointer, opened by right-click. Rendered into <body> so a window's transform or overflow can't clip it,
 * and nudged back inside the viewport. Closes on a click elsewhere, Esc, scrolling, resizing or the page losing focus.
 * Arrow keys move between items and in and out of submenus, Enter picks one.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: x, top: y });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        setPos({
            left: Math.max(MARGIN, Math.min(x, innerWidth - width - MARGIN)),
            top: Math.max(MARGIN, Math.min(y, innerHeight - height - MARGIN)),
        });
        focusFirstRow(el);
    }, [x, y]);

    useEffect(() => {
        const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
        const close = () => onClose();
        // Capture, so a click that something else stops still closes the menu.
        addEventListener("pointerdown", away, true);
        addEventListener("contextmenu", away, true);
        addEventListener("scroll", away, true);
        addEventListener("resize", close);
        addEventListener("blur", close);
        return () => {
            removeEventListener("pointerdown", away, true);
            removeEventListener("contextmenu", away, true);
            removeEventListener("scroll", away, true);
            removeEventListener("resize", close);
            removeEventListener("blur", close);
        };
    }, [onClose]);

    return createPortal(
        <div ref={ref} style={pos} className="fixed z-[1000]">
            <MenuPanel items={items} onClose={onClose} />
        </div>,
        document.body,
    );
}

/** A menu's rows. `onBack` leaves a submenu for the row that opened it. */
function MenuPanel({ items, onClose, onBack }: { items: MenuItem[]; onClose: () => void; onBack?: () => void }) {
    const ref = useRef<HTMLDivElement>(null);

    function move(step: number) {
        const rows = [...(ref.current?.querySelectorAll<HTMLElement>(OWN_ROWS) ?? [])];
        if (rows.length === 0) return;
        const index = rows.indexOf(document.activeElement as HTMLElement);
        rows[(index + step + rows.length) % rows.length].focus();
    }

    function handleKey(event: KeyboardEvent) {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") onClose();
        else if (event.key === "ArrowDown") move(1);
        else if (event.key === "ArrowUp") move(-1);
        else if (event.key === "ArrowLeft" && onBack) onBack();
        else return;
        event.preventDefault();
    }

    function row(item: MenuItem, index: number) {
        if (item.kind === "separator")
            return <div key={index} role="separator" className="mx-2 my-1 h-px bg-zinc-100 dark:bg-zinc-800" />;
        if (item.kind === "submenu") return <SubmenuRow key={index} item={item} onClose={onClose} />;
        return (
            <button
                key={index}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => { onClose(); item.onSelect(); }}
                className={`${ROW} ${item.danger ? DANGER : PLAIN}`}
            >
                <span className="grid size-4 shrink-0 place-items-center text-zinc-400">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && <span className="pl-4 text-[11px] text-zinc-400">{item.shortcut}</span>}
            </button>
        );
    }

    return (
        <div
            ref={ref}
            role="menu"
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={handleKey}
            className={PANEL}
        >
            {items.map(row)}
        </div>
    );
}

/** A row that opens its submenu while it's pointed at, or on a click, Enter or the right arrow key. */
function SubmenuRow({ item, onClose }: { item: Submenu; onClose: () => void }) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    /** The submenu takes the focus once it's open. */
    const takesFocus = useRef(false);

    useLayoutEffect(function placePanel() {
        const element = panel.current;
        if (!open || !element) return;
        // Beside the row: on its other side when there's no room, and moved up to stay in the viewport.
        const box = element.getBoundingClientRect();
        if (box.right > innerWidth - MARGIN) {
            element.style.left = "auto";
            element.style.right = "100%";
        }
        const overflow = box.bottom - (innerHeight - MARGIN);
        if (overflow > 0) element.style.top = `${-overflow}px`;
        if (takesFocus.current) focusFirstRow(element);
        takesFocus.current = false;
    }, [open]);

    function enter() {
        if (open) {
            focusFirstRow(panel.current);
            return;
        }
        takesFocus.current = true;
        setOpen(true);
    }

    function handleKey(event: KeyboardEvent) {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        enter();
    }

    function goBack() {
        trigger.current?.focus();
        setOpen(false);
    }

    return (
        <div
            role="none"
            onPointerEnter={() => setOpen(!item.disabled)}
            onPointerLeave={() => setOpen(false)}
            className="relative"
        >
            <button
                ref={trigger}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={open}
                disabled={item.disabled}
                onClick={enter}
                onKeyDown={handleKey}
                className={`${ROW} ${PLAIN}`}
            >
                <span className="grid size-4 shrink-0 place-items-center text-zinc-400">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                <ChevronRight className="size-3.5 text-zinc-400" />
            </button>
            {open && (
                <div ref={panel} className="absolute left-full top-0 z-10">
                    <MenuPanel items={item.items} onClose={onClose} onBack={goBack} />
                </div>
            )}
        </div>
    );
}
