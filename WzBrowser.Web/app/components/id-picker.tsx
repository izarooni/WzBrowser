import { useEffect, useState } from "react";
import type { LookupKind, NamedId, QuestSummary } from "../lib/api";
import { useConnection } from "../lib/connection";
import { KIND_LABEL } from "./ref-link";

const MAX_QUESTS = 50;

function searchQuests(quests: QuestSummary[], text: string): NamedId[] {
    const needle = text.toLowerCase();
    const matches = (quest: QuestSummary) => `${quest.id} ${quest.name}`.toLowerCase().includes(needle);
    return quests.filter(matches).slice(0, MAX_QUESTS);
}

/** Takes a thing's id, typed or picked from the things whose id or name contains the text. */
export function IdPicker({ fileId, kind, quests, label, value, onChange }: {
    fileId: string;
    kind: LookupKind;
    quests: QuestSummary[];
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    const { api } = useConnection();
    const [found, setFound] = useState<NamedId[]>([]);
    const [picked, setPicked] = useState<NamedId | null>(null);
    const needle = value.trim();
    const isPicked = picked != null && String(picked.id) === needle;

    useEffect(function search() {
        if (!needle || isPicked) {
            setFound([]);
            return;
        }
        if (kind === "quest") {
            setFound(searchQuests(quests, needle));
            return;
        }
        const searched = kind;
        let cancelled = false;
        function showFound(list: NamedId[]) {
            if (!cancelled) setFound(list);
        }
        function showNone() {
            showFound([]);
        }
        const ask = () => api.searchNames(fileId, searched, needle).then(showFound, showNone);
        const timer = setTimeout(ask, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [api, fileId, kind, quests, needle, isPicked]);

    function pick(entry: NamedId) {
        setPicked(entry);
        onChange(String(entry.id));
    }

    function option(entry: NamedId) {
        return (
            <li key={entry.id}>
                <button
                    type="button"
                    onClick={() => pick(entry)}
                    className="flex w-full gap-2 px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                    <span className="shrink-0 font-mono text-zinc-500">{entry.id}</span>
                    <span className="truncate">{entry.name || "Unnamed"}</span>
                </button>
            </li>
        );
    }

    return (
        <div className="space-y-1">
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={`${KIND_LABEL[kind]} id or name`}
                aria-label={label}
                className="input py-1.5 text-[13px]"
            />
            {isPicked && <p className="truncate text-xs text-zinc-500">{picked.name || "Unnamed"}</p>}
            {found.length > 0 && (
                <ul
                    aria-label={`${label} matches`}
                    className="max-h-40 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700"
                >
                    {found.map(option)}
                </ul>
            )}
        </div>
    );
}
