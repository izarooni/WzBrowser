import type { MapEdit, MapItem, MapLayout } from "./api";
import { endNames, endsOf, numberOf, positionOf, type Grid, type Grip, type Point } from "./map-scene";

/** What the map editor's actions change, as edits for the server. */

/** Properties that hold text; everything else the editor adds is a number. */
const TEXTS = new Set([
    "u", "oS", "l0", "l1", "l2", "bS", "pn", "tn", "type", "id", "name", "script", "image", "tags", "limitedname",
    "reactorName", "sessionValueKey", "sessionValue",
]);

/** A background's type is a number, a mob's or NPC's is a letter. */
export function typeOf(item: Pick<MapItem, "kind">, name: string) {
    if (item.kind === "back" && name === "type") return "int";
    return TEXTS.has(name) ? "string" : "int";
}

export const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Sets every value that differs from before. */
export function editsBetween(before: MapItem, after: MapItem): MapEdit[] {
    if (before.kind === "seat") {
        const value = `${after.values.x}, ${after.values.y}`;
        return value === `${before.values.x}, ${before.values.y}` ? [] : [{ op: "set", path: before.path, value }];
    }
    const edits: MapEdit[] = [];
    for (const [name, value] of Object.entries(after.values))
        if (before.values[name] !== value)
            edits.push({ op: "set", path: `${before.path}/${name}`, value, type: typeOf(before, name) });
    return edits;
}

/** Free numbered names in folders of the map, each given out once. */
export class FreeNames {
    private readonly next = new Map<string, number>();

    constructor(layout: MapLayout) {
        for (const item of layout.items) {
            this.note(folderOf(item.path), nameOf(item.path));
            // A foothold's id is its own in the whole map.
            if (item.kind === "foothold") this.note("foothold", nameOf(item.path));
        }
    }

    private note(folder: string, name: string) {
        const number = Number(name) || 0;
        this.next.set(folder, Math.max(this.next.get(folder) ?? 0, number + 1));
    }

    take(folder: string): string {
        // Footholds count from 1: 0 is how prev and next say there's none.
        const first = folder === "foothold" ? 1 : 0;
        const number = this.next.get(folder) ?? first;
        this.next.set(folder, number + 1);
        return String(number);
    }
}

/** Adds an item at its path. */
export function createItem(item: MapItem): MapEdit[] {
    if (item.kind === "seat")
        return [{ op: "set", path: item.path, value: `${item.values.x}, ${item.values.y}`, type: "vector" }];
    const add = ([name, value]: [string, string]): MapEdit =>
        ({ op: "set", path: `${item.path}/${name}`, value, type: typeOf(item, name) });
    return Object.entries(item.values).map(add);
}

// ------------------------------------------------------------ moving

function withMovedEnd(item: MapItem, grip: "start" | "end", dx: number, dy: number): MapItem {
    const names = endNames(item)![grip];
    const values = { ...item.values };
    // Both ends of a ladder share its x, so an end only moves up and down.
    if (item.kind !== "ladder") values[names.x] = String(numberOf(item, names.x) + dx);
    values[names.y] = String(numberOf(item, names.y) + dy);
    return { ...item, values };
}

function withMoved(item: MapItem, dx: number, dy: number): MapItem {
    const values = { ...item.values };
    const shift = (name: string, by: number) => {
        if (values[name] !== undefined) values[name] = String(numberOf(item, name) + by);
    };
    const names = endNames(item);
    if (names) {
        for (const name of new Set([names.start.x, names.end.x])) shift(name, dx);
        for (const name of [names.start.y, names.end.y]) shift(name, dy);
        return { ...item, values };
    }
    shift("x", dx);
    shift("y", dy);
    if (item.kind === "life") {
        shift("rx0", dx);
        shift("rx1", dx);
        shift("cy", dy);
    }
    return { ...item, values };
}

const keyOf = (point: Point) => `${point.x},${point.y}`;

/** The items a drag changes, as they'd be after it. Footholds that share a moved end are stretched along. */
export function movedItems(layout: MapLayout, items: MapItem[], grip: Grip, dx: number, dy: number): MapItem[] {
    const moved: MapItem[] = [];
    const movedPoints = new Set<string>();
    for (const item of items) {
        if (item.kind === "foothold") {
            const [start, end] = endsOf(item)!;
            if (grip !== "end") movedPoints.add(keyOf(start));
            if (grip !== "start") movedPoints.add(keyOf(end));
        } else if (grip === "item" || !endNames(item)) moved.push(withMoved(item, dx, dy));
        else moved.push(withMovedEnd(item, grip, dx, dy));
    }
    if (movedPoints.size === 0) return moved;
    for (const item of layout.items) {
        if (item.kind !== "foothold") continue;
        const [start, end] = endsOf(item)!;
        let changed = item;
        if (movedPoints.has(keyOf(start))) changed = withMovedEnd(changed, "start", dx, dy);
        if (movedPoints.has(keyOf(end))) changed = withMovedEnd(changed, "end", dx, dy);
        if (changed !== item) moved.push(changed);
    }
    return moved;
}

