import { createContext, memo, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LookupKind, LookupRequest, PropTree, QuestChain, QuestDetail } from "../lib/api";
import { useConnection } from "../lib/connection";
import {
  JOB_NAMES, QUEST_STATES, STAGE_LABELS, formatMinutes, formatStamp, parseMapleText, refsInText, type TextColor,
} from "../lib/quest-format";
import { useNames } from "../lib/use-names";
import { Archive } from "./icons";
import { RefCtx, RefIcon, RefLink } from "./ref-link";
import { buttonSecondary } from "./ui";

// ------------------------------------------------------------------ tree helpers

const kids = (t?: PropTree | null) => t?.children ?? [];
const child = (t: PropTree | null | undefined, name: string) => kids(t).find((c) => c.name === name);
const int = (t?: PropTree | null) => (t && t.value != null && /^-?\d+$/.test(t.value) ? Number(t.value) : undefined);
const isNumbered = (t: PropTree) => /^\d+$/.test(t.name);
const isString = (t: PropTree) => t.type === "string" && !t.children;

/** Which kind of thing the `id` of each entry in these lists refers to. */
const LIST_KIND: Record<string, LookupKind> = { item: "item", mob: "mob", quest: "quest", skill: "skill", pet: "item", mbcard: "item" };
/** Lists whose entries are bare map ids. */
const MAP_LISTS = new Set(["fieldEnter", "map"]);
const ITEM_LISTS = new Set(["equipAllNeed", "equipSelectNeed"]);

/** Every id these quests mention, so all the names can be fetched in one request. */
function collectIds(ds: (QuestDetail | null)[]): LookupRequest {
  const out: LookupRequest = {};
  const push = (kind: LookupKind, id: number | undefined) => { if (id != null) (out[kind] ??= []).push(id); };

  const walk = (t: PropTree) => {
    const listKind = LIST_KIND[t.name];
    if (listKind) for (const e of kids(t)) push(listKind, int(child(e, "id")));
    if (MAP_LISTS.has(t.name)) for (const e of kids(t)) push("map", int(e));
    if (ITEM_LISTS.has(t.name)) for (const e of kids(t)) push("item", int(e));

    for (const c of kids(t)) {
      if (c.name === "npc") push("npc", int(c));
      else if (c.name === "nextQuest") push("quest", int(c));
      else if (c.name === "buffItemID" || c.name === "viewMedalItem") push("item", int(c));
      else if (c.name === "selectedSkillID") push("skill", int(c));
      if (c.type === "string" && c.value) refsInText(c.value, out);
      walk(c);
    }
  };

  for (const d of ds) if (d) for (const section of [d.info, d.check, d.say, d.act]) if (section) walk(section);
  return out;
}

// ------------------------------------------------------------------ shared bits

const NamesCtx = createContext<(kind: LookupKind, id: number) => string | undefined>(() => undefined);

const KIND_LABEL: Record<LookupKind, string> = { npc: "NPC", item: "Item", mob: "Mob", map: "Map", skill: "Skill", quest: "Quest" };

/** "Paul (9000000)" once the name is known, "NPC 9000000" until then (or when there is no String.wz). */
function Ref({ kind, id }: { kind: LookupKind; id: number }) {
  const name = useContext(NamesCtx)(kind, id);
  return (
    <RefLink kind={kind} id={id} name={name}>
      {name
        ? <><span className="font-medium">{name}</span> <span className="font-mono text-xs text-zinc-500">({id})</span></>
        : <span className="font-mono text-[13px]"><span className="text-zinc-500">{KIND_LABEL[kind]}</span> {id}</span>}
    </RefLink>
  );
}

const COLOR_CLASS: Record<Exclude<TextColor, null>, string> = {
  blue: "text-sky-600 dark:text-sky-400",
  red: "text-rose-600 dark:text-rose-400",
  green: "text-emerald-600 dark:text-emerald-400",
  purple: "text-violet-600 dark:text-violet-400",
};

/** Renders in-game text: colours, bold, line breaks and #p/#t/#o/#m references (resolved to names when known). */
function MapleText({ text }: { text: string }) {
  const nameOf = useContext(NamesCtx);
  const tokens = useMemo(() => parseMapleText(text), [text]);
  return (
    <span className="whitespace-pre-wrap break-words">
      {tokens.map((t, i) => {
        switch (t.kind) {
          case "br": return <br key={i} />;
          case "choice": return <span key={i}><br /><span className="text-accent-600 dark:text-accent-400">▸ </span></span>;
          case "choiceEnd": return <br key={i} />;
          case "icon":
            return t.ref
              ? <RefIcon key={i} kind={t.ref.kind} id={t.ref.id} label={t.label} />
              : <span key={i} className="mx-0.5 rounded bg-zinc-100 px-1.5 py-0.5 align-baseline font-mono text-[11px] text-zinc-500 dark:bg-zinc-800">{t.label}</span>;
          case "player": return <span key={i} className={`italic ${t.color ? COLOR_CLASS[t.color] : ""}`}>{"<player>"}</span>;
          case "ref": {
            const n = nameOf(t.ref, t.id);
            return (
              <RefLink key={i} kind={t.ref} id={t.id} name={n}>
                <span className={`${t.color ? COLOR_CLASS[t.color] : ""} ${t.bold ? "font-bold" : ""}`}>{n ?? `${KIND_LABEL[t.ref]} ${t.id}`}</span>
              </RefLink>
            );
          }
          default: return <span key={i} className={`${t.color ? COLOR_CLASS[t.color] : ""} ${t.bold ? "font-bold" : ""}`}>{t.text}</span>;
        }
      })}
    </span>
  );
}

