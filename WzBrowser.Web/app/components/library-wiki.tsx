import { useSearchParams } from "@remix-run/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LibraryFile, OpenedFile } from "../lib/api";
import { useConnection } from "../lib/connection";
import type { Focus } from "../lib/focus";
import { CommodityEditor } from "./commodity-editor";
import { libraryLabels } from "./file-picker";
import { MapTable } from "./map-table";
import { MobLocationTable } from "./mob-locations";
import { MobTable } from "./mob-table";
import { NpcQuestTable } from "./npc-quests";
import { QuestBrowser } from "./quest-browser";
import { SkillTable } from "./skill-table";

const KIND_TITLE: Record<NonNullable<LibraryFile["kind"]>, string> = { quest: "Quests", etc: "Cash Shop" };
const KIND_ABOUT: Record<NonNullable<LibraryFile["kind"]>, string> = {
  quest: "Every quest with its requirements, dialogue and rewards. Pick one from the index, or search by id or name.",
  etc: "Every Cash Shop entry in Commodity.img: the item sold, its price, how long it lasts and whether it's on sale.",
};

/** Shows a quest in its archive's tab (`archive` is the archive's library name). */
type OpenQuest = (archive: string, quest: number) => void;

/** What a data tab can link to. The `show*` links are left out when the library has no such tab. */
interface Links {
  openQuest: OpenQuest;
  /** The row another tab asked this one to show, while this is the open tab. */
  focus: Focus | null;
  showMap?: (id: number) => void;
  showMob?: (id: number) => void;
  showNpc?: (id: number) => void;
}

/** Tabs that aren't a file: they read data from across the library. Each is shown when the server says it has it. */
const DATA_TABS: readonly { key: string; title: string; has: "skills" | "mobs" | "mobLocations" | "maps" | "npcs"; about: string; view: (links: Links) => ReactNode }[] = [
  {
    // Skill.wz or a Packs/Skill_*.ms pack
    key: "skills", title: "Skills", has: "skills",
    about: "Every job's skills with their icons, descriptions and what each level does. Search by name, or narrow it to one class.",
    view: () => <SkillTable />,
  },
  {
    // Mob.wz (or its parts, or a Packs/Mob_*.ms pack), with String's names
    key: "mobs", title: "Mobs", has: "mobs",
    about: "Every mob with its level, HP, EXP and combat stats. Click a column to sort by it; search by name or id.",
    view: ({ focus }) => <MobTable focus={focus} />,
  },
  {
    // Etc's MobLocation.img, plus the spawn points in the maps themselves
    key: "mob-locations", title: "Mob Locations", has: "mobLocations",
    about: "Where every mob spawns, from Etc's MobLocation.img and the maps' own spawn points. Search by mob or map; open a mob to see each map's minimap, and pick one to see what else is there.",
    view: ({ focus, showMap }) => <MobLocationTable focus={focus} onShowMap={showMap} />,
  },
  {
    // Every map's life in the Map files, plus the mobs Etc's MobLocation.img lists there
    key: "maps", title: "Maps", has: "maps",
    about: "Every map with the mobs that spawn in it and the NPCs standing in it. Search by map, mob or NPC; open a map to see its minimap, and pick a mob to see its stats or an NPC to see its quests and maps.",
    view: ({ focus, showMob, showNpc }) => <MapTable focus={focus} onShowMob={showMob} onShowNpc={showNpc} />,
  },
  {
    // Check/0/npc and Check/1/npc of every quest archive
    key: "npcs", title: "NPCs", has: "npcs",
    about: "Every NPC that starts or ends a quest. Search by NPC or quest; open an NPC to see its quests and the maps it stands in, and pick one to go there.",
    view: ({ openQuest, focus, showMap }) => <NpcQuestTable onOpenQuest={openQuest} focus={focus} onShowMap={showMap} />,
  },
];

type Loaded = { file: OpenedFile } | { error: string };

