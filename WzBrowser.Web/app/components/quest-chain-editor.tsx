import { useState, type FormEvent } from "react";
import type { QuestDetail, QuestEdit } from "../lib/api";
import { useConnection } from "../lib/connection";
import { errorMessage } from "../lib/errors";
import { child, int, kids } from "../lib/prop-tree";
import {
    completedQuests, fieldProblem, newIdProblem, nextNumber, nextQuestOf, type QuestField,
} from "../lib/quest-props";
import { useActions } from "../lib/workspace";
import { IdPicker } from "./id-picker";
import { QuestIdInput } from "./new-quest-form";
import { Card, StageCard } from "./quest-cards";
import { BUTTON, RemoveButton, useQuestEditor } from "./quest-fields";
import { Ref } from "./ref-link";

const LINKED: QuestField = { name: "", label: "Quest", type: "int", required: true, kind: "quest" };

/** Asks for a quest to link to, by id or name. */
function LinkForm({ label, onLink }: { label: string; onLink: (id: number) => Promise<boolean> }) {
    const { fileId, quests, questId } = useQuestEditor();
    const [value, setValue] = useState("");
    const ready = !fieldProblem(LINKED, value, quests, questId);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (ready && await onLink(Number(value))) setValue("");
    }

    return (
        <form aria-label={label} onSubmit={submit} className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
                <IdPicker fileId={fileId} kind="quest" quests={quests} label={label} value={value} onChange={setValue} />
            </div>
            <button type="submit" disabled={!ready} className={BUTTON}>Link</button>
        </form>
    );
}

/** What makes `from` lead to `to`, and `to` require it. `replace`: even when `from` leads elsewhere already. */
function linkOps(from: QuestDetail, to: QuestDetail, replace: boolean): QuestEdit[] {
    const ops: QuestEdit[] = [];
    function set(quest: QuestDetail, section: QuestEdit["section"], path: string, value: number) {
        ops.push({ op: "set", quest: quest.id, section, path, value: String(value), type: "int" });
    }

    const next = nextQuestOf(from.act);
    if (next == null || (replace && next !== to.id)) set(from, "Act", "1/nextQuest", to.id);
    if (completedQuests(to.check, from.id).length === 0) {
        const number = nextNumber(child(child(to.check, "0"), "quest"));
        set(to, "Check", `0/quest/${number}/id`, from.id);
        set(to, "Check", `0/quest/${number}/state`, 2);
    }
    return ops;
}

/** What takes out both sides of a link. Either quest may be missing from the archive. */
function unlinkOps(fromId: number, toId: number, from: QuestDetail | null, to: QuestDetail | null): QuestEdit[] {
    const ops: QuestEdit[] = [];
    if (nextQuestOf(from?.act) === toId) ops.push({ op: "delete", quest: fromId, section: "Act", path: "1/nextQuest" });

    const entries = completedQuests(to?.check, fromId);
    const all = kids(child(child(to?.check, "0"), "quest"));
    if (entries.length > 0 && entries.length === all.length) {
        ops.push({ op: "delete", quest: toId, section: "Check", path: "0/quest" });
        return ops;
    }
    // From the last, as removing one moves the ones after it.
    const fromLast = entries.map((entry) => Number(entry.name)).sort((a, b) => b - a);
    for (const number of fromLast)
        ops.push({ op: "remove", quest: toId, section: "Check", path: `0/quest/${number}` });
    return ops;
}

/** The quests that come before and after this one, to link, unlink and create. */
export function ChainCard({ quest, onCreate }: {
    quest: QuestDetail;
    /** Resolves false when the quest was refused. */
    onCreate: (quest: { id: number; after: number }) => Promise<boolean>;
}) {
    const { fileId, quests, apply } = useQuestEditor();
    const { api } = useConnection();
    const { toast } = useActions();
    const [newId, setNewId] = useState("");
    const next = nextQuestOf(quest.act);
    const before = new Set(completedQuests(quest.check).flatMap((entry) => int(child(entry, "id")) ?? []));
    const ready = !!newId && !newIdProblem(newId, quests);

    /** Null for a quest that's mentioned but isn't in the archive. */
    async function detailOf(id: number) {
        if (id === quest.id) return quest;
        return quests.some((listed) => listed.id === id) ? api.quest(fileId, id) : null;
    }

    async function change(label: string, makeOps: () => Promise<QuestEdit[]>) {
        try {
            const ops = await makeOps();
            return ops.length === 0 || await apply(label, ops);
        } catch (reason) {
            toast("error", errorMessage(reason));
            return false;
        }
    }

    function link(fromId: number, toId: number, replace: boolean) {
        return change(`Link quest ${fromId} to ${toId}`, makeOps);

        async function makeOps() {
            const [from, to] = await Promise.all([detailOf(fromId), detailOf(toId)]);
            if (!from || !to) throw new Error("That quest isn't in this archive.");
            const isBackwards = completedQuests(from.check, toId).length > 0 || nextQuestOf(to.act) === fromId;
            if (isBackwards) throw new Error(`Quest ${toId} already comes before quest ${fromId}.`);
            return linkOps(from, to, replace);
        }
    }

    function unlink(fromId: number, toId: number) {
        return change(`Unlink quest ${fromId} from ${toId}`, makeOps);

        async function makeOps() {
            const [from, to] = await Promise.all([detailOf(fromId), detailOf(toId)]);
            return unlinkOps(fromId, toId, from, to);
        }
    }

    function linkRow(id: number, onUnlink: () => void) {
        return (
            <div key={id} className="flex items-center justify-between gap-2 text-[13px]">
                <Ref kind="quest" id={id} />
                <RemoveButton label={`Unlink quest ${id}`} onClick={onUnlink} />
            </div>
        );
    }

    async function createNext(event: FormEvent) {
        event.preventDefault();
        if (ready && await onCreate({ id: Number(newId), after: quest.id })) setNewId("");
    }

    return (
        <Card title="Chain" subtitle="Linking makes the first quest lead to the second, which then requires it completed.">
            <div className="grid gap-4 @2xl:grid-cols-2">
                <StageCard stage="←" label="Comes after" empty={false}>
                    {[...before].map((id) => linkRow(id, () => void unlink(id, quest.id)))}
                    <LinkForm label="Quest before this one" onLink={(id) => link(id, quest.id, false)} />
                </StageCard>
                <StageCard stage="→" label="Leads to" empty={false}>
                    {next != null && linkRow(next, () => void unlink(quest.id, next))}
                    <LinkForm label="Quest after this one" onLink={(id) => link(quest.id, id, true)} />
                    <form aria-label="New quest after this one" onSubmit={createNext} className="space-y-1.5">
                        <QuestIdInput quests={quests} value={newId} onChange={setNewId} />
                        <button type="submit" disabled={!ready} className={BUTTON}>New quest after this one</button>
                    </form>
                </StageCard>
            </div>
        </Card>
    );
}