function Card({ title, subtitle, onOpenRaw, children }: { title: string; subtitle?: string; onOpenRaw?: () => void; children: ReactNode }) {
  return (
    <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {onOpenRaw && (
          <button type="button" onClick={onOpenRaw} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
            <Archive className="size-3.5" />Raw tree
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function StageCard({ label, stage, children, empty }: { label: string; stage: number | string; children: ReactNode; empty: boolean }) {
  return (
    <div className="min-w-0 space-y-4 rounded-xl bg-zinc-50 p-5 dark:bg-zinc-950/60">
      <div className="flex items-center gap-2.5">
        <span className="grid size-5 place-items-center rounded-md bg-zinc-200 font-mono text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{stage}</span>
        <h4 className="text-sm font-semibold">{label}</h4>
      </div>
      {empty ? <p className="text-sm text-zinc-400">Nothing set.</p> : children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-1 text-[13px] leading-6">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

const Chip = ({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "emerald" | "rose" | "amber" }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${{
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    rose: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  }[tone]}`}>{children}</span>
);

/** Fallback for keys without special handling, so nothing in the file is ever hidden. */
function Generic({ node }: { node: PropTree }) {
  if (node.children?.length) {
    return (
      <Row label={node.name}>
        <ul className="space-y-1">
          {node.children.map((c, i) => (
            <li key={i} className="flex gap-2"><span className="text-zinc-500">{c.name}:</span> {c.children?.length ? <Generic node={c} /> : <MapleText text={c.value ?? ""} />}</li>
          ))}
        </ul>
      </Row>
    );
  }
  return <Row label={node.name}>{node.type === "string" ? <MapleText text={node.value ?? ""} /> : <span className="font-mono">{node.value ?? "—"}</span>}</Row>;
}

const List = ({ children }: { children: ReactNode }) => <ul className="space-y-1">{children}</ul>;

// ------------------------------------------------------------------ Check / Act

const CHECK_HANDLED = new Set(["npc", "lvmin", "lvmax", "level", "job", "quest", "item", "mob", "fieldEnter", "skill", "pet", "start", "end", "interval", "startscript", "endscript"]);

function levelText(stage: PropTree) {
  const min = int(child(stage, "lvmin")), max = int(child(stage, "lvmax")), exact = int(child(stage, "level"));
  if (exact != null) return `${exact}`;
  if (min != null && max != null) return `${min} – ${max}`;
  if (min != null) return `${min} or higher`;
  if (max != null) return `${max} or lower`;
  return null;
}

function Requirements({ stage }: { stage: PropTree }) {
  const npc = int(child(stage, "npc"));
  const level = levelText(stage);
  const jobs = kids(child(stage, "job")).map(int).filter((n): n is number => n != null);
  const quests = kids(child(stage, "quest"));
  const items = kids(child(stage, "item"));
  const mobs = kids(child(stage, "mob"));
  const maps = kids(child(stage, "fieldEnter")).map(int).filter((n): n is number => n != null);
  const skills = kids(child(stage, "skill"));
  const pets = kids(child(stage, "pet"));
  const start = child(stage, "start")?.value, end = child(stage, "end")?.value;
  const interval = int(child(stage, "interval"));
  const scripts = ["startscript", "endscript"].map((k) => child(stage, k)).filter((n): n is PropTree => !!n);

  return (
    <dl className="space-y-3">
      {npc != null && <Row label="NPC"><Ref kind="npc" id={npc} /></Row>}
      {level && <Row label="Level">{level}</Row>}
      {jobs.length > 0 && <Row label="Jobs"><div className="flex flex-wrap gap-1.5">{jobs.map((j) => <Chip key={j}>{JOB_NAMES[j] ?? j}</Chip>)}</div></Row>}
      {quests.length > 0 && (
        <Row label="Quests">
          <List>{quests.map((q, i) => {
            const id = int(child(q, "id")), state = int(child(q, "state"));
            return id == null ? null : <li key={i}><Ref kind="quest" id={id} />{state != null && <> <Chip tone={state === 2 ? "emerald" : "amber"}>{QUEST_STATES[state] ?? `state ${state}`}</Chip></>}</li>;
          })}</List>
        </Row>
      )}
      {items.length > 0 && (
        <Row label="Items">
          <List>{items.map((it, i) => {
            const id = int(child(it, "id")), count = int(child(it, "count"));
            return id == null ? null : <li key={i}><Ref kind="item" id={id} />{count != null && <span className="text-zinc-500"> × {count}</span>}</li>;
          })}</List>
        </Row>
      )}
      {mobs.length > 0 && (
        <Row label="Defeat">
          <List>{mobs.map((m, i) => {
            const id = int(child(m, "id")), count = int(child(m, "count"));
            return id == null ? null : <li key={i}><Ref kind="mob" id={id} />{count != null && <span className="text-zinc-500"> × {count}</span>}</li>;
          })}</List>
        </Row>
      )}
      {maps.length > 0 && <Row label="Enter map"><List>{maps.map((m) => <li key={m}><Ref kind="map" id={m} /></li>)}</List></Row>}
      {skills.length > 0 && <Row label="Skills"><List>{skills.map((s, i) => { const id = int(child(s, "id")); return id == null ? null : <li key={i}><Ref kind="skill" id={id} /></li>; })}</List></Row>}
      {pets.length > 0 && <Row label="Pets"><List>{pets.map((p, i) => { const id = int(child(p, "id")); return id == null ? null : <li key={i}><Ref kind="item" id={id} /></li>; })}</List></Row>}
      {start && <Row label="Available from">{formatStamp(start)}</Row>}
      {end && <Row label="Available until">{formatStamp(end)}</Row>}
      {interval != null && <Row label="Repeat every">{interval === 0 ? "—" : formatMinutes(interval)}</Row>}
      {scripts.map((s) => <Row key={s.name} label={s.name === "startscript" ? "Start script" : "End script"}><span className="font-mono">{s.value}</span></Row>)}
      {kids(stage).filter((c) => !CHECK_HANDLED.has(c.name)).map((c) => <Generic key={c.name} node={c} />)}
    </dl>
  );
}

const ACT_HANDLED = new Set(["exp", "money", "pop", "nextQuest", "item", "quest", "skill", "map", "fieldEnter", "buffItemID", "npc", "message", "ask", "yes", "no", "stop", "lost", "default"]);

function Actions({ stage }: { stage: PropTree }) {
  const exp = int(child(stage, "exp")), money = int(child(stage, "money")), pop = int(child(stage, "pop"));
  const nextQuest = int(child(stage, "nextQuest"));
  const npc = int(child(stage, "npc"));
  const buff = int(child(stage, "buffItemID"));
  const items = kids(child(stage, "item"));
  const quests = kids(child(stage, "quest"));
  const skills = kids(child(stage, "skill"));
  const maps = [...kids(child(stage, "map")), ...kids(child(stage, "fieldEnter"))].map(int).filter((n): n is number => n != null);
  const message = child(stage, "message");

  // The sign of `count` decides direction: positive gives the item, negative takes it.
  const given = items.filter((it) => (int(child(it, "count")) ?? 1) >= 0);
  const taken = items.filter((it) => (int(child(it, "count")) ?? 1) < 0);
  // Some quests keep their dialogue inside Act; show it the same way as Say.
  const hasDialogue = kids(stage).some((c) => ["yes", "no", "stop", "lost", "ask"].includes(c.name) || (isNumbered(c) && isString(c)));

  const itemLine = (it: PropTree, i: number, negate: boolean) => {
    const id = int(child(it, "id")), count = int(child(it, "count"));
    if (id == null) return null;
    const meta: string[] = [];
    const period = int(child(it, "period")); if (period) meta.push(`lasts ${formatMinutes(period)}`);
    const expire = child(it, "dateExpire")?.value; if (expire) meta.push(`expires ${formatStamp(expire)}`);
    const prop = int(child(it, "prop")); if (prop != null) meta.push(`prop ${prop}`);
    const gender = int(child(it, "gender")); if (gender != null) meta.push(gender === 0 ? "male only" : gender === 1 ? "female only" : "any gender");
    const job = int(child(it, "job")); if (job != null) meta.push(`job flag ${job}`);
    const variant = int(child(it, "var")); if (variant != null) meta.push(`var ${variant}`);
    return (
      <li key={i}>
        <Ref kind="item" id={id} /><span className="whitespace-nowrap text-zinc-500"> × {negate && count != null ? Math.abs(count) : count ?? 1}</span>
        {meta.length > 0 && <div className="text-xs leading-5 text-zinc-500">{meta.join(" · ")}</div>}
      </li>
    );
  };

  const skipDialogue = (c: PropTree) => !ACT_HANDLED.has(c.name) && !(isNumbered(c) && isString(c));

  return (
    <div className="space-y-5">
      <dl className="space-y-3">
        {exp != null && <Row label="Experience"><span className="font-mono">{exp >= 0 ? "+" : ""}{exp.toLocaleString()}</span></Row>}
        {money != null && <Row label="Mesos">{money >= 0 ? <Chip tone="emerald">Give</Chip> : <Chip tone="rose">Take</Chip>} <span className="font-mono">{Math.abs(money).toLocaleString()}</span></Row>}
        {pop != null && <Row label="Fame"><span className="font-mono">{pop >= 0 ? "+" : ""}{pop}</span></Row>}
        {given.length > 0 && <Row label="Give items"><List>{given.map((it, i) => itemLine(it, i, false))}</List></Row>}
        {taken.length > 0 && <Row label="Take items"><List>{taken.map((it, i) => itemLine(it, i, true))}</List></Row>}
        {quests.length > 0 && (
          <Row label="Set quests">
            <List>{quests.map((q, i) => {
              const id = int(child(q, "id")), state = int(child(q, "state"));
              return id == null ? null : <li key={i}><Ref kind="quest" id={id} />{state != null && <> <Chip>{QUEST_STATES[state] ?? `state ${state}`}</Chip></>}</li>;
            })}</List>
          </Row>
        )}
        {nextQuest != null && <Row label="Next quest"><Ref kind="quest" id={nextQuest} /></Row>}
        {skills.length > 0 && (
          <Row label="Skills">
            <List>{skills.map((s, i) => {
              const id = int(child(s, "id")); if (id == null) return null;
              const level = int(child(s, "skillLevel")), master = int(child(s, "masterLevel"));
              return <li key={i}><Ref kind="skill" id={id} />{(level != null || master != null) && <span className="ml-2 text-xs text-zinc-500">{[level != null && `level ${level}`, master != null && `master ${master}`].filter(Boolean).join(" · ")}</span>}</li>;
            })}</List>
          </Row>
        )}
        {maps.length > 0 && <Row label="Map"><List>{maps.map((m, i) => <li key={i}><Ref kind="map" id={m} /></li>)}</List></Row>}
        {buff != null && <Row label="Buff item"><Ref kind="item" id={buff} /></Row>}
        {npc != null && <Row label="NPC"><Ref kind="npc" id={npc} /></Row>}
        {message && <Row label="Message"><MapleText text={message.value ?? ""} /></Row>}
        {kids(stage).filter(skipDialogue).map((c) => <Generic key={c.name} node={c} />)}
      </dl>
      {hasDialogue && <div className="space-y-3"><h5 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Dialogue</h5><Dialogue node={stage} /></div>}
    </div>
  );
}

// ------------------------------------------------------------------ Say

const BRANCH_LABEL: Record<string, string> = {
  yes: "Player says yes", no: "Player says no", stop: "Conversation stops", lost: "Item was lost", default: "Default",
  npc: "NPC not met yet", item: "Items missing", mob: "Mobs not defeated", quest: "Quest requirement missing", info: "Progress info missing",
};

/** Pages (strings), flags (ints) and nested branches of one dialogue node, in file order. */
function Dialogue({ node }: { node: PropTree }) {
  const parts = kids(node);
  const pages = parts.filter((c) => isNumbered(c) && isString(c));
  const flags = parts.filter((c) => int(c) != null);
  const branches = parts.filter((c) => c.children && !isString(c));
  const strays = parts.filter((c) => !isNumbered(c) && isString(c));

  return (
    <div className="space-y-3">
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => <Chip key={f.name} tone="amber">{f.name} = {f.value}</Chip>)}
        </div>
      )}
      {pages.map((p, i) => (
        <div key={p.name} className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[13px] leading-6 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="mr-2 font-mono text-[11px] text-zinc-400">{i + 1}</span><MapleText text={p.value ?? ""} />
        </div>
      ))}
      {strays.map((s) => <Generic key={s.name} node={s} />)}
      {branches.map((b) => (
        <div key={b.name} className="space-y-2.5 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
          <p className="text-xs font-semibold text-zinc-500">{BRANCH_LABEL[b.name] ?? (isNumbered(b) ? `Branch ${Number(b.name) + 1}` : b.name)}</p>
          <Dialogue node={b} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Chain

interface ChainTotals {
  exp: number;
  money: number;
  pop: number;
  /** Item -> how many the chain's completion checks ask for in total, and how many the chain's own actions hand out. */
  collect: Map<number, { need: number; given: number }>;
  mobs: Map<number, number>;
  /** What the player keeps: every item an action gives, less what a later action takes back. */
  items: Map<number, number>;
  /** Items given only by chance or to some jobs/genders, so they can't simply be added up. */
  conditional: Map<number, number>;
  skills: Set<number>;
}

const addTo = (m: Map<number, number>, id: number, n: number) => m.set(id, (m.get(id) ?? 0) + n);

/** A reward that depends on luck, job or gender (gender 2 is "any"). */
const isConditional = (it: PropTree) => child(it, "prop") != null || child(it, "job") != null || (int(child(it, "gender")) ?? 2) !== 2;

function chainTotals(quests: QuestDetail[]): ChainTotals {
  const t: ChainTotals = { exp: 0, money: 0, pop: 0, collect: new Map(), mobs: new Map(), items: new Map(), conditional: new Map(), skills: new Set() };
  const given = new Map<number, number>();
  for (const q of quests) {
    const done = child(q.check, "1");
    for (const it of kids(child(done, "item"))) {
      // A count of 0 means "must not have it", which isn't something to collect.
      const id = int(child(it, "id")), count = int(child(it, "count")) ?? 1;
      if (id == null || count <= 0) continue;
      const c = t.collect.get(id) ?? { need: 0, given: 0 };
      c.need += count;
      t.collect.set(id, c);
    }
    for (const m of kids(child(done, "mob"))) {
      const id = int(child(m, "id")), count = int(child(m, "count")) ?? 1;
      if (id != null && count > 0) addTo(t.mobs, id, count);
    }
    for (const stage of [child(q.act, "0"), child(q.act, "1")]) {
      t.exp += int(child(stage, "exp")) ?? 0;
      t.money += int(child(stage, "money")) ?? 0;
      t.pop += int(child(stage, "pop")) ?? 0;
      for (const it of kids(child(stage, "item"))) {
        const id = int(child(it, "id")), count = int(child(it, "count")) ?? 1;
        if (id == null) continue;
        if (count > 0 && isConditional(it)) { addTo(t.conditional, id, count); continue; }
        addTo(t.items, id, count);
        if (count > 0) addTo(given, id, count);
      }
      for (const s of kids(child(stage, "skill"))) { const id = int(child(s, "id")); if (id != null) t.skills.add(id); }
    }
  }
  for (const [id, c] of t.collect) c.given = given.get(id) ?? 0;
  return t;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-950/60">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 truncate font-mono text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString()}`;

/** One line per quest: who starts and ends it, its level, and what it asks for and gives. */
function ChainStep({ quest, index, viewing }: { quest: QuestDetail; index: number; viewing: boolean }) {
  const start = child(quest.check, "0"), done = child(quest.check, "1");
  const startNpc = int(child(start, "npc")), endNpc = int(child(done, "npc"));
  const level = start && levelText(start);
  const exp = (int(child(child(quest.act, "0"), "exp")) ?? 0) + (int(child(child(quest.act, "1"), "exp")) ?? 0);
  const items = kids(child(done, "item")).filter((it) => (int(child(it, "count")) ?? 1) > 0).length;
  const mobs = kids(child(done, "mob")).length;
  const facts = [
    level && `Lv ${level}`,
    items > 0 && `${items} item${items === 1 ? "" : "s"} to bring`,
    mobs > 0 && `${mobs} mob${mobs === 1 ? "" : "s"} to defeat`,
    exp !== 0 && `${signed(exp)} EXP`,
  ].filter(Boolean);

  return (
    <li className={`flex gap-3 rounded-xl px-3 py-2.5 ${viewing ? "bg-accent-50 dark:bg-accent-600/15" : ""}`}>
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-zinc-200 font-mono text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{index + 1}</span>
      <div className="min-w-0 space-y-1 text-[13px] leading-6">
        <div><Ref kind="quest" id={quest.id} />{viewing && <> <Chip tone="emerald">Viewing</Chip></>}</div>
        {(startNpc != null || endNpc != null) && (
          <div className="text-zinc-500">
            {startNpc != null && <>From <Ref kind="npc" id={startNpc} /></>}
            {startNpc != null && endNpc != null && " · "}
            {endNpc != null && endNpc !== startNpc && <>to <Ref kind="npc" id={endNpc} /></>}
            {endNpc != null && endNpc === startNpc && "and back"}
          </div>
        )}
        {facts.length > 0 && <div className="text-xs text-zinc-500">{facts.join(" · ")}</div>}
      </div>
    </li>
  );
}

/** "Name (id) × n" for each entry. */
const countList = (kind: LookupKind, entries: [number, number][]) => (
  <List>{entries.map(([id, n]) => <li key={id}><Ref kind={kind} id={id} /><span className="whitespace-nowrap text-zinc-500"> × {n.toLocaleString()}</span></li>)}</List>
);

/**
 * Totals for a chain, or (`selection`) for quests the user picked by hand, which needn't be related.
 * The same sums apply either way; only the wording changes.
 */
function ChainSummary({ chain, questId, selection = false }: { chain: QuestChain; questId?: number; selection?: boolean }) {
  const t = useMemo(() => chainTotals(chain.quests), [chain]);
  const of = selection ? "the selected quests'" : "the chain's";
  const by = selection ? "the selected quests" : "the chain";
  const toCollect = [...t.collect].filter(([, c]) => c.need > c.given);
  const toHandOver = [...t.collect].filter(([, c]) => c.need <= c.given);
  const kept = [...t.items].filter(([, n]) => n > 0);
  const firstLevel = (() => { const s = !selection && child(chain.quests[0]?.check, "0"); return s && levelText(s); })();

  const questList = (qs: QuestChain["before"]) => <List>{qs.map((q) => <li key={q.id}><Ref kind="quest" id={q.id} /></li>)}</List>;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
        <Stat label="Quests" value={chain.quests.length} />
        <Stat label="Experience" value={signed(t.exp)} />
        <Stat label="Mesos" value={signed(t.money)} />
        <Stat label="Fame" value={signed(t.pop)} />
      </div>

      <Card
        title={selection ? "Quests" : "Steps"}
        subtitle={selection ? "In the order they were picked." : `In play order${firstLevel ? `, starting at level ${firstLevel}` : ""}. Quests lead on through nextQuest, or by requiring the one before as their only completed quest.`}
      >
        {chain.before.length > 0 && <dl><Row label="Continues from">{questList(chain.before)}</Row></dl>}
        <ol className="-mx-3 space-y-1">
          {chain.quests.map((q, i) => <ChainStep key={q.id} quest={q} index={i} viewing={q.id === questId} />)}
        </ol>
        {chain.after.length > 0 && <dl><Row label={chain.after.length > 1 ? "Branches into" : "Leads into"}>{questList(chain.after)}</Row></dl>}
      </Card>

      <Card title="To do" subtitle={`Everything ${of} completion checks ask for, added up.`}>
        {toCollect.length === 0 && toHandOver.length === 0 && t.mobs.size === 0 && <p className="text-sm text-zinc-400">Nothing to collect or defeat.</p>}
        <dl className="space-y-3">
          {toCollect.length > 0 && (
            <Row label="Collect">
              <List>{toCollect.map(([id, c]) => (
                <li key={id}>
                  <Ref kind="item" id={id} /><span className="whitespace-nowrap text-zinc-500"> × {(c.need - c.given).toLocaleString()}</span>
                  {c.given > 0 && <div className="text-xs leading-5 text-zinc-500">{c.need.toLocaleString()} asked for, {c.given.toLocaleString()} handed out by {by}</div>}
                </li>
              ))}</List>
            </Row>
          )}
          {t.mobs.size > 0 && <Row label="Defeat">{countList("mob", [...t.mobs])}</Row>}
          {toHandOver.length > 0 && <Row label="Deliver">{countList("item", toHandOver.map(([id, c]): [number, number] => [id, c.need]))}<p className="text-xs leading-5 text-zinc-500">Given to you by {by} {selection ? "themselves" : "itself"}.</p></Row>}
        </dl>
      </Card>

      <Card title="Rewards" subtitle={`Everything ${of} actions give, less items a later ${selection ? "one" : "step"} takes back.`}>
        <dl className="space-y-3">
          <Row label="Experience"><span className="font-mono">{signed(t.exp)}</span></Row>
          <Row label="Mesos"><span className="font-mono">{signed(t.money)}</span></Row>
          {t.pop !== 0 && <Row label="Fame"><span className="font-mono">{signed(t.pop)}</span></Row>}
          {kept.length > 0 && <Row label="Items">{countList("item", kept)}</Row>}
          {t.conditional.size > 0 && <Row label="Maybe">{countList("item", [...t.conditional])}<p className="text-xs leading-5 text-zinc-500">Given by chance, or only to some jobs or genders.</p></Row>}
          {t.skills.size > 0 && <Row label="Skills"><List>{[...t.skills].map((id) => <li key={id}><Ref kind="skill" id={id} /></li>)}</List></Row>}
        </dl>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ selection

/** A summary of several hand-picked quests, laid out like a chain's. */
export const QuestSelectionView = memo(function QuestSelectionView({ fileId, revision, questIds, onOpenQuest, onClear }: {
  fileId: string;
  revision: number;
  /** In the order they were picked. */
  questIds: number[];
  onOpenQuest: (id: number) => void;
  onClear: () => void;
}) {
  const refs = useMemo(() => ({ fileId, openQuest: onOpenQuest }), [fileId, onOpenQuest]);
  const { api } = useConnection();
  // Quests already fetched, so ticking one more only loads that one. Dropped when the file changes.
  const key = `${fileId}:${revision}`;
  const [cache, setCache] = useState<{ key: string; quests: Map<number, QuestDetail> }>({ key: "", quests: new Map() });
  const known = cache.key === key ? cache.quests : null;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const missing = questIds.filter((id) => !known?.has(id));
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map((id) => api.quest(fileId, id))).then(
      (ds) => {
        if (cancelled) return;
        setError(null);
        setCache((c) => {
          const quests = new Map(c.key === key ? c.quests : []);
          for (const d of ds) quests.set(d.id, d);
          return { key, quests };
        });
      },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, fileId, key, questIds, known]);

  const quests = useMemo(() => questIds.flatMap((id) => known?.get(id) ?? []), [questIds, known]);
  const chain = useMemo<QuestChain>(() => ({ quests, before: [], after: [] }), [quests]);
  const names = useNames(fileId, useMemo(() => collectIds(quests), [quests]), revision);
  const loading = quests.length < questIds.length;

  if (error) return <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>;
  if (!quests.length) {
    return <div className="space-y-4 p-6">{[24, 56, 40].map((h, i) => <div key={i} className="skeleton rounded-xl bg-zinc-100 dark:bg-zinc-800" style={{ height: h * 3 }} />)}</div>;
  }

  return (
    <RefCtx.Provider value={refs}>
    <NamesCtx.Provider value={names}>
      <div className="@container space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">
            {questIds.length} quests selected
            {loading && <span className="ml-2 text-sm font-normal text-zinc-500">Loading…</span>}
          </h2>
          <button type="button" onClick={onClear} className={`${buttonSecondary} !py-1.5`}>Clear selection</button>
        </header>
        <ChainSummary chain={chain} selection />
      </div>
    </NamesCtx.Provider>
    </RefCtx.Provider>
  );
});

// ------------------------------------------------------------------ the view

const INFO_HANDLED = new Set(["name", "parent", "area", "order", "0", "1", "2", "summary", "demandSummary", "rewardSummary", "type", "autoStart", "autoComplete", "autoAccept", "autoPreComplete", "oneShot"]);
const INFO_FLAGS: Record<string, string> = { autoStart: "Auto start", autoAccept: "Auto accept", autoPreComplete: "Auto pre-complete", autoComplete: "Auto complete", oneShot: "One shot" };

export const QuestDetailView = memo(function QuestDetailView({ fileId, revision, questId, onOpenRaw, onOpenQuest }: {
  fileId: string;
  revision: number;
  questId: number;
  /** Left out when there's no raw tree to show. */
  onOpenRaw?: (path: string) => void;
  /** Jump to another quest in this archive (quest links). */
  onOpenQuest: (id: number) => void;
}) {
  const refs = useMemo(() => ({ fileId, openQuest: onOpenQuest }), [fileId, onOpenQuest]);
  const { api } = useConnection();
  const [detail, setDetail] = useState<QuestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.quest(fileId, questId).then(
      (d) => { if (!cancelled) setDetail(d); },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, fileId, questId, revision]);

  const [chain, setChain] = useState<QuestChain | null>(null);
  const [view, setView] = useState<"quest" | "chain">("quest");
  useEffect(() => {
    let cancelled = false;
    // Without a chain the quest is still shown, just with no Chain tab.
    api.questChain(fileId, questId).then(
      (c) => { if (!cancelled) setChain(c); },
      () => { if (!cancelled) setChain(null); },
    );
    return () => { cancelled = true; };
  }, [api, fileId, questId, revision]);

  // Don't flash the previous quest's data under the new heading while it loads.
  const current = detail?.id === questId ? detail : null;
  // Moving along the chain keeps it (and the tab) on screen until the refetch lands, since it's the same chain.
  const currentChain = chain && chain.quests.length > 1 && chain.quests.some((q) => q.id === questId) ? chain : null;
  const names = useNames(fileId, useMemo(() => collectIds([current, ...(currentChain?.quests ?? [])]), [current, currentChain]), revision);

  if (error) return <p role="alert" className="p-6 text-sm text-rose-600 dark:text-rose-400">{error}</p>;
  if (!current) {
    return <div className="space-y-4 p-6">{[24, 56, 40].map((h, i) => <div key={i} className="skeleton rounded-xl bg-zinc-100 dark:bg-zinc-800" style={{ height: h * 3 }} />)}</div>;
  }

  const { info, check, say, act, paths } = current;
  const stageOf = (t: PropTree | null, n: number) => child(t, String(n));
  const journal = [0, 1, 2].map((n) => ({ n, node: child(info, String(n)) })).filter((j) => j.node && j.node.value);
  const flags = Object.keys(INFO_FLAGS).filter((k) => int(child(info, k)) === 1);
  const parent = child(info, "parent")?.value, type = child(info, "type")?.value, area = int(child(info, "area")), order = int(child(info, "order"));
  const summaries = (["summary", "demandSummary", "rewardSummary"] as const).map((k) => ({ k, node: child(info, k) })).filter((s) => s.node?.value);

  // Stage keys other than 0/1 do exist (e.g. a few Check entries); keep them visible rather than dropping them.
  const extraStages = (t: PropTree | null) => kids(t).filter((c) => c.name !== "0" && c.name !== "1");

  return (
    <RefCtx.Provider value={refs}>
    <NamesCtx.Provider value={names}>
      <div className="@container space-y-6 p-6">
        <header className="space-y-3">
          <h2 className="text-xl font-semibold tracking-tight">
            <span className="font-mono text-base text-zinc-500">{current.id}</span> - {current.name || <span className="italic text-zinc-400">(unnamed)</span>}
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {parent && <Chip>{parent}</Chip>}
            {type && <Chip tone="amber">{type}</Chip>}
            {area != null && <Chip>area {area}</Chip>}
            {order != null && <Chip>order {order}</Chip>}
            {flags.map((f) => <Chip key={f} tone="emerald">{INFO_FLAGS[f]}</Chip>)}
          </div>
        </header>

        {currentChain && (
          <div role="tablist" aria-label="Quest view" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
            {(["quest", "chain"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={view === t}
                onClick={() => setView(t)}
                className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-[13px] font-medium transition ${
                  view === t
                    ? "border-accent-500 text-accent-700 dark:text-accent-300"
                    : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                {t === "quest" ? "Quest" : `Chain · ${currentChain.quests.length} quests`}
              </button>
            ))}
          </div>
        )}

        {currentChain && view === "chain" ? <ChainSummary chain={currentChain} questId={questId} /> : <>
        <Card title="About" subtitle={`${paths.info}: journal text and summaries`} onOpenRaw={onOpenRaw && (() => onOpenRaw(paths.info))}>
          {journal.length === 0 && summaries.length === 0 && <p className="text-sm text-zinc-400">No text.</p>}
          <div className="grid gap-4 @2xl:grid-cols-3">
            {journal.map(({ n, node }) => (
              <StageCard key={n} stage={n} label={STAGE_LABELS.info[n as 0 | 1 | 2]} empty={false}>
                <p className="text-[13px] leading-6"><MapleText text={node!.value ?? ""} /></p>
              </StageCard>
            ))}
          </div>
          {summaries.length > 0 && (
            <dl className="space-y-3">
              {summaries.map(({ k, node }) => <Row key={k} label={k === "summary" ? "Summary" : k === "demandSummary" ? "Needs" : "Rewards"}><MapleText text={node!.value ?? ""} /></Row>)}
            </dl>
          )}
          {kids(info).filter((c) => !INFO_HANDLED.has(c.name)).length > 0 && (
            <dl className="space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              {kids(info).filter((c) => !INFO_HANDLED.has(c.name)).map((c) => <Generic key={c.name} node={c} />)}
            </dl>
          )}
        </Card>

        <Card title="Requirements" subtitle={`${paths.check}: what the player must satisfy`} onOpenRaw={onOpenRaw && (() => onOpenRaw(paths.check))}>
          <div className="grid gap-4 @2xl:grid-cols-2">
            {[0, 1].map((n) => {
              const s = stageOf(check, n);
              return <StageCard key={n} stage={n} label={STAGE_LABELS.check[n as 0 | 1]} empty={!kids(s).length}>{s && <Requirements stage={s} />}</StageCard>;
            })}
          </div>
          {extraStages(check).map((s) => <StageCard key={s.name} stage={s.name} label={`Entry “${s.name}”`} empty={!kids(s).length}><dl className="space-y-3">{kids(s).map((c) => <Generic key={c.name} node={c} />)}</dl></StageCard>)}
          {!check && <p className="text-sm text-zinc-400">Nothing at {paths.check}.</p>}
        </Card>

        <Card title="Dialogue" subtitle={`${paths.say}: what the NPC says`} onOpenRaw={onOpenRaw && (() => onOpenRaw(paths.say))}>
          <div className="grid gap-4">
            {[0, 1].map((n) => {
              const s = stageOf(say, n);
              return <StageCard key={n} stage={n} label={STAGE_LABELS.say[n as 0 | 1]} empty={!kids(s).length}>{s && <Dialogue node={s} />}</StageCard>;
            })}
          </div>
          {extraStages(say).map((s) => <StageCard key={s.name} stage={s.name} label={`Entry “${s.name}”`} empty={!kids(s).length}><Dialogue node={s} /></StageCard>)}
          {!say && <p className="text-sm text-zinc-400">Nothing at {paths.say}.</p>}
        </Card>

        <Card title="Actions" subtitle={`${paths.act}: what happens in-game. A negative count takes an item, a positive one gives it.`} onOpenRaw={onOpenRaw && (() => onOpenRaw(paths.act))}>
          <div className="grid gap-4 @2xl:grid-cols-2">
            {[0, 1].map((n) => {
              const s = stageOf(act, n);
              return <StageCard key={n} stage={n} label={STAGE_LABELS.act[n as 0 | 1]} empty={!kids(s).length}>{s && <Actions stage={s} />}</StageCard>;
            })}
          </div>
          {extraStages(act).map((s) => <StageCard key={s.name} stage={s.name} label={`Entry “${s.name}”`} empty={!kids(s).length}><dl className="space-y-3">{kids(s).map((c) => <Generic key={c.name} node={c} />)}</dl></StageCard>)}
          {!act && <p className="text-sm text-zinc-400">Nothing at {paths.act}.</p>}
        </Card>
        </>}
      </div>
    </NamesCtx.Provider>
    </RefCtx.Provider>
  );
});
