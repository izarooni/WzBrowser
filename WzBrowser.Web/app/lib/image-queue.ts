import { useEffect, useState, type RefObject } from "react";

/**
 * Thumbnails load through here instead of straight from an <img>: a few at a time, only while on screen, and dropped
 * (request aborted) as soon as they leave the screen or the view, e.g. on switching sections. A browser keeps only six
 * connections to the API, so pictures loading straight away would queue the next section's list behind a screenful of
 * them. Loaded pictures are kept, so going back to a section shows them at once.
 */

/** Pictures loading at once; the browser's other connections to the server stay free for lists and edits. */
const MAX_RUNNING = 4;
/** Loaded pictures kept, as object URLs by address, oldest first. */
const CACHE_MAX = 4000;

const cache = new Map<string, string>();
interface Job { url: string; signal: AbortSignal; resolve: (src: string) => void; reject: (e: unknown) => void }
const waiting: Job[] = [];
let running = 0;

function remember(url: string, src: string) {
    cache.set(url, src);
    while (cache.size > CACHE_MAX) {
        const [oldest, old] = cache.entries().next().value as [string, string];
        cache.delete(oldest);
        URL.revokeObjectURL(old);
    }
}

function next() {
    while (running < MAX_RUNNING && waiting.length > 0) {
        const job = waiting.shift()!;
        if (job.signal.aborted) continue;
        running++;
        fetch(job.url, { signal: job.signal })
            .then(async (res) => {
                if (!res.ok) throw new Error(`${res.status}`);
                const src = URL.createObjectURL(await res.blob());
                remember(job.url, src);
                job.resolve(src);
            })
            .catch(job.reject)
            .finally(() => { running--; next(); });
    }
}

function load(url: string, signal: AbortSignal): Promise<string> {
    const hit = cache.get(url);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
        waiting.push({ url, signal, resolve, reject });
        signal.addEventListener("abort", () => {
            const i = waiting.findIndex((j) => j.signal === signal);
            if (i >= 0) waiting.splice(i, 1);
            reject(signal.reason);
        }, { once: true });
        next();
    });
}

/**
 * The picture at `url` for the element `ref`, loaded through the queue once the element is on screen (or near it).
 * `src` is null until it's loaded; `failed` when there's none (a 404) or it couldn't be read.
 */
export function useQueuedImage(url: string | null, ref: RefObject<HTMLElement | null>): { src: string | null; failed: boolean } {
    const [visible, setVisible] = useState(false);
    const [state, setState] = useState<{ url: string; src: string | null; failed: boolean } | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" });
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);

    const cached = url ? cache.get(url) : undefined;
    useEffect(() => {
        if (!url || cached || !visible) return;
        const aborter = new AbortController();
        load(url, aborter.signal).then(
            (src) => setState({ url, src, failed: false }),
            () => { if (!aborter.signal.aborted) setState({ url, src: null, failed: true }); },
        );
        return () => aborter.abort();
    }, [url, cached, visible]);

    if (!url) return { src: null, failed: true };
    if (cached) return { src: cached, failed: false };
    if (state?.url === url) return { src: state.src, failed: state.failed };
    return { src: null, failed: false };
}
