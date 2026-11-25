import { createContext, useContext, useId, useState, type FormEvent } from "react";
import type { PropTree, QuestEdit, QuestSection, QuestSummary } from "../lib/api";
import { child, isNumbered, kids } from "../lib/prop-tree";
import { addPropOps, fieldProblem, isMissing, joinPath, type QuestField, type QuestProp } from "../lib/quest-props";
import { EDITABLE, invalid } from "../lib/values";
import { IdPicker } from "./id-picker";
import { XMark } from "./icons";
import { InlineEdit } from "./node-tree";
import { Ref } from "./ref-link";

/** The quest editor's rows and forms. */

export const BUTTON = "btn-outline px-2 py-1 text-xs disabled:opacity-50";
export const SMALL_INPUT = "input py-1.5 text-[13px]";

interface QuestEditorContext {
    fileId: string;
    questId: number;
    quests: QuestSummary[];
    /** Resolves false when the edit was refused. */
    apply: (label: string, ops: QuestEdit[]) => Promise<boolean>;
}

export const QuestEditorCtx = createContext<QuestEditorContext | null>(null);

export function useQuestEditor() {
    const editor = useContext(QuestEditorCtx);
    if (!editor) throw new Error("This must be used inside a QuestEditor");
    return editor;
}

/** A place in one of the quest's sections; `path` is inside the section. */
export interface Place {
    section: QuestSection;
    path: string;
}

export const inside = (place: Place, name: string): Place => ({ ...place, path: joinPath(place.path, name) });

/** Edits at one place, named in the history by what it's about. */
export function useQuestEdits() {
    const { questId, apply } = useQuestEditor();

    function edit(verb: string, op: QuestEdit["op"], place: Place, value?: string, type?: string) {
        const label = `${verb} ${joinPath(place.section, place.path)} of quest ${questId}`;
        return apply(label, [{ op, quest: questId, ...place, value, type }]);
    }

    return {
        set: (place: Place, value: string, type: string) => edit("Set", "set", place, value, type),
        createFolder: (place: Place) => edit("Create", "folder", place),
        remove: (place: Place) => edit("Delete", "delete", place),
        /** Takes out a numbered entry, moving the ones after it up. */
        removeNumbered: (place: Place) => edit("Delete", "remove", place),
    };
}

// ------------------------------------------------------------------ adding things

function choiceOptions(choices: Record<number, string>) {
    return Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>);
}

function FieldInput({ field, value, onChange }: {
    field: QuestField;
    value: string;
    onChange: (value: string) => void;
}) {
    const { fileId, quests } = useQuestEditor();
    const listId = useId();
    if (field.kind) {
        return (
            <IdPicker
                fileId={fileId}
                kind={field.kind}
                quests={quests}
                label={field.label}
                value={value}
                onChange={onChange}
            />
        );
    }
    const input = {
        value,
        "aria-label": field.label,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        className: SMALL_INPUT,
    };
    if (field.choices) {
        return (
            <select {...input}>
                {!field.required && <option value="">Not set</option>}
                {choiceOptions(field.choices)}
            </select>
        );
    }
    if (field.multiline) return <textarea rows={3} {...input} />;
    return (
        <>
            <input list={field.suggestions && listId} {...input} />
            {field.suggestions && <datalist id={listId}>{choiceOptions(field.suggestions)}</datalist>}
        </>
    );
}

/** A choice that has to be made starts on its first. */
function initialValue(field: QuestField) {
    if (field.initial) return field.initial;
    const isForced = field.required && field.choices;
    return isForced ? Object.keys(field.choices!)[0] : "";
}

