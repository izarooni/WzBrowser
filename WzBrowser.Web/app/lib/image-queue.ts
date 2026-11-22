import { useEffect, useState, type RefObject } from "react";

/**
 * Thumbnails load through here instead of straight from an <img>: a few at a time, only while on screen, and dropped
 * (request aborted) as soon as they leave the screen or the view, e.g. on switching sections. A browser keeps only six
 * connections to the API, so pictures loading straight away would queue the next section's list behind a screenful of
 * them. Loaded pictures are kept, so going back to a section shows them at once.
 */

/** Pictures loading at once; the browser's other connections to the server stay free for lists and edits. */
const MAX_RUNNING = 4;
/** Loaded pictures kept. */
const CACHE_MAX = 4000;

interface Job {
    url: string;
    signal: AbortSignal;
    resolve: (objectUrl: string) => void;
    reject: (reason: unknown) => void;
}

/** Loaded pictures as object URLs, by address, oldest first. */
const cache = new Map<string, string>();
const waiting: Job[] = [];
let running = 0;

function remember(url: string, objectUrl: string) {
    cache.set(url, objectUrl);
    while (cache.size > CACHE_MAX) {
        const [oldestUrl, oldestObjectUrl] = cache.entries().next().value as [string, string];
        cache.delete(oldestUrl);
        URL.revokeObjectURL(oldestObjectUrl);
    }
}

async function fetchPicture(job: Job) {
    const response = await fetch(job.url, { signal: job.signal });
    if (!response.ok) throw new Error(`${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    remember(job.url, objectUrl);
    return objectUrl;
}

function startWaiting() {
    while (running < MAX_RUNNING && waiting.length > 0) {
        const job = waiting.shift()!;
        if (job.signal.aborted) continue;
        running++;
        fetchPicture(job).then(job.resolve, job.reject).finally(finishJob);
    }
}

function finishJob() {
    running--;
    startWaiting();
}

function load(url: string, signal: AbortSignal): Promise<string> {
    const hit = cache.get(url);
    if (hit) return Promise.resolve(hit);
    return new Promise(function queue(resolve, reject) {
        const job: Job = { url, signal, resolve, reject };
        waiting.push(job);
        signal.addEventListener("abort", function dropJob() {
            const index = waiting.indexOf(job);
            if (index >= 0) waiting.splice(index, 1);
            reject(signal.reason);
        }, { once: true });
        startWaiting();
    });
}

export interface QueuedImage {
    /** The loaded picture's object URL; null until it's loaded. */
    src: string | null;
    /** There's no picture (a 404) or it couldn't be read. */
    failed: boolean;
}

/** The picture at `url` for the element `ref`, loaded through the queue once the element is on screen (or near it). */
export function useQueuedImage(url: string | null, ref: RefObject<HTMLElement | null>): QueuedImage {
    const [visible, setVisible] = useState(false);
    const [loaded, setLoaded] = useState<QueuedImage & { url: string } | null>(null);

    useEffect(function watchVisibility() {
        const element = ref.current;
        if (!element) return;
        const showVisibility = ([entry]: IntersectionObserverEntry[]) => setVisible(entry.isIntersecting);
        const observer = new IntersectionObserver(showVisibility, { rootMargin: "200px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);

    const cached = url ? cache.get(url) : undefined;
    useEffect(function loadWhileVisible() {
        if (!url || cached || !visible) return;
        const loading = url;
        const aborter = new AbortController();
        const showLoaded = (src: string) => setLoaded({ url: loading, src, failed: false });
        const showFailed = () => {
            if (!aborter.signal.aborted) setLoaded({ url: loading, src: null, failed: true });
        };
        load(loading, aborter.signal).then(showLoaded, showFailed);
        return () => aborter.abort();
    }, [url, cached, visible]);

    if (!url) return { src: null, failed: true };
    if (cached) return { src: cached, failed: false };
    if (loaded?.url === url) return { src: loaded.src, failed: loaded.failed };
    return { src: null, failed: false };
}