/** The foothold a point stands on: the nearest one at or below it, with its height there. */
export function footholdBelow(layout: MapLayout, point: Point): { id: string; y: number } | null {
    let best: { id: string; y: number } | null = null;
    for (const item of layout.items) {
        if (item.kind !== "foothold") continue;
        const [start, end] = endsOf(item)!;
        // Footholds walked on run left to right; the others are walls and ceilings.
        if (start.x >= end.x || point.x < start.x || point.x > end.x) continue;
        const along = (point.x - start.x) / (end.x - start.x);
        const y = Math.round(start.y + (end.y - start.y) * along);
        if (y < point.y - 10 || (best && y >= best.y)) continue;
        best = { id: nameOf(item.path), y };
    }
    return best;
}

/** Puts a mob or NPC on the foothold below it. */
export function standing(layout: MapLayout, life: MapItem): MapItem {
    const foothold = footholdBelow(layout, positionOf(life));
    if (!foothold) return life;
    const above = life.values.y === undefined ? 0 : numberOf(life, "y") - positionOf(life).y;
    const values = { ...life.values, y: String(foothold.y + above), cy: String(foothold.y), fh: foothold.id };
    return { ...life, values };
}

// ------------------------------------------------------------ snapping

/** How near a thing must be to snap, in screen pixels. */
const SNAP = 10;

const CELL = { width: 90, height: 60 };

/**
 * The corners of the ground each type of tile draws, from its position: a cell is 90x60, edges are its sides, and
 * slopes are the triangles of one cut corner to corner. Tiles fit together where corners meet.
 */
const TILE_CORNERS: Record<string, Point[]> = {
    bsc: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    enH0: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    enH1: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    enV0: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    enV1: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    edU: [{ x: 0, y: 0 }],
    edD: [{ x: 0, y: 0 }],
    slLU: [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
    slRU: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }],
    slLD: [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }],
    slRD: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
};

function tileCorners(tile: MapItem, scale: number): Point[] {
    const { x, y } = positionOf(tile);
    const place = (corner: Point) => ({
        x: x + corner.x * CELL.width * scale,
        y: y + corner.y * CELL.height * scale,
    });
    return (TILE_CORNERS[tile.values.u] ?? []).map(place);
}

/** The nearest of `targets` to any of `points`, as how far to move to meet it; null when none is near. */
function nearestOffset(points: Point[], targets: Point[], reach: number): Point | null {
    let best: Point | null = null;
    let nearest = reach;
    for (const point of points)
        for (const target of targets) {
            const offset = { x: target.x - point.x, y: target.y - point.y };
            const away = Math.hypot(offset.x, offset.y);
            if (away > nearest) continue;
            nearest = away;
            best = offset;
        }
    return best;
}

/** The ends of every foothold, except those of the left out items. */
function footholdEnds(layout: MapLayout, leftOut: ReadonlySet<string>): Point[] {
    const points: Point[] = [];
    for (const item of layout.items)
        if (item.kind === "foothold" && !leftOut.has(item.path)) points.push(...endsOf(item)!);
    return points;
}

/** The corners of a layer's tiles. */
function layerCorners(layout: MapLayout, layer: number, leftOut: ReadonlySet<string>): Point[] {
    const points: Point[] = [];
    for (const item of layout.items)
        if (item.kind === "tile" && item.layer === layer && !leftOut.has(item.path))
            points.push(...tileCorners(item, layout.tileScales[layer]));
    return points;
}

function toGrid(grid: Grid, { x, y }: Point): Point {
    return {
        x: grid.x + Math.round((x - grid.x) / grid.width) * grid.width,
        y: grid.y + Math.round((y - grid.y) / grid.height) * grid.height,
    };
}

/** What things fit to: the ones around them, and grids for footholds and for everything else. */
export interface Snapping { things: boolean; grid: Grid | null; footholdGrid: Grid | null }

