import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CommodityCell, CommodityColumn, CommodityRow, CommodityRowResult, CommodityTable } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useNames } from "../lib/use-names";
import { useActions } from "../lib/workspace";
import { Plus, Search, XMark } from "./icons";
import { RefCtx, RefLink, type RefContext } from "./ref-link";
import { buttonPrimary, inputClass } from "./ui";

const ROW_H = 40;
const OVERSCAN = 8;
const IMG = "Commodity.img";

const INTEGER = new Set(["int", "short", "long"]);
const RANGE: Record<string, [bigint, bigint]> = {
  short: [-32768n, 32767n],
  int: [-2147483648n, 2147483647n],
  long: [-9223372036854775808n, 9223372036854775807n],
};
const EDITABLE = new Set(["int", "short", "long", "float", "double", "string"]);

// Integer columns whose values are codes; they get a picker (any other value can still be typed in the raw tree).
const CHOICES: Record<string, [number, string][]> = {
  gender: [[0, "Male"], [1, "Female"], [2, "Both"]],
  class: [[0, "New"], [1, "Sale"], [2, "Hot"], [3, "Event"], [4, "None"]],
};

/** Why `value` can't be stored as `type`, or null when it can. */
function invalid(type: string, value: string): string | null {
  const v = value.trim();
  if (INTEGER.has(type)) {
    if (!/^-?\d+$/.test(v)) return `A ${type} must be a whole number.`;
    const [lo, hi] = RANGE[type];
    const n = BigInt(v);
    return n < lo || n > hi ? `A ${type} must be between ${lo} and ${hi}.` : null;
  }
  if (type === "float" || type === "double") return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v) ? null : `A ${type} must be a number.`;
  return null;
}

/**
 * The server orders columns by first appearance, which shifts when a property is added to an early entry.
 * Keep the order already on screen and append new names at the end.
 */
function keepOrder(prev: CommodityColumn[] | undefined, next: CommodityColumn[]) {
  if (!prev) return next;
  const byName = new Map(next.map((c) => [c.name, c]));
  return [...prev.filter((c) => byName.has(c.name)).map((c) => byName.get(c.name)!), ...next.filter((c) => !prev.some((p) => p.name === c.name))];
}

/** A row's cells rearranged from one column order to another. */
function remap(row: CommodityRow, from: CommodityColumn[], to: CommodityColumn[]): CommodityRow {
  if (from.length === to.length && from.every((c, i) => c.name === to[i].name)) return row;
  const at = new Map(from.map((c, i) => [c.name, i]));
  return { ...row, cells: to.map((c) => (at.has(c.name) ? row.cells[at.get(c.name)!] : null)) };
}

const colWidth = (c: CommodityColumn) => (c.type === "string" ? 200 : c.name.toLowerCase() === "sn" ? 120 : 104);

