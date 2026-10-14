import type { WzNode } from "./api";

export const joinPath = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);

export const parentPath = (path: string) => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** What a node is, as far as pasting is concerned. The file root behaves like a directory. */
export type PasteKind = Pick<WzNode, "type">;

/** Mirrors the server's rules: directories/images go into directories, properties into images or properties. */
export function canPaste(source: PasteKind, target: PasteKind): boolean {
  if (source.type === "file") return false;
  if (source.type === "directory" || source.type === "image") return target.type === "directory" || target.type === "file";
  return ["image", "sub", "convex", "canvas"].includes(target.type);
}