function nearbyOffset(layout: MapLayout, items: MapItem[], zoom: number): Point | null {
    const leftOut = new Set(items.map((item) => item.path));
    const reach = SNAP / zoom;
    const [first] = items;
    switch (first.kind) {
        case "tile": {
            const corners = tileCorners(first, layout.tileScales[first.layer]);
            return nearestOffset(corners, layerCorners(layout, first.layer, leftOut), reach);
        }
        case "foothold": return nearestOffset(endsOf(first)!, footholdEnds(layout, leftOut), reach);
        case "portal":
        case "reactor":
        case "seat": {
            const position = positionOf(first);
            const foothold = footholdBelow(layout, position);
            if (!foothold || Math.abs(foothold.y - position.y) > reach) return null;
            return { x: 0, y: foothold.y - position.y };
        }
        default: return null;
    }
}

/** How far to move these things, dragged or about to be placed, to fit the ones around them or else a grid. */
export function snapOffset(layout: MapLayout, items: MapItem[], zoom: number, snapping: Snapping): Point {
    const [first] = items;
    if (!first) return { x: 0, y: 0 };
    const nearby = snapping.things ? nearbyOffset(layout, items, zoom) : null;
    if (nearby) return nearby;
    const grid = first.kind === "foothold" ? snapping.footholdGrid : snapping.grid;
    if (!grid) return { x: 0, y: 0 };
    const position = endsOf(first)?.[0] ?? positionOf(first);
    const snapped = toGrid(grid, position);
    return { x: snapped.x - position.x, y: snapped.y - position.y };
}

/** Where an end of a foothold goes: onto an end or tile corner near it, or else the grid. */
export function snapPoint(
    layout: MapLayout,
    point: Point,
    zoom: number,
    snapping: Snapping,
    leftOut: ReadonlySet<string> = new Set(),
): Point {
    if (snapping.things) {
        const targets = footholdEnds(layout, leftOut);
        layout.tileScales.forEach((_, layer) => targets.push(...layerCorners(layout, layer, leftOut)));
        const offset = nearestOffset([point], targets, SNAP / zoom);
        if (offset) return { x: point.x + offset.x, y: point.y + offset.y };
    }
    return snapping.footholdGrid ? toGrid(snapping.footholdGrid, point) : point;
}

// ------------------------------------------------------------ deleting, copying, ordering

/** Deletes items; footholds next to a deleted one stop leading to it, and the view range is only its four numbers. */
export function deleteItems(layout: MapLayout, items: MapItem[]): MapEdit[] {
    const edits: MapEdit[] = [];
    const gone = new Set<string>();
    for (const item of items) {
        if (item.kind === "bounds") {
            for (const name of Object.keys(item.values)) edits.push({ op: "delete", path: `info/${name}` });
            continue;
        }
        edits.push({ op: "delete", path: item.path });
        if (item.kind === "foothold") gone.add(nameOf(item.path));
    }
    if (gone.size === 0) return edits;
    const deleted = new Set(items.map((item) => item.path));
    for (const other of layout.items) {
        if (other.kind !== "foothold" || deleted.has(other.path)) continue;
        for (const side of ["prev", "next"])
            if (gone.has(other.values[side])) edits.push({ op: "set", path: `${other.path}/${side}`, value: "0" });
    }
    return edits;
}

/** Things that can be copied: all but the view range and the one-off things, which a map has one of. */
export function isCopyable(item: MapItem) {
    return item.kind !== "bounds" && item.kind !== "misc";
}

/**
 * Copies items into a map (or moves them there), shifted by the offset. `from` is their map when it's another one.
 * Returns the edits and the new paths. A copy keeps everything the original has, known to the editor or not.
 */
export function copyItems(
    op: "copy" | "move",
    layout: MapLayout,
    items: MapItem[],
    from: string | null,
    offset: Point,
) {
    const names = new FreeNames(layout);
    const edits: MapEdit[] = [];
    const paths: string[] = [];
    // New footholds have ids of their own, which the copied prev and next follow.
    const ids = new Map<string, string>();
    for (const item of items)
        if (item.kind === "foothold") ids.set(nameOf(item.path), names.take("foothold"));

    for (const item of items) {
        const folder = folderOf(item.path);
        const isFoothold = item.kind === "foothold";
        const target = `${folder}/${isFoothold ? ids.get(nameOf(item.path)) : names.take(folder)}`;
        edits.push({ op, path: item.path, target, from: from ?? undefined });
        const original = { ...item, path: target };
        let copy = withMoved(original, offset.x, offset.y);
        if (isFoothold) {
            const prev = ids.get(item.values.prev) ?? "0";
            const next = ids.get(item.values.next) ?? "0";
            copy = { ...copy, values: { ...copy.values, prev, next } };
        }
        if (item.kind === "life") copy = standing(layout, copy);
        edits.push(...editsBetween(original, copy));
        paths.push(target);
    }
    edits.push(...tileSetEdits(layout, items));
    return { edits, paths };
}

