import { useState, type FormEvent } from "react";
import type { QuestSummary } from "../lib/api";
import { newIdProblem } from "../lib/quest-props";

const BUTTON = "btn-outline px-2 py-1 text-xs disabled:opacity-50";

/** Takes a new quest's id, saying why it can't be used. */
export function QuestIdInput({ quests, value, onChange }: {
    quests: QuestSummary[];
    value: string;
    onChange: (id: string) => void;
}) {
    const problem = newIdProblem(value, quests);
    return (
        <>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 9))}
                inputMode="numeric"
                placeholder="New quest's id"
                aria-label="New quest's id"
                aria-invalid={!!problem}
                className="input py-1.5 text-[13px]"
            />
            {problem && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{problem}</p>}
        </>
    );
}

export function NewQuestForm({ quests, current, onCreate, onDelete }: {
    quests: QuestSummary[];
    current: number | null;
    /** Resolves false when the quest was refused. */
    onCreate: (quest: { id: number; from?: number }) => Promise<boolean>;
    onDelete: (id: number) => Promise<void>;
}) {
    const [id, setId] = useState("");
    const [busy, setBusy] = useState(false);
    const ready = !!id && !busy && !newIdProblem(id, quests);

    async function create(from?: number) {
        setBusy(true);
        const created = await onCreate({ id: Number(id), from });
        setBusy(false);
        if (created) setId("");
    }

    function submit(event: FormEvent) {
        event.preventDefault();
        if (ready) void create();
    }

    return (
        <form
            aria-label="New quest"
            onSubmit={submit}
            className="space-y-1.5 border-t border-zinc-100 p-2 dark:border-zinc-800"
        >
            <QuestIdInput quests={quests} value={id} onChange={setId} />
            <div className="flex flex-wrap gap-1.5">
                <button type="submit" disabled={!ready} className={BUTTON}>New quest</button>
                <button
                    type="button"
                    disabled={!ready || current == null}
                    onClick={() => void create(current!)}
                    title="Makes the new quest a copy of the open one"
                    className={BUTTON}
                >
                    Clone open quest
                </button>
                <button
                    type="button"
                    disabled={current == null}
                    onClick={() => void onDelete(current!)}
                    className={BUTTON}
                >
                    Delete open quest
                </button>
            </div>
        </form>
    );
}
