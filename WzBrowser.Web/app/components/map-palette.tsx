import { useEffect, useRef, useState } from "react";
import type { MapPiece, MapSetKind, NamedId } from "../lib/api";
import { useConnection } from "../lib/connection";
import { errorMessage } from "../lib/errors";
import { useQueuedImage } from "../lib/image-queue";

/** What clicks on the map place or draw. A piece comes with the ones like it, for random tiles. */
export type Tool =
    | { kind: "piece"; source: MapSetKind; set: string; piece: MapPiece; variants: MapPiece[] }
    | { kind: "life"; type: "m" | "n"; id: string }
    | { kind: "reactor"; id: string }
    | { kind: "portal"; type: number }
    | { kind: "seat" }
    | { kind: "foothold" }
    | { kind: "ladder"; isLadder: boolean }
    | { kind: "area"; folder: string }
    | { kind: "bounds" };

type Source = MapSetKind | "mob" | "npc" | "reactor" | "portal" | "shapes";

const SOURCES: { source: Source; label: string }[] = [
    { source: "tile", label: "Tile" },
    { source: "obj", label: "Object" },
    { source: "back", label: "Background" },
    { source: "mob", label: "Mob" },
    { source: "npc", label: "NPC" },
    { source: "reactor", label: "Reactor" },
    { source: "portal", label: "Portal" },
    { source: "shapes", label: "Shapes" },
];

/** A portal's types, by number (pt). */
export const PORTAL_TYPES = [
    "Start point", "Invisible", "Visible", "Collision", "Changeable", "Changeable, invisible", "Town portal", "Script",
    "Script, invisible", "Collision with script", "Hidden", "Script, hidden", "Collision, vertical jump",
    "Collision, custom impact", "Collision, custom impact (unknown)",
];

const SHAPES: { label: string; tool: Tool }[] = [
    { label: "Footholds", tool: { kind: "foothold" } },
    { label: "Ladder", tool: { kind: "ladder", isLadder: true } },
    { label: "Rope", tool: { kind: "ladder", isLadder: false } },
    { label: "Seat", tool: { kind: "seat" } },
    { label: "Tooltip area", tool: { kind: "area", folder: "ToolTip" } },
    { label: "Area", tool: { kind: "area", folder: "area" } },
    { label: "Swim area", tool: { kind: "area", folder: "swimArea" } },
    { label: "View range", tool: { kind: "bounds" } },
];

type PickTool = (tool: Tool | null) => void;

function hintOf(tool: Tool) {
    switch (tool.kind) {
        case "foothold": return "Click each corner; Enter or a right click finishes, Esc cancels.";
        case "ladder": return "Click its top, then its bottom. Esc cancels.";
        case "area":
        case "bounds": return "Click two opposite corners. Esc cancels.";
        default: return "Click the map to place it. Esc stops.";
    }
}

