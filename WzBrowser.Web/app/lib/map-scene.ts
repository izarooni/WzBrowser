import type { MapItem, MapItemKind, MapLayout, MapSprite } from "./api";

/** The map editor's geometry and drawing: where a map's things are, how they look, and what's under the pointer. */

export const MAP_KINDS: { kind: MapItemKind; label: string }[] = [
    { kind: "back", label: "Backgrounds" },
    { kind: "tile", label: "Tiles" },
    { kind: "obj", label: "Objects" },
    { kind: "reactor", label: "Reactors" },
    { kind: "life", label: "Mobs & NPCs" },
    { kind: "portal", label: "Portals" },
    { kind: "foothold", label: "Footholds" },
    { kind: "ladder", label: "Ladders & ropes" },
    { kind: "seat", label: "Seats" },
    { kind: "area", label: "Areas" },
    { kind: "misc", label: "Misc" },
    { kind: "bounds", label: "View range" },
];

export interface Point { x: number; y: number }
export interface Box extends Point { width: number; height: number }

/** Lines every `width` and `height` map pixels, one of each through the grid's x and y. */
export type Grid = Box;

/** The map point in the middle of the canvas, and how many screen pixels a map pixel takes. */
export interface Camera extends Point { zoom: number }

/** What a drag moves: the whole item, or one end of a line (or corner of a rectangle). */
export type Grip = "item" | "start" | "end";
export interface Hit { item: MapItem; grip: Grip }

/** A picture and where its origin is. */
export interface Picture { image: HTMLImageElement; sprite: MapSprite }
/** The loaded picture of a key; undefined until it's loaded, null when there is none. */
export type PictureOf = (key: string) => Picture | null | undefined;

/** Screen pixels around a line, end or marker that still count as on it. */
const REACH = 7;
const MARKER = 10;
/** How far off screen a thing whose picture isn't loaded yet may be and still be loaded, in map pixels. */
const UNKNOWN_SIZE = 600;
/** Grid lines nearer together on screen than this aren't drawn. */
const MIN_GRID_STEP = 5;

const COLOURS: Record<MapItemKind, string> = {
    back: "#0ea5e9",
    portal: "#3b82f6",
    foothold: "#ef4444",
    ladder: "#22c55e",
    seat: "#eab308",
    life: "#a855f7",
    reactor: "#f97316",
    area: "#14b8a6",
    misc: "#ec4899",
    bounds: "#e879f9",
    tile: "#71717a",
    obj: "#71717a",
};
const SELECTED = "#f59e0b";

export function numberOf(item: MapItem, name: string) {
    return Number(item.values[name] ?? 0) || 0;
}

/** Where an item is. Mobs and NPCs stand at cy, not y. */
export function positionOf(item: MapItem): Point {
    const x = numberOf(item, "x");
    if (item.kind === "life" && item.values.cy !== undefined) return { x, y: numberOf(item, "cy") };
    return { x, y: numberOf(item, "y") };
}

interface EndNames { start: { x: string; y: string }; end: { x: string; y: string } }

const CORNERS: EndNames = { start: { x: "x1", y: "y1" }, end: { x: "x2", y: "y2" } };

/** The properties that hold each end of a line or corner of a rectangle. */
const END_NAMES: Partial<Record<MapItemKind, EndNames>> = {
    foothold: CORNERS,
    area: CORNERS,
    ladder: { start: { x: "x", y: "y1" }, end: { x: "x", y: "y2" } },
    bounds: { start: { x: "VRLeft", y: "VRTop" }, end: { x: "VRRight", y: "VRBottom" } },
};

export function endNames(item: MapItem): EndNames | null {
    return END_NAMES[item.kind] ?? null;
}

/** A line's ends or a rectangle's corners; null for anything else. */
export function endsOf(item: MapItem): [Point, Point] | null {
    const names = endNames(item);
    if (!names) return null;
    return [
        { x: numberOf(item, names.start.x), y: numberOf(item, names.start.y) },
        { x: numberOf(item, names.end.x), y: numberOf(item, names.end.y) },
    ];
}

