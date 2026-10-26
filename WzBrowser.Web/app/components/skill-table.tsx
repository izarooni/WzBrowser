import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Skill, SkillBook } from "../lib/api";
import { useConnection } from "../lib/connection";
import { JOB_NAMES } from "../lib/quest-format";
import { ChevronDown, ChevronRight, Search, XMark } from "./icons";
import { inputClass } from "./ui";

type JobClass = "beginner" | "warrior" | "magician" | "bowman" | "thief" | "pirate" | "other";

const CLASS_LABEL: Record<JobClass, string> = {
  beginner: "Beginner", warrior: "Warrior", magician: "Magician", bowman: "Bowman", thief: "Thief", pirate: "Pirate", other: "Other",
};
const CLASSES = Object.keys(CLASS_LABEL) as JobClass[];

/**
 * The class a job belongs to, from its hundreds digit (110 Fighter -> 1 Warrior; 1100 and 2100 too).
 * GM books (800, 900) and the special ranges above them (collab skills, professions) are "other".
 */
function jobClass(job: number): JobClass {
  if ((job >= 800 && job < 1000) || job >= 8000) return "other";
  return (["beginner", "warrior", "magician", "bowman", "thief", "pirate"] as const)[Math.floor((job % 1000) / 100)] ?? "other";
}

function jobName(book: SkillBook): string {
  return JOB_NAMES[book.job] ?? (book.job === 800 || book.job === 900 ? "GM" : book.book ?? `Job ${book.job}`);
}

/** Skill and item strings: line breaks (written as "\n" in the data) and #c...# for the client's orange highlight. */
export function SkillText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    text.replace(/\\r\\n|\\n/g, "\n").split(/(#c[^#]*#)/).forEach((chunk, i) => {
      if (chunk.startsWith("#c") && chunk.endsWith("#") && chunk.length > 2) {
        out.push(<span key={i} className="font-medium text-amber-700 dark:text-amber-400">{chunk.slice(2, -1)}</span>);
      } else if (chunk) {
        out.push(<span key={i}>{chunk}</span>);
      }
    });
    return out;
  }, [text]);
  return <span className="whitespace-pre-wrap break-words">{parts}</span>;
}

/** Skill ids as the game writes them: seven digits, so Beginner skills read 0001000. */
const skillId = (id: number) => String(id).padStart(7, "0");

/** The description without its "[Master Level: N]" line, which the Max Lv. badge already shows. */
const describe = (s: Skill) => s.desc?.replace(/^\[Master Level: ?\d+\](\\r\\n|\\n|\r?\n)?/, "") || null;

function matches(skill: Skill, needle: string): boolean {
  return skillId(skill.id).includes(needle)
    || (skill.name?.toLowerCase().includes(needle) ?? false)
    || (skill.desc?.toLowerCase().includes(needle) ?? false);
}

