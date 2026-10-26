import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { QuestSummary } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useActions } from "../lib/workspace";
import { Search, XMark } from "./icons";
import { QuestDetailView, QuestSelectionView } from "./quest-detail";
import { inputClass } from "./ui";

const ROW_H = 40;
const OVERSCAN = 8;

/** Lists every quest as "{id} - {name}" and shows the selected quest's data beside it. */
export const QuestBrowser = memo(function QuestBrowser({ fileId, revision, onOpenRaw, focus }: {
  fileId: string;
  revision: number;
  /** Switches to the raw tree and reveals this node, e.g. "Check.img/1000". */
  onOpenRaw?: (path: string) => void;
  /** A quest to show, picked from outside; each new object selects it once the list has loaded. */
  focus?: { quest: number } | null;
}) {
  const { api, status, readOnly } = useConnection();
  const { toast } = useActions();
  const [quests, setQuests] = useState<QuestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  // Links inside the detail pane are created once per quest, so they read the current selection through a ref.
  const selectedRef = useRef<number | null>(null);
  selectedRef.current = selected;

  // View-only viewers tick quests to see them summed up together, chain-style.
  const [checked, setChecked] = useState<number[]>([]);
  const [showSelection, setShowSelection] = useState(false);
  const toggleChecked = (id: number) => {
    setChecked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    setShowSelection(true);
  };
  const clearChecked = () => { setChecked([]); setShowSelection(false); };
  // Quests that vanished from the archive (e.g. after a revert) drop out of the selection.
  useEffect(() => {
    if (quests) setChecked((c) => { const kept = c.filter((id) => quests.some((q) => q.id === id)); return kept.length === c.length ? c : kept; });
  }, [quests]);
  const selectionShown = readOnly && showSelection && checked.length >= 2;

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
    setShowSelection(false);
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

  const focused = useRef<{ quest: number } | null>(null);
  useEffect(() => {
    if (!focus || !quests || focused.current === focus) return;
    focused.current = focus;
    openQuest(focus.quest);
  }, [focus, quests, openQuest]);

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
    setShowSelection(false);
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
      case " ": if (readOnly && selected != null) { e.preventDefault(); toggleChecked(selected); } break;
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
            <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-zinc-500">
              <p>{quests ? (needle ? `${visible.length.toLocaleString()} of ${quests.length.toLocaleString()} quests` : `${quests.length.toLocaleString()} quests`) : error ? "" : "Loading…"}</p>
              {readOnly && checked.length > 0 && (
                <p className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={checked.length < 2}
                    onClick={() => setShowSelection(true)}
                    title={checked.length < 2 ? "Tick another quest to see a summary" : "Show the selected quests' summary"}
                    className="rounded-md px-1.5 py-0.5 font-medium text-accent-700 transition hover:bg-accent-50 disabled:cursor-default disabled:text-zinc-500 disabled:hover:bg-transparent dark:text-accent-300 dark:hover:bg-accent-600/15"
                  >
                    {checked.length} selected
                  </button>
                  <button type="button" onClick={clearChecked} aria-label="Clear selection" title="Clear selection" className="rounded-md p-0.5 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300">
                    <XMark className="size-3.5" />
                  </button>
                </p>
              )}
            </div>
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
                const isSelected = q.id === selected && !selectionShown;
                const isChecked = readOnly && checked.includes(q.id);
                return (
                  <div
                    key={q.id}
                    role="option"
                    aria-selected={isSelected}
                    aria-checked={readOnly ? isChecked : undefined}
                    data-quest={q.id}
                    onClick={() => { setSelected(q.id); setShowSelection(false); listRef.current?.focus({ preventScroll: true }); }}
                    style={{ position: "absolute", top: index * ROW_H, height: ROW_H, left: 0, right: 0 }}
                    className={`flex cursor-pointer items-center gap-2.5 px-4 text-left text-[13px] transition ${
                      isSelected
                        ? "bg-accent-50 font-medium text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
                        : isChecked
                          ? "bg-zinc-50 dark:bg-zinc-800/40"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                    }`}
                  >
                    {readOnly && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        tabIndex={-1}
                        aria-label={`Select quest ${q.id}`}
                        title={`Quest ${q.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => { toggleChecked(q.id); listRef.current?.focus({ preventScroll: true }); }}
                        className="size-4 shrink-0 cursor-pointer accent-accent-600"
                      />
                    )}
                    <span className="min-w-0 truncate">
                      {!readOnly && <><span className="font-mono text-xs tabular-nums text-zinc-500">{q.id}</span>{" - "}</>}
                      {q.name || <span className="italic text-zinc-400">(unnamed)</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {history.length > 0 && !selectionShown && (
            <div className="sticky top-0 z-10 border-b border-zinc-100 bg-white/90 px-6 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
              <button type="button" onClick={goBack} className="flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-[13px] font-medium text-accent-700 transition hover:bg-accent-50 dark:text-accent-300 dark:hover:bg-accent-600/15">
                <span aria-hidden>←</span>
                <span className="truncate">Back to {previousQuest ? `${previousQuest.id} - ${previousQuest.name || "(unnamed)"}` : history[history.length - 1]}</span>
              </button>
            </div>
          )}
          {selectionShown ? (
            <QuestSelectionView fileId={fileId} revision={revision} questIds={checked} onOpenQuest={openQuest} onClear={clearChecked} />
          ) : selected == null ? (
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
