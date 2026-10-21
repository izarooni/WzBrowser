// Property values as the API shows them, and what it accepts back for each type.

export const INTEGER = new Set(["int", "short", "long"]);
const RANGE: Record<string, [bigint, bigint]> = {
  short: [-32768n, 32767n],
  int: [-2147483648n, 2147483647n],
  long: [-9223372036854775808n, 9223372036854775807n],
};
/** Types whose value can be set. The rest (sub, canvas, sound, null, ...) only have a name. */
export const EDITABLE = new Set(["int", "short", "long", "float", "double", "string", "vector", "uol"]);

function integerProblem(type: string, v: string): string | null {
  if (!/^-?\d+$/.test(v)) return `A ${type} must be a whole number.`;
  const [lo, hi] = RANGE[type];
  const n = BigInt(v);
  return n < lo || n > hi ? `A ${type} must be between ${lo} and ${hi}.` : null;
}

/** Why `value` can't be stored as `type`, or null when it can. */
export function invalid(type: string, value: string): string | null {
  const v = value.trim();
  if (INTEGER.has(type)) return integerProblem(type, v);
  if (type === "float" || type === "double") return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v) ? null : `A ${type} must be a number.`;
  if (type === "vector") {
    const parts = v.split(",").map((p) => p.trim());
    if (parts.length !== 2) return "A vector is written as “x, y”.";
    return parts.some((p) => integerProblem("int", p)) ? "Each coordinate must be a whole number that fits an int." : null;
  }
  if (type === "uol") return v ? null : "A link needs a path.";
  return null;
}
