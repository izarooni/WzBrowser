import { useMemo } from "react";

/** The client's orange highlight: #c...#. */
const HIGHLIGHT = /(#c[^#]*#)/;

/** Skill and item strings: line breaks (written as "\n" in the data) and #c...# for the client's orange highlight. */
export function GameText({ text }: { text: string }) {
    const parts = useMemo(() => splitGameText(text), [text]);
    return <span className="whitespace-pre-wrap break-words">{parts}</span>;
}

function splitGameText(text: string) {
    return text.replace(/\\r\\n|\\n/g, "\n").split(HIGHLIGHT).map(renderChunk);
}

function renderChunk(chunk: string, index: number) {
    const highlighted = chunk.startsWith("#c") && chunk.endsWith("#") && chunk.length > 2;
    if (highlighted)
        return <span key={index} className="font-medium text-amber-700 dark:text-amber-400">{chunk.slice(2, -1)}</span>;
    if (chunk) return <span key={index}>{chunk}</span>;
    return null;
}
