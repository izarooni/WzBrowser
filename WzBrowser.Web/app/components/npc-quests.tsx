import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { NpcQuest, NpcQuests } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useScrollIntoView, type Focus } from "../lib/focus";
import { npcId } from "../lib/game-ids";
import { ChevronDown, ChevronRight, Search, XMark } from "./icons";
import { MapCard } from "./mob-locations";
import { inputClass } from "./ui";

/** Rows rendered at a time; "Show more" adds another page. */
const PAGE = 150;
/** Quest names shown on a collapsed row before "+N more". */
const PREVIEW_QUESTS = 6;

/** Every NPC a quest starts or ends at: its sprite, the quests, each a link to that quest's page, and the maps it stands in. */
export const NpcQuestTable = memo(function NpcQuestTable({ onOpenQuest, focus, onShowMap }: {
  /** Shows the quest in its archive's tab. */
  onOpenQuest: (archive: string, quest: number) => void;
  /** The NPC another tab asked to show: it's opened and scrolled to. */
  focus: Focus | null;
  /** Shows the map in the Maps tab; without it the maps aren't links. */
  onShowMap?: (id: number) => void;
}) {
  const { api, status, maps: hasMaps } = useConnection();
  const [data, setData] = useState<NpcQuests[] | null>(null);
  // NPC id -> the maps it stands in, from the Map files; null until loaded (or when the library has none).
  const [npcMaps, setNpcMaps] = useState<{ maps: Map<number, number[]>; names: Map<number, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [focused, setFocused] = useState<number | null>(null);
  const applied = useRef<Focus | null>(null);
  const scrollTo = useScrollIntoView();

  useEffect(() => {
    if (status !== "online" || data) return;
    let cancelled = false;
    api.npcQuests().then(
      (d) => { if (!cancelled) { setData(d); setError(null); } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status, data]);

  useEffect(() => {
    if (status !== "online" || !hasMaps || npcMaps) return;
    let cancelled = false;
    // Without it the NPCs just don't list their maps.
    api.maps().then((d) => {
      if (cancelled) return;
      const maps = new Map<number, number[]>(), names = new Map<number, string>();
      for (const map of d.maps) {
        if (map.name) names.set(map.id, map.name);
        for (const n of map.npcs) {
          const list = maps.get(n);
          if (list) list.push(map.id); else maps.set(n, [map.id]);
        }
      }
      setNpcMaps({ maps, names });
    }, () => {});
    return () => { cancelled = true; };
  }, [api, status, hasMaps, npcMaps]);

  // Quests from more than one archive name theirs, so two quests with the same id can be told apart.
  const manyArchives = useMemo(() => new Set((data ?? []).flatMap((n) => n.quests.map((q) => q.archive))).size > 1, [data]);

  const needle = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!data) return [];
    if (!needle) return data.map((npc) => ({ npc, hits: null as Set<NpcQuest> | null }));
    const out: { npc: NpcQuests; hits: Set<NpcQuest> | null }[] = [];
    for (const npc of data) {
      // A search that names the NPC shows all its quests; one that names quests shows the NPCs that have them, those first.
      if (npcId(npc.id).includes(needle) || (npc.name?.toLowerCase().includes(needle) ?? false)) {
        out.push({ npc, hits: null });
        continue;
      }
      const hits = new Set(npc.quests.filter((q) => String(q.id).includes(needle) || q.name.toLowerCase().includes(needle)));
      if (hits.size > 0) out.push({ npc, hits });
    }
    return out;
  }, [data, needle]);

  // A new search starts back at the first page.
  const search = (value: string) => { setFilter(value); setLimit(PAGE); };

  // Another tab's link: clear the search, open the NPC and scroll to it.
  useEffect(() => {
    if (!focus || !data || applied.current === focus) return;
    applied.current = focus;
    const index = data.findIndex((n) => n.id === focus.id);
    if (index < 0) return;
    setFilter("");
    setOpen((o) => new Set(o).add(focus.id));
    setLimit(Math.max(PAGE, index + 1));
    setFocused(focus.id);
    scrollTo(`npc-${focus.id}`);
  }, [focus, data, scrollTo]);

  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-zinc-100 px-4 py-3 sm:px-6 dark:border-zinc-800">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={filter}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") search(""); }}
            placeholder="Search by NPC or quest name, or id…"
            aria-label="Search NPCs and quests"
            className={`${inputClass} !rounded-lg !py-2 pl-10 ${filter ? "pr-10" : ""}`}
          />
          {filter && (
            <button
              type="button"
              onClick={(e) => { search(""); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); }}
              aria-label="Clear search"
              title="Clear search (Esc)"
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <XMark className="size-4" />
            </button>
          )}
        </label>
        <p className="px-1 text-xs text-zinc-500">
          {data ? (needle ? `${rows.length.toLocaleString()} of ${data.length.toLocaleString()} NPCs` : `${data.length.toLocaleString()} NPCs`) : error ? "" : "Loading…"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!data && !error && (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-16 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
        )}
        {data && rows.length === 0 && <p className="px-6 py-12 text-center text-sm text-zinc-500">No NPCs match.</p>}

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.slice(0, limit).map(({ npc, hits }) => {
            const expanded = open.has(npc.id);
            // Quests the search named come first.
            const quests = hits ? [...npc.quests.filter((q) => hits.has(q)), ...npc.quests.filter((q) => !hits.has(q))] : npc.quests;
            const maps = npcMaps?.maps.get(npc.id) ?? [];
            return (
              <li key={npc.id} id={`npc-${npc.id}`} className={`scroll-mt-2 ${focused === npc.id ? "bg-accent-50/40 dark:bg-accent-600/5" : ""}`}>
                <button
                  type="button"
                  onClick={() => toggle(npc.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-zinc-50 sm:px-6 dark:hover:bg-zinc-800/50"
                >
                  <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <img src={api.npcSpriteUrl(npc.id)} alt="" loading="lazy" className="max-h-16 max-w-16 object-contain [image-rendering:pixelated]"
                      onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <span className="text-[13px] font-semibold">{npc.name || <span className="italic font-normal text-zinc-400">(unnamed)</span>}</span>
                      <span className="font-mono text-xs tabular-nums text-zinc-500">{npcId(npc.id)}</span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {quests.length} {quests.length === 1 ? "quest" : "quests"}
                      </span>
                      {npcMaps && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {maps.length} {maps.length === 1 ? "map" : "maps"}
                        </span>
                      )}
                    </span>
                    {!expanded && (
                      <span className="flex flex-wrap gap-1.5">
                        {quests.slice(0, PREVIEW_QUESTS).map((q) => (
                          <span
                            key={`${q.archive}/${q.id}`}
                            className={`truncate rounded-md px-2 py-0.5 text-xs ${hits?.has(q)
                              ? "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
                              : "bg-zinc-50 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400"}`}
                          >
                            {q.name || <span className="font-mono">{q.id}</span>}
                          </span>
                        ))}
                        {quests.length > PREVIEW_QUESTS && <span className="px-1 py-0.5 text-xs text-zinc-500">+{quests.length - PREVIEW_QUESTS} more</span>}
                      </span>
                    )}
                  </span>
                  {expanded ? <ChevronDown className="size-4 shrink-0 text-zinc-400" /> : <ChevronRight className="size-4 shrink-0 text-zinc-400" />}
                </button>
                {expanded && (
                  <div className="space-y-4 px-4 pb-4 sm:pl-[6.5rem] sm:pr-6">
                    <ul className="space-y-1">
                      {quests.map((q) => (
                        <li key={`${q.archive}/${q.id}`}>
                          <button
                            type="button"
                            onClick={() => onOpenQuest(q.archive, q.id)}
                            title="Show this quest"
                            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-[13px] transition hover:border-accent-400 hover:bg-accent-50/50 dark:hover:border-accent-500/60 dark:hover:bg-accent-600/10 ${hits?.has(q)
                              ? "border-accent-400 dark:border-accent-500/60"
                              : "border-zinc-200 dark:border-zinc-800"}`}
                          >
                            <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-zinc-500">{q.id}</span>
                            <span className="min-w-0 flex-1 truncate font-medium">{q.name || <span className="italic font-normal text-zinc-400">(unnamed)</span>}</span>
                            {manyArchives && <span className="hidden shrink-0 truncate font-mono text-[11px] text-zinc-400 sm:inline">{q.archive}</span>}
                            {q.starts && <Role>Starts</Role>}
                            {q.ends && <Role>Ends</Role>}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {npcMaps && (
                      <section className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Maps</h3>
                        {maps.length > 0
                          ? (
                            <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                              {maps.map((m) => <MapCard key={m} id={m} name={npcMaps.names.get(m)} highlight={false} onShow={onShowMap} />)}
                            </ul>
                          )
                          : <p className="text-[13px] text-zinc-500">No map places this NPC.</p>}
                      </section>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {rows.length > limit && (
          <div className="p-4 text-center">
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-[13px] font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Show more ({(rows.length - limit).toLocaleString()} left)
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

function Role({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </span>
  );
}
