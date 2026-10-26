import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item, ItemCategory } from "../lib/api";
import { useConnection } from "../lib/connection";
import { Search, XMark } from "./icons";
import { SkillText } from "./skill-table";
import { inputClass } from "./ui";

/** Rows rendered at a time; "Show more" adds another page. */
const PAGE = 150;

const CATEGORIES: readonly { key: ItemCategory; label: string }[] = [
  { key: "equip", label: "Equip" },
  { key: "use", label: "Use" },
  { key: "setup", label: "Set-up" },
  { key: "etc", label: "Etc" },
  { key: "cash", label: "Cash" },
];

/** Character's equipment folders, in the order the slot filter lists them; folders not named here follow as written. */
const SLOT_LABEL: Record<string, string> = {
  Weapon: "Weapon", Cap: "Hat", Coat: "Top", Longcoat: "Overall", Pants: "Bottom", Shoes: "Shoes", Glove: "Gloves",
  Shield: "Shield", Cape: "Cape", Accessory: "Accessory", Ring: "Ring", PetEquip: "Pet Equip", TamingMob: "Mount",
};
const SLOTS = Object.keys(SLOT_LABEL);

/** What equipment and scrolls add (info/inc*); a few installs write attack as incWAT. */
const BONUS: readonly [string, string][] = [
  ["incSTR", "STR"], ["incDEX", "DEX"], ["incINT", "INT"], ["incLUK", "LUK"], ["incMHP", "HP"], ["incMMP", "MP"],
  ["incPAD", "Attack"], ["incWAT", "Attack"], ["incMAD", "M. Attack"], ["incPDD", "Defense"], ["incMDD", "M. Defense"],
  ["incACC", "Accuracy"], ["incEVA", "Avoid"], ["incCraft", "Hands"], ["incSpeed", "Speed"], ["incJump", "Jump"],
  ["incCRT", "Critical %"], ["incCRD", "Critical damage"],
];
/** What using an item does (spec/*); `R` ones are a share of the maximum. */
const EFFECT: readonly [string, string][] = [
  ["hp", "HP"], ["mp", "MP"], ["pad", "Attack"], ["mad", "M. Attack"], ["pdd", "Defense"], ["mdd", "M. Defense"],
  ["acc", "Accuracy"], ["eva", "Avoid"], ["speed", "Speed"], ["jump", "Jump"], ["indieSpeed", "Speed"], ["indieJump", "Jump"],
];
const REQUIRE: readonly [string, string][] = [["reqSTR", "STR"], ["reqDEX", "DEX"], ["reqINT", "INT"], ["reqLUK", "LUK"], ["reqPOP", "Fame"]];
/** info flags (set to 1) shown as badges beside the name. */
const FLAGS: readonly [string, string, string][] = [
  ["cash", "Cash", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
  ["quest", "Quest", "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"],
  ["only", "One of a kind", "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"],
  ["tradeBlock", "Untradeable", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
  ["accountSharable", "Account-shared", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
  ["notSale", "Can't be sold", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
  ["timeLimited", "Time-limited", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
  ["expireOnLogout", "Expires on logout", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
];

/** info/reqJob is a mask of classes; 0 is everyone and -1 Beginners only. */
const JOB_BITS: readonly [number, string][] = [[1, "Warrior"], [2, "Magician"], [4, "Bowman"], [8, "Thief"], [16, "Pirate"]];
function jobs(mask: number | undefined): string | null {
  if (!mask) return null;
  if (mask === -1) return "Beginner";
  return JOB_BITS.filter(([bit]) => mask & bit).map(([, name]) => name).join(", ") || null;
}

/** info/attackSpeed as the client words it (2 fastest, 9 slowest). */
function attackSpeed(n: number): string {
  return `${n <= 3 ? "Faster" : n <= 5 ? "Fast" : n === 6 ? "Normal" : n <= 8 ? "Slow" : "Slower"} (${n})`;
}

/** spec/time is in milliseconds. */
function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${+(s / 3600).toFixed(1)} h`;
}

const num = (n: number) => n.toLocaleString();
const signed = (n: number) => (n < 0 ? num(n) : `+${num(n)}`);
const itemId = (id: number) => String(id).padStart(7, "0");
const level = (i: Item) => i.stats.reqLevel ?? 0;

function Chip({ tone, children }: { tone: "bonus" | "effect" | "plain"; children: ReactNode }) {
  const cls = tone === "bonus"
    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
    : tone === "effect"
      ? "bg-accent-50 text-accent-800 dark:bg-accent-600/15 dark:text-accent-200"
      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${cls}`}>{children}</span>;
}

/** The item's numbers worth reading: requirements, what it adds or does, its upgrade slots and how many stack. */
function Stats({ item }: { item: Item }) {
  const s = item.stats, e = item.effects ?? {};
  const chips: ReactNode[] = [];
  for (const [key, label] of BONUS) if (s[key]) chips.push(<Chip key={key} tone="bonus">{label} {signed(s[key])}</Chip>);
  for (const [key, label] of EFFECT) if (e[key]) chips.push(<Chip key={`e-${key}`} tone="effect">{label} {signed(e[key])}</Chip>);
  if (e.hpR) chips.push(<Chip key="hpR" tone="effect">HP +{e.hpR}%</Chip>);
  if (e.mpR) chips.push(<Chip key="mpR" tone="effect">MP +{e.mpR}%</Chip>);
  if (e.time) chips.push(<Chip key="time" tone="effect">for {duration(e.time)}</Chip>);
  if (e.moveTo) chips.push(<Chip key="moveTo" tone="effect">{e.moveTo === 999999999 ? "Returns to the nearest town" : `Moves to map ${e.moveTo}`}</Chip>);
  if (e.morph) chips.push(<Chip key="morph" tone="effect">Transforms</Chip>);
  if (s.recoveryHP) chips.push(<Chip key="recoveryHP" tone="effect">Recovers {num(s.recoveryHP)} HP</Chip>);
  if (s.recoveryMP) chips.push(<Chip key="recoveryMP" tone="effect">Recovers {num(s.recoveryMP)} MP</Chip>);
  if (s.success != null && s.success !== 0) chips.push(<Chip key="success" tone="plain">{s.success}% success</Chip>);
  if (s.cursed) chips.push(<Chip key="cursed" tone="plain">{s.cursed}% destroyed</Chip>);
  if (s.tuc) chips.push(<Chip key="tuc" tone="plain">{s.tuc} upgrade slot{s.tuc === 1 ? "" : "s"}</Chip>);
  if (s.attackSpeed) chips.push(<Chip key="attackSpeed" tone="plain">Speed {attackSpeed(s.attackSpeed)}</Chip>);
  if (s.slotMax && s.slotMax > 1) chips.push(<Chip key="slotMax" tone="plain">Stacks to {num(s.slotMax)}</Chip>);
  if (s.life && Math.floor(item.id / 10000) === 500) chips.push(<Chip key="life" tone="plain">Lives {s.life} days</Chip>);

  const required = REQUIRE.filter(([key]) => s[key]).map(([key, label]) => `${label} ${num(s[key])}`);
  const job = jobs(s.reqJob);
  if (job) required.push(job);

  if (chips.length === 0 && required.length === 0) return <span className="text-zinc-400">—</span>;
  return (
    <span className="flex min-w-56 max-w-md flex-col gap-1">
      {chips.length > 0 && <span className="flex flex-wrap gap-1">{chips}</span>}
      {required.length > 0 && <span className="text-xs text-zinc-500">Needs {required.join(" · ")}</span>}
    </span>
  );
}

type Column = { key: string; label: string; title?: string; value: (i: Item) => number | string | null; numeric?: boolean };

const NAME: Column = { key: "name", label: "Item", value: (i) => i.name?.toLowerCase() ?? null };
const LEVEL: Column = { key: "level", label: "Level", title: "Required level (info/reqLevel)", value: level, numeric: true };
// A price of 0 means it doesn't say, so those sort last either way.
const PRICE: Column = { key: "price", label: "Price", title: "What a shop pays for it (info/price)", value: (i) => i.price || null, numeric: true };
const SORTABLE = [NAME, LEVEL, PRICE];

type Sort = { key: string; desc: boolean } | null;
type Loaded = Item[] | { error: string };

/** Every item in the library, a sub-tab per inventory tab, with stats and descriptions; sortable by name, level and price. */
export const ItemTable = memo(function ItemTable() {
  const { api, status } = useConnection();
  const [category, setCategory] = useState<ItemCategory>("equip");
  const [loaded, setLoaded] = useState<Partial<Record<ItemCategory, Loaded>>>({});
  const [filter, setFilter] = useState("");
  const [slot, setSlot] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>(null);
  const [limit, setLimit] = useState(PAGE);

  // Each sub-tab's items are fetched the first time it's opened, then kept.
  useEffect(() => {
    if (status !== "online" || category in loaded) return;
    let cancelled = false;
    api.items(category).then(
      (list) => { if (!cancelled) setLoaded((l) => ({ ...l, [category]: list })); },
      (e) => { if (!cancelled) setLoaded((l) => ({ ...l, [category]: { error: e instanceof Error ? e.message : String(e) } })); },
    );
    return () => { cancelled = true; };
  }, [api, status, category, loaded]);

  const current = loaded[category];
  const items = Array.isArray(current) ? current : null;
  const error = current && !Array.isArray(current) ? current.error : null;

  const slots = useMemo(() => {
    if (category !== "equip" || !items) return [];
    const present = new Set(items.map((i) => i.slot).filter((s): s is string => !!s));
    return [...SLOTS.filter((s) => present.has(s)), ...[...present].filter((s) => !SLOTS.includes(s)).sort()];
  }, [category, items]);
  const hasLevels = useMemo(() => (items ?? []).some((i) => level(i) > 0), [items]);

  const sorted = useMemo(() => {
    const list = items ?? [];
    const column = sort && SORTABLE.find((c) => c.key === sort.key);
    if (!column) return list;
    return [...list].sort((a, b) => {
      const x = column.value(a), y = column.value(b);
      if (x == null || y == null) return x == null ? (y == null ? a.id - b.id : 1) : -1; // missing values last either way
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (sort.desc ? -c : c) || a.id - b.id;
    });
  }, [items, sort]);

  const needle = filter.trim().toLowerCase();
  const rows = useMemo(
    () => sorted.filter((i) => (!slot || i.slot === slot) && (!needle || itemId(i.id).includes(needle)
      || (i.name?.toLowerCase().includes(needle) ?? false) || (i.desc?.toLowerCase().includes(needle) ?? false))),
    [sorted, slot, needle],
  );

  // A new search, filter, order or sub-tab starts back at the first page.
  const search = (value: string) => { setFilter(value); setLimit(PAGE); };
  const pickSlot = (s: string | null) => { setSlot(s); setLimit(PAGE); };
  const pickCategory = (c: ItemCategory) => { setCategory(c); setSlot(null); setLimit(PAGE); };

  // Numbers start from the biggest, names from A; a third click goes back to id order.
  const toggleSort = (c: Column) => {
    setSort((s) => {
      const first = !!c.numeric;
      if (s?.key !== c.key) return { key: c.key, desc: first };
      return s.desc === first ? { key: c.key, desc: !first } : null;
    });
    setLimit(PAGE);
  };

  const headCell = "sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/95 p-0 text-xs font-semibold text-zinc-600 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-300";
  const plainHead = `${headCell} whitespace-nowrap px-3 py-2.5 text-left`;
  const cell = "border-b border-zinc-100 px-3 py-1.5 align-top dark:border-zinc-800/70";
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
    on
      ? "border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-500/60 dark:bg-accent-600/15 dark:text-accent-200"
      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
  }`;

  const sortHead = (c: Column) => {
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
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Inventory tab" className="flex shrink-0 gap-1 overflow-x-auto border-b border-zinc-200 px-4 sm:px-6 dark:border-zinc-800">
        {CATEGORIES.map((c) => {
          const on = c.key === category;
          const list = loaded[c.key];
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => pickCategory(c.key)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                on ? "border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {c.label}
              {Array.isArray(list) && <span className="ml-1.5 text-xs tabular-nums text-zinc-400">{list.length.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>

      <div className="shrink-0 space-y-3 border-b border-zinc-100 px-4 py-3 sm:px-6 dark:border-zinc-800">
        <label className="relative block min-w-0">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={filter}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") search(""); }}
            placeholder="Search by name, id or description…"
            aria-label="Search items"
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
        {slots.length > 1 && (
          <div role="group" aria-label="Slot" className="flex gap-2 overflow-x-auto pb-0.5">
            <button type="button" aria-pressed={slot === null} onClick={() => pickSlot(null)} className={chip(slot === null)}>All</button>
            {slots.map((s) => (
              <button key={s} type="button" aria-pressed={slot === s} onClick={() => pickSlot(slot === s ? null : s)} className={chip(slot === s)}>
                {SLOT_LABEL[s] ?? s}
              </button>
            ))}
          </div>
        )}
        <p className="px-1 text-xs text-zinc-500">
          {items ? (rows.length < items.length ? `${rows.length.toLocaleString()} of ${items.length.toLocaleString()} items` : `${items.length.toLocaleString()} items`) : error ? "" : "Loading…"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!current && (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
        )}
        {items && (
          <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className={headCell}><span className="sr-only">Icon</span></th>
                {sortHead(NAME)}
                {hasLevels && sortHead(LEVEL)}
                <th scope="col" className={plainHead}>Stats</th>
                <th scope="col" className={plainHead}>Description</th>
                {sortHead(PRICE)}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((i) => (
                <tr key={i.id} className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
                  <td className="border-b border-zinc-100 py-1.5 pl-4 pr-1 align-top sm:pl-6 dark:border-zinc-800/70">
                    <span className="grid size-10 place-items-center overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                      <img src={api.itemIconUrl(i.id)} alt="" loading="lazy" className="max-h-10 max-w-10 object-contain [image-rendering:pixelated]"
                        onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                    </span>
                  </td>
                  <td className={cell}>
                    <span className="flex min-w-48 flex-col">
                      <span className="font-semibold">{i.name || <span className="font-normal italic text-zinc-400">(unnamed)</span>}</span>
                      <span className="font-mono text-xs tabular-nums text-zinc-500">
                        {itemId(i.id)}{i.slot && <span className="font-sans"> · {SLOT_LABEL[i.slot] ?? i.slot}</span>}
                      </span>
                      {FLAGS.some(([key]) => i.stats[key] === 1) && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {FLAGS.filter(([key]) => i.stats[key] === 1).map(([key, label, cls]) => (
                            <span key={key} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>
                          ))}
                        </span>
                      )}
                    </span>
                  </td>
                  {hasLevels && <td className={`${cell} text-right tabular-nums`}>{level(i) ? num(level(i)) : <span className="text-zinc-400">—</span>}</td>}
                  <td className={cell}><Stats item={i} /></td>
                  <td className={`${cell} min-w-64 max-w-md text-zinc-600 dark:text-zinc-400`}>
                    {i.desc ? <SkillText text={i.desc} /> : <span className="text-zinc-400">—</span>}
                  </td>
                  <td className={`${cell} text-right tabular-nums`}>{i.price ? num(i.price) : <span className="text-zinc-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {items && rows.length === 0 && <p className="px-6 py-12 text-center text-sm text-zinc-500">{items.length ? "No items match." : "The library has no items in this tab."}</p>}
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
