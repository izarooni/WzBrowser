import type { PropTree } from "./api";

export const kids = (t?: PropTree | null) => t?.children ?? [];
export const child = (t: PropTree | null | undefined, name: string) => kids(t).find((c) => c.name === name);
export const int = (t?: PropTree | null) => (t && t.value != null && /^-?\d+$/.test(t.value) ? Number(t.value) : undefined);
export const isNumbered = (t: PropTree) => /^\d+$/.test(t.name);
export const isString = (t: PropTree) => t.type === "string" && !t.children;
