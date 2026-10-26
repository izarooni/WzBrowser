import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MapInfo, Maps } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useScrollIntoView, type Focus } from "../lib/focus";
import { mapId, mobId, npcId, splitMapName } from "../lib/game-ids";
import { ChevronDown, ChevronRight, Search, XMark } from "./icons";
import { inputClass } from "./ui";

/** Rows rendered at a time; "Show more" adds another page. */
const PAGE = 150;
/** Mob and NPC names shown on a collapsed row before "+N more". */
const PREVIEW_LIFE = 8;

/** A search hit inside a map: one of its mobs ("m{id}") or NPCs ("n{id}"). */
type Hits = Set<string>;

/** Every map with the mobs that spawn in it and the NPCs standing in it, each a link to its own tab. */
export const MapTable = memo(function MapTable({ focus, onShowMob, onShowNpc }: {
  /** The map another tab asked to show: it's opened and scrolled to. */
  focus: Focus | null;
  /** Shows the mob in the Mobs tab; without it the mobs aren't links. */
  onShowMob?: (id: number) => void;
  /** Shows the NPC in the NPCs tab; only NPCs with quests are listed there, so only they are links. */
  onShowNpc?: (id: number) => void;
}) {
  const { api, status } = useConnection();
  const [data, setData] = useState<Maps | null>(null);
  const [error, setError] = useState<string | null>(null);
  // NPC id -> how many quests it starts or ends; the NPCs tab lists only these.
  const [questNpcs, setQuestNpcs] = useState<Map<number, number> | null>(null);
  const [filter, setFilter] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [focused, setFocused] = useState<number | null>(null);
  const applied = useRef<Focus | null>(null);
  const scrollTo = useScrollIntoView();

  useEffect(() => {
    if (status !== "online" || data) return;
    let cancelled = false;
    api.maps().then(
      (d) => { if (!cancelled) { setData(d); setError(null); } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status, data]);

  const linksNpcs = !!onShowNpc;
  useEffect(() => {
    if (status !== "online" || !linksNpcs || questNpcs) return;
    let cancelled = false;
    // Without it NPCs just aren't links.
    api.npcQuests().then((npcs) => { if (!cancelled) setQuestNpcs(new Map(npcs.map((n) => [n.id, n.quests.length]))); }, () => {});
    return () => { cancelled = true; };
  }, [api, status, linksNpcs, questNpcs]);

  const mobName = (id: number) => data?.mobNames[id];
  const npcName = (id: number) => data?.npcNames[id];
  const isEmpty = (m: MapInfo) => m.mobs.length === 0 && m.npcs.length === 0;
  const pool = useMemo(() => (data?.maps ?? []).filter((m) => showEmpty || !isEmpty(m)), [data, showEmpty]);

  const needle = filter.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!needle || !data) return pool.map((map) => ({ map, hits: null as Hits | null }));
    const out: { map: MapInfo; hits: Hits | null }[] = [];
    for (const map of pool) {
      // A search that names the map shows it as is; one that names its mobs or NPCs shows the maps they're in, those first.
      if (mapId(map.id).includes(needle) || (map.name?.toLowerCase().includes(needle) ?? false)) {
        out.push({ map, hits: null });
        continue;
      }
      const hits: Hits = new Set([
        ...map.mobs.filter((m) => mobId(m.id).includes(needle) || (data.mobNames[m.id]?.toLowerCase().includes(needle) ?? false)).map((m) => `m${m.id}`),
        ...map.npcs.filter((n) => npcId(n).includes(needle) || (data.npcNames[n]?.toLowerCase().includes(needle) ?? false)).map((n) => `n${n}`),
      ]);
      if (hits.size > 0) out.push({ map, hits });
    }
    return out;
  }, [pool, needle, data]);

  // A new search starts back at the first page.
  const search = (value: string) => { setFilter(value); setLimit(PAGE); };

  // Another tab's link: clear the search, open the map (showing empty maps if it's one) and scroll to it.
  useEffect(() => {
    if (!focus || !data || applied.current === focus) return;
    applied.current = focus;
    const map = data.maps.find((m) => m.id === focus.id);
    if (!map) return;
    const empty = showEmpty || isEmpty(map);
    setShowEmpty(empty);
    setFilter("");
    setOpen((o) => new Set(o).add(map.id));
    setLimit(Math.max(PAGE, data.maps.filter((m) => empty || !isEmpty(m)).indexOf(map) + 1));
    setFocused(map.id);
    scrollTo(`map-${map.id}`);
  }, [focus, data, showEmpty, scrollTo]);

  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chip = (key: string, label: ReactNode, hit: boolean) => (
    <span
      key={key}
      className={`truncate rounded-md px-2 py-0.5 text-xs ${hit
        ? "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
        : "bg-zinc-50 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400"}`}
    >
      {label}
    </span>
  );

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
              placeholder="Search by map, mob or NPC name, or id…"
              aria-label="Search maps, mobs and NPCs"
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
          <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={showEmpty} onChange={(e) => { setShowEmpty(e.target.checked); setLimit(PAGE); }} className="size-4 accent-accent-600" />
            Show maps with no mobs or NPCs
          </label>
        </div>
        <p className="px-1 text-xs text-zinc-500">
          {data ? (needle ? `${rows.length.toLocaleString()} of ${pool.length.toLocaleString()} maps` : `${pool.length.toLocaleString()} maps`) : error ? "" : "Loading…"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!data && !error && (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-16 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
        )}
        {data && rows.length === 0 && <p className="px-6 py-12 text-center text-sm text-zinc-500">No maps match.</p>}

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.slice(0, limit).map(({ map, hits }) => {
            const expanded = open.has(map.id);
            const { street, map: title } = splitMapName(map.name ?? undefined);
            // Mobs and NPCs the search named come first.
            const first = <T,>(list: T[], key: (t: T) => string) => hits ? [...list.filter((t) => hits.has(key(t))), ...list.filter((t) => !hits.has(key(t)))] : list;
            const mobs = first(map.mobs, (m) => `m${m.id}`);
            const npcs = first(map.npcs, (n) => `n${n}`);
            const preview = [
              ...mobs.map((m) => chip(`m${m.id}`, mobName(m.id) ?? <span className="font-mono">{mobId(m.id)}</span>, hits?.has(`m${m.id}`) ?? false)),
              ...npcs.map((n) => chip(`n${n}`, npcName(n) ?? <span className="font-mono">{npcId(n)}</span>, hits?.has(`n${n}`) ?? false)),
            ];
            return (
              <li key={map.id} id={`map-${map.id}`} className={`scroll-mt-2 ${focused === map.id ? "bg-accent-50/40 dark:bg-accent-600/5" : ""}`}>
                <button
                  type="button"
                  onClick={() => toggle(map.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition hover:bg-zinc-50 sm:px-6 dark:hover:bg-zinc-800/50"
                >
                  <span className="min-w-0 flex-1 space-y-1.5">
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <span className="text-[13px] font-semibold">{title || <span className="italic font-normal text-zinc-400">(unnamed)</span>}</span>
                      {street && <span className="text-xs text-zinc-500">{street}</span>}
                      <span className="font-mono text-xs tabular-nums text-zinc-500">{mapId(map.id)}</span>
                      {mobs.length > 0 && <Badge>{mobs.length} {mobs.length === 1 ? "mob" : "mobs"}</Badge>}
                      {npcs.length > 0 && <Badge>{npcs.length} {npcs.length === 1 ? "NPC" : "NPCs"}</Badge>}
                    </span>
                    {!expanded && preview.length > 0 && (
                      <span className="flex flex-wrap gap-1.5">
                        {preview.slice(0, PREVIEW_LIFE)}
                        {preview.length > PREVIEW_LIFE && <span className="px-1 py-0.5 text-xs text-zinc-500">+{preview.length - PREVIEW_LIFE} more</span>}
                      </span>
                    )}
                  </span>
                  {expanded ? <ChevronDown className="size-4 shrink-0 text-zinc-400" /> : <ChevronRight className="size-4 shrink-0 text-zinc-400" />}
                </button>
                {expanded && (
                  <div className="flex flex-col gap-4 px-4 pb-4 sm:flex-row sm:items-start sm:px-6">
                    <Minimap id={map.id} />
                    <div className="min-w-0 flex-1 space-y-4">
                      {mobs.length === 0 && npcs.length === 0 && <p className="text-[13px] text-zinc-500">No mobs spawn here and no NPCs stand here.</p>}
                      {mobs.length > 0 && (
                        <Section title="Mobs">
                          {mobs.map((m) => (
                            <LifeCard
                              key={m.id}
                              sprite={api.mobSpriteUrl(m.id)}
                              name={mobName(m.id)}
                              id={mobId(m.id)}
                              note={m.count > 0 ? `×${m.count}` : "Listed in Etc"}
                              noteTitle={m.count > 0 ? `${m.count} spawn ${m.count === 1 ? "point" : "points"} in this map` : "Etc's MobLocation.img lists it here, but the map's life doesn't place it"}
                              highlight={hits?.has(`m${m.id}`) ?? false}
                              onClick={onShowMob && (() => onShowMob(m.id))}
                              linkTitle="Show this mob's stats"
                            />
                          ))}
                        </Section>
                      )}
                      {npcs.length > 0 && (
                        <Section title="NPCs">
                          {npcs.map((n) => {
                            const quests = questNpcs?.get(n);
                            return (
                              <LifeCard
                                key={n}
                                sprite={api.npcSpriteUrl(n)}
                                name={npcName(n)}
                                id={npcId(n)}
                                note={quests ? `${quests} ${quests === 1 ? "quest" : "quests"}` : null}
                                highlight={hits?.has(`n${n}`) ?? false}
                                onClick={onShowNpc && quests ? () => onShowNpc(n) : undefined}
                                linkTitle="Show this NPC's quests and maps"
                              />
                            );
                          })}
                        </Section>
                      )}
                    </div>
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

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">{children}</ul>
    </section>
  );
}

function Minimap({ id }: { id: number }) {
  const { api } = useConnection();
  const [hasMinimap, setHasMinimap] = useState(true);
  return (
    <div className="grid h-40 shrink-0 place-items-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 sm:w-64 dark:border-zinc-800 dark:bg-zinc-950/40">
      {hasMinimap
        ? <img src={api.mapMinimapUrl(id)} alt="" loading="lazy" className="max-h-40 max-w-full object-contain" onError={() => setHasMinimap(false)} />
        : <span className="text-xs text-zinc-400">No minimap</span>}
    </div>
  );
}

/** A mob or NPC in the map: its sprite, name and id, and a link to its own tab when `onClick` is given. */
function LifeCard({ sprite, name, id, note, noteTitle, highlight, onClick, linkTitle }: {
  sprite: string;
  name: string | undefined;
  id: string;
  note: string | null;
  noteTitle?: string;
  highlight: boolean;
  onClick?: () => void;
  linkTitle: string;
}) {
  const body = (
    <>
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
        <img src={sprite} alt="" loading="lazy" className="max-h-12 max-w-12 object-contain [image-rendering:pixelated]"
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium" title={name}>{name || <span className="italic font-normal text-zinc-400">(unnamed)</span>}</span>
        <span className="flex items-baseline gap-2 text-xs text-zinc-500">
          <span className="font-mono tabular-nums">{id}</span>
          {note && <span className="ml-auto shrink-0" title={noteTitle}>{note}</span>}
        </span>
      </span>
    </>
  );
  const frame = `flex w-full items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition ${highlight
    ? "border-accent-400 dark:border-accent-500/60"
    : "border-zinc-200 dark:border-zinc-800"}`;
  return (
    <li>
      {onClick
        ? <button type="button" onClick={onClick} title={linkTitle} className={`${frame} hover:border-accent-400 hover:bg-accent-50/50 dark:hover:border-accent-500/60 dark:hover:bg-accent-600/10`}>{body}</button>
        : <div className={frame}>{body}</div>}
    </li>
  );
}
