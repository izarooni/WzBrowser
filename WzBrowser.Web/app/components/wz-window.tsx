import { memo, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useConnection } from "../lib/connection";
import type { OpenedFile } from "../lib/api";
import { LibraryScopeProvider, tableTopOf, type TableTop } from "../lib/library-api";
import { MIN_H, MIN_W, useActions, useWorkspaceData, type Win } from "../lib/workspace";
import { Archive, Download, Minus, Plus, Undo, XMark } from "./icons";
import { CanvasGallery } from "./canvas-gallery";
import { CharacterBrowser } from "./character-browser";
import { CommodityEditor } from "./commodity-editor";
import { ItemTable } from "./item-table";
import { MapTable } from "./map-table";
import { MobLocationTable } from "./mob-locations";
import { MobTable } from "./mob-table";
import { NodeTree } from "./node-tree";
import { NpcQuestTable } from "./npc-quests";
import { QuestBrowser } from "./quest-browser";

type Gesture =
    | { kind: "move"; sx: number; sy: number; x: number; y: number }
    | { kind: "resize"; sx: number; sy: number; w: number; h: number; dx: boolean; dy: boolean };

/** The file's own view ("main"), the library's table for its kind of data ("data"), and the raw tree. */
type View = "main" | "data" | "raw";

interface DataView {
    label: string;
    /** The health check's flag saying a pinned library has this data. */
    has: "mobs" | "mobLocations" | "maps" | "items" | "npcs";
    view: () => ReactNode;
}

/**
 * The library table a file gets as a tab (see {@link tableTopOf}). The tables read the pinned library, or without one
 * the install the file sits in, from disk, so they don't show unsaved edits.
 */
const DATA_VIEWS: Record<TableTop, DataView> = {
    mob: { label: "Mobs", has: "mobs", view: () => <MobTable focus={null} /> },
    etc: { label: "Mob Locations", has: "mobLocations", view: () => <MobLocationTable focus={null} /> },
    map: { label: "Maps", has: "maps", view: () => <MapTable focus={null} /> },
    item: { label: "Items", has: "items", view: () => <ItemTable /> },
    npc: { label: "NPCs", has: "npcs", view: () => <NpcQuestTable focus={null} /> },
};

/** The name of a file's own view's tab, or null when it only has the raw tree. */
function mainLabelOf(kind: OpenedFile["kind"] | undefined) {
    switch (kind) {
        case "quest": return "Quests";
        case "etc": return "Commodity";
        case "canvas":
        case "character":
        case "item": return "Thumbnails";
        case "skill": return "Skills";
        default: return null;
    }
}

/** A file's own view: the quest browser, the _Canvas gallery, the Character/Item/Skill thumbnails, or Commodity. */
function MainView({ file, onOpenRaw }: { file: OpenedFile; onOpenRaw?: (path: string) => void }) {
    switch (file.kind) {
        case "quest":
            return <QuestBrowser fileId={file.id} revision={file.revision} onOpenRaw={onOpenRaw} />;
        case "canvas":
            return <CanvasGallery fileId={file.id} revision={file.revision} onOpenRaw={onOpenRaw} />;
        case "character":
        case "item":
        case "skill":
            return <CharacterBrowser fileId={file.id} kind={file.kind} revision={file.revision} onOpenRaw={onOpenRaw} />;
        default:
            return <CommodityEditor fileId={file.id} revision={file.revision} onOpenRaw={onOpenRaw} />;
    }
}


