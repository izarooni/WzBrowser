import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { MobLocation, MobLocations } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useScrollIntoView, type Focus } from "../lib/focus";
import { mapId, mobId, splitMapName } from "../lib/game-ids";
import { ChevronDown, ChevronRight, Search, XMark } from "./icons";
import { inputClass } from "./ui";

/** Rows rendered at a time; "Show more" adds another page. */
const PAGE = 150;
/** Map names shown on a collapsed row before "+N more". */
const PREVIEW_MAPS = 6;

/** Every mob with the maps it spawns in: its sprite, and each map's name and minimap. */
export const MobLocationTable = memo(function MobLocationTable({ focus, onShowMap }: {
  /** The mob another tab asked to show: it's opened and scrolled to. */
  focus: Focus | null;
  /** Shows the map in the Maps tab; without it the maps aren't links. */
  onShowMap?: (id: number) => void;
}) {
  const { api, status } = useConnection();
  const [data, setData] = useState<MobLocations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showUnknown, setShowUnknown] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [focused, setFocused] = useState<number | null>(null);
  const applied = useRef<Focus | null>(null);
  const scrollTo = useScrollIntoView();

  useEffect(() => {
    if (status !== "online" || data) return;
    let cancelled = false;
    api.mobLocations().then(
      (d) => { if (!cancelled) { setData(d); setError(null); } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status, data]);

  const mapName = (id: number) => data?.mapNames[id];
  const hasUnknown = useMemo(() => (data?.mobs ?? []).some((m) => !m.known), [data]);
  const pool = useMemo(() => (data?.mobs ?? []).filter((m) => showUnknown || m.known), [data, showUnknown]);

  const needle = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!needle || !data) return pool.map((mob) => ({ mob, hits: null as Set<number> | null }));
    const out: { mob: MobLocation; hits: Set<number> | null }[] = [];
    for (const mob of pool) {
      // A search that names the mob shows all its maps; one that names maps shows the mobs found there, those maps first.
      if (mobId(mob.id).includes(needle) || (mob.name?.toLowerCase().includes(needle) ?? false)) {
        out.push({ mob, hits: null });
        continue;
      }
      const hits = new Set(mob.maps.filter((m) => mapId(m).includes(needle) || (data.mapNames[m]?.toLowerCase().includes(needle) ?? false)));
      if (hits.size > 0) out.push({ mob, hits });
    }
    return out;
  }, [pool, needle, data]);

  // A new search starts back at the first page.
  const search = (value: string) => { setFilter(value); setLimit(PAGE); };

  // Another tab's link: clear the search, open the mob (showing mobs this install lacks if it's one), and scroll to it.
  useEffect(() => {
    if (!focus || !data || applied.current === focus) return;
    applied.current = focus;
    const mob = data.mobs.find((m) => m.id === focus.id);
    if (!mob) return;
    const unknown = showUnknown || !mob.known;
    setShowUnknown(unknown);
    setFilter("");
    setOpen((o) => new Set(o).add(mob.id));
    setLimit(Math.max(PAGE, data.mobs.filter((m) => unknown || m.known).indexOf(mob) + 1));
    setFocused(mob.id);
    scrollTo(`mob-location-${mob.id}`);
  }, [focus, data, showUnknown, scrollTo]);

  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-zinc-100 px-4 py-3 sm:px-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative block min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={filter}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") search(""); }}
              placeholder="Search by mob or map name, or id…"
              aria-label="Search mobs and maps"
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
          {hasUnknown && (
            <label
              className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400"
              title="Etc can list mobs this install's Mob data doesn't have; they have no sprite"
            >
              <input type="checkbox" checked={showUnknown} onChange={(e) => { setShowUnknown(e.target.checked); setLimit(PAGE); }} className="size-4 accent-accent-600" />
              Show mobs missing from this install
            </label>
          )}
        </div>
        <p className="px-1 text-xs text-zinc-500">
          {data ? (needle ? `${rows.length.toLocaleString()} of ${pool.length.toLocaleString()} mobs` : `${pool.length.toLocaleString()} mobs`) : error ? "" : "Loading…"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!data && !error && (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-16 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
        )}
        {data && rows.length === 0 && <p className="px-6 py-12 text-center text-sm text-zinc-500">No mobs match.</p>}

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.slice(0, limit).map(({ mob, hits }) => {
            const expanded = open.has(mob.id);
            // Maps the search named come first.
            const maps = hits ? [...mob.maps.filter((m) => hits.has(m)), ...mob.maps.filter((m) => !hits.has(m))] : mob.maps;
            return (
              <li key={mob.id} id={`mob-location-${mob.id}`} className={`scroll-mt-2 ${focused === mob.id ? "bg-accent-50/40 dark:bg-accent-600/5" : ""}`}>
                <button
                  type="button"
                  onClick={() => toggle(mob.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-zinc-50 sm:px-6 dark:hover:bg-zinc-800/50"
                >
                  <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    {mob.known && (
                      <img src={api.mobSpriteUrl(mob.id)} alt="" loading="lazy" className="max-h-16 max-w-16 object-contain [image-rendering:pixelated]"
                        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <span className="text-[13px] font-semibold">{mob.name || <span className="italic font-normal text-zinc-400">(unnamed)</span>}</span>
                      <span className="font-mono text-xs tabular-nums text-zinc-500">{mobId(mob.id)}</span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {maps.length} {maps.length === 1 ? "map" : "maps"}
                      </span>
                      {!mob.known && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Not in this install</span>
                      )}
                    </span>
                    {!expanded && (
                      <span className="flex flex-wrap gap-1.5">
                        {maps.slice(0, PREVIEW_MAPS).map((m) => (
                          <span
                            key={m}
                            className={`truncate rounded-md px-2 py-0.5 text-xs ${hits?.has(m)
                              ? "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
                              : "bg-zinc-50 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400"}`}
                          >
                            {splitMapName(mapName(m)).map ?? <span className="font-mono">{mapId(m)}</span>}
                          </span>
                        ))}
                        {maps.length > PREVIEW_MAPS && <span className="px-1 py-0.5 text-xs text-zinc-500">+{maps.length - PREVIEW_MAPS} more</span>}
                      </span>
                    )}
                  </span>
                  {expanded ? <ChevronDown className="size-4 shrink-0 text-zinc-400" /> : <ChevronRight className="size-4 shrink-0 text-zinc-400" />}
                </button>
                {expanded && (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 px-4 pb-4 sm:pl-[6.5rem] sm:pr-6">
                    {maps.map((m) => <MapCard key={m} id={m} name={mapName(m)} highlight={hits?.has(m) ?? false} onShow={onShowMap} />)}
                  </ul>
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

/** A map with its minimap and name; a link to the map's page in the Maps tab when `onShow` is given. */
export function MapCard({ id, name, highlight, onShow }: { id: number; name: string | undefined; highlight: boolean; onShow?: (id: number) => void }) {
  const { api } = useConnection();
  const [hasMinimap, setHasMinimap] = useState(true);
  const { street, map } = splitMapName(name);
  const body = (
    <>
      <div className="grid h-28 place-items-center bg-zinc-50 dark:bg-zinc-950/40">
        {hasMinimap
          ? <img src={api.mapMinimapUrl(id)} alt="" loading="lazy" className="max-h-28 max-w-full object-contain" onError={() => setHasMinimap(false)} />
          : <span className="text-xs text-zinc-400">No minimap</span>}
      </div>
      <div className="space-y-0.5 px-3 py-2">
        <p className="truncate text-[13px] font-medium" title={map ?? undefined}>{map ?? <span className="italic font-normal text-zinc-400">(unnamed)</span>}</p>
        <p className="flex items-baseline gap-2 text-xs text-zinc-500">
          {street && <span className="truncate" title={street}>{street}</span>}
          <span className="ml-auto shrink-0 font-mono tabular-nums">{mapId(id)}</span>
        </p>
      </div>
    </>
  );
  return (
    <li className={`overflow-hidden rounded-xl border bg-white transition dark:bg-zinc-900 ${highlight ? "border-accent-400 dark:border-accent-500/60" : "border-zinc-200 dark:border-zinc-800"} ${onShow ? "hover:border-accent-400 dark:hover:border-accent-500/60" : ""}`}>
      {onShow
        ? <button type="button" onClick={() => onShow(id)} title="Show this map's mobs and NPCs" className="block w-full text-left">{body}</button>
        : body}
    </li>
  );
}
