import { useMemo, useState, type ReactNode } from "react";
import type { PropTree, QuestDetail, QuestEdit, QuestSection, QuestSummary } from "../lib/api";
import { useConnection } from "../lib/connection";
import { errorMessage } from "../lib/errors";
import { child, isNumbered, isString, kids } from "../lib/prop-tree";
import { STAGE_LABELS } from "../lib/quest-format";
import {
    ACT_PROPS, CHECK_PROPS, INFO_PROPS, SAY_BRANCHES, SAY_PAGE, SAY_PROPS, SECTION_STAGES, STOP_BRANCHES, STOP_PROPS,
    createSectionOps, isMissing, nextNumber,
} from "../lib/quest-props";
import { useActions } from "../lib/workspace";
import { Card, StageCard } from "./quest-cards";
import { ChainCard } from "./quest-chain-editor";
import {
    AddProperty, BUTTON, FieldsForm, PropertyRows, QuestEditorCtx, RemoveButton, SMALL_INPUT, ValueRow, inside,
    useQuestEditor, useQuestEdits, type Place,
} from "./quest-fields";

// ------------------------------------------------------------------ sections

interface SectionProps {
    title: string;
    section: QuestSection;
    path: string;
    node: PropTree | null;
    onOpenRaw?: (path: string) => void;
}

/** A section's card: a button to create it when it's missing, else what's in it. */
function SectionCard({ title, section, path, node, onOpenRaw, children }: SectionProps & { children: ReactNode }) {
    const { questId, apply } = useQuestEditor();
    const edits = useQuestEdits();

    function create() {
        void apply(`Create ${section} of quest ${questId}`, createSectionOps(questId, section));
    }

    const openRaw = node && onOpenRaw ? () => onOpenRaw(path) : undefined;
    // About holds the quest's place in the list, so it goes only with the quest.
    const canDelete = node && section !== "QuestInfo";
    return (
        <Card title={title} subtitle={path} onOpenRaw={openRaw}>
            {node
                ? children
                : <button type="button" onClick={create} className={BUTTON}>Create {title}</button>}
            {canDelete && (
                <button type="button" onClick={() => void edits.remove({ section, path: "" })} className={BUTTON}>
                    Delete {title}
                </button>
            )}
        </Card>
    );
}

/** A section with a stage for starting the quest and one for completing it. */
function StagedSection({ labels, children, ...props }: SectionProps & {
    labels: readonly [string, string];
    children: (place: Place, stage: PropTree) => ReactNode;
}) {
    const edits = useQuestEdits();
    const isExtra = (name: string) => !SECTION_STAGES.includes(name);
    const extra = kids(props.node).map((stage) => stage.name).filter(isExtra);

    function stageCard(name: string) {
        const stage = child(props.node, name);
        const label = isExtra(name) ? `Entry “${name}”` : labels[Number(name)];
        const place: Place = { section: props.section, path: name };
        const create = () => void edits.createFolder(place);
        return (
            <StageCard key={name} stage={name} label={label} empty={false}>
                {stage
                    ? children(place, stage)
                    : <button type="button" onClick={create} className={BUTTON}>Create “{label}”</button>}
            </StageCard>
        );
    }

    return (
        <SectionCard {...props}>
            <div className="grid gap-4 @2xl:grid-cols-2">{[...SECTION_STAGES, ...extra].map(stageCard)}</div>
        </SectionCard>
    );
}

/** About's journal states that have no text yet, each with a button to create it. */
function CreateJournal({ info }: { info: PropTree | null }) {
    const edits = useQuestEdits();
    const missing = ([0, 1, 2] as const).filter((state) => isMissing(child(info, String(state))));
    if (missing.length === 0) return null;

    function stateButton(state: 0 | 1 | 2) {
        const create = () => void edits.set({ section: "QuestInfo", path: String(state) }, "", "string");
        return (
            <button key={state} type="button" onClick={create} className={BUTTON}>
                Create {state}: {STAGE_LABELS.info[state]}
            </button>
        );
    }

    return <div className="flex flex-wrap gap-1.5">{missing.map(stateButton)}</div>;
}

// ------------------------------------------------------------------ dialogue

function branchesOf(place: Place): Record<string, string> {
    const names = place.path.split("/");
    const name = names[names.length - 1];
    if (names.length === 1) return SAY_BRANCHES;
    if (name === "stop") return STOP_BRANCHES;
    if (name === "lost") return { yes: SAY_BRANCHES.yes, no: SAY_BRANCHES.no };
    return {};
}

/** The values besides its text a conversation, or a branch of it, can have. */
function dialogueProps(place: Place) {
    const names = place.path.split("/");
    if (names.length === 1) return SAY_PROPS;
    return names.includes("stop") ? STOP_PROPS : [];
}

