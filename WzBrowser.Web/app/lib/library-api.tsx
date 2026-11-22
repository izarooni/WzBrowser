import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ItemCategory } from "./api";
import { useConnection } from "./connection";

/**
 * The open file whose install the library tables read. A server pinned to a library folder reads that folder and
 * ignores it; one that isn't reads the install the file sits in.
 */
const LibraryScope = createContext<string | null>(null);

export function LibraryScopeProvider({ fileId, children }: { fileId: string; children: ReactNode }) {
    return <LibraryScope.Provider value={fileId}>{children}</LibraryScope.Provider>;
}

/** The library tables' data and pictures (mobs, maps, items, NPCs), for the install in scope. */
export function useLibraryApi() {
    const { api } = useConnection();
    const file = useContext(LibraryScope);
    return useMemo(() => ({
        mobs: () => api.mobs(file),
        mobLocations: () => api.mobLocations(file),
        mobSpriteUrl: (id: number) => api.mobSpriteUrl(id, file),
        maps: () => api.maps(file),
        mapMinimapUrl: (id: number) => api.mapMinimapUrl(id, file),
        items: (category: ItemCategory) => api.items(category, file),
        itemIconUrl: (id: number) => api.itemIconUrl(id, file),
        npcQuests: () => api.npcQuests(file),
        npcSpriteUrl: (id: number) => api.npcSpriteUrl(id, file),
    }), [api, file]);
}
