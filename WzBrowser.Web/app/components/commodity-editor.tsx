import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CategoryTable, CommodityCell, CommodityColumn, CommodityRow, CommodityRowResult, CommodityRowsResult, CommodityTable, OpenedFile } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useNames } from "../lib/use-names";
import { EDITABLE, INTEGER, invalid } from "../lib/values";
import { useActions } from "../lib/workspace";
import { CategorySidebar, snTab, tabKey, type TabFilter } from "./category-sidebar";
import { Plus, Search, XMark } from "./icons";
import { RefCtx, RefLink, type RefContext } from "./ref-link";
import { buttonPrimary, inputClass } from "./ui";

const ROW_H = 40;
const OVERSCAN = 8;
const IMG = "Commodity.img";
const PACKAGE_IMG = "CashPackage.img";

/** Stands for the row-selection checkbox column wherever a column index is expected. */
const SELECT = -1;

// Integer columns whose values are codes; they get a picker (any other value can still be typed in the raw tree).
const CHOICES: Record<string, [number, string][]> = {
  gender: [[0, "Male"], [1, "Female"], [2, "Both"]],
  class: [[0, "New"], [1, "Sale"], [2, "Hot"], [3, "Event"], [4, "None"]],
};

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

/**
 * Commodity.img (Etc.wz) as a table: one row per Cash Shop entry, every value editable in place, plus adding entries.
 * Beside it, Category.img's tabs filter the table to the entries whose SN files them under that tab.
 */
