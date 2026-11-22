import { useMemo, type ReactNode } from "react";

/** Skill and item strings: line breaks (written as "\n" in the data) and #c...# for the client's orange highlight. */
export function GameText({ text }: { text: string }) {
    const parts = useMemo(() => {
        const out: ReactNode[] = [];
        text.replace(/\\r\\n|\\n/g, "\n").split(/(#c[^#]*#)/).forEach((chunk, i) => {
            if (chunk.startsWith("#c") && chunk.endsWith("#") && chunk.length > 2) {
                out.push(<span key={i} className="font-medium text-amber-700 dark:text-amber-400">{chunk.slice(2, -1)}</span>);
            } else if (chunk) {
                out.push(<span key={i}>{chunk}</span>);
            }
        });
        return out;
    }, [text]);
    return <span className="whitespace-pre-wrap break-words">{parts}</span>;
}
