import type { LookupKind, PropTree, QuestEdit, QuestSection, QuestSummary } from "./api";
import { child, int, isNumbered, kids } from "./prop-tree";
import { JOB_NAMES, QUEST_STATES } from "./quest-format";
import { invalid } from "./values";

/** What the game reads from quests, for the quest editor to offer. */

export interface QuestField {
    /** Inside the property or list entry; "" when it's the value itself. */
    name: string;
    label: string;
    type: "int" | "string";
    required?: boolean;
    multiline?: boolean;
    initial?: string;
    /** What the number is the id of. */
    kind?: LookupKind;
    /** The only values it can have. */
    choices?: Record<number, string>;
    /** Names of some of the values it can have. */
    suggestions?: Record<number, string>;
}

export interface QuestProp {
    name: string;
    label: string;
    /** Holds numbered entries, rather than one value. */
    list: boolean;
    fields: QuestField[];
}

type Extra = Partial<Omit<QuestField, "name" | "label" | "type">>;

function field(name: string, label: string, extra: Extra = {}): QuestField {
    return { name, label, type: "int", ...extra };
}

function numberProp(name: string, label: string, extra: Extra = {}): QuestProp {
    return { name, label, list: false, fields: [field("", label, { required: true, ...extra })] };
}

function textProp(name: string, label: string, multiline = false): QuestProp {
    const value: QuestField = { name: "", label, type: "string", required: true, multiline };
    return { name, label, list: false, fields: [value] };
}

function listProp(name: string, label: string, fields: QuestField[]): QuestProp {
    return { name, label, list: true, fields };
}

const YES_NO = { 0: "No", 1: "Yes" };
const FLAG: Extra = { initial: "1", choices: YES_NO };
const COUNT = field("count", "Quantity");

const idField = (name: string, label: string, kind: LookupKind) => field(name, label, { required: true, kind });

const QUEST_ENTRY = [
    idField("id", "Quest", "quest"),
    field("state", "State", { required: true, initial: "2", choices: QUEST_STATES }),
];
const JOBS = listProp("job", "Job", [field("", "Job", { required: true, suggestions: JOB_NAMES })]);
const MAPS = listProp("fieldEnter", "Enter map", [idField("", "Map", "map")]);

export const INFO_PROPS: QuestProp[] = [
    textProp("name", "Name"),
    textProp("0", "Available", true),
    textProp("1", "In progress", true),
    textProp("2", "Completed", true),
    textProp("summary", "Summary", true),
    textProp("demandSummary", "Needs", true),
    textProp("rewardSummary", "Rewards", true),
    numberProp("area", "Area"),
    textProp("parent", "Parent (group's name)"),
    numberProp("order", "Order in its group"),
    textProp("type", "Type"),
    textProp("sortkey", "Sort key"),
    numberProp("autoStart", "Auto start", FLAG),
    numberProp("autoAccept", "Auto accept", FLAG),
    numberProp("autoComplete", "Auto complete", FLAG),
    numberProp("autoPreComplete", "Auto pre-complete", FLAG),
    numberProp("oneShot", "One shot", FLAG),
    numberProp("timeLimit", "Time limit"),
    textProp("timerUI", "Timer UI"),
    numberProp("viewMedalItem", "Medal", { kind: "item" }),
    numberProp("medalCategory", "Medal category"),
    numberProp("selectedSkillID", "Selected skill", { kind: "skill" }),
];

export const CHECK_PROPS: QuestProp[] = [
    numberProp("npc", "NPC", { kind: "npc" }),
    listProp("item", "Item", [idField("id", "Item", "item"), COUNT]),
    listProp("mob", "Mob to defeat", [
        idField("id", "Mob", "mob"),
        field("count", "How many", { required: true, initial: "1" }),
    ]),
    listProp("quest", "Quest", QUEST_ENTRY),
    numberProp("lvmin", "Level at least"),
    numberProp("lvmax", "Level at most"),
    JOBS,
    numberProp("pop", "Fame at least"),
    numberProp("endmeso", "Mesos at least"),
    listProp("skill", "Skill", [
        idField("id", "Skill", "skill"),
        field("acquire", "Has learned it", { choices: YES_NO }),
    ]),
    listProp("pet", "Pet", [idField("id", "Pet", "item")]),
    numberProp("pettamenessmin", "Pet closeness at least"),
    listProp("equipAllNeed", "Wearing all of", [idField("", "Item", "item")]),
    listProp("equipSelectNeed", "Wearing one of", [idField("", "Item", "item")]),
    MAPS,
    numberProp("interval", "Repeat every (minutes)"),
    numberProp("dayByDay", "Once a day", FLAG),
    textProp("start", "Available from (YYYYMMDDHH)"),
    textProp("end", "Available until (YYYYMMDDHH)"),
    numberProp("normalAutoStart", "Auto start", FLAG),
    textProp("startscript", "Start script"),
    textProp("endscript", "End script"),
    numberProp("infoNumber", "Progress info number"),
    listProp("infoex", "Progress info", [
        { name: "value", label: "Value", type: "string", required: true },
        field("cond", "Condition"),
    ]),
];