export const CommodityEditor = memo(function CommodityEditor({ fileId, revision, onOpenRaw, readOnly = false }: {
  fileId: string;
  revision: number;
  /** Show the entries only: no selecting, adding, deleting or editing values. */
  readOnly?: boolean;
  /** Switches to the raw tree and reveals this node, e.g. "Commodity.img/12". Left out when there's no raw tree. */
  onOpenRaw?: (path: string) => void;
}) {
  const { api, status } = useConnection();
  const actions = useActions();
  const [table, setTable] = useState<CommodityTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const [editing, setEditing] = useState<{ row: string; col: number } | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<Set<string> | null>(null);
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
  const onSaleCol = colIndex("onsale");
  // Display order of the value columns after Item; OnSale is pulled out to sit between Entry and Item.
  const order = useMemo(() => {
    const all = columns.map((_, i) => i);
    return onSaleCol < 0 ? all : all.filter((i) => i !== onSaleCol);
  }, [columns, onSaleCol]);
  const snOf = (row: CommodityRow) => {
    const v = snCol < 0 ? null : row.cells[snCol]?.value;
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };
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

  // ------------------------------------------------------------ Cash Shop tabs (Category.img)

  const [tabs, setTabs] = useState<CategoryTable | null>(null);
  const [tabFilter, setTabFilter] = useState<TabFilter>(null);
  const known = useMemo(() => new Set(tabs?.categories.flatMap((g) => g.subs.map((s) => tabKey(g.category, s.sub))) ?? []), [tabs]);
  /** The tab key each row's SN names, or null without an SN. */
  const rowTab = (row: CommodityRow) => {
    const sn = snOf(row);
    if (sn == null) return null;
    const t = snTab(sn);
    return tabKey(t.category, t.sub);
  };
  const counts = useMemo(() => {
    if (!table) return null;
    const m = new Map<string, number>();
    for (const r of table.rows) { const k = rowTab(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, snCol]);
  const isOther = (row: CommodityRow) => { const k = rowTab(row); return k == null || !known.has(k); };
  const [otherCount, unfiledCount] = useMemo(() => {
    let other = 0, unfiled = 0;
    if (table && tabs) for (const r of table.rows) {
      if (!isOther(r)) continue;
      other++;
      const sn = snOf(r);
      if (sn != null && sn >= 10000000 && sn < 80000000) unfiled++;
    }
    return [other, unfiled];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, tabs, known, snCol]);
  // A filter on "other" with nothing left in it, or on a category that's gone, falls back to every entry.
  useEffect(() => {
    if (!tabs || !tabFilter) return;
    if (tabFilter === "other" ? otherCount === 0 : !tabs.categories.some((g) => g.category === tabFilter.category)) setTabFilter(null);
  }, [tabFilter, tabs, otherCount]);
  const inTab = (row: CommodityRow) => {
    if (!tabFilter) return true;
    if (tabFilter === "other") return isOther(row);
    const sn = snOf(row);
    if (sn == null) return false;
    const t = snTab(sn);
    return t.category === tabFilter.category && (tabFilter.sub == null || t.sub === tabFilter.sub);
  };
  /** The sub tab new entries go into, when one is selected. */
  const addTab = tabFilter && tabFilter !== "other" && tabFilter.sub != null ? { category: tabFilter.category, sub: tabFilter.sub } : null;
  const addTabName = addTab && tabs?.categories.find((g) => g.category === addTab.category)?.subs.find((s) => s.sub === addTab.sub)?.name;

  // Not memoised: item names arrive after the table, and a pass over a few thousand rows is cheap.
  const needle = filter.trim().toLowerCase();
  const inTabRows = !tabFilter ? sorted : sorted.filter(inTab);
  const visible = !needle ? inTabRows : inTabRows.filter((r) => {
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

  /**
   * Refetches the whole table, for edits after which the server renumbered entries (adding, deleting, moving an SN to
   * another tab): rows can't be matched by name any more. Returns the rows in file order.
   */
  const reload = async (file: OpenedFile, nodes: string[]) => {
    ownRevisions.current.add(file.revision);
    actions.edited(file, nodes);
    const t = await api.commodity(fileId);
    const columns = keepOrder(table?.columns, t.columns);
    const rows = t.rows.map((r) => remap(r, t.columns, columns));
    setTable({ columns, rows });
    return rows;
  };

  /** Merges an edit's result into the table, in the column order already on screen. New entries are appended. */
  const apply = (r: CommodityRowsResult, reload: string[]) => {
    ownRevisions.current.add(r.file.revision);
    setTable((t) => {
      if (!t) return t;
      const columns = keepOrder(t.columns, r.columns);
      const changed = new Map(r.rows.map((x) => [x.name, remap(x, r.columns, columns)]));
      const rows = t.rows.map((x) => changed.get(x.name) ?? remap(x, t.columns, columns));
      const known = new Set(t.rows.map((x) => x.name));
      return { columns, rows: [...rows, ...[...changed.values()].filter((x) => !known.has(x.name))] };
    });
    actions.edited(r.file, reload);
  };

  /** Stores `value` in column `col` of each row, as one edit. */
  const commitMany = async (rows: CommodityRow[], col: number, value: string) => {
    if (rows.length === 0) return;
    const column = columns[col];
    const sets = rows.map((row) => ({ entry: row.name, property: column.name, type: row.cells[col]?.type ?? column.type, value }));
    const problem = invalid(sets[0].type, value);
    if (problem) { actions.toast("error", `${column.name}: ${problem}`); return; }

    const tags = rows.map((row) => `${row.name}/${col}`);
    setPending((p) => new Set([...p, ...tags]));
    try {
      const r = await api.setCommodity(fileId, sets);
      if (r.renumbered) await reload(r.file, [IMG, PACKAGE_IMG]);
      else apply(r, [...rows.map((row) => `${IMG}/${row.name}`), ...(r.packageRefs ? [PACKAGE_IMG] : [])]);
      const notes = [
        ...(r.renumbered ? ["entries renumbered to keep each Cash Shop tab together"] : []),
        ...(r.packageRefs ? [`${r.packageRefs.toLocaleString()} package ${r.packageRefs === 1 ? "content" : "contents"} moved to the new SN`] : []),
      ];
      if (rows.length > 1 || notes.length)
        actions.toast("success", `Set ${column.name} to ${value}${rows.length > 1 ? ` on ${rows.length.toLocaleString()} entries` : ""}${notes.length ? `; ${notes.join(", ")}` : ""}.`);
    } catch (e) {
      actions.toast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setPending((p) => { const n = new Set(p); tags.forEach((t) => n.delete(t)); return n; });
    }
  };

  const commit = (row: CommodityRow, col: number, value: string) => {
    const cell = row.cells[col];
    if (cell && cell.value === value) return;
    void commitMany([row], col, value);
  };

  // Shift-click ranges on checkbox columns: the first shift-click toggles a row and becomes the anchor; the next
  // shift-click gives every row between the two (in the order shown) the anchor's value. Releasing Shift or leaving
  // the window drops the anchor, so a fresh range needs Shift pressed again.
  const anchor = useRef<{ row: string; col: number; value: string } | null>(null);
  const [anchorRow, setAnchorRow] = useState<string | null>(null);
  useEffect(() => {
    const drop = () => { anchor.current = null; setAnchorRow(null); };
    const onKeyUp = (e: globalThis.KeyboardEvent) => { if (e.key === "Shift") drop(); };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", drop);
    return () => { window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", drop); };
  }, []);

  /** Flips a checkbox (an OnSale cell, or the row's selection when `col` is SELECT), extending a range on Shift. */
  const toggle = (row: CommodityRow, col: number, shift: boolean) => {
    const current = col === SELECT ? (selected.has(row.name) ? "1" : "0") : row.cells[col]?.value;
    const value = current === "1" ? "0" : "1";
    const a = anchor.current;
    const from = shift && a && a.col === col ? visible.findIndex((r) => r.name === a.row) : -1;
    let rows = [row];
    if (!shift || from < 0) {
      anchor.current = shift ? { row: row.name, col, value } : null;
      setAnchorRow(shift ? row.name : null);
    } else {
      const to = visible.findIndex((r) => r.name === row.name);
      rows = visible.slice(Math.min(from, to), Math.max(from, to) + 1);
      // Keep chaining from the row just clicked.
      anchor.current = { row: row.name, col, value: a!.value };
      setAnchorRow(row.name);
    }
    const target = anchor.current?.value ?? value;
    if (col === SELECT) select(rows, target === "1");
    else void commitMany(rows.filter((r) => r.cells[col]?.value !== target), col, target);
  };

  // ------------------------------------------------------------ selecting and deleting

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const select = (rows: CommodityRow[], on: boolean) => setSelected((s) => {
    const next = new Set(s);
    for (const r of rows) if (on) next.add(r.name); else next.delete(r.name);
    return next;
  });

  // Entries that disappear (deleted, or gone after a revert) leave the selection.
  useEffect(() => {
    if (!table) return;
    setSelected((s) => {
      if (s.size === 0) return s;
      const present = new Set(table.rows.map((r) => r.name));
      const next = new Set([...s].filter((n) => present.has(n)));
      return next.size === s.size ? s : next;
    });
  }, [table]);

  const visibleSelected = visible.reduce((n, r) => n + (selected.has(r.name) ? 1 : 0), 0);

  /**
   * Deletes entries after asking. The server renumbers the rest (the client reads "0".."N-1") and takes their SNs out
   * of every package, so the table is reloaded afterwards.
   */
  const deleteEntries = async (names: string[], hidden = 0) => {
    if (names.length === 0) return;
    const what = names.length === 1 ? `entry ${names[0]}` : `${names.length.toLocaleString()} entries`;
    const ok = await actions.confirm({
      title: `Delete ${what}?`,
      body: `${hidden > 0 ? `${hidden.toLocaleString()} of them ${hidden === 1 ? "is" : "are"} hidden by the search. ` : ""}Their SNs are also removed from any package in ${PACKAGE_IMG} (a package left empty stays), and the remaining entries are renumbered so the client still reads them all. This changes the open file in memory only. Nothing on disk changes until you save, and you can discard all edits with Revert.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.deleteCommodity(fileId, names);
      setSelected(new Set());
      await reload(r.file, [IMG, PACKAGE_IMG]);
      actions.toast("success", `Deleted ${r.deleted === 1 ? "1 entry" : `${r.deleted.toLocaleString()} entries`}${r.packageRefs ? ` and ${r.packageRefs.toLocaleString()} package ${r.packageRefs === 1 ? "content" : "contents"}` : ""}.`);
    } catch (e) {
      actions.toast("error", e instanceof Error ? e.message : String(e));
    }
  };

  const deleteSelected = () => deleteEntries([...selected], selected.size - visibleSelected);

  /** The next editable column after `col` in the same row (Tab), or before it (Shift+Tab). */
  const step = (row: CommodityRow, col: number, back: boolean) => {
    for (let at = order.indexOf(col) + (back ? -1 : 1); at >= 0 && at < order.length; at += back ? -1 : 1) {
      const c = order[at];
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

  /** The item ids typed into the add box, one per line; blank lines are skipped. Lines that aren't ids are reported. */
  const parseItems = (text: string) => {
    const ids: number[] = [];
    const bad: number[] = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const s = line.trim();
      if (!s) return;
      const n = Number(s);
      if (/^\d+$/.test(s) && Number.isSafeInteger(n) && n > 0) ids.push(n); else bad.push(i + 1);
    });
    return { ids, bad };
  };
  const newItems = parseItems(newItem);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const { ids, bad } = newItems;
    if (bad.length) { actions.toast("error", `Not an item id on line${bad.length > 1 ? "s" : ""} ${bad.join(", ")}. Enter one item id per line, e.g. 1002186.`); return; }
    if (ids.length === 0) { actions.toast("error", "Enter the item ids to sell, one per line, e.g. 1002186."); return; }
    setBusy(true);
    // Each add renumbers the entries after it, so entry names go stale; the new rows are found again by SN.
    const sns: string[] = [];
    let last: CommodityRowResult | null = null;
    let added = 0;
    let failure: string | null = null;
    for (const itemId of ids) {
      try {
        const r = await api.addCommodity(fileId, { itemId, donor, ...(addTab ?? {}) });
        last = r;
        added++;
        const sn = r.row.cells[r.columns.findIndex((c) => c.name.toLowerCase() === "sn")]?.value;
        if (sn) sns.push(sn);
      } catch (err) {
        failure = `Item ${itemId}: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }
    // Keep the ids not added yet in the box so they can be fixed and retried.
    setNewItem(ids.slice(added).join("\n"));
    try {
      if (last) {
        // New entries go at the end of their tab's run, so the entries after them were renamed: reload.
        const rows = await reload(last.file, [IMG]);
        const snSet = new Set(sns);
        const names = new Set(snCol < 0 ? [last.row.name] : rows.filter((r) => { const v = r.cells[snCol]?.value; return v != null && snSet.has(v); }).map((r) => r.name));
        if (ids.length === 1 && !failure) {
          actions.toast("success", `Added entry ${last.row.name} for item ${ids[0]}${sns[0] ? ` with SN ${sns[0]}` : ""}.`);
        } else if (!failure) {
          actions.toast("success", `Added ${ids.length.toLocaleString()} entries.`);
        }
        setFilter("");
        setSort(null);
        if (!addTab) setTabFilter(null);
        setFlash(names);
        setTimeout(() => setFlash((f) => (f === names ? null : f)), 2500);
        const first = (addTab ? rows.filter(inTab) : rows).find((r) => names.has(r.name));
        if (first) scrollToRow(first.name, addTab ? rows.filter(inTab) : rows);
        if (failure) actions.toast("error", `Added ${added.toLocaleString()} of ${ids.length.toLocaleString()} entries, then stopped. ${failure}`);
      } else if (failure) {
        actions.toast("error", failure);
      }
    } catch (err) {
      actions.toast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------ layout

  const ref = useMemo<RefContext>(() => ({ fileId, openQuest: () => {} }), [fileId]);
  const template = [...(readOnly ? [] : ["40px"]), "88px", ...(onSaleCol >= 0 ? [`${colWidth(columns[onSaleCol])}px`] : []), ...(itemCol >= 0 ? ["240px"] : []), ...order.map((i) => `${colWidth(columns[i])}px`), ...(readOnly ? [] : ["84px"])].join(" ");
  const headCell = "flex items-center gap-1.5 px-3 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300";
  const sortMark = (col: number) => (sort?.col === col ? (sort.desc ? " ↓" : " ↑") : "");
  const columnHead = (i: number) => {
    const c = columns[i];
    return (
      <button key={c.name} type="button" role="columnheader" onClick={() => toggleSort(i)} title={`${c.name} (${c.type}) — click to sort`}
        className={`${headCell} ${c.type === "string" ? "" : "justify-end"}`}>
        <span className="truncate">{c.name}{sortMark(i)}</span>
        <span className="shrink-0 rounded bg-zinc-200/70 px-1 font-mono text-[10px] font-normal text-zinc-500 dark:bg-zinc-800">{c.type}</span>
      </button>
    );
  };
  const cellAt = (row: CommodityRow, col: number) => (
    <Cell
      key={columns[col].name}
      column={columns[col]}
      cell={row.cells[col]}
      readOnly={readOnly}
      editing={editing?.row === row.name && editing.col === col}
      pending={pending.has(`${row.name}/${col}`)}
      anchor={anchorRow === row.name && anchor.current?.col === col}
      onEdit={() => setEditing({ row: row.name, col })}
      onToggle={(shift) => toggle(row, col, shift)}
      onDone={(value, move) => {
        if (value != null) void commit(row, col, value);
        if (move) step(row, col, move === "back"); else setEditing(null);
      }}
    />
  );

  return (
    <RefCtx.Provider value={ref}>
      <div className="flex min-h-0 flex-1">
      <CategorySidebar fileId={fileId} revision={revision} counts={counts} total={table?.rows.length ?? null} other={otherCount} unfiled={unfiledCount}
        selected={tabFilter} onTabs={setTabs} onOpenRaw={onOpenRaw}
        onSelect={(f) => { setTabFilter(f); if (scrollRef.current) scrollRef.current.scrollTop = 0; }} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            {table ? (needle || tabFilter ? `${visible.length.toLocaleString()} of ${table.rows.length.toLocaleString()} entries` : `${table.rows.length.toLocaleString()} entries`) : error ? "" : "Loading…"}
          </p>
          {!readOnly && <>
          <button type="button" onClick={() => void deleteSelected()} disabled={selected.size === 0}
            title={selected.size ? "Delete the selected entries" : "Tick rows in the first column to select them"}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:text-zinc-400 disabled:hover:bg-white dark:border-rose-900 dark:bg-zinc-900 dark:text-rose-300 dark:hover:bg-rose-950/40 dark:disabled:border-zinc-800 dark:disabled:text-zinc-600 dark:disabled:hover:bg-zinc-900">
            <XMark className="size-4" />Delete{selected.size > 0 && ` ${selected.size.toLocaleString()}`}
          </button>
          <button type="button" onClick={() => setAdding((a) => !a)} aria-expanded={adding} className={`${buttonPrimary} !rounded-lg !px-3.5 !py-2 !text-[13px]`}>
            <Plus className="size-4" />Add entry
          </button>
          </>}
        </div>

        {adding && (
          <form onSubmit={add} className="flex flex-wrap items-end gap-4 border-b border-zinc-100 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <label className="block w-44 space-y-1.5">
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Item ids, one per line</span>
              <textarea
                autoFocus
                rows={4}
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAdding(false);
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
                }}
                placeholder={"1002186\n1702155"}
                title="One item id per line; blank lines are skipped. Ctrl+Enter to add."
                aria-invalid={newItems.bad.length > 0}
                className={`${inputClass} !rounded-lg !py-2 resize-y font-mono`}
              />
            </label>
            {!addTab && (
              <label className="flex items-center gap-2 pb-2 text-[13px]">
                <input type="checkbox" checked={donor} onChange={(e) => setDonor(e.target.checked)} className="size-4 accent-accent-600" />
                Donor item
              </label>
            )}
            <button type="submit" disabled={busy || !table} className={`${buttonPrimary} !rounded-lg !px-4 !py-2 !text-[13px]`}>
              {busy ? "Adding…" : newItems.ids.length > 1 ? `Add ${newItems.ids.length.toLocaleString()}` : "Add"}
            </button>
            <p className="basis-full text-xs leading-5 text-zinc-500">
              {addTab
                ? <>The SN goes in the selected tab{addTabName ? <> (<b className="font-semibold">{addTabName}</b>)</> : null}: {addTab.category}{String(addTab.sub).padStart(2, "0")}xxxxx, with the lowest free number.</>
                : <>The SN is generated from the item's category: {donor ? "1" : "2"}<i>C</i>xxxxxx, where <i>C</i> is the Cash Shop tab and the rest is the lowest free number. Select a sub tab on the left to put the SN there instead.</>}
              Each new entry starts on sale for 4000 NX, 90 days, count 1, both genders, priority 99 and no tag; change any of it in the table.
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
                {!readOnly && <div role="columnheader" className="grid place-items-center">
                  {/* Selects (or clears) the rows the search shows. */}
                  <input type="checkbox" aria-label="Select all shown entries" title="Select all shown entries"
                    checked={visible.length > 0 && visibleSelected === visible.length}
                    ref={(el) => { if (el) el.indeterminate = visibleSelected > 0 && visibleSelected < visible.length; }}
                    onChange={() => select(visible, visibleSelected < visible.length)}
                    className="size-4 cursor-pointer accent-accent-600" />
                </div>}
                <button type="button" role="columnheader" onClick={() => toggleSort(-1)} className={headCell}>Entry{sortMark(-1)}</button>
                {onSaleCol >= 0 && columnHead(onSaleCol)}
                {itemCol >= 0 && <div role="columnheader" className={headCell}>Item</div>}
                {order.map(columnHead)}
                {!readOnly && <div role="columnheader" className="sr-only">Actions</div>}
              </div>

              {visible.length === 0 && <p className="px-4 py-10 text-center text-sm text-zinc-500">{needle ? "No entries match." : tabFilter ? "No entries in this tab." : "Commodity.img is empty."}</p>}

              <div role="rowgroup" style={{ height: visible.length * ROW_H, position: "relative" }}>
                {shown.map((row, i) => {
                  const itemId = itemIdOf(row);
                  const itemName = itemId == null ? undefined : names("item", itemId);
                  const isSelected = selected.has(row.name);
                  return (
                    <div
                      key={row.name}
                      role="row"
                      style={{ position: "absolute", top: (start + i) * ROW_H, height: ROW_H, left: 0, right: 0, gridTemplateColumns: template }}
                      className={`group grid items-stretch border-b border-zinc-100 transition-colors dark:border-zinc-800/70 ${
                        flash?.has(row.name) ?"bg-emerald-50 dark:bg-emerald-500/10"
                          : isSelected ? "bg-accent-50/70 dark:bg-accent-600/10"
                          : "hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                      }`}
                    >
                      {/* Shift+mousedown would otherwise extend a text selection from the last click to here. */}
                      {!readOnly && <div role="cell" onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }} className="grid select-none place-items-center">
                        <input type="checkbox" checked={isSelected} aria-label={`Select entry ${row.name}`}
                          title="Select for deletion. Shift-click two boxes to select every row between."
                          onChange={(e) => toggle(row, SELECT, (e.nativeEvent as MouseEvent).shiftKey === true)}
                          className={`size-4 cursor-pointer accent-accent-600 ${anchorRow === row.name && anchor.current?.col === SELECT ? "rounded-sm outline-2 outline-offset-2 outline-accent-500" : ""}`} />
                      </div>}
                      <div role="cell" className="flex items-center px-3 font-mono text-xs tabular-nums text-zinc-500">{row.name}</div>
                      {onSaleCol >= 0 && cellAt(row, onSaleCol)}
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
                      {order.map((col) => cellAt(row, col))}
                      {!readOnly && <div role="cell" className="flex items-center justify-end gap-0.5 px-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                        {onOpenRaw && (
                          <button type="button" onClick={() => onOpenRaw(`${IMG}/${row.name}`)} title="Show in raw tree" aria-label={`Show entry ${row.name} in raw tree`}
                            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:hover:bg-zinc-700/70 dark:hover:text-zinc-100">
                            Raw
                          </button>
                        )}
                        <button type="button" onClick={() => void deleteEntries([row.name])} title="Delete entry" aria-label={`Delete entry ${row.name}`}
                          className="rounded-md p-1.5 text-zinc-500 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/20">
                          <XMark className="size-4" />
                        </button>
                      </div>}
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
function Cell({ column, cell, readOnly, editing, pending, anchor, onEdit, onToggle, onDone }: {
  column: CommodityColumn;
  cell: CommodityCell | null;
  /** Show the value only. */
  readOnly: boolean;
  editing: boolean;
  pending: boolean;
  /** This checkbox starts the current shift-click range. */
  anchor: boolean;
  onEdit: () => void;
  /** Checkbox columns: flip the value (`shift` extends a range from the anchor). */
  onToggle: (shift: boolean) => void;
  /** `value` is null when the edit was cancelled; `move` steps to the next/previous cell (Tab). */
  onDone: (value: string | null, move?: "next" | "back") => void;
}) {
  const type = cell?.type ?? column.type;
  const key = column.name.toLowerCase();
  const numeric = type !== "string" && type !== "uol";
  const editable = EDITABLE.has(type);
  const choices = INTEGER.has(type) ? CHOICES[key] : undefined;
  const base = `flex min-w-0 items-center px-3 ${numeric ? "justify-end font-mono text-xs tabular-nums" : ""} ${pending ? "opacity-50" : ""}`;

  if (readOnly) {
    const label = cell?.value == null ? null : key === "onsale" && INTEGER.has(type) ? (cell.value === "1" ? "Yes" : "No") : choices?.find(([v]) => String(v) === cell.value)?.[1];
    return (
      <div role="cell" title={`${column.name} (${type})`} className={base}>
        {cell == null ? <span className="text-zinc-300 dark:text-zinc-600">—</span> : (
          <span className="truncate">
            {cell.value === "" ? <span className="italic text-zinc-400">(empty)</span> : cell.value}
            {label && <span className="ml-1 font-sans text-zinc-400">{label}</span>}
          </span>
        )}
      </div>
    );
  }

  if (!editable) {
    return <div role="cell" title={`${type} property — edit it in the raw tree`} className={`${base} italic text-zinc-400`}>{cell?.value ?? type}</div>;
  }

  if (key === "onsale" && INTEGER.has(type)) {
    const on = cell?.value === "1";
    return (
      // Shift+mousedown would otherwise extend a text selection from the last click to here.
      <div role="cell" onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }} className={`${base} !justify-center select-none`}>
        <input type="checkbox" checked={on} disabled={pending}
          // React fires onChange from the click, so the native event says whether Shift was held.
          onChange={(e) => onToggle((e.nativeEvent as MouseEvent).shiftKey === true)}
          aria-label={on ? "On sale" : "Not on sale"}
          title={`${cell ? `OnSale = ${cell.value}` : "No OnSale value yet; ticking creates it"}. Shift-click two boxes to set every row between.`}
          className={`size-4 cursor-pointer accent-accent-600 ${anchor ? "rounded-sm outline-2 outline-offset-2 outline-accent-500" : ""}`} />
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
        inputMode={INTEGER.has(type) ? "numeric" : type === "float" || type === "double" ? "decimal" : undefined}
        aria-invalid={!!problem}
        title={problem ?? "Enter to save, Esc to cancel, Tab for the next value"}
        className={`w-full rounded-md border bg-white px-2 py-1 text-xs outline-2 dark:bg-zinc-950 ${numeric ? "text-right font-mono tabular-nums" : ""} ${
          problem ? "border-rose-400 outline-rose-500/30" : "border-accent-400 outline-accent-500/30"
        }`}
      />
    </div>
  );
}
