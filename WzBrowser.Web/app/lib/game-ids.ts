/** Ids as the game writes them: mobs and NPCs in seven digits, maps in nine. */
export const mobId = (id: number) => String(id).padStart(7, "0");
export const npcId = (id: number) => String(id).padStart(7, "0");
export const mapId = (id: number) => String(id).padStart(9, "0");

/** "Street : Map" -> its two halves; a name without a street is all map. */
export function splitMapName(name: string | undefined): { street: string | null; map: string | null } {
  if (!name) return { street: null, map: null };
  const at = name.indexOf(" : ");
  return at < 0 ? { street: null, map: name } : { street: name.slice(0, at), map: name.slice(at + 3) };
}
