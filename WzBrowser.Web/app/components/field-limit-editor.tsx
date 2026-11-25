import { useEffect, useState } from "react";
import { FIELD_LIMITS, parseFieldLimit } from "../lib/field-limit";
import { invalid } from "../lib/values";

/** A checkbox for each bit of a map's fieldLimit. Bits without a checkbox are kept as they are. */
export function FieldLimitEditor({ type, value, readOnly, onSave }: {
    type: string;
    value: string | null;
    readOnly: boolean;
    /** Resolves false when the save failed. */
    onSave: (value: string) => Promise<boolean>;
}) {
    /** The value just saved, until the tree has it too. */
    const [pending, setPending] = useState<string | null>(null);
    useEffect(() => setPending(null), [value]);

    const limits = parseFieldLimit(pending ?? value);
    if (limits === null) return null;

    const toggle = async (toggled: bigint) => {
        // Until the last change is in, the next one would be built on an old value.
        if (pending !== null) return;
        const next = toggled.toString();
        setPending(next);
        const ok = await onSave(next);
        if (!ok) setPending(null);
    };

    const limitRow = ({ bit, label }: { bit: number; label: string }) => {
        const mask = 1n << BigInt(bit);
        const toggled = limits ^ mask;
        const problem = invalid(type, toggled.toString());
        const disabled = readOnly || problem !== null;
        return (
            <li key={bit}>
                <label
                    title={problem ?? `Bit ${bit}`}
                    className={`flex select-none items-center gap-2.5 rounded-md px-1.5 py-1 text-[13px] ${disabled
                        ? "opacity-50"
                        : "cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
                >
                    <input
                        type="checkbox"
                        checked={(limits & mask) !== 0n}
                        disabled={disabled}
                        onChange={() => void toggle(toggled)}
                        className="size-4 shrink-0 accent-accent-600"
                    />
                    <span className="min-w-0 flex-1">{label}</span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-500">0x{mask.toString(16).toUpperCase()}</span>
                </label>
            </li>
        );
    };

    return (
        <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Field limits</h4>
            <ul className="-mx-1.5">{FIELD_LIMITS.map(limitRow)}</ul>
        </section>
    );
}