function sameTool(left: Tool | null, right: Tool) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function PieceButton({ url, title, active, onPick }: {
    url: string;
    title: string;
    active: boolean;
    onPick: () => void;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    const { src } = useQueuedImage(url, ref);
    const border = active ? "border-accent-500 ring-2 ring-accent-500/40" : "border-zinc-200 dark:border-zinc-700";
    return (
        <button
            ref={ref}
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={active}
            onClick={onPick}
            className={`checker grid size-16 place-items-center overflow-hidden rounded-lg border p-1 ${border}`}
        >
            {src && <img src={src} alt="" className="max-h-full max-w-full object-contain" />}
        </button>
    );
}

/** A set's pieces. A layer with tiles has one tile set, so its tiles come from that one. */
function PiecePicker({ fileId, kind, fixedSet, tool, onTool }: {
    fileId: string;
    kind: MapSetKind;
    fixedSet: string;
    tool: Tool | null;
    onTool: PickTool;
}) {
    const { api } = useConnection();
    const [sets, setSets] = useState<string[]>([]);
    const [chosen, setChosen] = useState("");
    const [pieces, setPieces] = useState<MapPiece[]>([]);
    const [group, setGroup] = useState("");
    const [error, setError] = useState<string | null>(null);
    const set = fixedSet || chosen;

    useEffect(function loadSets() {
        let cancelled = false;
        function showSets(list: string[]) {
            if (!cancelled) setSets(list);
        }
        function showError(reason: unknown) {
            if (!cancelled) setError(errorMessage(reason));
        }
        api.mapSets(fileId, kind).then(showSets, showError);
        return () => { cancelled = true; };
    }, [api, fileId, kind]);

    useEffect(function loadPieces() {
        setPieces([]);
        setGroup("");
        if (!set) return;
        let cancelled = false;
        function showPieces(list: MapPiece[]) {
            if (!cancelled) setPieces(list);
        }
        function showError(reason: unknown) {
            if (!cancelled) setError(errorMessage(reason));
        }
        api.mapPieces(fileId, kind, set).then(showPieces, showError);
        return () => { cancelled = true; };
    }, [api, fileId, kind, set]);

    const groupOf = (piece: MapPiece) => piece.path.slice(0, piece.path.lastIndexOf("/"));
    const groups = [...new Set(pieces.map(groupOf))];
    const shown = group ? pieces.filter((piece) => groupOf(piece) === group) : pieces;
    const isActive = (piece: MapPiece) => tool?.kind === "piece" && tool.piece.sprite === piece.sprite;

    function pieceButton(piece: MapPiece) {
        const active = isActive(piece);
        function pick() {
            const variants = pieces.filter((other) => groupOf(other) === groupOf(piece));
            onTool(active ? null : { kind: "piece", source: kind, set, piece, variants });
        }
        return (
            <PieceButton
                key={piece.path}
                url={api.mapItemSpriteUrl(fileId, piece.sprite)}
                title={piece.path}
                active={active}
                onPick={pick}
            />
        );
    }

    return (
        <>
            <select
                aria-label="Set"
                value={set}
                disabled={fixedSet !== ""}
                onChange={(event) => setChosen(event.target.value)}
                className="input py-1.5 text-[13px]"
            >
                <option value="">Pick a set…</option>
                {sets.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {groups.length > 1 && (
                <select
                    aria-label="Group"
                    value={group}
                    onChange={(event) => setGroup(event.target.value)}
                    className="input py-1.5 text-[13px]"
                >
                    <option value="">Everything in it</option>
                    {groups.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
            )}
            {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            <div className="flex flex-wrap gap-1.5">{shown.map(pieceButton)}</div>
        </>
    );
}

/** Mobs or NPCs by id or name. Nothing is read until something's typed. */
function LifePicker({ fileId, kind, tool, onTool }: {
    fileId: string;
    kind: "mob" | "npc";
    tool: Tool | null;
    onTool: PickTool;
}) {
    const { api } = useConnection();
    const [text, setText] = useState("");
    const [found, setFound] = useState<NamedId[]>([]);
    const needle = text.trim();

    useEffect(function searchNames() {
        setFound([]);
        if (!needle) return;
        let cancelled = false;
        function showFound(list: NamedId[]) {
            if (!cancelled) setFound(list);
        }
        function showNone() {
            if (!cancelled) setFound([]);
        }
        const search = () => api.mapNames(fileId, kind, needle).then(showFound, showNone);
        const timer = setTimeout(search, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [api, fileId, kind, needle]);

    const isNumber = /^\d+$/.test(needle);
    const isListed = found.some((entry) => entry.id === Number(needle));
    // An id String has no name for can still be placed.
    const listed = isNumber && !isListed ? [{ id: Number(needle), name: "Unnamed" }, ...found] : found;

    function lifeButton({ id, name }: NamedId) {
        const padded = String(id).padStart(7, "0");
        const place: Tool = { kind: "life", type: kind === "mob" ? "m" : "n", id: padded };
        const active = sameTool(tool, place);
        return (
            <LifeButton
                key={id}
                url={api.mapItemSpriteUrl(fileId, `${kind}/${padded}`)}
                id={padded}
                name={name}
                active={active}
                onPick={() => onTool(active ? null : place)}
            />
        );
    }

    return (
        <>
            <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={kind === "mob" ? "Mob id or name" : "NPC id or name"}
                aria-label={kind === "mob" ? "Mob id or name" : "NPC id or name"}
                className="input py-1.5 text-[13px]"
            />
            <ul className="space-y-0.5">{listed.map(lifeButton)}</ul>
        </>
    );
}

function LifeButton({ url, id, name, active, onPick }: {
    url: string;
    id: string;
    name: string;
    active: boolean;
    onPick: () => void;
}) {
    const ref = useRef<HTMLButtonElement>(null);
    const { src } = useQueuedImage(url, ref);
    return (
        <li>
            <button
                ref={ref}
                type="button"
                aria-pressed={active}
                onClick={onPick}
                className={`flex w-full items-center gap-2 rounded-md p-1 text-left text-xs ${active
                    ? "bg-accent-100 text-accent-700 dark:bg-accent-600/25 dark:text-accent-200"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
            >
                <span className="grid size-9 shrink-0 place-items-center">
                    {src && <img src={src} alt="" className="max-h-full max-w-full object-contain" />}
                </span>
                <span className="min-w-0">
                    <span className="block truncate">{name}</span>
                    <span className="block font-mono text-[11px] text-zinc-500">{id}</span>
                </span>
            </button>
        </li>
    );
}

function ReactorPicker({ tool, onTool }: { tool: Tool | null; onTool: PickTool }) {
    const [id, setId] = useState("");
    const place: Tool = { kind: "reactor", id: id.padStart(7, "0") };
    const active = sameTool(tool, place);
    return (
        <div className="flex gap-2">
            <input
                value={id}
                onChange={(event) => setId(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                placeholder="Reactor id"
                aria-label="Reactor id"
                className="input min-w-0 py-1.5 text-[13px]"
            />
            <button
                type="button"
                disabled={!id}
                aria-pressed={active}
                onClick={() => onTool(active ? null : place)}
                className="btn-outline py-1.5 disabled:opacity-50"
            >
                {active ? "Stop" : "Place"}
            </button>
        </div>
    );
}

/** Buttons that each pick a tool. */
function ToolButtons({ tools, tool, onTool }: {
    tools: { label: string; tool: Tool }[];
    tool: Tool | null;
    onTool: PickTool;
}) {
    function toolButton(option: { label: string; tool: Tool }) {
        const active = sameTool(tool, option.tool);
        return (
            <button
                key={option.label}
                type="button"
                aria-pressed={active}
                onClick={() => onTool(active ? null : option.tool)}
                className={`rounded-md px-2 py-1 text-left text-xs ${active
                    ? "bg-accent-600 text-white"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
            >
                {option.label}
            </button>
        );
    }
    return <div className="grid grid-cols-1 gap-0.5">{tools.map(toolButton)}</div>;
}

const PORTAL_TOOLS = PORTAL_TYPES.map((label, type) => ({ label, tool: { kind: "portal", type } as Tool }));

/** Picks what clicks on the map place or draw. */
export function MapPalette({ fileId, layer, tileSet, tool, onTool, randomTiles, onRandomTiles }: {
    fileId: string;
    layer: number;
    /** The layer's tile set, "" when it has none yet. */
    tileSet: string;
    tool: Tool | null;
    onTool: PickTool;
    randomTiles: boolean;
    onRandomTiles: (random: boolean) => void;
}) {
    const [source, setSource] = useState<Source>("tile");

    function show(next: Source) {
        setSource(next);
        onTool(null);
    }

    function sourceButton(option: { source: Source; label: string }) {
        return (
            <button
                key={option.source}
                type="button"
                aria-pressed={source === option.source}
                onClick={() => show(option.source)}
                className={`rounded-md px-2 py-1 text-xs font-medium ${source === option.source
                    ? "bg-accent-600 text-white"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}
            >
                {option.label}
            </button>
        );
    }

    const isPiece = source === "tile" || source === "obj" || source === "back";
    return (
        <section aria-label="Place" className="space-y-2 p-3">
            <div className="flex flex-wrap gap-1">{SOURCES.map(sourceButton)}</div>
            {(source === "tile" || source === "obj") && <p className="text-xs text-zinc-500">On layer {layer}</p>}
            {source === "tile" && (
                <label className="flex items-center gap-2 text-xs">
                    <input
                        type="checkbox"
                        checked={randomTiles}
                        onChange={(event) => onRandomTiles(event.target.checked)}
                        className="accent-accent-600"
                    />
                    Random tile of the same kind
                </label>
            )}
            {isPiece && (
                <PiecePicker
                    key={source}
                    fileId={fileId}
                    kind={source}
                    fixedSet={source === "tile" ? tileSet : ""}
                    tool={tool}
                    onTool={onTool}
                />
            )}
            {(source === "mob" || source === "npc") && (
                <LifePicker key={source} fileId={fileId} kind={source} tool={tool} onTool={onTool} />
            )}
            {source === "reactor" && <ReactorPicker tool={tool} onTool={onTool} />}
            {source === "portal" && <ToolButtons tools={PORTAL_TOOLS} tool={tool} onTool={onTool} />}
            {source === "shapes" && <ToolButtons tools={SHAPES} tool={tool} onTool={onTool} />}
            {tool && <p className="text-xs text-accent-700 dark:text-accent-200">{hintOf(tool)}</p>}
        </section>
    );
}