/** Commodity.img (Etc.wz) as a table: one row per Cash Shop entry, every value editable in place, plus adding entries. */
export const CommodityEditor = memo(function CommodityEditor({ fileId, revision, onOpenRaw }: {
  fileId: string;
  revision: number;
  /** Switches to the raw tree and reveals this node, e.g. "Commodity.img/12". */
  onOpenRaw: (path: string) => void;
}) {
  const { api, status } = useConnection();
  const actions = useActions();
  const [table, setTable] = useState<CommodityTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const [editing, setEditing] = useState<{ row: string; col: number } | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  // Revisions caused by this view's own edits; the table is already up to date for those, so skip the refetch.
  const ownRevisions = useRef(new Set<number>());

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(400);

  useEffect(() => {
    if (status !== "online" || ownRevisions.current.has(revision)) return;
    let cancelled = false;
    api.commodity(fileId).then(
      (t) => {
        if (cancelled) return;
        setTable((prev) => {
          const columns = keepOrder(prev?.columns, t.columns);
          return { columns, rows: t.rows.map((r) => remap(r, t.columns, columns)) };
        });
        setError(null);
      },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status, fileId, revision]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = table?.columns ?? [];
  const colIndex = (name: string) => columns.findIndex((c) => c.name.toLowerCase() === name);
  const itemCol = colIndex("itemid");
  const snCol = colIndex("sn");
  const itemIdOf = (row: CommodityRow) => {
    const v = itemCol < 0 ? null : row.cells[itemCol]?.value;
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  // ------------------------------------------------------------ filtering and sorting

  // Every item's name is fetched up front (one request) so the search can match names, not just the rows seen so far.
  const itemIds = useMemo(() => (table ? [...new Set(table.rows.map(itemIdOf).filter((n): n is number => n != null))] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, itemCol]);
  const names = useNames(fileId, { item: itemIds }, revision);

  const sorted = useMemo(() => {
    if (!table) return [];
    let rows = table.rows;
    if (sort) {
      const key = (r: CommodityRow) => (sort.col < 0 ? r.name : r.cells[sort.col]?.value ?? null);
      const cmp = (a: CommodityRow, b: CommodityRow) => {
        const x = key(a), y = key(b);
        if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // missing values last either way
        const nx = Number(x), ny = Number(y);
        const c = !isNaN(nx) && !isNaN(ny) ? nx - ny : x.localeCompare(y);
        return sort.desc ? -c : c;
      };
      rows = [...rows].sort(cmp);
    }
    return rows;
  }, [table, sort]);

  // Not memoised: item names arrive after the table, and a pass over a few thousand rows is cheap.
  const needle = filter.trim().toLowerCase();
  const visible = !needle ? sorted : sorted.filter((r) => {
    if (r.name.toLowerCase().includes(needle)) return true;
    if (r.cells.some((c) => c?.value?.toLowerCase().includes(needle))) return true;
    const id = itemIdOf(r);
    return id != null && !!names("item", id)?.toLowerCase().includes(needle);
  });

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN);
  const shown = visible.slice(start, end);

  const toggleSort = (col: number) =>
    setSort((s) => (s?.col !== col ? { col, desc: false } : s.desc ? null : { col, desc: true }));

  const scrollToRow = (name: string, rows: CommodityRow[]) => {
    const index = rows.findIndex((r) => r.name === name);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el && index >= 0) el.scrollTop = Math.max(0, index * ROW_H - el.clientHeight / 2 + ROW_H / 2);
    });
  };

  // ------------------------------------------------------------ editing

  /** Merges an edit's result into the table, in the column order already on screen. */
  const apply = (r: CommodityRowResult, reload: string[]) => {
    ownRevisions.current.add(r.file.revision);
    setTable((t) => {
      if (!t) return t;
      const columns = keepOrder(t.columns, r.columns);
      const row = remap(r.row, r.columns, columns);
      let rows = t.rows.map((x) => remap(x, t.columns, columns));
      const at = rows.findIndex((x) => x.name === row.name);
      rows = at < 0 ? [...rows, row] : rows.map((x, i) => (i === at ? row : x));
      return { columns, rows };
    });
    actions.edited(r.file, reload);
  };

  const commit = async (row: CommodityRow, col: number, value: string) => {
    const column = columns[col];
    const cell = row.cells[col];
    const type = cell?.type ?? column.type;
    if (cell && cell.value === value) return;
    const problem = invalid(type, value);
    if (problem) { actions.toast("error", `${column.name}: ${problem}`); return; }

    const tag = `${row.name}/${col}`;
    setPending((p) => new Set(p).add(tag));
    try {
      apply(await api.setCommodity(fileId, { entry: row.name, property: column.name, type, value }), [`${IMG}/${row.name}`]);
    } catch (e) {
      actions.toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(tag); return n; });
    }
  };

  /** The next editable column after `col` in the same row (Tab), or before it (Shift+Tab). */
  const step = (row: CommodityRow, col: number, back: boolean) => {
    for (let c = col + (back ? -1 : 1); c >= 0 && c < columns.length; c += back ? -1 : 1) {
      const type = row.cells[c]?.type ?? columns[c].type;
      if (EDITABLE.has(type) && columns[c].name.toLowerCase() !== "onsale") return setEditing({ row: row.name, col: c });
    }
    setEditing(null);
  };

  // ------------------------------------------------------------ adding

  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState("");
  const [donor, setDonor] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const itemId = Number(newItem.trim());
    if (!Number.isInteger(itemId) || itemId <= 0) { actions.toast("error", "Enter the item id to sell, e.g. 1002186."); return; }
    setBusy(true);
    try {
      const r = await api.addCommodity(fileId, { itemId, donor });
      apply(r, [IMG]);
      const sn = r.row.cells[r.columns.findIndex((c) => c.name.toLowerCase() === "sn")]?.value;
      actions.toast("success", `Added entry ${r.row.name} for item ${itemId}${sn ? ` with SN ${sn}` : ""}.`);
      setNewItem("");
      setFilter("");
      setSort(null);
      setFlash(r.row.name);
      setTimeout(() => setFlash((f) => (f === r.row.name ? null : f)), 2500);
      scrollToRow(r.row.name, [...(table?.rows ?? []), r.row]);
    } catch (err) {
      actions.toast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------ layout

  const ref = useMemo<RefContext>(() => ({ fileId, openQuest: () => {} }), [fileId]);
  const template = ["88px", ...(itemCol >= 0 ? ["240px"] : []), ...columns.map((c) => `${colWidth(c)}px`), "84px"].join(" ");
  const headCell = "flex items-center gap-1.5 px-3 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300";
  const sortMark = (col: number) => (sort?.col === col ? (sort.desc ? " ↓" : " ↑") : "");

  return (
    <RefCtx.Provider value={ref}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 p-3 dark:border-zinc-800">
          <label className="relative block min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={filter}
              onChange={(e) => { setFilter(e.target.value); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
              onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
              placeholder="Search entry, SN, item id or name…"
              aria-label="Search entries"
              className={`${inputClass} !rounded-lg !py-2 pl-10 ${filter ? "pr-10" : ""}`}
            />
            {filter && (
              <button
                type="button"
                onClick={(e) => { setFilter(""); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); }}
                aria-label="Clear search"
                title="Clear search (Esc)"
                className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              >
                <XMark className="size-4" />
              </button>
            )}
          </label>
          <p className="shrink-0 text-xs text-zinc-500">
            {table ? (needle ? `${visible.length.toLocaleString()} of ${table.rows.length.toLocaleString()} entries` : `${table.rows.length.toLocaleString()} entries`) : error ? "" : "Loading…"}
          </p>
          <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding} className={`${buttonPrimary} !rounded-lg !px-3.5 !py-2 !text-[13px]`}>
            <Plus className="size-4" />Add entry
          </button>
        </div>

        {adding && (
          <form onSubmit={add} className="flex flex-wrap items-end gap-4 border-b border-zinc-100 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <label className="block w-44 space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Item id</span>
              <input
                autoFocus
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setAdding(false); }}
                inputMode="numeric"
                placeholder="1002186"
                className={`${inputClass} !rounded-lg !py-2 font-mono`}
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-[13px]">
              <input type="checkbox" checked={donor} onChange={(e) => setDonor(e.target.checked)} className="size-4 accent-accent-600" />
              Donor item
            </label>
            <button type="submit" disabled={busy || !table} className={`${buttonPrimary} !rounded-lg !px-4 !py-2 !text-[13px]`}>
              {busy ? "Adding…" : "Add"}
            </button>
            <p className="basis-full text-xs leading-5 text-zinc-500">
              The SN is generated from the item's category: {donor ? "1" : "2"}<i>C</i>xxxxxx, where <i>C</i> is the Cash Shop tab and the rest is the lowest free number.
              The new entry starts on sale for 4000 NX, 90 days, count 1, both genders, priority 99 and no tag; change any of it in the table.
            </p>
          </form>
        )}

        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop(Math.max(0, e.currentTarget.scrollTop - ROW_H))}
          className="min-h-0 flex-1 overflow-auto"
        >
          {error && <p role="alert" className="p-4 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
          {!table && !error && (
            <div className="space-y-2 p-3">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
          )}
          {table && (
            <div role="table" aria-label={IMG} aria-rowcount={visible.length + 1} className="w-max min-w-full text-[13px]">
              <div role="row" style={{ gridTemplateColumns: template, height: ROW_H }}
                className="sticky top-0 z-10 grid border-b border-zinc-200 bg-zinc-50/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
                <button type="button" role="columnheader" onClick={() => toggleSort(-1)} className={headCell}>Entry{sortMark(-1)}</button>
                {itemCol >= 0 && <div role="columnheader" className={headCell}>Item</div>}
                {columns.map((c, i) => (
                  <button key={c.name} type="button" role="columnheader" onClick={() => toggleSort(i)} title={`${c.name} (${c.type}) — click to sort`}
                    className={`${headCell} ${c.type === "string" ? "" : "justify-end"}`}>
                    <span className="truncate">{c.name}{sortMark(i)}</span>
                    <span className="shrink-0 rounded bg-zinc-200/70 px-1 font-mono text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{c.type}</span>
                  </button>
                ))}
                <div role="columnheader" className="sr-only">Actions</div>
              </div>

              {visible.length === 0 && <p className="px-4 py-10 text-center text-sm text-zinc-500">{needle ? "No entries match." : "Commodity.img is empty."}</p>}

              <div role="rowgroup" style={{ height: visible.length * ROW_H, position: "relative" }}>
                {shown.map((row, i) => {
                  const itemId = itemIdOf(row);
                  const itemName = itemId == null ? undefined : names("item", itemId);
                  return (
                    <div
                      key={row.name}
                      role="row"
                      style={{ position: "absolute", top: (start + i) * ROW_H, height: ROW_H, left: 0, right: 0, gridTemplateColumns: template }}
                      className={`group grid items-stretch border-b border-zinc-100 transition-colors dark:border-zinc-800/70 ${
                        flash === row.name ? "bg-emerald-50 dark:bg-emerald-500/10" : "hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                      }`}
                    >
                      <div role="cell" className="flex items-center px-3 font-mono text-xs tabular-nums text-zinc-500">{row.name}</div>
                      {itemCol >= 0 && (
                        <div role="cell" className="flex min-w-0 items-center gap-1.5 px-2">
                          <span className="grid size-8 shrink-0 place-items-center">{itemId != null && <ItemIcon key={itemId} fileId={fileId} id={itemId} />}</span>
                          <span className="min-w-0 truncate">
                            {itemId == null ? <span className="text-zinc-400">—</span> : (
                              <RefLink kind="item" id={itemId} name={itemName}>{itemName ?? <span className="text-zinc-400">{itemId}</span>}</RefLink>
                            )}
                          </span>
                        </div>
                      )}
                      {columns.map((c, col) => (
                        <Cell
                          key={c.name}
                          column={c}
                          cell={row.cells[col]}
                          editing={editing?.row === row.name && editing.col === col}
                          pending={pending.has(`${row.name}/${col}`)}
                          onEdit={() => setEditing({ row: row.name, col })}
                          onDone={(value, move) => {
                            if (value != null) void commit(row, col, value);
                            if (move) step(row, col, move === "back"); else setEditing(null);
                          }}
                        />
                      ))}
                      <div role="cell" className="flex items-center justify-end gap-0.5 px-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        <button type="button" onClick={() => onOpenRaw(`${IMG}/${row.name}`)} title="Show in raw tree" aria-label={`Show entry ${row.name} in raw tree`}
                          className="rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-700/70 dark:hover:text-zinc-100">
                          Raw
                        </button>
                        <button type="button" onClick={() => void actions.deleteNode(fileId, `${IMG}/${row.name}`, `entry ${row.name}`)} title="Delete entry" aria-label={`Delete entry ${row.name}`}
                          className="rounded-md p-1.5 text-zinc-500 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/20">
                          <XMark className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {snCol < 0 && table && table.rows.length > 0 && (
            <p className="p-4 text-xs text-amber-700 dark:text-amber-300">These entries have no SN property; new entries still get one.</p>
          )}
        </div>
      </div>
    </RefCtx.Provider>
  );
});

/** The item's icon, or nothing when it has none (or the item files aren't next to Etc.wz). */
function ItemIcon({ fileId, id }: { fileId: string; id: number }) {
  const { api } = useConnection();
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <RefLink kind="item" id={id}>
      <img src={api.previewUrl(fileId, "item", id)} alt="" loading="lazy" onError={() => setFailed(true)}
        style={{ imageRendering: "pixelated" }} className="max-h-8 max-w-8 object-contain" />
    </RefLink>
  );
}

/**
 * One value. Clicking edits it with an input that fits its property type: a checkbox for OnSale, a picker for coded
 * integers (Gender, Class), a number field for other numbers and a text field for strings. A missing value is created
 * with the column's type. Other property types (sub, canvas, ...) are shown but not editable here.
 */
function Cell({ column, cell, editing, pending, onEdit, onDone }: {
  column: CommodityColumn;
  cell: CommodityCell | null;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  /** `value` is null when the edit was cancelled; `move` steps to the next/previous cell (Tab). */
  onDone: (value: string | null, move?: "next" | "back") => void;
}) {
  const type = cell?.type ?? column.type;
  const key = column.name.toLowerCase();
  const numeric = type !== "string";
  const editable = EDITABLE.has(type);
  const choices = INTEGER.has(type) ? CHOICES[key] : undefined;
  const base = `flex min-w-0 items-center px-3 ${numeric ? "justify-end font-mono text-xs tabular-nums" : ""} ${pending ? "opacity-50" : ""}`;

  if (!editable) {
    return <div role="cell" title={`${type} property — edit it in the raw tree`} className={`${base} italic text-zinc-400`}>{cell?.value ?? type}</div>;
  }

  if (key === "onsale" && INTEGER.has(type)) {
    const on = cell?.value === "1";
    return (
      <div role="cell" className={`${base} !justify-center`}>
        <input type="checkbox" checked={on} disabled={pending} onChange={() => onDone(on ? "0" : "1")}
          aria-label={on ? "On sale" : "Not on sale"} title={cell ? `OnSale = ${cell.value}` : "No OnSale value yet; ticking creates it"}
          className="size-4 cursor-pointer accent-accent-600" />
      </div>
    );
  }

  if (editing && choices) {
    const current = cell?.value ?? "";
    const known = choices.some(([v]) => String(v) === current);
    return (
      <div role="cell" className="flex items-center px-1">
        <select
          autoFocus
          defaultValue={current}
          onChange={(e) => onDone(e.target.value)}
          onBlur={() => onDone(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone(null);
            if (e.key === "Tab") { e.preventDefault(); onDone(null, e.shiftKey ? "back" : "next"); }
          }}
          className="w-full rounded-md border border-accent-400 bg-white px-1.5 py-1 text-xs outline-2 outline-accent-500/30 dark:bg-zinc-950"
        >
          {!known && <option value={current} disabled>{current === "" ? "—" : current}</option>}
          {choices.map(([v, label]) => <option key={v} value={v}>{v} · {label}</option>)}
        </select>
      </div>
    );
  }

  if (editing) return <CellInput type={type} value={cell?.value ?? ""} numeric={numeric} onDone={onDone} />;

  const label = cell?.value == null ? null : choices?.find(([v]) => String(v) === cell.value)?.[1];
  return (
    <div
      role="cell"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); onEdit(); } }}
      title={cell ? `${column.name} (${type}) — click to edit` : `No ${column.name} yet — click to add it as ${type}`}
      className={`${base} cursor-text outline-none hover:bg-accent-50/60 focus-visible:bg-accent-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400 dark:hover:bg-accent-600/10 dark:focus-visible:bg-accent-600/15`}
    >
      {cell == null ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : (
        <span className="truncate">
          {cell.value === "" ? <span className="italic text-zinc-400">(empty)</span> : cell.value}
          {label && <span className="ml-1 font-sans text-zinc-400">{label}</span>}
        </span>
      )}
    </div>
  );
}