/** A layer without a tile set takes the one of the tiles put in it. */
function tileSetEdits(layout: MapLayout, items: MapItem[]): MapEdit[] {
    const edits: MapEdit[] = [];
    const given = new Set<number>();
    for (const item of items) {
        if (item.kind !== "tile" || !item.sprite || layout.tileSets[item.layer] || given.has(item.layer)) continue;
        given.add(item.layer);
        const set = item.sprite.split("/")[1];
        edits.push({ op: "set", path: `${item.layer}/info/tS`, value: set, type: "string" });
    }
    return edits;
}

/** Why copied tiles can't go into this map: a layer draws all of its tiles from one set. */
export function tileSetClash(layout: MapLayout, items: MapItem[]): string | null {
    for (const item of items) {
        if (item.kind !== "tile" || !item.sprite) continue;
        const set = item.sprite.split("/")[1];
        const current = layout.tileSets[item.layer];
        if (current && current !== set) return `Layer ${item.layer} here uses the ${current} tiles, not ${set}.`;
    }
    return null;
}

/** Moves tiles and objects to another layer. Returns the edits and the new paths. */
export function moveToLayer(layout: MapLayout, items: MapItem[], layer: number) {
    const names = new FreeNames(layout);
    const edits: MapEdit[] = [];
    const paths: string[] = [];
    for (const item of items) {
        if ((item.kind !== "tile" && item.kind !== "obj") || item.layer === layer) {
            paths.push(item.path);
            continue;
        }
        const folder = `${layer}/${item.kind}`;
        const target = `${folder}/${names.take(folder)}`;
        edits.push({ op: "move", path: item.path, target });
        paths.push(target);
    }
    const moved = items.map((item) => ({ ...item, layer }));
    return { edits: [...edits, ...tileSetEdits(layout, moved)], paths };
}

/** The same value in several items, e.g. turned around. */
export function setEach(items: MapItem[], change: (item: MapItem) => Record<string, string>): MapEdit[] {
    const editsOf = (item: MapItem) => editsBetween(item, { ...item, values: { ...item.values, ...change(item) } });
    return items.flatMap(editsOf);
}

/** Puts objects over or under everything else in their layer. */
export function reorder(layout: MapLayout, items: MapItem[], toFront: boolean): MapEdit[] {
    function newOrder(item: MapItem) {
        const isLayerObject = (other: MapItem) => other.kind === "obj" && other.layer === item.layer;
        const orders = layout.items.filter(isLayerObject).map((other) => numberOf(other, "z"));
        return { z: String(toFront ? Math.max(...orders) + 1 : Math.min(...orders) - 1) };
    }
    return setEach(items.filter((item) => item.kind === "obj"), newOrder);
}

// ------------------------------------------------------------ footholds

/** New footholds through these points, joined to the ones that end where they start and the other way round. */
export function drawFootholds(layout: MapLayout, points: Point[], layer: number, platform: number) {
    const names = new FreeNames(layout);
    const ids = points.slice(1).map(() => names.take("foothold"));
    const edits: MapEdit[] = [];
    const paths: string[] = [];
    const meets = (grip: 0 | 1, point: Point) => layout.items.find((item) =>
        item.kind === "foothold" && keyOf(endsOf(item)![grip]) === keyOf(point));
    const before = meets(1, points[0]);
    const after = meets(0, points[points.length - 1]);

    ids.forEach((id, index) => {
        const [start, end] = [points[index], points[index + 1]];
        let prev = ids[index - 1] ?? "0";
        let next = ids[index + 1] ?? "0";
        if (index === 0 && before) prev = nameOf(before.path);
        if (index === ids.length - 1 && after) next = nameOf(after.path);
        const path = `foothold/${layer}/${platform}/${id}`;
        const values = {
            x1: String(start.x),
            y1: String(start.y),
            x2: String(end.x),
            y2: String(end.y),
            prev,
            next,
        };
        edits.push(...createItem({ path, kind: "foothold", layer, sprite: null, values }));
        paths.push(path);
    });
    if (before) edits.push({ op: "set", path: `${before.path}/next`, value: ids[0], type: "int" });
    if (after) edits.push({ op: "set", path: `${after.path}/prev`, value: ids[ids.length - 1], type: "int" });
    return { edits, paths };
}