function isRectangle(item: MapItem) {
    return item.kind === "area" || item.kind === "bounds";
}

export function boxBetween(start: Point, end: Point): Box {
    return {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
    };
}

/** The middle of an item, to show it. */
export function middleOf(item: MapItem): Point {
    const ends = endsOf(item);
    if (!ends) return positionOf(item);
    return { x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2 };
}

// ------------------------------------------------------------ drawing

export interface Scene {
    /** The layout's items in drawing order. */
    ordered: MapItem[];
    pictureOf: PictureOf;
    camera: Camera;
    isShown: (item: MapItem) => boolean;
    selected: ReadonlySet<string>;
    /** Things that were cut, drawn faded until they're pasted. */
    faded: ReadonlySet<string>;
    /** Items being dragged, as they'd be if dropped now, by path. */
    moved: ReadonlyMap<string, MapItem>;
    grid: Grid | null;
    /** Backgrounds move with the view, as in the game. */
    parallax: boolean;
    /** Marks things that have no picture to show. */
    markers: boolean;
    /** What a click would place. */
    ghost: MapItem | null;
    /** Points of a line or rectangle being drawn. */
    draft: Point[];
    /** A selection rectangle being dragged. */
    band: Box | null;
}

type Pictures = Pick<Scene, "pictureOf">;

function isFlipped(item: MapItem) {
    return item.values.f === "1";
}

function pictureFor(item: MapItem, { pictureOf }: Pictures) {
    return item.sprite ? pictureOf(item.sprite) ?? null : null;
}

/** Where an item's picture goes in the map; a marker's square when it has none. */
function boxOf(item: MapItem, scene: Pictures): Box {
    const { x, y } = positionOf(item);
    const picture = pictureFor(item, scene);
    if (!picture) return { x: x - MARKER, y: y - MARKER, width: MARKER * 2, height: MARKER * 2 };
    const { image, sprite } = picture;
    const width = image.naturalWidth;
    const left = isFlipped(item) ? width - sprite.originX : sprite.originX;
    return { x: x - left, y: y - sprite.originY, width, height: image.naturalHeight };
}

/** Everything an item takes up in the map. */
function extentOf(item: MapItem, scene: Pictures): Box {
    const ends = endsOf(item);
    return ends ? boxBetween(ends[0], ends[1]) : boxOf(item, scene);
}

/** The order things are drawn in: backgrounds, each layer's objects then tiles, then the rest. */
function drawOrder(item: MapItem, spriteZ: (key: string) => number): [number, number, number] {
    switch (item.kind) {
        case "back": return [item.values.front === "1" ? 200 : -1, 0, 0];
        case "obj": return [item.layer * 2, numberOf(item, "z"), numberOf(item, "zM")];
        case "tile": return [item.layer * 2 + 1, item.sprite ? spriteZ(item.sprite) : 0, numberOf(item, "zM")];
        case "reactor": return [100, 0, 0];
        case "life": return [101, 0, 0];
        case "misc": return [102, 0, 0];
        case "area":
        case "bounds": return [290, 0, 0];
        default: return [300, 0, 0];
    }
}

export function inDrawOrder(layout: MapLayout, spriteZ: (key: string) => number): MapItem[] {
    const ordered = layout.items.map((item) => ({ item, order: drawOrder(item, spriteZ) }));
    ordered.sort(function byOrder({ order: left }, { order: right }) {
        return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
    });
    return ordered.map(({ item }) => item);
}

function drawPicture(context: CanvasRenderingContext2D, image: HTMLImageElement, box: Box, flipped: boolean) {
    if (!flipped) {
        context.drawImage(image, box.x, box.y, box.width, box.height);
        return;
    }
    context.save();
    context.translate(box.x + box.width, box.y);
    context.scale(-1, 1);
    context.drawImage(image, 0, 0, box.width, box.height);
    context.restore();
}

/** A background's types say which ways it repeats. */
const REPEATS_ACROSS = new Set([1, 3, 4, 6, 7]);
const REPEATS_DOWN = new Set([2, 3, 5, 6, 7]);

