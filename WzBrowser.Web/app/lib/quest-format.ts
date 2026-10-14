import type { LookupKind, LookupRequest } from "./api";

// ------------------------------------------------------------------ in-game text codes

export type TextColor = "blue" | "red" | "green" | "purple" | null;

export type TextToken =
  | { kind: "text"; text: string; color: TextColor; bold: boolean }
  | { kind: "ref"; ref: LookupKind; id: number; color: TextColor; bold: boolean }
  /** An inline picture or marker. When `ref` is set, the picture is that thing's icon (e.g. #i4031003# is an item icon). */
  | { kind: "icon"; label: string; ref?: { kind: LookupKind; id: number } }
  | { kind: "player"; color: TextColor; bold: boolean }
  | { kind: "choice"; n: number }
  | { kind: "choiceEnd" }
  | { kind: "br" };

const COLORS: Record<string, TextColor> = { b: "blue", r: "red", g: "green", d: "purple", k: null };

// #p npc name, #t/#z item name, #o mob name, #m map name, #q skill name
const NAME_REFS: Record<string, LookupKind> = { p: "npc", t: "item", z: "item", o: "mob", m: "map", q: "skill" };
// #i/#v item icon, #s skill icon, #c owned count: not renderable here, shown as a small label instead
const ICON_REFS: Record<string, string> = { i: "item icon", v: "item image", s: "skill icon", c: "item count" };

/**
 * Parses MapleStory's `#` markup: colours (#b #r #g #d, #k resets), bold (#e, #n resets),
 * references (#p123#, #t123#, ...), the player's name (#h #), choices (#L0# ... #l) and line breaks.
 * Anything it doesn't recognise is kept as plain text.
 */
export function parseMapleText(input: string): TextToken[] {
  const out: TextToken[] = [];
  let color: TextColor = null;
  let bold = false;
  let buf = "";
  const flush = () => { if (buf) { out.push({ kind: "text", text: buf, color, bold }); buf = ""; } };

  const text = input.replace(/\\r\\n|\\n/g, "\n").replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") { flush(); out.push({ kind: "br" }); continue; }
    if (ch !== "#") { buf += ch; continue; }

    const rest = text.slice(i + 1);
    let m: RegExpMatchArray | null;

    if ((m = rest.match(/^([bdgrk])/))) { flush(); color = COLORS[m[1]]; i += 1; continue; }
    if ((m = rest.match(/^e/))) { flush(); bold = true; i += 1; continue; }
    if ((m = rest.match(/^n/))) { flush(); bold = false; i += 1; continue; }
    if ((m = rest.match(/^h\d*#/))) { flush(); out.push({ kind: "player", color, bold }); i += m[0].length; continue; }
    if ((m = rest.match(/^L(\d+)#/))) { flush(); out.push({ kind: "choice", n: Number(m[1]) }); i += m[0].length; continue; }
    if ((m = rest.match(/^l(?![a-z])/))) { flush(); out.push({ kind: "choiceEnd" }); i += 1; continue; }
    // Summaries write these as "#t123:#", so an optional colon is allowed before the closing '#'.
    if ((m = rest.match(/^([ptzomq])(\d+):?#/))) {
      flush();
      out.push({ kind: "ref", ref: NAME_REFS[m[1]], id: Number(m[2]), color, bold });
      i += m[0].length;
      continue;
    }
    if ((m = rest.match(/^([ivsc])(\d+):?#/))) {
      flush();
      // #i/#v are item pictures and #s a skill icon; #c (owned count) has nothing to show.
      const target: LookupKind | null = m[1] === "s" ? "skill" : m[1] === "c" ? null : "item";
      out.push({ kind: "icon", label: `${ICON_REFS[m[1]]} ${m[2]}`, ref: target ? { kind: target, id: Number(m[2]) } : undefined });
      i += m[0].length;
      continue;
    }
    // Reward-summary section tags such as "#Wprob#" / "#Wbasic#": markup for the client, nothing to show.
    if ((m = rest.match(/^W[A-Za-z]+#/))) { flush(); i += m[0].length; continue; }
    if ((m = rest.match(/^B\[?\d+\]?#/))) { flush(); out.push({ kind: "icon", label: "progress bar" }); i += m[0].length; continue; }
    if ((m = rest.match(/^f[^#]*#/))) { flush(); out.push({ kind: "icon", label: "image" }); i += m[0].length; continue; }

    buf += ch; // a lone '#'
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ stage meanings
//
// Verified against D:\MSPS\GalaxyLand\Quest.wz (2,800+ quests). In every image, key "0" and "1" are the two phases:
//   Check  0 = requirements to START the quest      1 = requirements to COMPLETE it
//   Say    0 = offer conversation (before accepted) 1 = conversation once accepted (in progress / turn-in)
//   Act    0 = actions when the quest is ACCEPTED   1 = actions when it is COMPLETED
//   QuestInfo "0"/"1"/"2" = journal text for available / in progress / completed
// Item direction is NOT decided by the stage: within Act (and Check), a negative `count` takes the item and a
// positive one gives it, in both stages. This is the one place to change if another server differs.
export const STAGE_LABELS = {
  check: { 0: "To start", 1: "To complete" },
  say: { 0: "Offer (before accepted)", 1: "After accepted (in progress / turn-in)" },
  act: { 0: "When accepted", 1: "When completed" },
  info: { 0: "Available", 1: "In progress", 2: "Completed" },
} as const;

export const QUEST_STATES: Record<number, string> = { 0: "not started", 1: "in progress", 2: "completed" };

/** A few readable job names; anything else is shown as its id. */
export const JOB_NAMES: Record<number, string> = {
  0: "Beginner", 100: "Warrior", 110: "Fighter", 111: "Crusader", 112: "Hero", 120: "Page", 121: "White Knight", 122: "Paladin",
  130: "Spearman", 131: "Dragon Knight", 132: "Dark Knight", 200: "Magician", 210: "F/P Wizard", 211: "F/P Mage", 212: "F/P Archmage",
  220: "I/L Wizard", 221: "I/L Mage", 222: "I/L Archmage", 230: "Cleric", 231: "Priest", 232: "Bishop", 300: "Archer", 310: "Hunter",
  311: "Ranger", 312: "Bowmaster", 320: "Crossbowman", 321: "Sniper", 322: "Marksman", 400: "Rogue", 410: "Assassin", 411: "Hermit",
  412: "Night Lord", 420: "Bandit", 421: "Chief Bandit", 422: "Shadower", 500: "Pirate", 510: "Brawler", 511: "Marauder", 512: "Buccaneer",
  520: "Gunslinger", 521: "Outlaw", 522: "Corsair", 1000: "Noblesse", 2000: "Legend",
};

/** "2009082600" (YYYYMMDDHH) -> "2009-08-26 00:00". Anything else is returned unchanged. */
export function formatStamp(s: string): string {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:00` : s;
}

/** Minutes -> "2 h", "1 d 12 h", "45 min". */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60;
  return [d && `${d} d`, h && `${h} h`, m && `${m} min`].filter(Boolean).join(" ");
}

/** Collects the ids a piece of dialogue refers to, so their names can be fetched. */
export function refsInText(input: string, into: LookupRequest) {
  for (const t of parseMapleText(input)) {
    if (t.kind === "ref") (into[t.ref] ??= []).push(t.id);
    else if (t.kind === "icon" && t.ref) (into[t.ref.kind] ??= []).push(t.ref.id);
  }
}
