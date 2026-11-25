import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { MapEdit, MapItem, MapItemKind, MapLayout, OpenedFile } from "../lib/api";
import { useConnection } from "../lib/connection";
import { download } from "../lib/download";
import { errorMessage } from "../lib/errors";
import {
    connectedFootholds,
    copyItems,
    createItem,
    deleteItems,
    drawFootholds,
    editsBetween,
    findProblems,
    folderOf,
    footholdBelow,
    FreeNames,
    isCopyable,
    movedItems,
    moveToLayer,
    platformOf,
    relinkFootholds,
    reorder,
    setEach,
    snapOffset,
    snapPoint,
    standing,
    tileSetClash,
    type Snapping,
} from "../lib/map-edits";
import { useMapPictures } from "../lib/map-pictures";
import {
    boxBetween,
    drawScene,
    endsOf,
    fitCamera,
    hitsAt,
    inDrawOrder,
    itemsIn,
    MAP_KINDS,
    mapBounds,
    middleOf,
    numberOf,
    positionOf,
    type Box,
    type Camera,
    type Grid,
    type Grip,
    type Point,
    type Scene,
} from "../lib/map-scene";
import { useStored } from "../lib/stored";
import { useActions } from "../lib/workspace";
import { ContextMenu, type MenuItem } from "./context-menu";
import { MapPalette, type Tool } from "./map-palette";
import { InspectPanel, ItemList, MapPanel, MinimapOverlay, ProblemList } from "./map-panels";
import { PaneResizer, usePaneWidth } from "./pane-resizer";

const ALL_LAYERS = -1;
const LAYERS = [0, 1, 2, 3, 4, 5, 6, 7];
/** Screen pixels a click may wander before it's a drag. */
const CLICK_SLOP = 3;
const ARROWS: Record<string, Point> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
};
/** Screen pixels an arrow key moves the view when nothing's selected. */
const ARROW_PAN = 48;
/** A minimap is this many times smaller than its map. */
const MINIMAP_SCALE = 16;
/** The largest picture that's exported, in pixels each way; larger maps are scaled down. */
const MAX_EXPORT = 8192;

type Tab = "inspect" | "place" | "list" | "map" | "check";
const TABS: { tab: Tab; label: string }[] = [
    { tab: "inspect", label: "Selected" },
    { tab: "place", label: "Place" },
    { tab: "list", label: "List" },
    { tab: "map", label: "Map" },
    { tab: "check", label: "Check" },
];

const DELETE_BUTTON = [
    "rounded-lg bg-rose-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-rose-700",
    "disabled:opacity-50",
].join(" ");

/** What was copied, or cut, for pasting into any map of the same file. */
let clipboard: { fileId: string; map: string; items: MapItem[]; isCut: boolean } | null = null;

/** A tile's cell, its halves, and finer ones. */
const GRID_SIZES = [[90, 60], [45, 30], [30, 30], [15, 15], [10, 10]] as const;

/** A drag in progress: the view, the selected things, or a selection rectangle. */
interface Gesture {
    kind: "pan" | "move" | "band";
    startX: number;
    startY: number;
    camera: Camera;
    from: Point;
    grip: Grip;
    items: MapItem[];
    /** A left press, which selects or places when it turns out to be a click. */
    isLeft: boolean;
}

interface Drag { items: MapItem[]; grip: Grip; dx: number; dy: number }

function countOf(items: unknown[]) {
    return items.length === 1 ? "1 thing" : `${items.length} things`;
}

const KIND_NAMES: Record<MapItemKind, string> = {
    back: "background", tile: "tile", obj: "object", reactor: "reactor", life: "mob or NPC", portal: "portal",
    foothold: "foothold", ladder: "ladder or rope", seat: "seat", area: "area", misc: "thing", bounds: "view range",
};

/** "Move tile", "Move 3 things": a step in the history. */
function labelFor(verb: string, items: MapItem[]) {
    if (items.length === 1) return `${verb} ${KIND_NAMES[items[0].kind]}`;
    return `${verb} ${countOf(items)}`;
}