/** Where a background is drawn: rx and ry are how far it moves with the map, in percent (-100 stays put in it). */
function backBox(item: MapItem, scene: Scene): Box {
    const box = boxOf(item, scene);
    if (!scene.parallax) return box;
    box.x += scene.camera.x * (1 + numberOf(item, "rx") / 100);
    box.y += scene.camera.y * (1 + numberOf(item, "ry") / 100);
    return box;
}

/** The first of a line's positions that still reaches `from`. */
function firstReaching(start: number, size: number, step: number, from: number) {
    return start - Math.floor((start + size - from) / step) * step;
}

function drawBack(context: CanvasRenderingContext2D, item: MapItem, scene: Scene, view: Box) {
    const picture = pictureFor(item, scene);
    if (!picture) return;
    const original = backBox(item, scene);
    const box = { ...original };
    const type = numberOf(item, "type");
    const across = REPEATS_ACROSS.has(type);
    const down = REPEATS_DOWN.has(type);
    const stepX = Math.abs(numberOf(item, "cx")) || box.width;
    const stepY = Math.abs(numberOf(item, "cy")) || box.height;
    const left = across ? firstReaching(box.x, box.width, stepX, view.x) : box.x;
    const top = down ? firstReaching(box.y, box.height, stepY, view.y) : box.y;
    const right = across ? view.x + view.width : left;
    const bottom = down ? view.y + view.height : top;
    // Repeats drawn a screen pixel larger leave no seams when the zoom puts their edges between pixels.
    const overlap = scene.camera.zoom === 1 ? 0 : 1 / scene.camera.zoom;
    if (across && stepX === box.width) box.width += overlap;
    if (down && stepY === box.height) box.height += overlap;
    context.globalAlpha = Math.min(1, Math.max(0, Number(item.values.a ?? 255) / 255));
    for (let x = left; x <= right; x += stepX)
        for (let y = top; y <= bottom; y += stepY)
            drawPicture(context, picture.image, { ...box, x, y }, isFlipped(item));
    context.globalAlpha = 1;
    if (scene.selected.has(item.path)) outline(context, original, SELECTED, 1 / scene.camera.zoom);
}

function touches(box: Box, view: Box) {
    return box.x <= view.x + view.width && box.x + box.width >= view.x
        && box.y <= view.y + view.height && box.y + box.height >= view.y;
}

function outline(context: CanvasRenderingContext2D, box: Box, colour: string, pixel: number, dashed = false) {
    context.strokeStyle = colour;
    context.lineWidth = 2 * pixel;
    context.setLineDash(dashed ? [6 * pixel, 4 * pixel] : []);
    context.strokeRect(box.x, box.y, box.width, box.height);
    context.setLineDash([]);
}

/** Faint lines, the ones through 0 a little stronger, readable over light and dark pictures alike. */
function drawGrid(context: CanvasRenderingContext2D, grid: Grid, view: Box, pixel: number) {
    if (Math.min(grid.width, grid.height) < MIN_GRID_STEP * pixel) return;
    const right = view.x + view.width;
    const bottom = view.y + view.height;
    context.beginPath();
    for (let x = firstReaching(grid.x, 0, grid.width, view.x); x <= right; x += grid.width) {
        context.moveTo(x, view.y);
        context.lineTo(x, bottom);
    }
    for (let y = firstReaching(grid.y, 0, grid.height, view.y); y <= bottom; y += grid.height) {
        context.moveTo(view.x, y);
        context.lineTo(right, y);
    }
    context.lineWidth = pixel;
    context.strokeStyle = "rgb(255 255 255 / 0.28)";
    context.stroke();
    context.setLineDash([2 * pixel, 2 * pixel]);
    context.strokeStyle = "rgb(0 0 0 / 0.28)";
    context.stroke();
    context.setLineDash([]);
}

function drawEnds(context: CanvasRenderingContext2D, ends: Point[], size: number) {
    for (const point of ends) context.fillRect(point.x - size, point.y - size, size * 2, size * 2);
}

function drawPath(context: CanvasRenderingContext2D, points: Point[]) {
    context.beginPath();
    for (const point of points) context.lineTo(point.x, point.y);
    context.stroke();
}