/** Makes every foothold's prev and next the ones that meet its ends, and stands mobs and NPCs on what's below them. */
export function relinkFootholds(layout: MapLayout): MapEdit[] {
    const footholds = layout.items.filter((item) => item.kind === "foothold");
    const byStart = new Map<string, string>();
    const byEnd = new Map<string, string>();
    for (const foothold of footholds) {
        const [start, end] = endsOf(foothold)!;
        byStart.set(keyOf(start), nameOf(foothold.path));
        byEnd.set(keyOf(end), nameOf(foothold.path));
    }
    const edits = setEach(footholds, function linksOf(foothold) {
        const [start, end] = endsOf(foothold)!;
        return { prev: byEnd.get(keyOf(start)) ?? "0", next: byStart.get(keyOf(end)) ?? "0" };
    });
    const known = new Set(footholds.map((foothold) => nameOf(foothold.path)));
    for (const life of layout.items)
        if (life.kind === "life" && !known.has(life.values.fh)) edits.push(...editsBetween(life, standing(layout, life)));
    return edits;
}

/** The footholds joined to this one, end to end. */
export function connectedFootholds(layout: MapLayout, first: MapItem): string[] {
    const footholds = layout.items.filter((item) => item.kind === "foothold");
    const found = new Set([first.path]);
    const points = new Set(endsOf(first)!.map(keyOf));
    for (let grew = true; grew;) {
        grew = false;
        for (const foothold of footholds) {
            if (found.has(foothold.path)) continue;
            const ends = endsOf(foothold)!.map(keyOf);
            if (!ends.some((end) => points.has(end))) continue;
            found.add(foothold.path);
            for (const end of ends) points.add(end);
            grew = true;
        }
    }
    return [...found];
}

/** Which platform (zM) of its layer an item is on: a foothold's is the folder it's in. */
export function platformOf(item: MapItem): string | null {
    if (item.kind === "foothold") return item.path.split("/")[2];
    return item.values.zM ?? null;
}

// ------------------------------------------------------------ checking

export interface Problem { text: string; path: string | null }

/** Things that are likely wrong with a map. `missing`: pictures that were looked for and not found. */
export function findProblems(layout: MapLayout, missing: (key: string) => boolean, mapIds: ReadonlySet<number>) {
    const problems: Problem[] = [];
    const add = (item: MapItem | null, text: string) => problems.push({ text, path: item?.path ?? null });
    const ids = new Set<string>();
    const portalNames = new Set<string>();
    for (const item of layout.items)
        if (item.kind === "foothold") ids.add(nameOf(item.path));

    const portals = layout.items.filter((item) => item.kind === "portal");
    if (!portals.some((portal) => portal.values.pt === "0")) add(null, "There's no start point (a portal with pt 0).");
    if (!layout.items.some((item) => item.kind === "bounds")) add(null, "There's no view range (VRLeft, VRTop, ...).");

    for (const item of layout.items) {
        if (item.sprite && missing(item.sprite)) add(item, `Its picture ${item.sprite} wasn't found.`);
        if (item.kind === "tile" && !item.sprite) add(item, "Its layer has no tile set (info/tS).");
        if (item.kind === "foothold") {
            const [start, end] = endsOf(item)!;
            if (keyOf(start) === keyOf(end)) add(item, "A foothold with no length.");
            for (const side of ["prev", "next"]) {
                const id = item.values[side] ?? "0";
                if (id !== "0" && !ids.has(id)) add(item, `Its ${side} is foothold ${id}, which isn't in the map.`);
            }
        }
        if (item.kind === "life" && !ids.has(item.values.fh)) add(item, "It stands on a foothold that isn't in the map.");
        if (item.kind === "back") {
            const repeats = numberOf(item, "type") !== 0;
            if (repeats && (numberOf(item, "cx") < 0 || numberOf(item, "cy") < 0))
                add(item, "A repeating background with a negative cx or cy.");
        }
        if (item.kind !== "portal") continue;
        const { pn, pt, tm } = item.values;
        if (pt !== "0" && pn) {
            if (portalNames.has(pn) && pn !== "tp") add(item, `Another portal is also called ${pn}.`);
            portalNames.add(pn);
        }
        const target = Number(tm);
        if (target !== 999999999 && mapIds.size > 0 && !mapIds.has(target)) add(item, `Its target map ${tm} isn't here.`);
    }
    return problems;
}