/**
 * The browse-only layout: a pinned server's browsable files as one full page, like a wiki article with a tab per
 * file, instead of a window per file, plus tabs for skills, mobs, mob locations, maps and NPCs when the library has that data. The open tab is
 * kept in the address (`?tab=`), with the row a link showed in it (`&id=`), so it can be linked to.
 */
export function LibraryWiki() {
  const connection = useConnection();
  const { api, status, recheck } = connection;
  const [library, setLibrary] = useState<LibraryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [params, setParams] = useSearchParams();
  // A quest picked elsewhere (the NPC tab) for its archive's tab to show; a new object each time, so picking it again jumps again.
  const [questFocus, setQuestFocus] = useState<{ archive: string; quest: number } | null>(null);
  // A row picked in one data tab for another to show (a map, a mob, an NPC); a link to `?tab=…&id=…` starts there.
  const [rowFocus, setRowFocus] = useState<{ tab: string; focus: Focus } | null>(() => {
    const tab = params.get("tab"), id = Number(params.get("id"));
    return tab && params.get("id") && Number.isInteger(id) ? { tab, focus: { id } } : null;
  });

  useEffect(() => {
    if (status !== "online") return;
    let cancelled = false;
    api.library().then(
      (list) => { if (!cancelled) { setLibrary(list); setError(null); } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); },
    );
    return () => { cancelled = true; };
  }, [api, status]);

  const labels = useMemo(() => libraryLabels(library ?? []), [library]);
  // A tab is named after what the file holds; the file's own name is added only when two hold the same kind.
  const titles = useMemo(() => {
    const files = library ?? [];
    return new Map(files.map((f) => {
      const title = f.kind ? KIND_TITLE[f.kind] : labels.get(f.path)!;
      return [f.path, files.filter((o) => o.kind === f.kind).length > 1 ? `${title} · ${labels.get(f.path)}` : title];
    }));
  }, [library, labels]);

  const dataTabs = DATA_TABS.filter((t) => connection[t.has]);
  const dataActive = dataTabs.find((t) => t.key === params.get("tab")) ?? (library?.length === 0 ? dataTabs[0] : undefined);
  const active = dataActive ? undefined : library?.find((f) => f.name === params.get("tab")) ?? library?.[0];
  // Like the file tabs, a data tab stays mounted once it has been shown.
  const [dataSeen, setDataSeen] = useState<Set<string>>(new Set());
  useEffect(() => { if (dataActive) setDataSeen((s) => s.has(dataActive.key) ? s : new Set(s).add(dataActive.key)); }, [dataActive]);

  // Open the file behind a tab the first time it's shown; tabs already seen stay mounted so they keep their state.
  useEffect(() => {
    if (!active || status !== "online" || active.path in loaded) return;
    let cancelled = false;
    api.open(active.path, "Auto").then(
      (file) => { if (!cancelled) setLoaded((l) => ({ ...l, [active.path]: { file } })); },
      (e) => { if (!cancelled) setLoaded((l) => ({ ...l, [active.path]: { error: e instanceof Error ? e.message : String(e) } })); },
    );
    return () => { cancelled = true; };
  }, [api, status, active, loaded]);

  if (status === "offline" && !library) {
    return (
      <Notice title="The library is offline">
        The server isn't answering right now. This page connects again as soon as it's back.{" "}
        <button type="button" onClick={recheck} className="font-semibold text-accent-600 hover:underline dark:text-accent-400">Check again</button>
      </Notice>
    );
  }
  if (error) return <Notice title="The library couldn't be listed">{error}</Notice>;
  if (library && library.length === 0 && dataTabs.length === 0) return <Notice title="Nothing to browse yet">The library folder has no quest archives or Etc.wz.</Notice>;

  const go = (tab: string, id?: number) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set("tab", tab);
    if (id === undefined) n.delete("id"); else n.set("id", String(id));
    return n;
  }, { preventScrollReset: true });
  const select = (tab: string) => { go(tab); setRowFocus(null); };
  const openQuest: OpenQuest = (archive, quest) => { select(archive); setQuestFocus({ archive, quest }); };
  const show = (tab: string) => dataTabs.some((t) => t.key === tab)
    ? (id: number) => { go(tab, id); setRowFocus({ tab, focus: { id } }); }
    : undefined;
  const links = (tab: string): Links => ({
    openQuest,
    focus: rowFocus?.tab === tab && tab === dataActive?.key ? rowFocus.focus : null,
    showMap: show("maps"),
    showMob: show("mobs"),
    showNpc: show("npcs"),
  });
  const tabClass = (on: boolean) => `shrink-0 rounded-t-xl border px-5 py-2.5 text-sm font-medium transition ${
    on
      ? "border-zinc-200 border-b-white bg-white text-zinc-900 dark:border-zinc-800 dark:border-b-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
      : "border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
  }`;

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-4 pb-4 pt-5 sm:px-6 sm:pb-6">
        <div role="tablist" aria-label="Files" className="relative z-10 -mb-px flex shrink-0 gap-1 overflow-x-auto">
          {!library && Array.from({ length: 2 }, (_, i) => <div key={i} className="skeleton h-10 w-32 rounded-t-xl bg-zinc-100 dark:bg-zinc-800" />)}
          {library?.map((f) => {
            const on = f === active;
            return (
              <button
                key={f.path}
                type="button"
                role="tab"
                aria-selected={on}
                title={f.name}
                onClick={() => select(f.name)}
                className={tabClass(on)}
              >
                {titles.get(f.path)}
              </button>
            );
          })}
          {library && dataTabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={t === dataActive} onClick={() => select(t.key)} className={tabClass(t === dataActive)}>
              {t.title}
            </button>
          ))}
        </div>

        <article className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl rounded-tr-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {active && (
            <header className="shrink-0 border-b border-zinc-200 px-6 pb-4 pt-5 sm:px-8 dark:border-zinc-800">
              <h1 className="font-serif text-3xl tracking-tight">{titles.get(active.path)}</h1>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                From <span className="font-mono text-[13px] text-zinc-700 dark:text-zinc-300">{active.name}</span>
                {active.kind && <> · {KIND_ABOUT[active.kind]}</>}
              </p>
            </header>
          )}

          {dataActive && (
            <header className="shrink-0 border-b border-zinc-200 px-6 pb-4 pt-5 sm:px-8 dark:border-zinc-800">
              <h1 className="font-serif text-3xl tracking-tight">{dataActive.title}</h1>
              <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">{dataActive.about}</p>
            </header>
          )}
          {dataTabs.filter((t) => t === dataActive || dataSeen.has(t.key)).map((t) => (
            <div key={t.key} role="tabpanel" className={t === dataActive ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
              {t.view(links(t.key))}
            </div>
          ))}

          {library?.map((f) => {
            const l = loaded[f.path];
            if (!l) return f === active ? <Loading key={f.path} /> : null;
            return (
              <div key={f.path} role="tabpanel" className={f === active ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                {"error" in l ? (
                  <p role="alert" className="p-8 text-sm text-rose-600 dark:text-rose-400">{l.error}</p>
                ) : l.file.kind === "quest" ? (
                  <QuestBrowser fileId={l.file.id} revision={l.file.revision} focus={questFocus?.archive === f.name ? questFocus : null} />
                ) : l.file.kind === "etc" ? (
                  <CommodityEditor fileId={l.file.id} revision={l.file.revision} readOnly />
                ) : (
                  <p className="p-8 text-sm text-zinc-500">This file has no view of its own.</p>
                )}
              </div>
            );
          })}
          {!library && <Loading />}
        </article>
      </div>
    </div>
  );
}

function Loading() {
  return <div className="space-y-2 p-6">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800" />)}</div>;
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md space-y-4 rounded-2xl border border-zinc-200 bg-white p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="leading-7 text-zinc-600 dark:text-zinc-400">{children}</p>
      </div>
    </div>
  );
}