function CellInput({ type, value, numeric, onDone }: {
  type: string;
  value: string;
  numeric: boolean;
  onDone: (value: string | null, move?: "next" | "back") => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const problem = invalid(type, text);

  const finish = (v: string | null, move?: "next" | "back") => {
    if (done.current) return;
    done.current = true;
    onDone(v, move);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); finish(null); }
    else if (e.key === "Enter") { e.preventDefault(); if (!problem) finish(text); }
    else if (e.key === "Tab") { e.preventDefault(); finish(problem ? null : text, e.shiftKey ? "back" : "next"); }
  };

  return (
    <div role="cell" className="flex items-center px-1">
      <input
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        // Leaving with an invalid value drops the edit instead of saving something the file can't hold.
        onBlur={() => finish(problem ? null : text)}
        inputMode={numeric ? (INTEGER.has(type) ? "numeric" : "decimal") : undefined}
        aria-invalid={!!problem}
        title={problem ?? "Enter to save, Esc to cancel, Tab for the next value"}
        className={`w-full rounded-md border bg-white px-2 py-1 text-xs outline-2 dark:bg-zinc-950 ${numeric ? "text-right font-mono tabular-nums" : ""} ${
          problem ? "border-rose-400 outline-rose-500/30" : "border-accent-400 outline-accent-500/30"
        }`}
      />
    </div>
  );
}
