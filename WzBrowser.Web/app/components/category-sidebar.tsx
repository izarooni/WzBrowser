import { memo, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { CategoryResult, CategorySub, CategoryTable } from "../lib/api";
import { useConnection } from "../lib/connection";
import { useActions } from "../lib/workspace";
import { Pencil, Plus, XMark } from "./icons";

const IMG = "Category.img";

/** The Cash Shop tab the client files an SN under: Category * 10000000 + CategorySub * 100000 + n. */
export function snTab(sn: number) {
  return { category: Math.floor(sn / 10000000), sub: Math.floor(sn / 100000) % 100 };
}
export const tabKey = (category: number, sub: number) => `${category}/${sub}`;

/** Which rows the Commodity table shows: every entry, one category or one of its sub tabs, or SNs in no known tab. */
export type TabFilter = null | { category: number; sub?: number } | "other";

/**
 * Category.img (Etc.wz) beside the Commodity table: each Cash Shop category with its sub tabs and how many entries'
 * SNs fall in each. Clicking one filters the table. Sub tabs can be added, renamed and deleted; categories are fixed
 * by the client, so they can't.
 */
export const CategorySidebar = memo(function CategorySidebar({ fileId, revision, counts, total, other, selected, onSelect, onTabs, onOpenRaw }: {
  fileId: string;
  revision: number;
  /** Entries per tab, keyed by {@link tabKey}; null while Commodity.img loads. */
  counts: Map<string, number> | null;
  total: number | null;
  /** Entries whose SN names no tab in Category.img. */
  other: number;
  selected: TabFilter;
  onSelect: (f: TabFilter) => void;
  /** Called with the tabs whenever they're loaded or edited. */
  onTabs: (t: CategoryTable | null) => void;
  /** Switches to the raw tree and reveals this node, e.g. "Category.img/12". */
  onOpenRaw?: (path: string) => void;
}) {
  const { api, status, readOnly } = useConnection();
  const actions = useActions();
  const [table, setTable] = useState<CategoryTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Revisions caused by this view's own edits; the tabs are already up to date for those, so skip the refetch.
  const ownRevisions = useRef(new Set<number>());

  useEffect(() => {
    if (status !== "online" || ownRevisions.current.has(revision)) return;
    let cancelled = false;
    api.categories(fileId).then(
      (t) => { if (!cancelled) { setTable(t); setError(null); } },
      (e) => { if (!cancelled) { setTable(null); setError(e instanceof Error ? e.message : String(e)); } },
    );
    return () => { cancelled = true; };
  }, [api, status, fileId, revision]);

  useEffect(() => { onTabs(table); }, [table, onTabs]);

  const count = (key: string) => (counts ? counts.get(key) ?? 0 : null);

  /** Runs an edit, takes the tabs it returns and tells the workspace which raw tree nodes to reload. */
  const run = async (edit: () => Promise<CategoryResult>, reload: string[], done?: (r: CategoryResult) => void) => {
    try {
      const r = await edit();
      ownRevisions.current.add(r.file.revision);
      setTable(r.table);
      actions.edited(r.file, reload);
      done?.(r);
      return true;
    } catch (e) {
      actions.toast("error", e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const add = (category: number, name: string) => {
    const before = new Set(table?.categories.flatMap((g) => g.subs.map((s) => s.entry)) ?? []);
    return run(() => api.addCategorySub(fileId, { category, name }), [IMG], (r) => {
      const added = r.table.categories.find((g) => g.category === category)?.subs.find((s) => !before.has(s.entry));
      if (!added) return;
      actions.toast("success", `Added "${added.name}" as sub category ${added.sub} of category ${category}. Its SNs are ${category * 100 + added.sub}xxxxx.`);
      setFlash(added.entry);
      setTimeout(() => setFlash((f) => (f === added.entry ? null : f)), 2500);
      onSelect({ category, sub: added.sub });
    });
  };

  const rename = (sub: CategorySub, name: string) =>
    run(() => api.renameCategorySub(fileId, { entry: sub.entry, name }), [`${IMG}/${sub.entry}`]);

  const remove = async (category: number, sub: CategorySub) => {
    const n = count(tabKey(category, sub.sub)) ?? 0;
    const ok = await actions.confirm({
      title: `Delete "${sub.name}"?`,
      body: `${n > 0 ? `${n.toLocaleString()} Commodity ${n === 1 ? "entry has an SN" : "entries have SNs"} in this tab and will have no tab to show in; they aren't deleted. ` : ""}Sub category ${sub.sub} of category ${category} (entry ${sub.entry}) is removed from the open file in memory only. Nothing on disk changes until you save, and you can discard all edits with Revert.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await run(() => api.deleteCategorySubs(fileId, [sub.entry]), [IMG], () => {
      actions.toast("success", `Deleted "${sub.name}".`);
      if (selected && selected !== "other" && selected.category === category && selected.sub === sub.sub) onSelect({ category });
    });
  };

  const isSel = (category: number, sub?: number) =>
    !!selected && selected !== "other" && selected.category === category && selected.sub === sub;

  return (
    <nav aria-label="Cash Shop tabs" className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-zinc-100 py-2 text-[13px] dark:border-zinc-800">
      <Row label="All entries" count={total} active={selected === null} onClick={() => onSelect(null)} strong />
      {error && <p role="alert" className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      {!table && !error && <div className="space-y-1.5 px-3 py-2">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-6 rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>}
      {table?.categories.map((g) => {
        const sum = counts ? g.subs.reduce((n, s) => n + (counts.get(tabKey(g.category, s.sub)) ?? 0), 0) : null;
        return (
          <div key={g.category} role="group" aria-label={`Category ${g.category}`} className="mt-2">
            <Row
              label={<><span className="font-mono text-xs tabular-nums text-zinc-400">{g.category}</span> Category {g.category}</>}
              count={sum} active={isSel(g.category)} onClick={() => onSelect({ category: g.category })} strong
              actions={!readOnly && (
                <IconButton title={`Add a sub category to category ${g.category}`} onClick={() => setAdding(g.category)}><Plus className="size-3.5" /></IconButton>
              )}
            />
            {g.subs.map((s) => editing === s.entry ? (
              <NameInput key={s.entry} value={s.name} onDone={(v) => {
                setEditing(null);
                if (v != null && v.trim() && v.trim() !== s.name) void rename(s, v);
              }} />
            ) : (
              <Row key={s.entry} indent flash={flash === s.entry}
                label={<><span title="CategorySub" className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-400">{s.sub}</span>{s.name || <i className="text-zinc-400">(no name)</i>}</>}
                title={`SNs ${g.category * 100 + s.sub}xxxxx · ${IMG}/${s.entry}`}
                count={count(tabKey(g.category, s.sub))} active={isSel(g.category, s.sub)} onClick={() => onSelect({ category: g.category, sub: s.sub })}
                actions={<>
                  {onOpenRaw && <IconButton title="Show in raw tree" onClick={() => onOpenRaw(`${IMG}/${s.entry}`)}><span className="px-0.5 text-[10px] font-semibold">Raw</span></IconButton>}
                  {!readOnly && <IconButton title="Rename" onClick={() => setEditing(s.entry)}><Pencil className="size-3.5" /></IconButton>}
                  {!readOnly && (
                    <IconButton danger title={g.subs.length <= 1 ? "A category needs at least one sub category" : "Delete sub category"}
                      disabled={g.subs.length <= 1} onClick={() => void remove(g.category, s)}><XMark className="size-3.5" /></IconButton>
                  )}
                </>}
              />
            ))}
            {adding === g.category && <AddInput category={g.category} onCancel={() => setAdding(null)} onAdd={async (name) => {
              const ok = await add(g.category, name);
              if (ok) setAdding(null);
              return ok;
            }} />}
          </div>
        );
      })}
      {other > 0 && (
        <div className="mt-2">
          <Row label={<span className="italic">Other SNs</span>} title="Entries whose SN names no tab in Category.img" count={other}
            active={selected === "other"} onClick={() => onSelect("other")} strong />
        </div>
      )}
    </nav>
  );
});

function Row({ label, count, active, onClick, strong, indent, flash, title, actions }: {
  label: ReactNode;
  count: number | null;
  active: boolean;
  onClick: () => void;
  strong?: boolean;
  indent?: boolean;
  flash?: boolean;
  title?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={`group relative mx-1.5 flex h-8 items-center rounded-md transition-colors ${
      active ? "bg-accent-50 text-accent-800 dark:bg-accent-600/15 dark:text-accent-200"
        : flash ? "bg-emerald-50 dark:bg-emerald-500/10"
        : "hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60"
    }`}>
      <button type="button" onClick={onClick} title={title} aria-current={active || undefined}
        className={`flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-400 ${indent ? "pl-4" : "pl-2.5"} ${strong ? "font-semibold" : ""}`}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{label}</span>
        {count != null && <span className={`shrink-0 font-mono text-[11px] font-normal tabular-nums ${count === 0 ? "text-zinc-300 dark:text-zinc-600" : "text-zinc-500"}`}>{count.toLocaleString()}</span>}
      </button>
      {actions && (
        <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 pl-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          {actions}
        </span>
      )}
    </div>
  );
}

function IconButton({ title, onClick, disabled, danger, children }: { title: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className={`grid h-6 min-w-6 place-items-center rounded bg-white/90 text-zinc-500 shadow-sm ring-1 ring-zinc-200 transition disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-900/90 dark:ring-zinc-700 ${
        danger ? "hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/20" : "hover:text-zinc-900 dark:hover:text-zinc-100"
      }`}>
      {children}
    </button>
  );
}

function AddInput({ category, onAdd, onCancel }: { category: number; onAdd: (name: string) => Promise<boolean>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    await onAdd(name.trim());
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="mx-1.5 flex items-center gap-1 py-1 pl-4">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        placeholder="Sub category name" aria-label={`New sub category name for category ${category}`}
        className="min-w-0 flex-1 rounded-md border border-accent-400 bg-white px-2 py-1 text-xs outline-2 outline-accent-500/30 placeholder:text-zinc-400 dark:bg-zinc-950" />
      <button type="submit" disabled={!name.trim() || busy} title="Add" aria-label="Add sub category"
        className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-600 text-white transition hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-40">
        <Plus className="size-3.5" />
      </button>
      <button type="button" onClick={onCancel} title="Cancel (Esc)" aria-label="Cancel"
        className="grid size-6 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70">
        <XMark className="size-3.5" />
      </button>
    </form>
  );
}

function NameInput({ value, onDone }: { value: string; onDone: (value: string | null) => void }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <div className="mx-1.5 flex h-8 items-center pl-4 pr-1">
      <input
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); finish(null); }
          else if (e.key === "Enter") { e.preventDefault(); finish(text); }
        }}
        onBlur={() => finish(text)}
        title="Enter to save, Esc to cancel"
        className="min-w-0 flex-1 rounded-md border border-accent-400 bg-white px-1.5 py-0.5 text-[13px] outline-2 outline-accent-500/30 dark:bg-zinc-950"
      />
    </div>
  );
}