export const ACT_PROPS: QuestProp[] = [
    numberProp("exp", "Experience"),
    numberProp("money", "Mesos"),
    numberProp("pop", "Fame"),
    listProp("item", "Item (a negative quantity takes it)", [
        idField("id", "Item", "item"),
        COUNT,
        field("prop", "Chance (-1: the player picks)"),
        field("gender", "Gender", { choices: { 0: "Male", 1: "Female", 2: "Any" } }),
        field("job", "Job flag"),
        field("period", "Lasts (minutes)"),
        { name: "dateExpire", label: "Expires (YYYYMMDDHH)", type: "string" },
    ]),
    numberProp("nextQuest", "Next quest", { kind: "quest" }),
    listProp("quest", "Set quest", QUEST_ENTRY),
    listProp("skill", "Skill", [
        idField("id", "Skill", "skill"),
        field("skillLevel", "Level"),
        field("masterLevel", "Master level"),
    ]),
    numberProp("buffItemID", "Buff item", { kind: "item" }),
    numberProp("pettameness", "Pet closeness"),
    numberProp("npc", "NPC", { kind: "npc" }),
    textProp("message", "Message", true),
    textProp("info", "Progress info"),
];

/** A conversation's branches, and the ones inside "stop" for what's missing. */
export const SAY_BRANCHES: Record<string, string> = {
    yes: "Player says yes",
    no: "Player says no",
    stop: "Conversation stops",
    lost: "Item was lost",
};
export const STOP_BRANCHES: Record<string, string> = {
    item: "Items missing",
    mob: "Mobs not defeated",
    quest: "Quest requirement missing",
    npc: "NPC not met yet",
    info: "Progress info missing",
    default: "Default",
};

export const SAY_PAGE: QuestField = { name: "", label: "Text", type: "string", required: true, multiline: true };
export const SAY_PROPS = [numberProp("ask", "Asks a question", FLAG)];
export const STOP_PROPS = [numberProp("answer", "Right answer's number")];

export const SECTION_STAGES = ["0", "1"];

export const joinPath = (...parts: string[]) => parts.filter(Boolean).join("/");

/** Whether there's nothing there, or only a null in place of a value. */
export const isMissing = (node: PropTree | undefined) => !node || node.type === "null";

export function nextNumber(node: PropTree | null | undefined) {
    let next = 0;
    for (const entry of kids(node))
        if (isNumbered(entry)) next = Math.max(next, Number(entry.name) + 1);
    return String(next);
}

/** What creates a section: both its stages, or About's name and journal. */
export function createSectionOps(quest: number, section: QuestSection): QuestEdit[] {
    if (section !== "QuestInfo")
        return SECTION_STAGES.map((path) => ({ op: "folder", quest, section, path }));
    return ["name", "0", "1", "2"].map((path) => ({ op: "set", quest, section, path, value: "", type: "string" }));
}

/** What adds a property, or an entry to a list, with the fields that were filled in. */
export function addPropOps(
    quest: number,
    section: QuestSection,
    parentPath: string,
    parent: PropTree,
    prop: QuestProp,
    values: Record<string, string>,
): QuestEdit[] {
    let path = joinPath(parentPath, prop.name);
    if (prop.list) path = joinPath(path, nextNumber(child(parent, prop.name)));
    const filled = prop.fields.filter((each) => values[each.name]?.trim());
    return filled.map((each) => ({
        op: "set",
        quest,
        section,
        path: joinPath(path, each.name),
        value: values[each.name],
        type: each.type,
    }));
}

/** Why a quest can't be referred to from another, or null. */
function questProblem(id: number, quests: QuestSummary[], current: number) {
    if (id === current) return "A quest can't refer to itself.";
    return quests.some((quest) => quest.id === id) ? null : `Quest ${id} isn't in this archive.`;
}

/** Why a field can't have the value, or null. */
export function fieldProblem(target: QuestField, value: string, quests: QuestSummary[], current: number) {
    if (!value.trim()) return target.required ? `${target.label} is required.` : null;
    const problem = invalid(target.type, value);
    if (problem || !target.kind) return problem;
    if (Number(value) < 0) return "An id can't be negative.";
    return target.kind === "quest" ? questProblem(Number(value), quests, current) : null;
}

/** Why a new quest can't have the id, or null. The server also refuses ids of quests that aren't listed. */
export function newIdProblem(id: string, quests: QuestSummary[]) {
    if (!id) return null;
    const number = Number(id);
    if (number < 1) return "An id is at least 1.";
    const taken = quests.find((quest) => quest.id === number);
    return taken ? `${number} is taken by ${taken.name || "an unnamed quest"}.` : null;
}

/** The entries of a Check section's start requirements that ask for a quest, or for this one, to be completed. */
export function completedQuests(check: PropTree | null | undefined, questId?: number) {
    function asksForIt(entry: PropTree) {
        if (int(child(entry, "state")) !== 2) return false;
        return questId == null || int(child(entry, "id")) === questId;
    }
    return kids(child(child(check, "0"), "quest")).filter(asksForIt);
}

export const nextQuestOf = (act: PropTree | null | undefined) => int(child(child(act, "1"), "nextQuest"));