/** A floating, draggable, resizable window showing one open WZ file. */
export const WzWindow = memo(function WzWindow({ win, focused }: { win: Win; focused: boolean }) {
    const actions = useActions();
    const { files } = useWorkspaceData();
    const connection = useConnection();
    const { browseOnly } = connection;
    const file = files[win.fileId];
    const gesture = useRef<Gesture | null>(null);
    // Quest archives open on the quest browser, Etc.wz on the Commodity table, and _Canvas and Character files on their
    // thumbnails; the raw tree is one tab away.
    const mainLabel = mainLabelOf(file?.kind);
    // Mob, Etc, Map, Item and Npc files (or their modular parts) also get the library's table for that data,
    // browse-only or not.
    const tableTop = file ? tableTopOf(file) : null;
    const dataDefinition = tableTop ? DATA_VIEWS[tableTop] : undefined;
    // A pinned library says up front which data it has. Without one the table reads this file's install, which
    // can't be told without reading it, so the tab is always offered and the table says when there's nothing.
    const dataOffered = dataDefinition && (!connection.library || connection[dataDefinition.has]);
    const dataView = dataOffered ? dataDefinition : undefined;
    const views: View[] = [];
    if (mainLabel) views.push("main");
    if (dataView) views.push("data");
    if (!browseOnly) views.push("raw");
    // Null until a tab is picked: the first view is shown, even once the file (and with it the views) has loaded.
    const [tab, setTab] = useState<View | null>(null);
    const current = tab && views.includes(tab) ? tab : views[0];
    // The data table loads the whole library's data, so it's only mounted once shown, then kept to hold its state.
    const [dataShown, setDataShown] = useState(false);
    useEffect(function keepDataMounted() {
        if (current === "data") setDataShown(true);
    }, [current]);

    function showInRawTree(path: string) {
        setTab("raw");
        actions.reveal(win.fileId, path);
    }

    function tabLabel(view: View) {
        if (view === "main") return mainLabel;
        if (view === "data") return dataView!.label;
        return "Raw tree";
    }

    // Browse-only viewers get the main view alone: no tabs, no raw tree, no "show in raw tree" buttons.
    const openRaw = browseOnly ? undefined : showInRawTree;

    const begin = (e: PointerEvent<HTMLElement>, g: Gesture) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = g;
    };

    const track = (e: PointerEvent<HTMLElement>) => {
        const g = gesture.current;
        if (!g) return;
        const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
        if (g.kind === "move") actions.patchWindow(win.fileId, { x: g.x + dx, y: g.y + dy });
        else actions.patchWindow(win.fileId, {
            ...(g.dx ? { w: Math.max(MIN_W, g.w + dx) } : {}),
            ...(g.dy ? { h: Math.max(MIN_H, g.h + dy) } : {}),
        });
    };

    const end = (e: PointerEvent<HTMLElement>) => {
        gesture.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handle = (dx: boolean, dy: boolean, cls: string) => (
        <div
            onPointerDown={(e) => begin(e, { kind: "resize", sx: e.clientX, sy: e.clientY, w: win.w, h: win.h, dx, dy })}
            onPointerMove={track}
            onPointerUp={end}
            onPointerCancel={end}
            className={`absolute z-10 touch-none ${cls}`}
        />
    );

    return (
        <section
            aria-label={file?.name ?? "WZ file"}
            onPointerDownCapture={() => actions.focusWindow(win.fileId)}
            style={{ left: win.x, top: win.y, width: win.w, height: win.collapsed ? undefined : win.h, zIndex: win.z }}
            className={`absolute flex flex-col rounded-2xl border bg-white transition-shadow dark:bg-zinc-900 ${
                focused
                    ? "border-accent-400/70 shadow-2xl shadow-zinc-900/20 ring-1 ring-accent-400/40 dark:shadow-black/60"
                    : "border-zinc-200 shadow-lg shadow-zinc-900/10 dark:border-zinc-800 dark:shadow-black/40"
            }`}
        >
            {/* Clipping lives here, not on the frame, so the resize handles can overhang the rounded border. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[15px]">
            <header
                onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button")) return;
                    begin(e, { kind: "move", sx: e.clientX, sy: e.clientY, x: win.x, y: win.y });
                }}
                onPointerMove={track}
                onPointerUp={end}
                onPointerCancel={end}
                onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button")) actions.patchWindow(win.fileId, { collapsed: !win.collapsed }); }}
                className="flex h-14 shrink-0 cursor-grab touch-none select-none items-center gap-3 border-b border-zinc-100 bg-zinc-50/80 px-4 active:cursor-grabbing dark:border-zinc-800 dark:bg-zinc-950/50"
            >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-600 dark:bg-accent-600/15 dark:text-accent-400">
                    <Archive className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 items-baseline gap-3">
                    <h2 className="truncate text-sm font-semibold" title={file?.path}>{file?.name ?? "…"}</h2>
                    {file && <span className="hidden shrink-0 text-xs text-zinc-500 sm:inline">{file.encryption} · v{file.version}</span>}
                    {file?.dirty && (
                        <span
                            title="Edits are in memory only. Save writes a new file; the original is never changed."
                            className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        >
                            Unsaved
                        </span>
                    )}
                </div>

                {file?.dirty && (
                    <>
                        <button type="button" onClick={() => void actions.save(win.fileId)} title="Save as a new file (Ctrl+S)"
                            className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-700">
                            <Download className="size-3.5" />Save
                        </button>
                        <button type="button" onClick={() => void actions.revert(win.fileId)} aria-label="Discard changes" title="Discard all unsaved changes" className="btn-icon">
                            <Undo className="size-4" />
                        </button>
                    </>
                )}
                <button type="button" onClick={() => actions.patchWindow(win.fileId, { collapsed: !win.collapsed })}
                    aria-label={win.collapsed ? "Expand window" : "Collapse window"} className="btn-icon">
                    {win.collapsed ? <Plus className="size-4" /> : <Minus className="size-4" />}
                </button>
                <button type="button" onClick={() => void actions.closeWindow(win.fileId)} aria-label="Close file" className="btn-icon hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-500/20">
                    <XMark className="size-4" />
                </button>
            </header>

            {!win.collapsed && views.length > 1 && (
                <div role="tablist" aria-label="View" className="flex shrink-0 gap-1 border-b border-zinc-100 px-4 pt-2 dark:border-zinc-800">
                    {views.map((view) => (
                        <button
                            key={view}
                            type="button"
                            role="tab"
                            aria-selected={current === view}
                            onClick={() => setTab(view)}
                            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-[13px] font-medium transition ${
                                current === view
                                    ? "border-accent-500 text-accent-700 dark:text-accent-300"
                                    : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                            }`}
                        >
                            {tabLabel(view)}
                        </button>
                    ))}
                </div>
            )}
            {/* The views stay mounted (the inactive ones are hidden) so the raw tree keeps its state and can be
                revealed from the main view. */}
            {!win.collapsed && file && mainLabel && (
                <div className={current === "main" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                    <MainView file={file} onOpenRaw={openRaw} />
                </div>
            )}
            {!win.collapsed && dataView && (dataShown || current === "data") && (
                <div className={current === "data" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                    <LibraryScopeProvider fileId={win.fileId}>{dataView.view()}</LibraryScopeProvider>
                </div>
            )}
            {!win.collapsed && !browseOnly && (
                <div className={current === "raw" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                    <NodeTree fileId={win.fileId} />
                </div>
            )}
            {!win.collapsed && views.length === 0 && (
                <p className="grid flex-1 place-items-center p-8 text-center text-sm text-zinc-500">This file has no view of its own.</p>
            )}
            </div>

            {!win.collapsed && (
                <>
                    {handle(true, false, "-right-1.5 top-14 bottom-4 w-3 cursor-ew-resize")}
                    {handle(false, true, "-bottom-1.5 left-4 right-4 h-3 cursor-ns-resize")}
                    {handle(true, true, "-bottom-2 -right-2 size-6 cursor-nwse-resize")}
                </>
            )}
        </section>
    );
});
