import { useEffect, useState } from "react";

const PREFIX = "wzbrowser.";

function read<T>(key: string, initial: T): T {
    try {
        const stored = localStorage.getItem(PREFIX + key);
        return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
        return initial; // not readable: as if it was never stored
    }
}

/** State this browser remembers. */
export function useStored<T>(key: string, initial: T) {
    const [value, setValue] = useState<T>(() => read(key, initial));
    // Written once it settles rather than on every move of a drag.
    useEffect(function remember() {
        function write() {
            try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* not persisted */ }
        }
        const timer = setTimeout(write, 250);
        return () => clearTimeout(timer);
    }, [key, value]);
    return [value, setValue] as const;
}