/** One map: its canvas, what can be done in it, and its side panels. */
export function MapCanvas({ fileId, path, mapIds, revision, onOpenRaw, onOpenMap, onDelete }: {
    fileId: string;
    path: string;
    /** Every map of the file, to check where portals lead. */
    mapIds: ReadonlySet<number>;
    revision: number;
    onOpenRaw?: (path: string) => void;
    onOpenMap: (id: number) => void;
    /** Deletes the whole map. */
    onDelete: () => void;
}) {
    const { api, readOnly } = useConnection();
    const actions = useActions();
    const { loader, version } = useMapPictures(fileId);
    const pane = usePaneWidth("map-panel", 248, 200, 480);
    const [layout, setLayout] = useState<MapLayout | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hidden, setHidden] = useState<ReadonlySet<MapItemKind>>(new Set());
    const [layer, setLayer] = useState(ALL_LAYERS);
    const [platform, setPlatform] = useState(0);
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [tool, setTool] = useState<Tool | null>(null);
    const [draft, setDraft] = useState<Point[]>([]);
    const [pointer, setPointer] = useState<Point | null>(null);
    const [camera, setCamera] = useState<Camera | null>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [band, setBand] = useState<Box | null>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [busy, setBusy] = useState(false);
    const [tab, setTab] = useState<Tab>("map");
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const [cut, setCut] = useState<ReadonlySet<string>>(new Set());
    const [snapThings, setSnapThings] = useStored("map.snap", true);
    const [showGrid, setShowGrid] = useStored("map.grid", false);
    const [gridSize, setGridSize] = useStored("map.gridSize", 0);
    const [snapGrid, setSnapGrid] = useStored("map.snapGrid", false);
    const [snapFootholds, setSnapFootholds] = useStored("map.snapFootholds", false);
    const [gridOrigin, setGridOrigin] = useState<Point>({ x: 0, y: 0 });
    const [parallax, setParallax] = useStored("map.parallax", true);
    const [showMinimap, setShowMinimap] = useStored("map.minimap", true);
    const [pickBackgrounds, setPickBackgrounds] = useState(false);
    const [randomTiles, setRandomTiles] = useState(false);
    const canvas = useRef<HTMLCanvasElement>(null);
    const gesture = useRef<Gesture | null>(null);
    const loadedRevision = useRef<number | null>(null);
    /** Where the pointer is in the map; state too only while something follows it, so moving it redraws nothing else. */
    const pointerAt = useRef<Point | null>(null);
    const readout = useRef<HTMLSpanElement>(null);
    const [gridWidth, gridHeight] = GRID_SIZES[gridSize] ?? GRID_SIZES[0];
    const grid: Grid = useMemo(
        () => ({ ...gridOrigin, width: gridWidth, height: gridHeight }),
        [gridOrigin, gridWidth, gridHeight],
    );
    const snapping: Snapping = useMemo(
        () => ({ things: snapThings, grid: snapGrid ? grid : null, footholdGrid: snapFootholds ? grid : null }),
        [snapThings, snapGrid, snapFootholds, grid],
    );

    // ------------------------------------------------------------ loading and drawing

    useEffect(function loadLayout() {
        // An edit made here has loaded the map as it left it.
        if (loadedRevision.current === revision) return;
        let cancelled = false;
        function showLayout(loaded: MapLayout) {
            if (cancelled) return;
            loadedRevision.current = revision;
            setLayout(loaded);
            setDrag(null);
            setError(null);
        }
        function showError(reason: unknown) {
            if (!cancelled) setError(errorMessage(reason));
        }
        api.mapLayout(fileId, path).then(showLayout, showError);
        return () => { cancelled = true; };
    }, [api, fileId, path, revision]);

    useEffect(function watchSize() {
        const element = canvas.current?.parentElement;
        if (!element) return;
        const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        measure();
        return () => observer.disconnect();
    }, []);

    useEffect(function showWholeMap() {
        if (layout && !camera && size.width > 0) setCamera(fitCamera(layout, size.width, size.height));
    }, [layout, camera, size]);

    // Tiles are ordered by what their pictures say, which arrives with them.
    const ordered = useMemo(
        () => (layout ? inDrawOrder(layout, loader.spriteZ) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [layout, loader, version],
    );
    const moved = useMemo(function previewDrag() {
        const items = layout && drag ? movedItems(layout, drag.items, drag.grip, drag.dx, drag.dy) : [];
        return new Map(items.map((item) => [item.path, item]));
    }, [layout, drag]);
    const items = useMemo(
        () => (layout?.items ?? []).filter((item) => selected.has(item.path)),
        [layout, selected],
    );
    /** The layer things are placed on. */
    const placedLayer = Math.max(0, layer);
    const ghost = useMemo(
        () => (pointer ? newItem(pointer) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pointer, tool, layout, layer, platform, snapping, camera?.zoom],
    );

    function isShown(item: MapItem) {
        if (hidden.has(item.kind)) return false;
        return layer === ALL_LAYERS || item.layer === ALL_LAYERS || item.layer === layer;
    }

    function sceneAt(view: Camera): Scene {
        const drawn = pointer && draft.length > 0 ? [...draft, drawnPoint(pointer)] : draft;
        return {
            ordered,
            pictureOf: loader.pictureOf,
            camera: view,
            isShown,
            selected,
            faded: cut,
            moved,
            grid: showGrid ? grid : null,
            parallax,
            markers: true,
            ghost,
            draft: drawn,
            band,
        };
    }

    useEffect(function draw() {
        const context = canvas.current?.getContext("2d");
        if (!context || !camera || size.width === 0) return;
        function drawFrame() {
            loader.want(drawScene(context!, size.width, size.height, sceneAt(camera!)));
        }
        const frame = requestAnimationFrame(drawFrame);
        return () => cancelAnimationFrame(frame);
        // The scene is made of these.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ordered, camera, hidden, layer, selected, cut, moved, size, version, parallax, ghost, draft, pointer, band, showGrid, grid]);

    const cameraRef = useRef(camera);
    cameraRef.current = camera;
    useEffect(function watchWheel() {
        const element = canvas.current;
        if (!element) return;
        function zoomAtPointer(event: WheelEvent) {
            const before = cameraRef.current;
            if (!before) return;
            event.preventDefault();
            const box = element!.getBoundingClientRect();
            const x = event.clientX - box.left - box.width / 2;
            const y = event.clientY - box.top - box.height / 2;
            const zoom = Math.min(8, Math.max(0.05, before.zoom * Math.exp(-event.deltaY * 0.0015)));
            // The map point under the pointer stays under it.
            setCamera({ x: before.x + x / before.zoom - x / zoom, y: before.y + y / before.zoom - y / zoom, zoom });
        }
        // React's wheel listeners are passive, so they can't keep the page from zooming.
        element.addEventListener("wheel", zoomAtPointer, { passive: false });
        return () => element.removeEventListener("wheel", zoomAtPointer);
    }, []);

    // ------------------------------------------------------------ editing

    /** Sends a change, then shows the map as it left it. Resolves false when it was refused. */
    async function change(send: () => Promise<OpenedFile>, folders: string[]) {
        if (busy || readOnly) return false;
        setBusy(true);
        try {
            const file = await send();
            const loaded = await api.mapLayout(fileId, path);
            loadedRevision.current = file.revision;
            setLayout(loaded);
            actions.edited(file, folders.map((folder) => (folder ? `${path}/${folder}` : path)));
            return true;
        } catch (reason) {
            actions.toast("error", errorMessage(reason));
            return false;
        } finally {
            setDrag(null);
            setBusy(false);
        }
    }

    /** Applies edits as one step of the history. */
    async function apply(label: string, edits: MapEdit[]) {
        if (edits.length === 0) {
            setDrag(null);
            return false;
        }
        // The raw tree reloads every folder something was changed, added or removed in.
        const folders = new Set<string>();
        for (const edit of edits)
            for (const changed of [edit.path, edit.target]) {
                if (!changed || (edit.op === "copy" && changed === edit.path)) continue;
                for (let folder = folderOf(changed); folder; folder = folderOf(folder)) folders.add(folder);
            }
        folders.add("");
        return change(() => api.editMap(fileId, path, label, edits), [...folders]);
    }

    async function moveItems({ items: dragged, grip, dx, dy }: Drag) {
        if (!layout) return;
        const edits: MapEdit[] = [];
        for (const item of movedItems(layout, dragged, grip, dx, dy)) {
            const before = layout.items.find((candidate) => candidate.path === item.path)!;
            edits.push(...editsBetween(before, item.kind === "life" ? standing(layout, item) : item));
        }
        await apply(labelFor("Move", dragged), edits);
    }

    async function removeSelected() {
        if (!layout || items.length === 0) return;
        if (await apply(labelFor("Delete", items), deleteItems(layout, items))) setSelected(new Set());
    }

    /** Cut things stay, faded, until they're pasted. */
    function copySelected(isCut: boolean) {
        const copied = items.filter(isCopyable);
        if (copied.length === 0) return;
        clipboard = { fileId, map: path, items: copied, isCut };
        setCut(new Set(isCut ? copied.map((item) => item.path) : []));
    }

    /** Adds the items, copied or moved, to this map. */
    async function addItems(verb: string, op: "copy" | "move", source: MapItem[], from: string | null, offset: Point) {
        if (!layout) return false;
        const clash = from === null ? null : tileSetClash(layout, source);
        if (clash) {
            actions.toast("error", clash);
            return false;
        }
        const { edits, paths } = copyItems(op, layout, source, from, offset);
        const applied = await apply(labelFor(verb, source), edits);
        if (applied) setSelected(new Set(paths));
        return applied;
    }

    /** Pastes with the middle of what was copied at the pointer, or in the middle of the view. */
    async function paste() {
        if (!clipboard || !camera) return;
        if (clipboard.fileId !== fileId) {
            actions.toast("error", "Things can only be pasted into maps of the same file.");
            return;
        }
        const target = pointerAt.current ?? { x: Math.round(camera.x), y: Math.round(camera.y) };
        const middles = clipboard.items.map(middleOf);
        const middle = {
            x: middles.reduce((sum, point) => sum + point.x, 0) / middles.length,
            y: middles.reduce((sum, point) => sum + point.y, 0) / middles.length,
        };
        const offset = { x: Math.round(target.x - middle.x), y: Math.round(target.y - middle.y) };
        const from = clipboard.map === path ? null : clipboard.map;
        const { isCut, items: pasted } = clipboard;
        const applied = await addItems("Paste", isCut ? "move" : "copy", pasted, from, offset);
        if (!applied || !isCut) return;
        clipboard = null;
        setCut(new Set());
    }

    const duplicate = () => addItems("Duplicate", "copy", items.filter(isCopyable), null, { x: 20, y: 20 });

    const flip = () => apply(
        labelFor("Flip", items),
        setEach(
            items.filter((item) => item.values.f !== undefined || ["obj", "back", "life", "reactor"].includes(item.kind)),
            (item) => ({ f: item.values.f === "1" ? "0" : "1" }),
        ),
    );

    async function changeLayer(target: number) {
        if (!layout) return;
        const clash = tileSetClash(layout, items.map((item) => ({ ...item, layer: target })));
        if (clash) {
            actions.toast("error", clash);
            return;
        }
        const { edits, paths } = moveToLayer(layout, items, target);
        if (await apply(`Move to layer ${target}`, edits)) setSelected(new Set(paths));
    }

    function bringToFront(toFront: boolean) {
        if (layout) void apply(toFront ? "Bring to front" : "Send to back", reorder(layout, items, toFront));
    }

    function shiftOrder(by: number) {
        const objects = items.filter((item) => item.kind === "obj");
        void apply("Change z", setEach(objects, (item) => ({ z: String(numberOf(item, "z") + by) })));
    }

    const setValue = (name: string, value: string) =>
        apply(`Set ${name}`, setEach(items, () => ({ [name]: value })));

    function deleteValue(name: string) {
        void apply(`Delete ${name}`, items.map((item) => ({ op: "delete", path: `${item.path}/${name}` })));
    }

    function deleteInfo(name: string) {
        void apply(`Delete ${name}`, [{ op: "delete", path: `info/${name}` }]);
    }

    const setInfo = (name: string, value: string, type: string) =>
        apply(`Set ${name}`, [{ op: "set", path: `info/${name}`, value, type }]);

    // ------------------------------------------------------------ placing

    /** The item a click at the point would place, or null when the tool doesn't place things. */
    function newItem(point: Point): MapItem | null {
        if (!layout || !tool) return null;
        const x = String(point.x);
        const y = String(point.y);
        const zM = String(platform);
        const make = (folder: string, kind: MapItemKind, sprite: string | null, values: Record<string, string>): MapItem =>
            ({ path: folder, kind, layer: kind === "tile" || kind === "obj" ? placedLayer : -1, sprite, values });
        let item: MapItem;
        switch (tool.kind) {
            case "piece": {
                const parts = tool.piece.path.split("/");
                if (tool.source === "tile") {
                    const [u, no] = parts;
                    item = make(`${placedLayer}/tile`, "tile", tool.piece.sprite, { x, y, u, no, zM });
                } else if (tool.source === "obj") {
                    const [l0, l1, l2] = parts;
                    const values = { oS: tool.set, l0, l1, l2, x, y, z: "0", f: "0", zM };
                    item = make(`${placedLayer}/obj`, "obj", tool.piece.sprite, values);
                } else {
                    const [folder, no] = parts;
                    item = make("back", "back", tool.piece.sprite, {
                        bS: tool.set,
                        no,
                        x,
                        y,
                        rx: "-100",
                        ry: "-100",
                        cx: "0",
                        cy: "0",
                        type: "0",
                        a: "255",
                        front: "0",
                        ani: folder === "ani" ? "1" : "0",
                        f: "0",
                    });
                }
                break;
            }
            case "life": {
                const foothold = footholdBelow(layout, point);
                const height = String(foothold?.y ?? point.y);
                item = make("life", "life", `${tool.type === "n" ? "npc" : "mob"}/${tool.id}`, {
                    type: tool.type,
                    id: tool.id,
                    x,
                    y: height,
                    cy: height,
                    fh: foothold?.id ?? "0",
                    f: "0",
                    rx0: String(point.x - 50),
                    rx1: String(point.x + 50),
                    mobTime: "0",
                });
                break;
            }
            case "reactor": {
                const values = { id: tool.id, x, y, reactorTime: "0", f: "0" };
                item = make("reactor", "reactor", `reactor/${tool.id}`, values);
                break;
            }
            case "portal": {
                const name = tool.type === 0 ? "sp" : `p${new FreeNames(layout).take("portal")}`;
                const values = { pn: name, pt: String(tool.type), x, y, tm: "999999999", tn: "" };
                item = make("portal", "portal", null, values);
                break;
            }
            case "seat":
                item = make("seat", "seat", null, { x, y });
                break;
            default: return null;
        }
        if (!camera) return item;
        const offset = snapOffset(layout, [item], camera.zoom, snapping);
        const position = { x: String(point.x + offset.x), y: String(point.y + offset.y) };
        return item.kind === "life" ? item : { ...item, values: { ...item.values, ...position } };
    }

    async function place(point: Point) {
        const item = newItem(point);
        if (!layout || !tool || !item) return;
        if (tool.kind === "piece" && tool.source === "tile" && randomTiles) {
            const variant = tool.variants[Math.floor(Math.random() * tool.variants.length)];
            const [u, no] = variant.path.split("/");
            item.values = { ...item.values, u, no };
        }
        const placed = { ...item, path: `${item.path}/${new FreeNames(layout).take(item.path)}` };
        const edits = createItem(placed);
        if (tool.kind === "piece" && tool.source === "tile" && !layout.tileSets[placedLayer])
            edits.unshift({ op: "set", path: `${placedLayer}/info/tS`, value: tool.set, type: "string" });
        if (await apply(labelFor("Place", [placed]), edits)) setSelected(new Set([placed.path]));
    }

    /** Where a point of a shape goes: on what's near it, and under the first one for a ladder. */
    function drawnPoint(point: Point): Point {
        let drawn = point;
        if (tool?.kind === "foothold" && layout && camera) drawn = snapPoint(layout, point, camera.zoom, snapping);
        if (tool?.kind === "ladder" && draft.length > 0) drawn = { x: draft[0].x, y: point.y };
        return drawn;
    }

    function addDraftPoint(point: Point) {
        const points = [...draft, drawnPoint(point)];
        if (tool?.kind === "foothold" || points.length < 2) setDraft(points);
        else void finishShape(points);
    }

    async function finishShape(points: Point[]) {
        setDraft([]);
        if (!layout || !tool || points.length < 2) return;
        const [first, second] = points;
        const box = boxBetween(first, second);
        if (tool.kind === "foothold") {
            const { edits, paths } = drawFootholds(layout, points, placedLayer, platform);
            if (await apply("Draw footholds", edits)) setSelected(new Set(paths));
            return;
        }
        if (tool.kind === "bounds") {
            const sides = {
                VRLeft: box.x,
                VRTop: box.y,
                VRRight: box.x + box.width,
                VRBottom: box.y + box.height,
            };
            const edits = Object.entries(sides).map(([name, value]): MapEdit =>
                ({ op: "set", path: `info/${name}`, value: String(value), type: "int" }));
            await apply("Set view range", edits);
            return;
        }
        let item: MapItem;
        if (tool.kind === "ladder") {
            const values = {
                l: tool.isLadder ? "1" : "0",
                uf: "1",
                x: String(first.x),
                y1: String(box.y),
                y2: String(box.y + box.height),
                page: String(placedLayer),
            };
            item = { path: "ladderRope", kind: "ladder", layer: -1, sprite: null, values };
        } else if (tool.kind === "area") {
            const values = {
                x1: String(box.x),
                y1: String(box.y),
                x2: String(box.x + box.width),
                y2: String(box.y + box.height),
            };
            item = { path: tool.folder, kind: "area", layer: -1, sprite: null, values };
        } else return;
        const placed = { ...item, path: `${item.path}/${new FreeNames(layout).take(item.path)}` };
        if (await apply(labelFor("Draw", [placed]), createItem(placed))) setSelected(new Set([placed.path]));
    }

    function pickTool(next: Tool | null) {
        setTool(next);
        setDraft([]);
        setPointer(null);
        // Keys go to the map again once something's picked.
        if (next) canvas.current?.focus({ preventScroll: true });
    }

    // ------------------------------------------------------------ pictures of the map

    /** The map drawn at a scale, with all its pictures. */
    async function drawWhole(scale: number, bounds: Box, shows: (item: MapItem) => boolean, markers: boolean) {
        const keys = new Set<string>();
        for (const item of ordered)
            if (item.sprite && shows(item)) keys.add(item.sprite);
        await loader.loadAll([...keys]);
        const picture = document.createElement("canvas");
        picture.width = Math.max(1, Math.round(bounds.width * scale));
        picture.height = Math.max(1, Math.round(bounds.height * scale));
        drawScene(picture.getContext("2d")!, picture.width, picture.height, {
            ordered: inDrawOrder(layout!, loader.spriteZ),
            pictureOf: loader.pictureOf,
            camera: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, zoom: scale },
            isShown: shows,
            selected: new Set(),
            faded: new Set(),
            moved: new Map(),
            grid: null,
            parallax: true,
            markers,
            ghost: null,
            draft: [],
            band: null,
        });
        const blob = await new Promise<Blob | null>((resolve) => picture.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("The picture couldn't be drawn.");
        return blob;
    }

    async function redrawMinimap() {
        const bounds = layout && mapBounds(layout);
        if (!bounds) return;
        const isGround = (item: MapItem) => item.kind === "tile" || item.kind === "obj";
        try {
            const picture = await drawWhole(1 / MINIMAP_SCALE, bounds, isGround, false);
            const area = {
                width: Math.round(bounds.width),
                height: Math.round(bounds.height),
                centerX: Math.round(-bounds.x),
                centerY: Math.round(-bounds.y),
            };
            await change(() => api.setMinimap(fileId, path, picture, area), ["", "miniMap"]);
        } catch (reason) {
            actions.toast("error", errorMessage(reason));
        }
    }

    async function exportPicture() {
        const bounds = layout && mapBounds(layout);
        if (!bounds) return;
        const scale = Math.min(1, MAX_EXPORT / bounds.width, MAX_EXPORT / bounds.height);
        try {
            const url = URL.createObjectURL(await drawWhole(scale, bounds, isShown, false));
            await download(url, `${path.slice(path.lastIndexOf("/") + 1).replace(".img", "")}.png`);
            URL.revokeObjectURL(url);
        } catch (reason) {
            actions.toast("error", errorMessage(reason));
        }
    }

    // ------------------------------------------------------------ pointer and keys

    function mapPoint(event: MouseEvent): Point {
        const box = canvas.current!.getBoundingClientRect();
        const { x, y, zoom } = camera!;
        return {
            x: Math.round(x + (event.clientX - box.left - box.width / 2) / zoom),
            y: Math.round(y + (event.clientY - box.top - box.height / 2) / zoom),
        };
    }

    function startGesture(event: PointerEvent<HTMLCanvasElement>) {
        const isLeft = event.button === 0;
        if (!camera || (!isLeft && event.button !== 1)) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        const from = mapPoint(event);
        // Only what's already selected is dragged: anywhere else, a drag moves the view.
        const hit = isLeft && !tool && !busy && !readOnly
            ? hitsAt(sceneAt(camera), from, pickBackgrounds).find(({ item }) => selected.has(item.path))
            : undefined;
        let kind: Gesture["kind"] = "pan";
        if (hit && !event.shiftKey) kind = "move";
        else if (isLeft && !tool && event.shiftKey) kind = "band";
        // An end only moves by itself when nothing else is selected.
        const grip = hit && items.length === 1 ? hit.grip : "item";
        gesture.current = {
            kind,
            startX: event.clientX,
            startY: event.clientY,
            camera,
            from,
            grip,
            items,
            isLeft,
        };
    }

    function isClick(event: PointerEvent, from: Gesture) {
        return Math.hypot(event.clientX - from.startX, event.clientY - from.startY) < CLICK_SLOP;
    }

    function offsetOf(event: PointerEvent, from: Gesture): Point {
        return {
            x: (event.clientX - from.startX) / from.camera.zoom,
            y: (event.clientY - from.startY) / from.camera.zoom,
        };
    }

    function dragOf(event: PointerEvent, from: Gesture): Drag {
        const offset = offsetOf(event, from);
        const moving = { items: from.items, grip: from.grip, dx: Math.round(offset.x), dy: Math.round(offset.y) };
        // Alt puts things exactly where they're dragged.
        if (event.altKey || !layout) return moving;
        const [first] = from.items;
        if (from.grip !== "item") {
            if (first.kind !== "foothold") return moving;
            const end = endsOf(first)![from.grip === "start" ? 0 : 1];
            const dropped = { x: end.x + moving.dx, y: end.y + moving.dy };
            const isJoined = (item: MapItem) => endsOf(item)?.some(({ x, y }) => x === end.x && y === end.y);
            const joined = layout.items.filter(isJoined).map((item) => item.path);
            const snapped = snapPoint(layout, dropped, from.camera.zoom, snapping, new Set(joined));
            return { ...moving, dx: snapped.x - end.x, dy: snapped.y - end.y };
        }
        const isMoved = (item: MapItem) => from.items.some((dragged) => dragged.path === item.path);
        const dragged = movedItems(layout, from.items, "item", moving.dx, moving.dy).filter(isMoved);
        const snap = snapOffset(layout, dragged, from.camera.zoom, snapping);
        return { ...moving, dx: Math.round(moving.dx + snap.x), dy: Math.round(moving.dy + snap.y) };
    }

    function moveGesture(event: PointerEvent<HTMLCanvasElement>) {
        if (!camera) return;
        const point = mapPoint(event);
        pointerAt.current = point;
        if (readout.current) readout.current.textContent = `${point.x}, ${point.y}`;
        if (tool) setPointer(point);
        const from = gesture.current;
        if (!from || isClick(event, from)) return;
        if (from.kind === "move") setDrag(dragOf(event, from));
        else if (from.kind === "band") setBand(boxBetween(from.from, mapPoint(event)));
        else {
            const offset = offsetOf(event, from);
            setCamera({ ...from.camera, x: from.camera.x - offset.x, y: from.camera.y - offset.y });
        }
    }

    function endGesture(event: PointerEvent<HTMLCanvasElement>) {
        const from = gesture.current;
        gesture.current = null;
        setBand(null);
        if (!from || !camera) return;
        if (isClick(event, from)) {
            setDrag(null);
            if (from.isLeft) clickAt(event, mapPoint(event));
        } else if (from.kind === "move") {
            const finished = dragOf(event, from);
            setDrag(finished);
            void moveItems(finished);
        } else if (from.kind === "band") {
            const inside = itemsIn(sceneAt(camera), boxBetween(from.from, mapPoint(event)));
            select([...selected, ...inside.map((item) => item.path)]);
        }
    }

    function clickAt(event: PointerEvent, point: Point) {
        if (tool) {
            const draws = ["foothold", "ladder", "area", "bounds"].includes(tool.kind);
            if (draws) addDraftPoint(point);
            else void place(point);
            return;
        }
        const hits = hitsAt(sceneAt(camera!), point, pickBackgrounds).map(({ item }) => item.path);
        const [topmost] = hits;
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
            if (!topmost) return;
            const next = new Set(selected);
            if (!next.delete(topmost)) next.add(topmost);
            select([...next]);
        } else if (event.altKey) {
            // Each Alt+click goes one deeper into what's under the pointer.
            const current = hits.findIndex((hit) => selected.has(hit));
            select(hits.slice((current + 1) % Math.max(1, hits.length)).slice(0, 1));
        } else select(topmost ? [topmost] : []);
    }

    function leaveCanvas() {
        pointerAt.current = null;
        setPointer(null);
        if (readout.current) readout.current.textContent = "–";
    }

    function cancelGesture() {
        gesture.current = null;
        setDrag(null);
        setBand(null);
    }

    function select(paths: string[]) {
        setSelected(new Set(paths));
        if (paths.length > 0) setTab("inspect");
    }

    /** Selects an item and brings it into the middle of the view. */
    function show(itemPath: string) {
        const item = layout?.items.find((candidate) => candidate.path === itemPath);
        if (!item) return;
        setSelected(new Set([item.path]));
        if (camera) setCamera({ ...camera, ...middleOf(item) });
    }

    function openMenu(event: MouseEvent) {
        event.preventDefault();
        if (!camera) return;
        if (draft.length > 0) {
            void finishShape(draft);
            return;
        }
        const hits = hitsAt(sceneAt(camera), mapPoint(event), pickBackgrounds);
        const isSelected = hits.some(({ item }) => selected.has(item.path));
        if (!isSelected) select(hits.slice(0, 1).map(({ item }) => item.path));
        setMenu({ x: event.clientX, y: event.clientY });
    }

    /** Puts one of the grid's crossings on the item. */
    function alignGrid(item: MapItem) {
        setGridOrigin(endsOf(item)?.[0] ?? positionOf(item));
        setShowGrid(true);
    }

    function selectPlatform(item: MapItem) {
        if (!layout) return;
        const isSame = (other: MapItem) => other.layer === item.layer && platformOf(other) === platformOf(item);
        select(layout.items.filter(isSame).map((other) => other.path));
    }

    function layerItem(target: number): MenuItem {
        const isCurrent = items.every((item) => item.layer === target);
        return {
            label: isCurrent ? `Layer ${target} (current)` : `Layer ${target}`,
            disabled: isCurrent,
            onSelect: () => void changeLayer(target),
        };
    }

    /**
     * "1 → 0": the selected objects' z and what it becomes over or under the rest of their layer. Empty when
     * that differs between them.
     */
    function orderChange(toFront: boolean) {
        if (!layout) return "";
        const objects = items.filter((item) => item.kind === "obj");
        const before = new Set(objects.map((item) => numberOf(item, "z")));
        const after = new Set(reorder(layout, objects, toFront).map((edit) => edit.value));
        if (after.size !== 1) return "";
        const [from] = before;
        const [to] = after;
        return before.size === 1 ? `${from} → ${to}` : `→ ${to}`;
    }

    function orderItem(label: string, toFront: boolean): MenuItem {
        return {
            label: `${label} ${orderChange(toFront)}`,
            disabled: readOnly || busy,
            onSelect: () => bringToFront(toFront),
        };
    }

    function menuItems(): MenuItem[] {
        const [first] = items;
        const locked = readOnly || busy;
        const paste_: MenuItem = {
            label: "Paste",
            shortcut: "Ctrl+V",
            disabled: locked || clipboard === null,
            onSelect: () => void paste(),
        };
        if (!first || !layout) return [paste_];
        const entries: MenuItem[] = [
            { label: "Copy", shortcut: "Ctrl+C", onSelect: () => copySelected(false) },
            { label: "Cut", shortcut: "Ctrl+X", disabled: locked, onSelect: () => copySelected(true) },
            paste_,
            { label: "Duplicate", shortcut: "Ctrl+D", disabled: locked, onSelect: () => void duplicate() },
            { label: "Flip", shortcut: "Ctrl+F", disabled: locked, onSelect: () => void flip() },
            { kind: "separator" },
        ];
        if (items.some((item) => item.kind === "obj"))
            entries.push(orderItem("Bring to front", true), orderItem("Send to back", false));
        if (items.every((item) => item.kind === "tile" || item.kind === "obj"))
            entries.push({ kind: "submenu", label: "Send to layer", disabled: locked, items: LAYERS.map(layerItem) });
        if (first.kind === "foothold")
            entries.push({ label: "Select connected", onSelect: () => select(connectedFootholds(layout, first)) });
        if (platformOf(first) !== null)
            entries.push({ label: "Select platform", onSelect: () => selectPlatform(first) });
        const target = Number(first.values.tm);
        if (first.kind === "portal" && target !== 999999999)
            entries.push({ label: "Open target map", onSelect: () => onOpenMap(target) });
        entries.push({ label: "Align grid here", onSelect: () => alignGrid(first) });
        if (onOpenRaw)
            entries.push({ label: "Find in raw tree", onSelect: () => onOpenRaw(`${path}/${first.path}`) });
        entries.push(
            { kind: "separator" },
            { label: "Delete", shortcut: "Del", danger: true, disabled: locked, onSelect: () => void removeSelected() },
        );
        return entries;
    }

    function handleShortcut(key: string) {
        switch (key) {
            case "a": selectAll(); return true;
            case "c": copySelected(false); return true;
            case "x": copySelected(true); return true;
            case "v": void paste(); return true;
            case "d": void duplicate(); return true;
            case "f": void flip(); return true;
            case "s": void actions.save(fileId); return true;
            default: return false;
        }
    }

    function selectAll() {
        const isPickable = (item: MapItem) => isShown(item) && item.kind !== "bounds"
            && (item.kind !== "back" || pickBackgrounds);
        select(ordered.filter(isPickable).map((item) => item.path));
    }

    function handleArrow(arrow: Point, fast: boolean) {
        if (items.length > 0) {
            const step = fast ? 10 : 1;
            void moveItems({ items, grip: "item", dx: arrow.x * step, dy: arrow.y * step });
        } else if (camera) {
            const step = ARROW_PAN / camera.zoom;
            setCamera({ ...camera, x: camera.x + arrow.x * step, y: camera.y + arrow.y * step });
        }
    }

    function handleEscape() {
        if (draft.length > 0) setDraft([]);
        else if (tool) pickTool(null);
        else setSelected(new Set());
    }

    function handleKey(event: KeyboardEvent) {
        const arrow = ARROWS[event.key];
        const isShortcut = (event.ctrlKey || event.metaKey) && !event.altKey;
        if (isShortcut) {
            if (!handleShortcut(event.key.toLowerCase())) return;
        } else if (arrow) handleArrow(arrow, event.shiftKey);
        else if (event.key === "Escape") handleEscape();
        else if (event.key === "Enter" && draft.length > 0) void finishShape(draft);
        else if (event.key === "Delete") void removeSelected();
        else if (event.key === "+") shiftOrder(1);
        else if (event.key === "-") shiftOrder(-1);
        else return;
        event.preventDefault();
        event.stopPropagation();
    }

    function toggleKind(kind: MapItemKind) {
        const next = new Set(hidden);
        if (!next.delete(kind)) next.add(kind);
        setHidden(next);
    }

    const problems = useMemo(
        () => {
            if (tab !== "check" || !layout) return [];
            return findProblems(layout, (key) => loader.pictureOf(key) === null, mapIds);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tab, layout, loader, version, mapIds],
    );
    useEffect(function loadPicturesToCheck() {
        if (tab !== "check" || !layout) return;
        const keys = layout.items.map((item) => item.sprite).filter((key) => key !== null);
        void loader.loadAll([...new Set(keys)]);
    }, [tab, layout, loader]);

    const disabled = readOnly || busy;
    const link = layout?.info.link;
    const barSelect = "rounded-md border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950";
    const toggles: { label: string; title: string; on: boolean; set: (on: boolean) => void }[] = [
        {
            label: "Snap",
            title: "Fits dragged and placed things to the ones around them; hold Alt to drag freely",
            on: snapThings,
            set: setSnapThings,
        },
        { label: "Grid", title: "Shows a grid to align things with", on: showGrid, set: setShowGrid },
        {
            label: "Snap to grid",
            title: "Aligns dragged and placed tiles, objects and other things to the grid",
            on: snapGrid,
            set: setSnapGrid,
        },
        {
            label: "Footholds to grid",
            title: "Aligns drawn and dragged footholds to the grid",
            on: snapFootholds,
            set: setSnapFootholds,
        },
        { label: "Parallax", title: "Backgrounds move with the view, as in the game", on: parallax, set: setParallax },
        {
            label: "Pick backgrounds",
            title: "Lets clicks select backgrounds",
            on: pickBackgrounds,
            set: setPickBackgrounds,
        },
        { label: "Minimap", title: "Shows the minimap", on: showMinimap, set: setShowMinimap },
    ];

    function checkbox(label: string, checked: boolean, onChange: () => void, title?: string) {
        return (
            <label key={label} title={title} className="flex cursor-pointer select-none items-center gap-1.5">
                <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent-600" />
                {label}
            </label>
        );
    }

    return (
        <>
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800">
                    <select
                        aria-label="Layer"
                        value={layer}
                        onChange={(event) => setLayer(Number(event.target.value))}
                        className={barSelect}
                    >
                        <option value={ALL_LAYERS}>All layers</option>
                        {LAYERS.map((number) => <option key={number} value={number}>Layer {number}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5" title="The platform (zM) placed tiles, objects and footholds go on">
                        Platform
                        <input
                            type="number"
                            min={0}
                            value={platform}
                            onChange={(event) => setPlatform(Math.max(0, Math.round(Number(event.target.value) || 0)))}
                            className={`w-14 ${barSelect}`}
                        />
                    </label>
                    {MAP_KINDS.map(({ kind, label }) => checkbox(label, !hidden.has(kind), () => toggleKind(kind)))}
                    <span aria-hidden className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
                    {toggles.map(({ label, title, on, set }) => checkbox(label, on, () => set(!on), title))}
                    {(showGrid || snapGrid || snapFootholds) && (
                        <select
                            aria-label="Grid size"
                            value={gridSize}
                            onChange={(event) => setGridSize(Number(event.target.value))}
                            className={barSelect}
                        >
                            {GRID_SIZES.map(([width, height], index) => (
                                <option key={index} value={index}>{width} × {height}</option>
                            ))}
                        </select>
                    )}
                    <button
                        type="button"
                        onClick={() => setCamera(null)}
                        title="Zooms and moves the view so the whole map fits in it"
                        className="btn-outline ml-auto px-2 py-1 text-xs"
                    >
                        Fit to screen
                    </button>
                    {!readOnly && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={onDelete}
                            className={DELETE_BUTTON}
                        >
                            Delete map
                        </button>
                    )}
                </div>
                {error && <p role="alert" className="error-text">{error}</p>}
                {link && (
                    <p className="bg-amber-100 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        The game draws map {link} in place of this one.
                    </p>
                )}
                {/* data-own-pan: a middle button drag here moves the map, not the workspace. */}
                <div data-own-pan className="relative min-h-0 flex-1 overflow-hidden bg-zinc-200 dark:bg-zinc-950">
                    <canvas
                        ref={canvas}
                        width={size.width}
                        height={size.height}
                        tabIndex={0}
                        aria-label="Map"
                        onPointerDown={startGesture}
                        onPointerMove={moveGesture}
                        onPointerUp={endGesture}
                        onPointerCancel={cancelGesture}
                        onPointerLeave={leaveCanvas}
                        onContextMenu={openMenu}
                        onKeyDown={handleKey}
                        className={`absolute inset-0 touch-none outline-none ${tool ? "cursor-crosshair" : "cursor-default"}`}
                    />
                    {!layout && !error && <p className="absolute inset-0 grid place-items-center text-sm text-zinc-500">Loading…</p>}
                    {layout?.minimap && showMinimap && camera && (
                        <MinimapOverlay
                            url={api.pngUrl(fileId, `${path}/miniMap/canvas`, revision)}
                            minimap={layout.minimap}
                            camera={camera}
                            size={size}
                            onGoTo={(point) => setCamera({ ...camera, ...point })}
                        />
                    )}
                </div>
                <p className="flex gap-4 border-t border-zinc-100 px-3 py-1 font-mono text-[11px] text-zinc-500 dark:border-zinc-800">
                    <span ref={readout}>–</span>
                    <span>{camera ? `${Math.round(camera.zoom * 100)}%` : ""}</span>
                    <span>{items.length > 0 ? `${items.length} selected` : ""}</span>
                </p>
            </div>
            <PaneResizer pane={pane} side="right" label="Resize the panel" />
            <aside
                style={{ width: pane.width }}
                className="flex shrink-0 flex-col overflow-hidden border-l border-zinc-100 dark:border-zinc-800"
            >
                <div role="tablist" aria-label="Panel" className="flex shrink-0 border-b border-zinc-100 px-1 dark:border-zinc-800">
                    {TABS.map((option) => (
                        <button
                            key={option.tab}
                            type="button"
                            role="tab"
                            aria-selected={tab === option.tab}
                            onClick={() => setTab(option.tab)}
                            className={`flex-1 border-b-2 px-1 py-2 text-xs font-medium ${tab === option.tab
                                ? "border-accent-500 text-accent-700 dark:text-accent-200"
                                : "border-transparent text-zinc-500"}`}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
                {layout && tab === "list" && (
                    <ItemList
                        layout={layout}
                        selected={selected}
                        onPick={(item) => show(item.path)}
                        onSelect={setSelected}
                        onDelete={() => void removeSelected()}
                        onReveal={onOpenRaw && ((item) => onOpenRaw(`${path}/${item.path}`))}
                    />
                )}
                {layout && tab === "check" && <ProblemList problems={problems} onPick={show} />}
                <div className={tab === "list" || tab === "check" ? "hidden" : "min-h-0 flex-1 overflow-auto"}>
                    {tab === "inspect" && (
                        <InspectPanel
                            key={items.map((item) => item.path).join()}
                            items={items}
                            readOnly={readOnly}
                            disabled={disabled}
                            actions={{
                                onSet: setValue,
                                onDeleteValue: deleteValue,
                                onFlip: () => void flip(),
                                onDuplicate: () => void duplicate(),
                                onDelete: () => void removeSelected(),
                                onLayer: (target) => void changeLayer(target),
                                onFront: bringToFront,
                                onReveal: onOpenRaw && (() => onOpenRaw(`${path}/${items[0].path}`)),
                                onOpenMap,
                            }}
                        />
                    )}
                    {/* Kept mounted so the picked set and piece stay. */}
                    {layout && !readOnly && (
                        <div className={tab === "place" ? "" : "hidden"}>
                            <MapPalette
                                fileId={fileId}
                                layer={placedLayer}
                                tileSet={layout.tileSets[placedLayer]}
                                tool={tool}
                                onTool={pickTool}
                                randomTiles={randomTiles}
                                onRandomTiles={setRandomTiles}
                            />
                        </div>
                    )}
                    {layout && tab === "map" && (
                        <MapPanel
                            fileId={fileId}
                            layout={layout}
                            readOnly={readOnly}
                            disabled={disabled}
                            onSet={setInfo}
                            onDeleteValue={deleteInfo}
                            onRelink={() => void apply("Link footholds", relinkFootholds(layout))}
                            onMinimap={() => void redrawMinimap()}
                            onExport={() => void exportPicture()}
                            onReveal={onOpenRaw && (() => onOpenRaw(path))}
                        />
                    )}
                </div>
            </aside>
            {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />}
        </>
    );
}
