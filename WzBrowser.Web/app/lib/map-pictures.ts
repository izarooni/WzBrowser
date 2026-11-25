import { useEffect, useMemo, useState } from "react";
import type { Api, MapSprite } from "./api";
import { useConnection } from "./connection";
import type { Picture } from "./map-scene";

/** Pictures loading at once; the browser's other connections stay free for edits and lists. */
const MAX_RUNNING = 4;
/** Keys whose origins are asked for at once. */
const BATCH = 40;

/**
 * A map's pictures, loaded only once they're wanted (on screen), the latest wanted first: where each sits is asked for
 * in batches, then the pictures themselves are loaded a few at a time.
 */
class PictureLoader {
    /** Undefined: not asked for, or loading. Null: there's none. */
    private readonly loaded = new Map<string, Picture | null>();
    private readonly sprites = new Map<string, MapSprite>();
    private readonly asked = new Set<string>();
    private waitingForSprite: string[] = [];
    private waitingForImage: string[] = [];
    private askingForSprites = false;
    private running = 0;
    private stopped = true;

    constructor(
        private readonly api: Api,
        private readonly fileId: string,
        private readonly onChange: () => void,
    ) {}

    readonly pictureOf = (key: string) => this.loaded.get(key);

    readonly spriteZ = (key: string) => this.sprites.get(key)?.z ?? 0;

    /** Loads what's on screen; keys still waiting that aren't anymore are dropped. */
    want(keys: string[]) {
        const wanted = new Set(keys);
        const forget = (key: string) => {
            if (wanted.has(key)) return true;
            this.asked.delete(key);
            return false;
        };
        this.waitingForSprite = this.waitingForSprite.filter(forget);
        this.waitingForImage = this.waitingForImage.filter(forget);
        this.ask(keys);
    }

    private ask(keys: string[]) {
        for (const key of keys) {
            if (this.asked.has(key) || this.loaded.has(key)) continue;
            this.asked.add(key);
            if (this.sprites.has(key)) this.waitingForImage.push(key);
            else this.waitingForSprite.push(key);
        }
        void this.askForSprites();
        this.startImages();
    }

    /** Loads all of these, resolving once each is loaded or known to be missing. */
    async loadAll(keys: string[]) {
        this.ask(keys);
        const isMissing = (key: string) => !this.loaded.has(key);
        while (!this.stopped && keys.some(isMissing)) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            // Scrolling meanwhile may have dropped some.
            this.ask(keys);
        }
    }

    start() {
        this.stopped = false;
    }

    /** Drops everything waiting; it can be wanted again after another start. */
    stop() {
        this.stopped = true;
        this.asked.clear();
        this.waitingForSprite = [];
        this.waitingForImage = [];
    }

    private async askForSprites() {
        if (this.askingForSprites) return;
        this.askingForSprites = true;
        while (this.waitingForSprite.length > 0 && !this.stopped) {
            const batch = this.waitingForSprite.splice(0, BATCH);
            try {
                const found = await this.api.mapSprites(this.fileId, batch);
                for (const key of batch) {
                    if (found[key]) {
                        this.sprites.set(key, found[key]);
                        this.waitingForImage.push(key);
                    } else this.loaded.set(key, null);
                }
            } catch {
                for (const key of batch) this.loaded.set(key, null);
            }
            if (this.stopped) break;
            this.onChange();
            this.startImages();
        }
        this.askingForSprites = false;
    }

    private startImages() {
        while (this.running < MAX_RUNNING && this.waitingForImage.length > 0 && !this.stopped) {
            this.running++;
            void this.loadImage(this.waitingForImage.shift()!);
        }
    }

    private async loadImage(key: string) {
        const image = new Image();
        // Without it, a canvas the picture is drawn on can't be saved as one.
        image.crossOrigin = "anonymous";
        image.src = this.api.mapItemSpriteUrl(this.fileId, key);
        try {
            await image.decode();
            this.loaded.set(key, { image, sprite: this.sprites.get(key)! });
        } catch {
            this.loaded.set(key, null);
        }
        this.running--;
        if (this.stopped) return;
        this.onChange();
        this.startImages();
    }
}

/** The loader, and a number that changes as pictures arrive. */
export function useMapPictures(fileId: string) {
    const { api } = useConnection();
    const [version, setVersion] = useState(0);
    const loader = useMemo(function createLoader() {
        let announced = false;
        // Several pictures arriving together redraw once.
        function announce() {
            if (announced) return;
            announced = true;
            requestAnimationFrame(function redraw() {
                announced = false;
                setVersion((current) => current + 1);
            });
        }
        return new PictureLoader(api, fileId, announce);
    }, [api, fileId]);
    useEffect(function loadWhileMounted() {
        loader.start();
        return () => loader.stop();
    }, [loader]);
    return { loader, version };
}