/** Asks for a property's or list entry's fields. */
export function FieldsForm({ title, fields, onSubmit, onClose }: {
    title: string;
    fields: QuestField[];
    /** Resolves false when the server refused it. */
    onSubmit: (values: Record<string, string>) => Promise<boolean>;
    onClose: () => void;
}) {
    const { quests, questId } = useQuestEditor();
    const [values, setValues] = useState<Record<string, string>>(
        () => Object.fromEntries(fields.map((field) => [field.name, initialValue(field)])),
    );
    const [busy, setBusy] = useState(false);

    const problemOf = (field: QuestField) => fieldProblem(field, values[field.name], quests, questId);
    const ready = !busy && !fields.some(problemOf);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!ready) return;
        setBusy(true);
        const added = await onSubmit(values);
        setBusy(false);
        if (added) onClose();
    }

    function fieldRow(field: QuestField) {
        const problem = values[field.name].trim() ? problemOf(field) : null;
        const setValue = (value: string) => setValues((current) => ({ ...current, [field.name]: value }));
        return (
            <div key={field.name} className="space-y-1">
                <p className="text-xs text-zinc-500">{field.label}{!field.required && " (optional)"}</p>
                <FieldInput field={field} value={values[field.name]} onChange={setValue} />
                {problem && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{problem}</p>}
            </div>
        );
    }

    return (
        <form
            aria-label={title}
            onSubmit={submit}
            className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
        >
            <h5 className="text-xs font-semibold">{title}</h5>
            {fields.map(fieldRow)}
            <div className="flex gap-1.5">
                <button type="submit" disabled={!ready} className={BUTTON}>Add</button>
                <button type="button" onClick={onClose} className={BUTTON}>Cancel</button>
            </div>
        </form>
    );
}

/** A menu of properties to add, then the picked one's fields. Lists can always take another entry. */
export function AddProperty({ place, node, props, label }: {
    place: Place;
    node: PropTree;
    props: QuestProp[];
    label: string;
}) {
    const { questId, apply } = useQuestEditor();
    const [adding, setAdding] = useState<QuestProp | null>(null);
    const offered = props.filter((prop) => prop.list || isMissing(child(node, prop.name)));

    function pick(name: string) {
        setAdding(offered.find((prop) => prop.name === name) ?? null);
    }

    if (adding) {
        function add(values: Record<string, string>) {
            const ops = addPropOps(questId, place.section, place.path, node, adding!, values);
            return apply(`Add ${adding!.name} to quest ${questId}`, ops);
        }
        return (
            <FieldsForm
                title={adding.label}
                fields={adding.fields}
                onSubmit={add}
                onClose={() => setAdding(null)}
            />
        );
    }
    if (offered.length === 0) return null;
    return (
        <select aria-label={label} value="" onChange={(event) => pick(event.target.value)} className={SMALL_INPUT}>
            <option value="">{label}…</option>
            {offered.map((prop) => <option key={prop.name} value={prop.name}>{prop.label}</option>)}
        </select>
    );
}

/** Adds one of the optional values an entry doesn't have yet. */
function AddField({ place, fields }: { place: Place; fields: QuestField[] }) {
    const edits = useQuestEdits();
    const [adding, setAdding] = useState<QuestField | null>(null);

    if (adding) {
        const add = (values: Record<string, string>) =>
            edits.set(inside(place, adding.name), values[adding.name], adding.type);
        return (
            <FieldsForm
                title={adding.label}
                fields={[{ ...adding, required: true }]}
                onSubmit={add}
                onClose={() => setAdding(null)}
            />
        );
    }

    function fieldButton(field: QuestField) {
        return (
            <button
                key={field.name}
                type="button"
                onClick={() => setAdding(field)}
                className={"rounded-md px-1.5 text-xs text-accent-700 hover:bg-accent-50"
                    + " dark:text-accent-300 dark:hover:bg-accent-600/15"}
            >
                + {field.label}
            </button>
        );
    }

    return <div className="flex flex-wrap gap-1">{fields.map(fieldButton)}</div>;
}

// ------------------------------------------------------------------ what's there

export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={"shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-rose-600"
                + " dark:hover:bg-zinc-800"}
        >
            <XMark className="size-3.5" />
        </button>
    );
}

/** What a value stands for: a thing's name, or the value's own. */
function ValueNote({ field, value }: { field?: QuestField; value: string }) {
    if (field?.kind && /^\d+$/.test(value)) return <Ref kind={field.kind} id={Number(value)} />;
    const label = field?.suggestions?.[Number(value)];
    return label ? <span className="text-xs text-zinc-500">{label}</span> : null;
}

function ValueEditor({ place, node, field, label }: {
    place: Place;
    node: PropTree;
    field?: QuestField;
    label: string;
}) {
    const { questId, quests } = useQuestEditor();
    const edits = useQuestEdits();
    const value = node.value ?? "";

    const save = (next: string) => edits.set(place, next, node.type);

    function check(next: string) {
        const problem = invalid(node.type, next);
        if (problem || !field || node.type !== "int") return problem;
        return fieldProblem(field, next, quests, questId);
    }

    if (!EDITABLE.has(node.type)) return <span className="text-zinc-400">{node.value ?? node.type}</span>;
    if (field?.choices && value in field.choices) {
        return (
            <select
                aria-label={label}
                value={value}
                onChange={(event) => void save(event.target.value)}
                className={SMALL_INPUT}
            >
                {choiceOptions(field.choices)}
            </select>
        );
    }
    const multiline = node.type === "string";
    return <InlineEdit label={label} value={value} multiline={multiline} check={check} onSave={save} />;
}

