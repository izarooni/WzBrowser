/** What equipment and scrolls add (info/inc*); a few installs write attack as incWAT. */
export const BONUS: readonly [string, string][] = [
    ["incSTR", "STR"], ["incDEX", "DEX"], ["incINT", "INT"], ["incLUK", "LUK"], ["incMHP", "HP"], ["incMMP", "MP"],
    ["incPAD", "Attack"], ["incWAT", "Attack"], ["incMAD", "M. Attack"], ["incPDD", "Defense"], ["incMDD", "M. Defense"],
    ["incACC", "Accuracy"], ["incEVA", "Avoid"], ["incCraft", "Hands"], ["incSpeed", "Speed"], ["incJump", "Jump"],
    ["incCRT", "Critical %"], ["incCRD", "Critical damage"],
];

export const REQUIRE: readonly [string, string][] = [
    ["reqSTR", "STR"], ["reqDEX", "DEX"], ["reqINT", "INT"], ["reqLUK", "LUK"], ["reqPOP", "Fame"],
];
/** info flags (set to 1) shown as badges beside the name. */
export const FLAGS: readonly [string, string, string][] = [
    ["cash", "Cash", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
    ["quest", "Quest", "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"],
    ["only", "One of a kind", "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"],
    ["tradeBlock", "Untradeable", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
    ["accountSharable", "Account-shared", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
    ["notSale", "Can't be sold", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
    ["timeLimited", "Time-limited", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
    ["expireOnLogout", "Expires on logout", "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"],
];

/** info/reqJob is a mask of classes; 0 is everyone and -1 Beginners only. */
const JOB_BITS: readonly [number, string][] = [[1, "Warrior"], [2, "Magician"], [4, "Bowman"], [8, "Thief"], [16, "Pirate"]];
export function jobs(mask: number | undefined): string | null {
    if (!mask) return null;
    if (mask === -1) return "Beginner";
    return JOB_BITS.filter(([bit]) => mask & bit).map(([, name]) => name).join(", ") || null;
}

/** info/attackSpeed as the client words it (2 fastest, 9 slowest). */
export function attackSpeed(n: number): string {
    return `${speedWord(n)} (${n})`;
}

function speedWord(n: number) {
    if (n <= 3) return "Faster";
    if (n <= 5) return "Fast";
    if (n === 6) return "Normal";
    if (n <= 8) return "Slow";
    return "Slower";
}