function drawShape(context: CanvasRenderingContext2D, item: MapItem, selected: boolean, pixel: number) {
    const ends = endsOf(item)!;
    const colour = selected ? SELECTED : COLOURS[item.kind];
    if (isRectangle(item)) {
        const box = boxBetween(ends[0], ends[1]);
        outline(context, box, colour, pixel, item.kind === "bounds");
        if (item.kind === "area") drawLabel(context, item.path, box.x + box.width / 2, box.y - 4 * pixel, pixel);
        context.fillStyle = colour;
        drawEnds(context, ends, 4 * pixel);
        return;
    }
    context.strokeStyle = colour;
    context.fillStyle = colour;
    context.lineWidth = (selected ? 3 : 2) * pixel;
    drawPath(context, ends);
    drawEnds(context, ends, (selected ? 4 : 2) * pixel);
}

function drawLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number, pixel: number) {
    context.font = `${12 * pixel}px ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.lineWidth = 3 * pixel;
    context.strokeStyle = "#000000cc";
    context.strokeText(text, x, y);
    context.fillStyle = "#ffffff";
    context.fillText(text, x, y);
}

function drawPlaced(context: CanvasRenderingContext2D, item: MapItem, box: Box, scene: Scene, pixel: number) {
    const picture = pictureFor(item, scene);
    if (picture) drawPicture(context, picture.image, box, isFlipped(item));
    else if (scene.markers) {
        context.fillStyle = `${COLOURS[item.kind]}99`;
        context.fillRect(box.x, box.y, box.width, box.height);
    }
    const text = item.kind === "portal" ? item.values.pn : item.values.id;
    const isNamed = item.kind === "portal" || !picture;
    if (isNamed && text && scene.markers) drawLabel(context, text, box.x + box.width / 2, box.y - 3 * pixel, pixel);
    if (scene.selected.has(item.path)) outline(context, box, SELECTED, pixel);
}

function drawDraft(context: CanvasRenderingContext2D, draft: Point[], pixel: number) {
    if (draft.length === 0) return;
    context.strokeStyle = SELECTED;
    context.fillStyle = SELECTED;
    context.lineWidth = 2 * pixel;
    drawPath(context, draft);
    drawEnds(context, draft, 4 * pixel);
}

function viewOf({ x, y, zoom }: Camera, width: number, height: number, margin = 0): Box {
    return {
        x: x - width / 2 / zoom - margin,
        y: y - height / 2 / zoom - margin,
        width: width / zoom + margin * 2,
        height: height / zoom + margin * 2,
    };
}

/** Draws the scene and returns the keys of the pictures it wanted but that aren't loaded. */
export function drawScene(context: CanvasRenderingContext2D, width: number, height: number, scene: Scene): string[] {
    const { camera, pictureOf } = scene;
    const pixel = 1 / camera.zoom;
    const view = viewOf(camera, width, height);
    const nearby = viewOf(camera, width, height, UNKNOWN_SIZE);
    const missing = new Set<string>();

    function drawItem(item: MapItem) {
        if (endsOf(item)) {
            drawShape(context, item, scene.selected.has(item.path), pixel);
            return;
        }
        const isUnloaded = item.sprite !== null && pictureOf(item.sprite) === undefined;
        const box = boxOf(item, scene);
        if (isUnloaded) {
            if (item.kind === "back" || touches(box, nearby)) missing.add(item.sprite!);
        } else if (item.kind === "back") drawBack(context, item, scene, view);
        else if (touches(box, view)) drawPlaced(context, item, box, scene, pixel);
    }

    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(camera.zoom, camera.zoom);
    context.translate(-view.x, -view.y);
    context.imageSmoothingEnabled = camera.zoom < 1;
    for (const item of scene.ordered) {
        if (!scene.isShown(item)) continue;
        if (scene.faded.has(item.path)) context.globalAlpha = 0.35;
        drawItem(scene.moved.get(item.path) ?? item);
        context.globalAlpha = 1;
    }
    if (scene.grid) drawGrid(context, scene.grid, view, pixel);
    if (scene.ghost) {
        if (scene.ghost.sprite && pictureOf(scene.ghost.sprite) === undefined) missing.add(scene.ghost.sprite);
        context.globalAlpha = 0.6;
        drawPlaced(context, scene.ghost, boxOf(scene.ghost, scene), scene, pixel);
        context.globalAlpha = 1;
    }
    drawDraft(context, scene.draft, pixel);
    if (scene.band) outline(context, scene.band, SELECTED, pixel, true);
    context.restore();
    return [...missing];
}

// ------------------------------------------------------------ picking

function distance(left: Point, right: Point) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}

function distanceToLine(point: Point, start: Point, end: Point) {
    const length = distance(start, end) ** 2;
    if (length === 0) return distance(point, start);
    const along = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / length;
    const clamped = Math.max(0, Math.min(1, along));
    return distance(point, {
        x: start.x + (end.x - start.x) * clamped,
        y: start.y + (end.y - start.y) * clamped,
    });
}

function contains(box: Box, point: Point) {
    return touches(box, { ...point, width: 0, height: 0 });
}

function distanceToEdges(point: Point, box: Box) {
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const corners = [{ x: box.x, y: box.y }, { x: right, y: box.y }, { x: right, y: bottom }, { x: box.x, y: bottom }];
    const sides = corners.map((corner, i) => distanceToLine(point, corner, corners[(i + 1) % 4]));
    return Math.min(...sides);
}

function gripAt(item: MapItem, scene: Scene, point: Point): Grip | null {
    const ends = endsOf(item);
    if (!ends) {
        const box = item.kind === "back" ? backBox(item, scene) : boxOf(item, scene);
        return contains(box, point) ? "item" : null;
    }
    const reach = REACH / scene.camera.zoom;
    if (distance(point, ends[0]) <= reach) return "start";
    if (distance(point, ends[1]) <= reach) return "end";
    // A rectangle is picked by its edges, so what's inside it can be too.
    const away = isRectangle(item)
        ? distanceToEdges(point, boxBetween(ends[0], ends[1]))
        : distanceToLine(point, ends[0], ends[1]);
    return away <= reach ? "item" : null;
}

/** Everything at a point, the topmost first. Backgrounds cover the whole map, so they're only picked when asked. */
export function hitsAt(scene: Scene, point: Point, backgrounds: boolean): Hit[] {
    const hits: Hit[] = [];
    for (let i = scene.ordered.length - 1; i >= 0; i--) {
        const item = scene.ordered[i];
        const isPickable = item.kind !== "back" || backgrounds || scene.selected.has(item.path);
        if (!isPickable || !scene.isShown(item)) continue;
        const grip = gripAt(item, scene, point);
        if (grip) hits.push({ item, grip });
    }
    return hits;
}

/** Everything a selection rectangle touches. */
export function itemsIn(scene: Scene, band: Box): MapItem[] {
    function isInside(item: MapItem) {
        if (item.kind === "back" || item.kind === "bounds" || !scene.isShown(item)) return false;
        return touches(extentOf(item, scene), band);
    }
    return scene.ordered.filter(isInside);
}

/** What the map takes up: its view range, else everything placed in it. */
export function mapBounds(layout: MapLayout): Box | null {
    const bounds = layout.items.find((item) => item.kind === "bounds");
    if (bounds) return boxBetween(...endsOf(bounds)!);
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const item of layout.items) {
        if (item.kind === "back") continue;
        for (const point of endsOf(item) ?? [positionOf(item)]) {
            left = Math.min(left, point.x);
            top = Math.min(top, point.y);
            right = Math.max(right, point.x);
            bottom = Math.max(bottom, point.y);
        }
    }
    if (left > right) return null;
    return { x: left - 100, y: top - 100, width: right - left + 200, height: bottom - top + 200 };
}

/** A camera showing the whole map. */
export function fitCamera(layout: MapLayout, width: number, height: number): Camera {
    const box = mapBounds(layout);
    if (!box || box.width === 0 || box.height === 0) return { x: 0, y: 0, zoom: 1 };
    const zoom = Math.min(width / box.width, height / box.height, 1);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, zoom: Math.max(0.05, zoom) };
}