export function ValueRow({ place, node, field, label, onRemove }: {
    place: Place;
    node: PropTree;
    field?: QuestField;
    label: string;
    /** Left out when the value has to be there. */
    onRemove?: () => void;
}) {
    return (
        <div className="flex items-start gap-3 text-[13px] leading-6">
            <span className="w-28 shrink-0 text-zinc-500" title={node.name}>{label}</span>
            <div className="min-w-0 flex-1">
                <ValueEditor place={place} node={node} field={field} label={label} />
                <ValueNote field={field} value={node.value ?? ""} />
            </div>
            {onRemove && <RemoveButton label={`Remove ${label}`} onClick={onRemove} />}
        </div>
    );
}

/** One entry of a list, holding its own values. */
function EntryCard({ place, node, fields, label, onRemove }: {
    place: Place;
    node: PropTree;
    fields: QuestField[];
    label: string;
    onRemove: () => void;
}) {
    const edits = useQuestEdits();
    const addable = fields.filter((field) => field.name && !child(node, field.name));

    function row(value: PropTree) {
        const at = inside(place, value.name);
        if (value.type === "sub") return <FolderRows key={value.name} place={at} node={value} label={value.name} />;
        const field = fields.find((candidate) => candidate.name === value.name);
        const remove = () => void edits.remove(at);
        return (
            <ValueRow
                key={value.name}
                place={at}
                node={value}
                field={field}
                label={field?.label ?? value.name}
                onRemove={field?.required ? undefined : remove}
            />
        );
    }

    return (
        <div className="flex items-start gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
            <div className="min-w-0 flex-1 space-y-1">
                {kids(node).map(row)}
                <AddField place={place} fields={addable} />
            </div>
            <RemoveButton label={`Remove ${label} ${node.name}`} onClick={onRemove} />
        </div>
    );
}

/** A list, or any other folder, with its entries. */
function FolderRows({ place, node, prop, label }: {
    place: Place;
    node: PropTree;
    prop?: QuestProp;
    label: string;
}) {
    const edits = useQuestEdits();
    const fields = prop?.fields ?? [];

    function remove(entry: PropTree) {
        const isLast = kids(node).length === 1;
        if (isLast) void edits.remove(place);
        else if (isNumbered(entry)) void edits.removeNumbered(inside(place, entry.name));
        else void edits.remove(inside(place, entry.name));
    }

    function row(entry: PropTree) {
        const at = inside(place, entry.name);
        const removeEntry = () => remove(entry);
        if (entry.type === "sub") {
            return (
                <EntryCard
                    key={entry.name}
                    place={at}
                    node={entry}
                    fields={fields}
                    label={label}
                    onRemove={removeEntry}
                />
            );
        }
        const field = fields.find((candidate) => candidate.name === "");
        return (
            <ValueRow key={entry.name} place={at} node={entry} field={field} label={entry.name} onRemove={removeEntry} />
        );
    }

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[13px]">
                <span className="font-medium" title={node.name}>{label}</span>
                <RemoveButton label={`Remove all of ${label}`} onClick={() => void edits.remove(place)} />
            </div>
            <div className="space-y-2">{kids(node).map(row)}</div>
        </div>
    );
}

/** Everything in a stage (or in About) and a menu to add to it. */
export function PropertyRows({ place, node, props, addLabel }: {
    place: Place;
    node: PropTree;
    props: QuestProp[];
    addLabel: string;
}) {
    const edits = useQuestEdits();

    function row(value: PropTree) {
        const at = inside(place, value.name);
        const prop = props.find((candidate) => candidate.name === value.name);
        const label = prop?.label ?? value.name;
        if (value.type === "sub") return <FolderRows key={value.name} place={at} node={value} prop={prop} label={label} />;
        const field = prop?.fields[0];
        const remove = () => void edits.remove(at);
        return <ValueRow key={value.name} place={at} node={value} field={field} label={label} onRemove={remove} />;
    }

    return (
        <div className="space-y-3">
            {kids(node).map(row)}
            <AddProperty place={place} node={node} props={props} label={addLabel} />
        </div>
    );
}
