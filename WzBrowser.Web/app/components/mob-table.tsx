import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Mob } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useScrollIntoView, type Focus } from "../lib/focus";
import { mobId } from "../lib/game-ids";
import { Search, XMark } from "./icons";
import { inputClass } from "./ui";

/** Rows rendered at a time; "Show more" adds another page. */
const PAGE = 150;

const ELEMENT: Record<string, string> = { F: "Fire", I: "Ice", L: "Lightning", S: "Poison", H: "Holy", D: "Dark", P: "Physical" };
const AFFINITY: Record<string, { label: string; className: string }> = {
  "1": { label: "Immune", className: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" },
  "2": { label: "Resists", className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  "3": { label: "Weak", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
};

/** "F2I3" -> each element and how the mob takes it; letters it doesn't know are shown as written. */
function parseElements(attr: string | null): { element: string; affinity: string }[] {
  return [...(attr ?? "").matchAll(/([A-Za-z])(\d)/g)].map(([, e, a]) => ({ element: ELEMENT[e.toUpperCase()] ?? e, affinity: a }));
}

type Column = {
  key: string;
  label: string;
  title?: string;
  value: (m: Mob) => number | string | null;
  render?: (m: Mob) => ReactNode;
  numeric?: boolean;
};

const num = (n: number) => n.toLocaleString();

const COLUMNS: readonly Column[] = [
  { key: "name", label: "Mob", value: (m) => m.name?.toLowerCase() ?? null },
  { key: "level", label: "Level", value: (m) => m.level, numeric: true },
  { key: "hp", label: "HP", value: (m) => m.maxHp, numeric: true },
  { key: "mp", label: "MP", value: (m) => m.maxMp, numeric: true },
  { key: "exp", label: "EXP", value: (m) => m.exp, numeric: true },
  { key: "pad", label: "Attack", title: "Physical attack (PADamage)", value: (m) => m.physicalAttack, numeric: true },
  { key: "mad", label: "M. Attack", title: "Magic attack (MADamage)", value: (m) => m.magicAttack, numeric: true },
  { key: "pdd", label: "Defense", title: "Physical defense (PDDamage)", value: (m) => m.physicalDefense, numeric: true },
  { key: "mdd", label: "M. Defense", title: "Magic defense (MDDamage)", value: (m) => m.magicDefense, numeric: true },
  { key: "acc", label: "Accuracy", value: (m) => m.accuracy, numeric: true },
  { key: "eva", label: "Avoid", value: (m) => m.avoid, numeric: true },
  { key: "speed", label: "Speed", value: (m) => m.speed, numeric: true },
  {
    key: "elements", label: "Elements", title: "How the mob takes each element (info/elemAttr)",
    value: (m) => m.elements,
    render: (m) => (
      <span className="flex flex-wrap gap-1">
        {parseElements(m.elements).map(({ element, affinity }) => (
          <span key={element} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${AFFINITY[affinity]?.className ?? "bg-zinc-100 dark:bg-zinc-800"}`}>
            {AFFINITY[affinity]?.label ?? affinity} {element}
          </span>
        ))}
      </span>
    ),
  },
];

type Sort = { key: string; desc: boolean } | null;

/** Every mob in the library with its stats, one row each, sortable by any column. */
export const MobTable = memo(function MobTable({ focus }: {
  /** The mob another tab asked to show: it's scrolled to and highlighted. */
  focus: Focus | null;
}) {
  const { api, status } = useConnection();
  const [mobs, setMobs] = useState<Mob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [bossesOnly, setBossesOnly] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  const [limit, setLimit] = useState(PAGE);
  const [focused, setFocused] = useState<number | null>(null);
  const applied = useRef<Focus | null>(null);
  const scrollTo = useScrollIntoView();

  useEffect(() => {
    if (status !== "online" || mobs) return;
    let cancelled = false;
    api.mobs().then(
      (d) => { if (!cancelled) { setMobs(d); setError(null); } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status, mobs]);

  const sorted = useMemo(() => {
    const list = mobs ?? [];
    const column = sort && COLUMNS.find((c) => c.key === sort.key);
    if (!column) return list;
    return [...list].sort((a, b) => {
      const x = column.value(a), y = column.value(b);
      if (x == null || y == null) return x == null ? (y == null ? a.id - b.id : 1) : -1; // missing values last either way
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (sort.desc ? -c : c) || a.id - b.id;
    });
  }, [mobs, sort]);

  const needle = filter.trim().toLowerCase();
  const rows = useMemo(
    () => sorted.filter((m) => (!bossesOnly || m.boss) && (!needle || mobId(m.id).includes(needle) || (m.name?.toLowerCase().includes(needle) ?? false))),
    [sorted, needle, bossesOnly],
  );

  // A new search or order starts back at the first page.
  const search = (value: string) => { setFilter(value); setLimit(PAGE); };
  const showBosses = (on: boolean) => { setBossesOnly(on); setLimit(PAGE); };

  // Numbers start from the biggest, names from A; a third click goes back to id order.
  const toggleSort = (c: Column) => {
    setSort((s) => {
      const first = !!c.numeric;
      if (s?.key !== c.key) return { key: c.key, desc: first };
      return s.desc === first ? { key: c.key, desc: !first } : null;
    });
    setLimit(PAGE);
  };

  // Another tab's link: clear the search (and "Bosses only" unless it's a boss), keep the order, and scroll to the mob.
  useEffect(() => {
    if (!focus || !mobs || applied.current === focus) return;
    applied.current = focus;
    const mob = mobs.find((m) => m.id === focus.id);
    if (!mob) return;
    const bosses = bossesOnly && mob.boss;
    setBossesOnly(bosses);
    setFilter("");
    setLimit(Math.max(PAGE, sorted.filter((m) => !bosses || m.boss).indexOf(mob) + 1));
    setFocused(mob.id);
    scrollTo(`mob-${mob.id}`);
  }, [focus, mobs, sorted, bossesOnly, scrollTo]);

  const headCell = "sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/95 p-0 text-xs font-semibold text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-300";

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
              placeholder="Search by mob name or id…"
              aria-label="Search mobs"
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
            <input type="checkbox" checked={bossesOnly} onChange={(e) => showBosses(e.target.checked)} className="size-4 accent-accent-600" />
            Bosses only
          </label>
        </div>
        <p className="px-1 text-xs text-zinc-500">
          {mobs ? (rows.length < mobs.length ? `${rows.length.toLocaleString()} of ${mobs.length.toLocaleString()} mobs` : `${mobs.length.toLocaleString()} mobs`) : error ? "" : "Loading…"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!mobs && !error && (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
        )}
        {mobs && (
          <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className={headCell}><span className="sr-only">Sprite</span></th>
                {COLUMNS.map((c) => {
                  const on = sort?.key === c.key;
                  return (
                    <th key={c.key} scope="col" aria-sort={on ? (sort.desc ? "descending" : "ascending") : "none"} className={headCell}>
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        title={`${c.title ?? c.label} — click to sort`}
                        className={`flex w-full items-center gap-1 whitespace-nowrap px-3 py-2.5 transition hover:text-zinc-900 dark:hover:text-zinc-100 ${c.numeric ? "justify-end" : ""} ${on ? "text-accent-700 dark:text-accent-300" : ""}`}
                      >
                        {c.label}
                        <span aria-hidden className={`w-3 text-center ${on ? "" : "text-zinc-300 dark:text-zinc-600"}`}>{on ? (sort.desc ? "↓" : "↑") : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((m) => (
                <tr key={m.id} id={`mob-${m.id}`} className={`scroll-mt-11 transition-colors ${focused === m.id ? "bg-accent-50/40 dark:bg-accent-600/5" : "hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"}`}>
                  <td className="border-b border-zinc-100 py-1 pl-4 pr-1 sm:pl-6 dark:border-zinc-800/70">
                    <span className="grid size-12 place-items-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                      <img src={api.mobSpriteUrl(m.id)} alt="" loading="lazy" className="max-h-12 max-w-12 object-contain [image-rendering:pixelated]"
                        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    </span>
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={`border-b border-zinc-100 px-3 py-1 dark:border-zinc-800/70 ${c.numeric ? "text-right tabular-nums" : ""}`}>
                      {c.key === "name" ? (
                        <span className="flex min-w-48 flex-col">
                          <span className="flex items-baseline gap-2">
                            <span className="font-semibold">{m.name || <span className="font-normal italic text-zinc-400">(unnamed)</span>}</span>
                            {m.boss && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Boss</span>}
                            {m.undead && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Undead</span>}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-zinc-500">
                            {mobId(m.id)}{m.link != null && <span title="Borrows its animations from this mob"> → {mobId(m.link)}</span>}
                          </span>
                        </span>
                      ) : c.render ? c.render(m) : c.numeric ? num(c.value(m) as number) : c.value(m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mobs && rows.length === 0 && <p className="px-6 py-12 text-center text-sm text-zinc-500">No mobs match.</p>}
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
