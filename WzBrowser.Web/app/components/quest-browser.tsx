import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { QuestSummary } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useActions } from "../lib/workspace";
import { Search, XMark } from "./icons";
import { QuestDetailView } from "./quest-detail";
import { inputClass } from "./ui";

const ROW_H = 40;
const OVERSCAN = 8;

/** Lists every quest as "{id} - {name}" and shows the selected quest's data beside it. */
export const QuestBrowser = memo(function QuestBrowser({ fileId, revision, onOpenRaw }: {
  fileId: string;
  revision: number;
  /** Switches to the raw tree and reveals this node, e.g. "Check.img/1000". */
  onOpenRaw: (path: string) => void;
}) {
  const { api, status } = useConnection();
  const { toast } = useActions();
  const [quests, setQuests] = useState<QuestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  // Links inside the detail pane are created once per quest, so they read the current selection through a ref.
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);

  // Refetch whenever the file's contents change (paste, delete, revert in the raw tree).
  useEffect(() => {
    if (status !== "online") return;
    let cancelled = false;
    api.quests(fileId).then(
      (list) => { if (!cancelled) { setQuests(list); setError(null); } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status, fileId, revision]);

  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!quests) return [];
    if (!needle) return quests;
    return quests.filter((q) => String(q.id).includes(needle) || q.name.toLowerCase().includes(needle) || `${q.id} - ${q.name}`.toLowerCase().includes(needle));
  }, [quests, needle]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedIndex = selected == null ? -1 : visible.findIndex((q) => q.id === selected);

  // Quest links: jump to another quest and remember where we came from so Back works.
  const [history, setHistory] = useState<number[]>([]);

  const goTo = (id: number) => {
    if (!quests) return;
    const index = quests.findIndex((q) => q.id === id);
    if (index < 0) { toast("error", `Quest ${id} isn't in this archive.`); return; }
    setFilter(""); // the target might be filtered out, so show everything and centre it
    setSelected(id);
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = Math.max(0, index * ROW_H - el.clientHeight / 2 + ROW_H / 2);
    });
  };

  const openQuest = useCallback((id: number) => {
    if (id === selectedRef.current) return;
    if (selectedRef.current != null) setHistory((h) => [...h.slice(-49), selectedRef.current!]);
    goTo(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests, toast]);

  const goBack = () => {
    const previous = history[history.length - 1];
    if (previous == null) return;
    setHistory((h) => h.slice(0, -1));
    goTo(previous);
  };
  const previousQuest = history.length ? quests?.find((q) => q.id === history[history.length - 1]) : undefined;

  // Clearing the search brings back every quest; keep the selected one centred so the user can look around it.
  const clearFilter = () => {
    setFilter("");
    const index = selected == null || !quests ? -1 : quests.findIndex((q) => q.id === selected);
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = index < 0 ? 0 : Math.max(0, index * ROW_H - el.clientHeight / 2 + ROW_H / 2);
    });
  };

  const scrollToIndex = (i: number) => {
    const el = listRef.current;
    if (!el) return;
    const top = i * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };

  const move = (to: number) => {
    const i = Math.max(0, Math.min(visible.length - 1, to));
    const q = visible[i];
    if (!q) return;
    setSelected(q.id);
    scrollToIndex(i);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const page = Math.max(1, Math.floor(viewportH / ROW_H) - 1);
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(selectedIndex < 0 ? 0 : selectedIndex + 1); break;
      case "ArrowUp": e.preventDefault(); move(selectedIndex < 0 ? 0 : selectedIndex - 1); break;
      case "PageDown": e.preventDefault(); move(selectedIndex + page); break;
      case "PageUp": e.preventDefault(); move(selectedIndex - page); break;
      case "Home": e.preventDefault(); move(0); break;
      case "End": e.preventDefault(); move(visible.length - 1); break;
    }
  };

  // Only the rows in (or near) view are rendered; the spacer keeps the scrollbar honest.
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col @xl:flex-row">
        <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-b border-zinc-100 @xl:max-h-none @xl:w-80 @xl:border-b-0 @xl:border-r dark:border-zinc-800">
          <div className="border-b border-zinc-100 p-3 dark:border-zinc-800">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={filter}
                onChange={(e) => { setFilter(e.target.value); if (listRef.current) listRef.current.scrollTop = 0; }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") clearFilter();
                  if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); move(selectedIndex < 0 ? 0 : selectedIndex + 1); }
                }}
                placeholder="Search by id or name…"
                aria-label="Search quests"
                className={`${inputClass} !rounded-lg !py-2 pl-10 ${filter ? "pr-10" : ""}`}
              />
              {filter && (
                <button
                  type="button"
                  onClick={(e) => { clearFilter(); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); }}
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                >
                  <XMark className="size-4" />
                </button>
              )}
            </label>
            <p className="mt-2 px-1 text-xs text-zinc-500">
              {quests ? (needle ? `${visible.length.toLocaleString()} of ${quests.length.toLocaleString()} quests` : `${quests.length.toLocaleString()} quests`) : error ? "" : "Loading…"}
            </p>
          </div>

          <div
            ref={listRef}
            role="listbox"
            aria-label="Quests"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="min-h-0 flex-1 overflow-auto outline-none"
          >
            {error && <p role="alert" className="p-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
            {!quests && !error && (
              <div className="space-y-2 p-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
            )}
            {quests && visible.length === 0 && <p className="px-4 py-10 text-center text-sm text-zinc-500">No quests match.</p>}
            <div style={{ height: visible.length * ROW_H, position: "relative" }}>
              {visible.slice(start, end).map((q, i) => {
                const index = start + i;
                const isSelected = q.id === selected;
                return (
                  <button
                    key={q.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-quest={q.id}
                    onClick={() => { setSelected(q.id); listRef.current?.focus({ preventScroll: true }); }}
                    style={{ position: "absolute", top: index * ROW_H, height: ROW_H, left: 0, right: 0 }}
                    className={`flex items-center gap-2 px-4 text-left text-[13px] transition ${
                      isSelected
                        ? "bg-accent-50 font-medium text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs tabular-nums text-zinc-500">{q.id}</span>
                      {" - "}
                      {q.name || <span className="italic text-zinc-400">(unnamed)</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {history.length > 0 && (
            <div className="sticky top-0 z-10 border-b border-zinc-100 bg-white/90 px-6 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
              <button type="button" onClick={goBack} className="flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-[13px] font-medium text-accent-700 transition hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-600/15">
                <span aria-hidden>←</span>
                <span className="truncate">Back to {previousQuest ? `${previousQuest.id} - ${previousQuest.name || "(unnamed)"}` : history[history.length - 1]}</span>
              </button>
            </div>
          )}
          {selected == null ? (
            <div className="grid h-full min-h-40 place-items-center p-8 text-center">
              <p className="max-w-xs text-sm leading-6 text-zinc-500">Pick a quest to see its requirements, dialogue and actions.</p>
            </div>
          ) : (
            <QuestDetailView fileId={fileId} revision={revision} questId={selected} onOpenRaw={onOpenRaw} onOpenQuest={openQuest} />
          )}
        </div>
      </div>
    </div>
  );
});
