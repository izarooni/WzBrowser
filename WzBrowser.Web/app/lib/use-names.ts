import { useCallback, useEffect, useRef, useState } from "react";
import type { LookupKind, LookupRequest } from "./api";
import { useConnection } from "./connection";

const KINDS: LookupKind[] = ["npc", "item", "mob", "map", "skill", "quest"];

// Per file and kind: id -> name, or null once looked up without a result (e.g. no String.wz, or an unknown id).
type KindCache = Map<number, string | null>;
const caches = new Map<string, Record<LookupKind, KindCache>>();

function cacheFor(fileId: string) {
  let c = caches.get(fileId);
  if (!c) {
    c = Object.fromEntries(KINDS.map((k) => [k, new Map()])) as Record<LookupKind, KindCache>;
    caches.set(fileId, c);
  }
  return c;
}

/**
 * Resolves ids to names for a quest archive. Pass every id the screen is about to show; only ids that haven't been
 * looked up yet are requested. Returns a function that gives the name, or undefined while it's still loading
 * (or when none exists), so callers can show the plain id in the meantime.
 *
 * `revision` makes quest names refresh after edits; NPC/item/mob/map names come from String.wz and never change.
 */
export function useNames(fileId: string, wanted: LookupRequest, revision: number) {
  const { api } = useConnection();
  const [, rerender] = useState(0);
  const inFlight = useRef(new Set<string>());
  const lastRevision = useRef(revision);

  const key = JSON.stringify(wanted);

  useEffect(() => {
    const cache = cacheFor(fileId);
    if (lastRevision.current !== revision) {
      cache.quest.clear();
      lastRevision.current = revision;
    }

    const missing: LookupRequest = {};
    let any = false;
    for (const kind of KINDS) {
      for (const id of new Set(wanted[kind] ?? [])) {
        const tag = `${fileId}:${kind}:${id}`;
        if (cache[kind].has(id) || inFlight.current.has(tag)) continue;
        (missing[kind] ??= []).push(id);
        inFlight.current.add(tag);
        any = true;
      }
    }
    if (!any) { rerender((n) => n + 1); return; }

    let cancelled = false;
    api.lookup(fileId, missing).then(
      (res) => {
        for (const kind of KINDS)
          for (const id of missing[kind] ?? []) cache[kind].set(id, res[kind]?.[id] ?? null);
      },
      () => { /* leave uncached so a later render can retry */ },
    ).finally(() => {
      for (const kind of KINDS) for (const id of missing[kind] ?? []) inFlight.current.delete(`${fileId}:${kind}:${id}`);
      if (!cancelled) rerender((n) => n + 1);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, fileId, key, revision]);

  return useCallback((kind: LookupKind, id: number): string | undefined => cacheFor(fileId)[kind].get(id) ?? undefined, [fileId]);
}