/** A conversation's pages, values and branches, and ways to add to them. */
function DialogueRows({ place, node }: { place: Place; node: PropTree }) {
    const edits = useQuestEdits();
    const [addingPage, setAddingPage] = useState(false);
    const branches = branchesOf(place);
    const missing = Object.entries(branches).filter(([name]) => !child(node, name));

    function addPage(values: Record<string, string>) {
        return edits.set(inside(place, nextNumber(node)), values[SAY_PAGE.name], "string");
    }

    function addBranch(name: string) {
        if (name) void edits.createFolder(inside(place, name));
    }

    function row(part: PropTree) {
        const at = inside(place, part.name);
        if (part.type !== "sub") {
            const isPage = isNumbered(part) && isString(part);
            const label = isPage ? `Page ${Number(part.name) + 1}` : part.name;
            const remove = () => void (isPage ? edits.removeNumbered(at) : edits.remove(at));
            return <ValueRow key={part.name} place={at} node={part} label={label} onRemove={remove} />;
        }
        const label = branches[part.name] ?? part.name;
        return (
            <div key={part.name} className="space-y-2 border-l-2 border-zinc-200 pl-4 dark:border-zinc-700">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-500" title={part.name}>{label}</span>
                    <RemoveButton label={`Remove ${label}`} onClick={() => void edits.remove(at)} />
                </div>
                <DialogueRows place={at} node={part} />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {kids(node).map(row)}
            {addingPage && (
                <FieldsForm
                    title="New page"
                    fields={[SAY_PAGE]}
                    onSubmit={addPage}
                    onClose={() => setAddingPage(false)}
                />
            )}
            <div className="flex flex-wrap gap-1.5">
                {!addingPage && (
                    <button type="button" onClick={() => setAddingPage(true)} className={BUTTON}>Add page</button>
                )}
                {missing.length > 0 && (
                    <select
                        aria-label="Add a branch"
                        value=""
                        onChange={(event) => addBranch(event.target.value)}
                        className={`${SMALL_INPUT} max-w-48`}
                    >
                        <option value="">Add a branch…</option>
                        {missing.map(([name, label]) => <option key={name} value={name}>{label}</option>)}
                    </select>
                )}
            </div>
            <AddProperty place={place} node={node} props={dialogueProps(place)} label="Add a value" />
        </div>
    );
}

// ------------------------------------------------------------------ the editor

const stageLabels = (labels: { 0: string; 1: string }) => [labels[0], labels[1]] as const;
const ABOUT: Place = { section: "QuestInfo", path: "" };

/** Creates a quest's sections and stages, edits what's in them, and chains it to others. */
export function QuestEditor({ fileId, quest, quests, onOpenRaw, onCreate }: {
    fileId: string;
    quest: QuestDetail;
    quests: QuestSummary[];
    onOpenRaw?: (path: string) => void;
    /** Resolves false when the quest was refused. */
    onCreate: (quest: { id: number; after: number }) => Promise<boolean>;
}) {
    const { api } = useConnection();
    const actions = useActions();
    const { info, check, say, act, paths } = quest;

    const editor = useMemo(function makeEditor() {
        async function apply(label: string, ops: QuestEdit[]) {
            try {
                actions.refreshed([await api.editQuests(fileId, label, ops)]);
                return true;
            } catch (reason) {
                actions.toast("error", errorMessage(reason));
                return false;
            }
        }
        return { fileId, questId: quest.id, quests, apply };
    }, [api, actions, fileId, quest.id, quests]);

    return (
        <QuestEditorCtx.Provider value={editor}>
            <ChainCard quest={quest} onCreate={onCreate} />
            <SectionCard title="About" section="QuestInfo" path={paths.info} node={info} onOpenRaw={onOpenRaw}>
                <CreateJournal info={info} />
                {info && <PropertyRows place={ABOUT} node={info} props={INFO_PROPS} addLabel="Add a property" />}
            </SectionCard>
            <StagedSection
                title="Requirements"
                section="Check"
                path={paths.check}
                node={check}
                labels={stageLabels(STAGE_LABELS.check)}
                onOpenRaw={onOpenRaw}
            >
                {(place, stage) => (
                    <PropertyRows place={place} node={stage} props={CHECK_PROPS} addLabel="Add a requirement" />
                )}
            </StagedSection>
            <StagedSection
                title="Dialogue"
                section="Say"
                path={paths.say}
                node={say}
                labels={stageLabels(STAGE_LABELS.say)}
                onOpenRaw={onOpenRaw}
            >
                {(place, stage) => <DialogueRows place={place} node={stage} />}
            </StagedSection>
            <StagedSection
                title="Actions"
                section="Act"
                path={paths.act}
                node={act}
                labels={stageLabels(STAGE_LABELS.act)}
                onOpenRaw={onOpenRaw}
            >
                {(place, stage) => (
                    <PropertyRows place={place} node={stage} props={ACT_PROPS} addLabel="Add an action" />
                )}
            </StagedSection>
        </QuestEditorCtx.Provider>
    );
}
