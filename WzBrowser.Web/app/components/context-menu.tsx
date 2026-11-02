import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuItem =
  | { kind?: "item"; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "separator" };

/**
 * A menu at the pointer, opened by right-click. Rendered into <body> so a window's transform or overflow can't clip it,
 * and nudged back inside the viewport. Closes on a click elsewhere, Esc, scrolling, resizing or the page losing focus.
 * Arrow keys move between items, Enter picks one.
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, innerWidth - width - 4)), top: Math.max(4, Math.min(y, innerHeight - height - 4)) });
    el.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus({ preventScroll: true });
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

  const move = (step: number) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    list[(i + step + list.length) % list.length].focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); onClose(); }
        else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      }}
      style={pos}
      className="fixed z-[1000] min-w-48 rounded-xl border border-zinc-200 bg-white p-1 text-[13px] shadow-lg outline-none dark:border-zinc-700 dark:bg-zinc-900"
    >
      {items.map((item, i) => item.kind === "separator" ? (
        <div key={i} role="separator" className="mx-2 my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
      ) : (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => { onClose(); item.onSelect(); }}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none transition disabled:opacity-40 enabled:hover:bg-zinc-100 enabled:focus:bg-zinc-100 dark:enabled:hover:bg-zinc-800 dark:enabled:focus:bg-zinc-800 ${
            item.danger ? "text-rose-600 dark:text-rose-400" : "text-zinc-700 dark:text-zinc-200"
          }`}
        >
          <span className="grid size-4 shrink-0 place-items-center text-zinc-400">{item.icon}</span>
          <span className="flex-1">{item.label}</span>
          {item.shortcut && <span className="pl-4 text-[11px] text-zinc-400">{item.shortcut}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
