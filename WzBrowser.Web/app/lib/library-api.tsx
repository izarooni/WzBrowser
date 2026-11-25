import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { OpenedFile } from "./api";
import { useConnection } from "./connection";

/**
 * The open file whose install the library tables read. A server pinned to a library folder reads that folder and
 * ignores it; one that isn't reads the install the file sits in.
 */
const LibraryScope = createContext<string | null>(null);

export function LibraryScopeProvider({ fileId, children }: { fileId: string; children: ReactNode }) {
    return <LibraryScope.Provider value={fileId}>{children}</LibraryScope.Provider>;
}

/**
 * The classic files that get a library table as a tab (lowercase), by the classic file they are or are part of. Keep
 * in step with the server's TableTops, which lets a browse-only server open these files.
 */
export const TABLE_TOPS = ["mob", "etc", "npc"] as const;

export type TableTop = (typeof TABLE_TOPS)[number];

function isTableTop(top: string): top is TableTop {
    return (TABLE_TOPS as readonly string[]).includes(top);
}

/** Which library table a file gets as a tab, or null. _Canvas parts sit under Mob but only hold pictures. */
export function tableTopOf(file: OpenedFile): TableTop | null {
    if (file.kind === "canvas") return null;
    // An older server doesn't send `top`.
    const top = (file.top ?? "").toLowerCase();
    return isTableTop(top) ? top : null;
}

/** The library tables' data and pictures (mobs, maps, NPCs), for the install in scope. */
export function useLibraryApi() {
    const { api } = useConnection();
    const file = useContext(LibraryScope);
    return useMemo(() => ({
        mobs: () => api.mobs(file),
        mobLocations: () => api.mobLocations(file),
        mobSpriteUrl: (id: number) => api.mobSpriteUrl(id, file),
        maps: () => api.maps(file),
        mapMinimapUrl: (id: number) => api.mapMinimapUrl(id, file),
        npcQuests: () => api.npcQuests(file),
        npcSpriteUrl: (id: number) => api.npcSpriteUrl(id, file),
    }), [api, file]);
}
