/** What a map's info/fieldLimit forbids or changes, by the bit that turns it on (MapleLib's FieldLimitType). */
export const FIELD_LIMITS: { bit: number; label: string }[] = [
    "Unable to jump",
    "Unable to use skills",
    "Unable to use summoning items",
    "Unable to use Mystic Door",
    "Unable to migrate (change channel, Cash Shop)",
    "Unable to use portal scrolls",
    "Unable to use teleport items",
    "Unable to open mini games",
    "Unable to use specific portal scrolls",
    "Unable to use taming mobs (mounts)",
    "Unable to use stat change items (potions)",
    "Unable to change party boss",
    "No monster capacity limit (unconfirmed)",
    "Unable to use wedding invitations",
    "Unable to use cash weather items",
    "Unable to use pets",
    "Unable to use anti-macro items (unconfirmed)",
    "Unable to fall down",
    "Unable to summon NPCs",
    "No EXP decrease (unconfirmed)",
    "No damage on falling",
    "Parcel open limit (unconfirmed)",
    "Drop limit",
    "Unable to use Rocket Boost",
    "No item option limit (unconfirmed)",
    "No quest alert",
    "No androids (unconfirmed)",
    "Auto-expand minimap",
    "Movement skills only",
].map((label, bit) => ({ bit, label }));

const FIELD_LIMIT_PATH = /(^|\/)info\/fieldLimit$/i;

/** The path is a map's fieldLimit property. */
export const isFieldLimit = (path: string) => FIELD_LIMIT_PATH.test(path);

/** The bits a stored fieldLimit holds, or null when it isn't a whole number. */
export function parseFieldLimit(value: string | null): bigint | null {
    const text = value?.trim() ?? "";
    if (!/^-?\d+$/.test(text)) return null;
    return BigInt(text);
}
