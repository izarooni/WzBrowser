import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { MapEntry } from "../lib/api";
import { useConnection } from "../lib/connection";
import { errorMessage } from "../lib/errors";
import { mapId } from "../lib/game-ids";
import { useActions, type TreeEvent } from "../lib/workspace";
import { MapCanvas } from "./map-canvas";
import { usePagedList } from "./map-panels";
import { PaneResizer, usePaneWidth } from "./pane-resizer";

/** Whether an edit could have added or removed maps, rather than changed something inside one. */
function changesMaps({ reset, reload, reloadUnder }: TreeEvent) {
    return reset || reloadUnder !== undefined || reload?.some((folder) => !folder.includes(".img"));
}

/** A Map file's maps, searched by id or name, and the one picked in an editor. */
export function MapEditor({ fileId, revision, onOpenRaw }: {
    fileId: string;
    revision: number;
    onOpenRaw?: (path: string) => void;
}) {
    const { api, readOnly } = useConnection();
    const actions = useActions();
    const [maps, setMaps] = useState<MapEntry[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState("");
    const [current, setCurrent] = useState<MapEntry | null>(null);
    /** Counts the edits that could have added or removed maps, to list them again. */
    const [listing, setListing] = useState(0);
    const { limit, showMore, reset } = usePagedList();
    const pane = usePaneWidth("map-list", 208, 140, 400);

    useEffect(function watchMaps() {
        return actions.subscribe(fileId, (event) => {
            if (changesMaps(event)) setListing((count) => count + 1);
        });
    }, [actions, fileId]);

    useEffect(function loadMaps() {
        let cancelled = false;
        function showMaps(list: MapEntry[]) {
            if (cancelled) return;
            setMaps(list);
            setCurrent((open) => list.find((map) => map.path === open?.path) ?? null);
            setError(null);
        }
        function showError(reason: unknown) {
            if (!cancelled) setError(errorMessage(reason));
        }
        api.editorMaps(fileId).then(showMaps, showError);
        return () => { cancelled = true; };
    }, [api, fileId, listing]);

    const needle = filter.trim().toLowerCase();
    const matching = useMemo(function filterMaps() {
        const matches = (map: MapEntry) => `${mapId(map.id)} ${map.name ?? ""}`.toLowerCase().includes(needle);
        return (maps ?? []).filter(matches);
    }, [maps, needle]);
    const mapIds = useMemo(() => new Set((maps ?? []).map((map) => map.id)), [maps]);

    function changeFilter(text: string) {
        setFilter(text);
        reset();
    }

    function openMap(id: number) {
        const map = maps?.find((candidate) => candidate.id === id);
        if (map) setCurrent(map);
        else actions.toast("error", `Map ${mapId(id)} isn't in this file.`);
    }

    async function createMap(id: number, from: string | null) {
        try {
            const created = await api.createMap(fileId, id, from);
            actions.edited(created.file, [created.map.path.slice(0, Math.max(0, created.map.path.lastIndexOf("/")))]);
            setCurrent(created.map);
        } catch (reason) {
            actions.toast("error", errorMessage(reason));
        }
    }

    async function deleteMap(map: MapEntry) {
        const label = map.name ? `${map.name} (${mapId(map.id)})` : mapId(map.id);
        const deleted = await actions.deleteNode(fileId, map.path, label, {
            strings: true,
            body: "The map is removed from this file, and its name from String, in memory only. "
                + "Nothing on disk changes until you save each file, and undo brings them back.",
        });
        if (deleted) setCurrent((open) => (open?.path === map.path ? null : open));
    }

    function mapButton(map: MapEntry) {
        const active = current?.path === map.path;
        return (
            <li key={map.path}>
                <button
                    type="button"
                    aria-current={active}
                    onClick={() => setCurrent(map)}
                    className={`w-full px-3 py-1.5 text-left text-[13px] ${active
                        ? "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                    <span className="block truncate">{map.name ?? "Unnamed"}</span>
                    <span className="block font-mono text-[11px] text-zinc-500">{mapId(map.id)}</span>
                </button>
            </li>
        );
    }

    return (
        <div className="flex min-h-0 flex-1">
            <nav aria-label="Maps" style={{ width: pane.width }} className="flex shrink-0 flex-col border-r border-zinc-100 dark:border-zinc-800">
                <div className="p-2">
                    <input
                        value={filter}
                        onChange={(event) => changeFilter(event.target.value)}
                        placeholder="Map id or name"
                        aria-label="Search maps"
                        className="input py-1.5 text-[13px]"
                    />
                </div>
                {error && <p role="alert" className="error-text">{error}</p>}
                <ul className="min-h-0 flex-1 overflow-auto" onScroll={showMore}>
                    {matching.slice(0, limit).map(mapButton)}
                </ul>
                {!readOnly && <NewMapForm current={current} onCreate={createMap} />}
            </nav>
            <PaneResizer pane={pane} side="left" label="Resize the map list" />
            {current
                ? (
                    <MapCanvas
                        key={current.path}
                        fileId={fileId}
                        path={current.path}
                        mapIds={mapIds}
                        revision={revision}
                        onOpenRaw={onOpenRaw}
                        onOpenMap={openMap}
                        onDelete={() => void deleteMap(current)}
                    />
                )
                : <p className="grid flex-1 place-items-center p-8 text-sm text-zinc-500">Pick a map to edit.</p>}
        </div>
    );
}

function NewMapForm({ current, onCreate }: {
    current: MapEntry | null;
    onCreate: (id: number, from: string | null) => Promise<void>;
}) {
    const [id, setId] = useState("");
    const button = "btn-outline px-2 py-1 text-xs disabled:opacity-50";

    async function create(from: string | null) {
        await onCreate(Number(id), from);
        setId("");
    }

    function submit(event: FormEvent) {
        event.preventDefault();
        if (id) void create(null);
    }

    return (
        <form onSubmit={submit} className="space-y-1.5 border-t border-zinc-100 p-2 dark:border-zinc-800">
            <input
                value={id}
                onChange={(event) => setId(event.target.value.replace(/\D/g, "").slice(0, 9))}
                inputMode="numeric"
                placeholder="New map's id"
                aria-label="New map's id"
                className="input py-1.5 text-[13px]"
            />
            <div className="flex gap-1.5">
                <button type="submit" disabled={!id} className={button}>New map</button>
                <button
                    type="button"
                    disabled={!id || !current}
                    onClick={() => void create(current!.path)}
                    title="Makes the new map a copy of the open one"
                    className={button}
                >
                    Clone open map
                </button>
            </div>
        </form>
    );
}
