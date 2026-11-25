import { useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { MapItem, MapItemKind, MapLayout } from "../lib/api";
import { useConnection } from "../lib/connection";
import { platformOf, type Problem } from "../lib/map-edits";
import type { Box, Camera, Point } from "../lib/map-scene";
import { FieldLimitEditor } from "./field-limit-editor";
import { PORTAL_TYPES } from "./map-palette";
import { InlineEdit } from "./node-tree";
import { isDeleteKey, PropertyRow } from "./property-row";

/** The map editor's side panels and overlays. */

const SMALL_BUTTON = "btn-outline px-2 py-1 text-xs disabled:opacity-50";
const VALUE_LIST = "space-y-0.5 font-mono text-[12px]";

/** A value that turns into an input when clicked, unless read only. A `mixed` one differs between the selected things. */
function ValueRow({ name, value, mixed = false, readOnly, onSave, onDelete }: {
    name: string;
    value: string;
    mixed?: boolean;
    readOnly: boolean;
    /** Resolves false when the save failed. */
    onSave: (value: string) => Promise<boolean>;
    onDelete?: () => void;
}) {
    const shown = mixed ? "" : value;
    const placeholder = mixed ? "(mixed)" : "(empty)";
    return (
        <li>
            <PropertyRow name={name} title={name} onDelete={readOnly ? undefined : onDelete}>
                <span className="min-w-0 flex-1 break-all text-right text-zinc-800 dark:text-zinc-200">
                    {readOnly && (shown || <i className="font-sans text-zinc-400">{placeholder}</i>)}
                    {!readOnly && (
                        <InlineEdit
                            label={name}
                            value={shown}
                            placeholder={placeholder}
                            multiline={shown.includes("\n")}
                            check={noProblem}
                            onSave={onSave}
                        />
                    )}
                </span>
            </PropertyRow>
        </li>
    );
}

/** The layout doesn't say what type a value has, so the server is what refuses a wrong one. */
const noProblem = () => null;

/** Values the game reads that a thing doesn't have to have. */
const OPTIONAL: Partial<Record<MapItemKind, string[]>> = {
    obj: ["f", "zM", "name", "r", "hide", "reactor", "dynamic", "flow", "rx", "ry", "cx", "cy", "tags"],
    life: ["f", "hide", "mobTime", "info", "team", "limitedname", "rx0", "rx1"],
    portal: [
        "image", "script", "verticalImpact", "horizontalImpact", "hRange", "vRange", "delay", "reactorName",
        "sessionValueKey", "sessionValue", "hideTooltip", "onlyOnce",
    ],
    back: ["front", "f", "ani", "a", "page", "screenMode"],
    reactor: ["f", "name", "reactorTime"],
    foothold: ["cantThrough", "forbidFallDown", "piece", "force"],
    ladder: ["uf", "page", "l"],
};

/** The kinds that can face either way, whether or not they say so yet. */
const FLIPPABLE = new Set<MapItemKind>(["obj", "back", "life", "reactor"]);

export interface ItemActions {
    onSet: (name: string, value: string) => Promise<boolean>;
    onDeleteValue: (name: string) => void;
    onFlip: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onLayer: (layer: number) => void;
    onFront: (toFront: boolean) => void;
    onReveal?: () => void;
    onOpenMap: (id: number) => void;
}

/** The values the selected things share; changing one changes it in all of them. */
export function InspectPanel({ items, readOnly, disabled, actions }: {
    items: MapItem[];
    readOnly: boolean;
    disabled: boolean;
    actions: ItemActions;
}) {
    const [first] = items;
    if (!first) return <p className="p-3 text-xs text-zinc-500">Click something in the map to see its values.</p>;

    const sameKind = items.every((item) => item.kind === first.kind);
    const isShared = (name: string) => items.every((item) => item.values[name] !== undefined);
    const names = Object.keys(first.values).filter(isShared);
    const missing = sameKind ? (OPTIONAL[first.kind] ?? []).filter((name) => first.values[name] === undefined) : [];
    // A seat is one point, whose x and y only go together.
    const canDeleteValues = items.every((item) => item.kind !== "seat");
    const layered = items.every((item) => item.kind === "tile" || item.kind === "obj");
    const target = Number(first.values.tm);
    const leads = items.length === 1 && first.kind === "portal" && target !== 999999999;

    const isMixed = (name: string) => items.some((item) => item.values[name] !== first.values[name]);

    function addValue(name: string) {
        if (name) void actions.onSet(name, name === "name" || name === "script" ? "new" : "0");
    }

    return (
        <section aria-label="Selected" className="space-y-2 p-3">
            <h4 className="truncate font-mono text-xs text-zinc-500">
                {items.length === 1 ? first.path : `${items.length} selected`}
            </h4>
            {items.length === 1 && platformOf(first) !== null && (
                <p className="text-xs text-zinc-500">Platform {platformOf(first)}</p>
            )}
            <ul className={VALUE_LIST}>
                {names.map((name) => (
                    <ValueRow
                        key={name}
                        name={name}
                        value={first.values[name]}
                        mixed={isMixed(name)}
                        readOnly={readOnly}
                        onSave={(value) => actions.onSet(name, value)}
                        onDelete={canDeleteValues ? () => actions.onDeleteValue(name) : undefined}
                    />
                ))}
            </ul>
            {sameKind && first.kind === "portal" && (
                <select
                    aria-label="Portal type"
                    value={isMixed("pt") ? "" : first.values.pt}
                    disabled={disabled}
                    onChange={(event) => void actions.onSet("pt", event.target.value)}
                    className="input py-1.5 text-xs"
                >
                    {PORTAL_TYPES.map((label, type) => <option key={label} value={type}>{type}: {label}</option>)}
                </select>
            )}
            {missing.length > 0 && (
                <select
                    aria-label="Add a value"
                    value=""
                    disabled={disabled}
                    onChange={(event) => addValue(event.target.value)}
                    className="input py-1.5 text-xs"
                >
                    <option value="">Add a value…</option>
                    {missing.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
            )}
            {layered && (
                <select
                    aria-label="Move to layer"
                    value={items.every((item) => item.layer === first.layer) ? first.layer : ""}
                    disabled={disabled}
                    onChange={(event) => actions.onLayer(Number(event.target.value))}
                    className="input py-1.5 text-xs"
                >
                    <option value="" disabled>Move to layer…</option>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((layer) => <option key={layer} value={layer}>Layer {layer}</option>)}
                </select>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
                {items.some((item) => FLIPPABLE.has(item.kind)) && (
                    <button type="button" disabled={disabled} onClick={actions.onFlip} className={SMALL_BUTTON}>Flip</button>
                )}
                {items.some((item) => item.kind === "obj") && (
                    <>
                        <button type="button" disabled={disabled} onClick={() => actions.onFront(true)} className={SMALL_BUTTON}>
                            To front
                        </button>
                        <button type="button" disabled={disabled} onClick={() => actions.onFront(false)} className={SMALL_BUTTON}>
                            To back
                        </button>
                    </>
                )}
                <button type="button" disabled={disabled} onClick={actions.onDuplicate} className={SMALL_BUTTON}>Duplicate</button>
                <button type="button" disabled={disabled} onClick={actions.onDelete} className={SMALL_BUTTON}>Delete</button>
                {leads && (
                    <button type="button" onClick={() => actions.onOpenMap(target)} className={SMALL_BUTTON}>
                        Open map {target}
                    </button>
                )}
                {items.length === 1 && actions.onReveal && (
                    <button type="button" onClick={actions.onReveal} className={SMALL_BUTTON}>Find in raw tree</button>
                )}
            </div>
        </section>
    );
}

/** Rows listed at a time; scrolling to the end adds more. */
const PAGE = 100;

/** Shows more of a list as it's scrolled to its end. */
export function usePagedList() {
    const [limit, setLimit] = useState(PAGE);
    function showMore(event: { currentTarget: HTMLElement }) {
        const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
        if (scrollTop + clientHeight > scrollHeight - 200) setLimit((current) => current + PAGE);
    }
    const reset = () => setLimit(PAGE);
    return { limit, showMore, reset };
}

/**
 * Everything in the map, to find and select it. Ctrl+click adds one to what's selected or takes it out, Shift+click
 * selects everything from the last one clicked, and both together add that to what's selected. Delete or Backspace on a selected
 * one deletes what's selected.
 */
export function ItemList({ layout, selected, onPick, onSelect, onDelete }: {
    layout: MapLayout;
    selected: ReadonlySet<string>;
    onPick: (item: MapItem) => void;
    onSelect: (paths: Set<string>) => void;
    onDelete: () => void;
}) {
    const [filter, setFilter] = useState("");
    /** The path of the last one clicked without Shift, where a range starts. */
    const anchor = useRef<string | null>(null);
    const { limit, showMore, reset } = usePagedList();
    const needle = filter.trim().toLowerCase();
    const textOf = (item: MapItem) => `${item.path} ${item.sprite ?? ""} ${item.values.pn ?? ""}`;
    const matching = layout.items.filter((item) => textOf(item).toLowerCase().includes(needle));

    function changeFilter(text: string) {
        setFilter(text);
        reset();
    }

    /** The paths listed between the anchor and the item, both included; without one listed, the range starts here. */
    function rangeTo(item: MapItem) {
        const end = matching.indexOf(item);
        const start = matching.findIndex((candidate) => candidate.path === anchor.current);
        if (start < 0) {
            anchor.current = item.path;
            return [item.path];
        }
        return matching.slice(Math.min(start, end), Math.max(start, end) + 1).map((candidate) => candidate.path);
    }

    function toggle(item: MapItem) {
        const next = new Set(selected);
        if (!next.delete(item.path)) next.add(item.path);
        onSelect(next);
    }

    function handleClick(event: MouseEvent, item: MapItem) {
        const isAdding = event.ctrlKey || event.metaKey;
        if (event.shiftKey) {
            const range = rangeTo(item);
            onSelect(new Set(isAdding ? [...selected, ...range] : range));
            return;
        }
        anchor.current = item.path;
        if (isAdding) toggle(item);
        else onPick(item);
    }

    function handleKey(event: KeyboardEvent, item: MapItem) {
        // A row that only has the focus isn't what would be deleted.
        if (!isDeleteKey(event) || !selected.has(item.path)) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) onDelete();
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="p-2">
                <input
                    value={filter}
                    onChange={(event) => changeFilter(event.target.value)}
                    placeholder="Filter"
                    aria-label="Filter the map's contents"
                    className="input py-1.5 text-[13px]"
                />
            </div>
            <ul className="min-h-0 flex-1 overflow-auto" onScroll={showMore}>
                {matching.slice(0, limit).map((item) => (
                    <li key={item.path}>
                        <button
                            type="button"
                            onClick={(event) => handleClick(event, item)}
                            onKeyDown={(event) => handleKey(event, item)}
                            className={`w-full select-none px-3 py-1 text-left text-xs ${selected.has(item.path)
                                ? "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-200"
                                : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                        >
                            <span className="block truncate font-mono">{item.path}</span>
                            <span className="block truncate text-[11px] text-zinc-500">{item.sprite ?? item.kind}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function ProblemList({ problems, onPick }: { problems: Problem[]; onPick: (path: string) => void }) {
    if (problems.length === 0) return <p className="p-3 text-xs text-zinc-500">No problems found.</p>;

    function problemRow({ text, path }: Problem, index: number) {
        return (
            <li key={index}>
                <button
                    type="button"
                    disabled={path === null}
                    onClick={() => path !== null && onPick(path)}
                    className="w-full px-3 py-1.5 text-left text-xs enabled:hover:bg-zinc-100 dark:enabled:hover:bg-zinc-800"
                >
                    <span className="block">{text}</span>
                    {path && <span className="block font-mono text-[11px] text-zinc-500">{path}</span>}
                </button>
            </li>
        );
    }
    return <ul className="min-h-0 flex-1 overflow-auto">{problems.map(problemRow)}</ul>;
}

/** Values of info the game reads that a map doesn't have to have, with their types. */
const MAP_OPTIONAL: Record<string, string> = {
    swim: "int", fly: "int", town: "int", noMapCmd: "int", hideMinimap: "int", moveLimit: "int", lvLimit: "int",
    lvForceMove: "int", timeLimit: "int", timeMob: "int", decHP: "int", decInterval: "int", protectItem: "int",
    partyOnly: "int", expeditionOnly: "int", personalShop: "int", everlast: "int", fieldType: "int", consumeItemCoolTime: "int",
    recovery: "float", fs: "float", mobRate: "float", createMobInterval: "int", fixedMobCapacity: "int",
    onUserEnter: "string", onFirstUserEnter: "string", fieldScript: "string", effect: "string", help: "string",
    mapName: "string", streetName: "string", link: "string",
};

/** The map's own values, music and minimap. The music only plays when it's asked to. */
export function MapPanel({ fileId, layout, readOnly, disabled, onSet, onDeleteValue, onRelink, onMinimap, onExport }: {
    fileId: string;
    layout: MapLayout;
    readOnly: boolean;
    disabled: boolean;
    onSet: (name: string, value: string, type: string) => Promise<boolean>;
    onDeleteValue: (name: string) => void;
    onRelink: () => void;
    onMinimap: () => void;
    onExport: () => void;
}) {
    const { api } = useConnection();
    const { info } = layout;
    const missing = Object.keys(MAP_OPTIONAL).filter((name) => info[name] === undefined);

    function addValue(name: string) {
        if (name) void onSet(name, MAP_OPTIONAL[name] === "string" ? "" : "0", MAP_OPTIONAL[name]);
    }

    return (
        <section aria-label="Map" className="space-y-2 p-3">
            {info.bgm && (
                <audio key={info.bgm} controls preload="none" src={api.mapMusicUrl(fileId, info.bgm)} className="h-9 w-full" />
            )}
            <div className="flex flex-wrap gap-1.5">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onRelink}
                    title="Makes each foothold lead to the ones that meet its ends, and puts mobs and NPCs on one"
                    className={SMALL_BUTTON}
                >
                    Link footholds
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    onClick={onMinimap}
                    title="Draws the minimap again from the map's tiles and objects"
                    className={SMALL_BUTTON}
                >
                    Redraw minimap
                </button>
                <button type="button" onClick={onExport} title="Saves what's shown as a picture" className={SMALL_BUTTON}>
                    Export PNG
                </button>
            </div>
            <ul className={VALUE_LIST}>
                {Object.entries(info).map(([name, value]) => (
                    <ValueRow
                        key={name}
                        name={name}
                        value={value}
                        readOnly={readOnly}
                        onSave={(next) => onSet(name, next, "string")}
                        onDelete={() => onDeleteValue(name)}
                    />
                ))}
            </ul>
            <select
                aria-label="Add a map value"
                value=""
                disabled={disabled}
                onChange={(event) => addValue(event.target.value)}
                className="input py-1.5 text-xs"
            >
                <option value="">Add a value…</option>
                {missing.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {info.fieldLimit !== undefined && (
                <FieldLimitEditor
                    type="int"
                    value={info.fieldLimit}
                    readOnly={disabled}
                    onSave={(value) => onSet("fieldLimit", value, "int")}
                />
            )}
        </section>
    );
}

// ------------------------------------------------------------ overlays

const OVERLAY = "rounded-lg border border-zinc-300 bg-white/90 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90";

/** The map's minimap with what's on screen framed; pressing it goes there, and dragging moves the view along. */
export function MinimapOverlay({ url, minimap, camera, size, onGoTo }: {
    url: string;
    minimap: Record<string, string>;
    camera: Camera;
    size: { width: number; height: number };
    onGoTo: (point: Point) => void;
}) {
    const width = Number(minimap.width) || 1;
    const height = Number(minimap.height) || 1;
    const centerX = Number(minimap.centerX) || 0;
    const centerY = Number(minimap.centerY) || 0;

    const view: Box = {
        x: camera.x - size.width / 2 / camera.zoom + centerX,
        y: camera.y - size.height / 2 / camera.zoom + centerY,
        width: size.width / camera.zoom,
        height: size.height / camera.zoom,
    };
    const percent = (part: number, whole: number) => `${part / whole * 100}%`;

    function goTo(event: PointerEvent<HTMLElement>) {
        const box = event.currentTarget.getBoundingClientRect();
        onGoTo({
            x: (event.clientX - box.left) / box.width * width - centerX,
            y: (event.clientY - box.top) / box.height * height - centerY,
        });
    }

    function startDrag(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0 && event.button !== 1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        goTo(event);
    }

    function dragTo(event: PointerEvent<HTMLElement>) {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) goTo(event);
    }

    return (
        <div
            role="img"
            aria-label="Minimap"
            title="Drag to move the view"
            onPointerDown={startDrag}
            onPointerMove={dragTo}
            className={`absolute bottom-2 left-2 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing ${OVERLAY}`}
        >
            <img src={url} alt="" loading="lazy" draggable={false} className="block max-h-36 max-w-56" />
            <span
                className="pointer-events-none absolute border border-amber-400"
                style={{
                    left: percent(view.x, width),
                    top: percent(view.y, height),
                    width: percent(view.width, width),
                    height: percent(view.height, height),
                }}
            />
        </div>
    );
}