/** Every job's skills, grouped by job, with a search box and a class filter. */
export const SkillTable = memo(function SkillTable() {
  const { api, status } = useConnection();
  const [books, setBooks] = useState<SkillBook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [cls, setCls] = useState<JobClass | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (status !== "online" || books) return;
    let cancelled = false;
    api.skills().then(
      (list) => { if (!cancelled) { setBooks(list); setError(null); } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status, books]);

  // Only the classes this library has jobs for get a filter button.
  const present = useMemo(() => new Set((books ?? []).map((b) => jobClass(b.job))), [books]);
  const hasHidden = useMemo(() => (books ?? []).some((b) => b.skills.some((s) => s.hidden)), [books]);

  const needle = filter.trim().toLowerCase();
  const groups = useMemo(() => (books ?? [])
    .filter((b) => !cls || jobClass(b.job) === cls)
    .map((b) => {
      // A search that names the job (or its book) shows all of that job's skills.
      const jobHit = !!needle && (jobName(b).toLowerCase().includes(needle) || (b.book?.toLowerCase().includes(needle) ?? false));
      return { book: b, skills: b.skills.filter((s) => (showHidden || !s.hidden) && (!needle || jobHit || matches(s, needle))) };
    })
    .filter((g) => g.skills.length > 0), [books, cls, needle, showHidden]);

  const visibleSkills = (b: SkillBook) => b.skills.filter((s) => showHidden || !s.hidden).length;
  const total = useMemo(() => (books ?? []).reduce((n, b) => n + visibleSkills(b), 0), [books, showHidden]);
  const jobs = useMemo(() => (books ?? []).filter((b) => visibleSkills(b) > 0).length, [books, showHidden]);
  const shown = groups.reduce((n, g) => n + g.skills.length, 0);

  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const chip = (on: boolean) => `shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
    on
      ? "border-accent-500 bg-accent-50 text-accent-700 dark:border-accent-500/60 dark:bg-accent-600/15 dark:text-accent-200"
      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
  }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3 border-b border-zinc-100 px-4 py-3 sm:px-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative block min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") setFilter(""); }}
              placeholder="Search by name, id, description or job…"
              aria-label="Search skills"
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
          {hasHidden && (
            <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="size-4 accent-accent-600" />
              Show hidden skills
            </label>
          )}
        </div>
        <div role="group" aria-label="Class" className="flex gap-2 overflow-x-auto pb-0.5">
          <button type="button" aria-pressed={cls === null} onClick={() => setCls(null)} className={chip(cls === null)}>All</button>
          {CLASSES.filter((c) => present.has(c)).map((c) => (
            <button key={c} type="button" aria-pressed={cls === c} onClick={() => setCls(cls === c ? null : c)} className={chip(cls === c)}>
              {CLASS_LABEL[c]}
            </button>
          ))}
        </div>
        <p className="px-1 text-xs text-zinc-500">
          {books ? (needle || cls ? `${shown.toLocaleString()} of ${total.toLocaleString()} skills` : `${total.toLocaleString()} skills in ${jobs} jobs`) : error ? "" : "Loading…"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        {!books && !error && (
          <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-12 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>
        )}
        {books && groups.length === 0 && <p className="px-6 py-12 text-center text-sm text-zinc-500">No skills match.</p>}

        {groups.map(({ book, skills }) => (
          <section key={book.job} aria-label={jobName(book)}>
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-100 bg-zinc-50/95 px-4 py-2.5 backdrop-blur sm:px-6 dark:border-zinc-800 dark:bg-zinc-950/90">
              <span className="grid size-8 shrink-0 place-items-center">
                {book.hasIcon && <img src={api.skillBookIconUrl(book.job)} alt="" className="max-h-8 max-w-8 [image-rendering:pixelated]" />}
              </span>
              <h2 className="text-sm font-semibold">{jobName(book)}</h2>
              <span className="font-mono text-xs tabular-nums text-zinc-500">{book.job}</span>
              {book.book && book.book !== jobName(book) && <span className="hidden truncate text-xs text-zinc-500 sm:inline">· {book.book}</span>}
              <span className="ml-auto shrink-0 text-xs text-zinc-500">{skills.length} {skills.length === 1 ? "skill" : "skills"}</span>
            </header>

            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {skills.map((s) => {
                const expanded = open.has(s.id);
                const canExpand = s.levels.length > 0;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => canExpand && toggle(s.id)}
                      aria-expanded={canExpand ? expanded : undefined}
                      className={`flex w-full items-start gap-4 px-4 py-3 text-left sm:px-6 ${canExpand ? "transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50" : "cursor-default"}`}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                        <img src={api.skillIconUrl(s.id)} alt="" loading="lazy" className="max-h-8 max-w-8 [image-rendering:pixelated]"
                          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                      </span>
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                          <span className="text-[13px] font-semibold">{s.name || <span className="italic font-normal text-zinc-400">(unnamed)</span>}</span>
                          <span className="font-mono text-xs tabular-nums text-zinc-500">{skillId(s.id)}</span>
                          {s.maxLevel > 0 && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Max Lv. {s.maxLevel}</span>}
                          {s.hidden && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">Hidden</span>}
                        </span>
                        {describe(s) && <span className="block text-[13px] leading-6 text-zinc-600 dark:text-zinc-400"><SkillText text={describe(s)!} /></span>}
                      </span>
                      {canExpand && (expanded
                        ? <ChevronDown className="mt-1 size-4 shrink-0 text-zinc-400" />
                        : <ChevronRight className="mt-1 size-4 shrink-0 text-zinc-400" />)}
                    </button>
                    {expanded && (
                      <ol className="mb-3 ml-[4.25rem] mr-4 space-y-1 rounded-xl border border-zinc-100 bg-zinc-50/60 p-3 text-[13px] leading-6 sm:ml-[4.75rem] sm:mr-6 dark:border-zinc-800 dark:bg-zinc-950/40">
                        {s.levels.map((text, i) => (
                          <li key={i} className="flex gap-3">
                            {s.levels.length > 1 && <span className="w-12 shrink-0 font-mono text-xs leading-6 tabular-nums text-zinc-400">Lv. {i + 1}</span>}
                            <SkillText text={text} />
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
});
