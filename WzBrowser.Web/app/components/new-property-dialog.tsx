import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useEffect, useState, type FormEvent } from "react";
import { invalid } from "../lib/values";
import { buttonPrimary, buttonSecondary, inputClass } from "./ui";

const TYPES: { value: string; label: string; placeholder?: string }[] = [
  { value: "int", label: "Int (32-bit)", placeholder: "0" },
  { value: "short", label: "Short (16-bit)", placeholder: "0" },
  { value: "long", label: "Long (64-bit)", placeholder: "0" },
  { value: "float", label: "Float", placeholder: "0.0" },
  { value: "double", label: "Double", placeholder: "0.0" },
  { value: "string", label: "String", placeholder: "Text" },
  { value: "vector", label: "Vector", placeholder: "x, y" },
  { value: "uol", label: "Link (UOL)", placeholder: "../path/to/node" },
  { value: "sub", label: "Sub-property (folder)" },
  { value: "null", label: "Null" },
];
/** A convex only holds extended properties (MapleLib refuses the rest). */
const CONVEX_TYPES = new Set(["vector", "uol", "sub"]);

/** Types that are just a name: no value to fill in. */
const VALUELESS = new Set(["sub", "null"]);

/**
 * Asks for a new property's name, type and value. Insert stays disabled until every field it needs is filled in
 * and valid; `onSubmit` resolves false when the server refused, which keeps the dialog open with what was typed.
 */
export function NewPropertyDialog({ open, parentName, parentType, siblings, onSubmit, onClose }: {
  open: boolean;
  /** Shown in the title: where the property goes. */
  parentName: string;
  parentType: string;
  /** Names already used in the parent, when known, so a clash is caught before sending. */
  siblings: string[] | null;
  onSubmit: (create: { name: string; type: string; value?: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const types = parentType === "convex" ? TYPES.filter((t) => CONVEX_TYPES.has(t.value)) : TYPES;
  const [name, setName] = useState("");
  const [type, setType] = useState(types[0].value);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState({ name: false, value: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setType(parentType === "convex" ? "vector" : "int");
    setValue("");
    setTouched({ name: false, value: false });
    setBusy(false);
  }, [open, parentType]);

  const needsValue = !VALUELESS.has(type);
  const trimmed = name.trim();
  const nameProblem = !trimmed ? "A name is required."
    : trimmed.includes("/") ? "A name can't contain “/”."
    : siblings?.some((s) => s.toLowerCase() === trimmed.toLowerCase()) ? `“${trimmed}” already exists here.`
    : null;
  const valueProblem = !needsValue ? null
    : !value.trim() ? "A value is required."
    : invalid(type, value);
  const ready = !nameProblem && !valueProblem && !busy;
  const placeholder = types.find((t) => t.value === type)?.placeholder;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ name: true, value: true });
    if (!ready) return;
    setBusy(true);
    const ok = await onSubmit({ name: trimmed, type, ...(needsValue ? { value: type === "string" ? value : value.trim() } : {}) });
    setBusy(false);
    if (ok) onClose();
  };

  const label = "block text-xs font-semibold uppercase tracking-wide text-zinc-500";
  const error = "text-xs text-rose-600 dark:text-rose-400";

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} className="relative z-[80]">
      <DialogBackdrop transition className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm transition duration-150 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-6">
        <DialogPanel
          as="form"
          onSubmit={submit}
          transition
          className="w-full max-w-md space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl transition duration-150 data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="space-y-1.5">
            <DialogTitle className="text-lg font-semibold">New property</DialogTitle>
            <p className="break-all text-sm text-zinc-500">In <span className="font-mono">{parentName || "the file"}</span></p>
          </div>

          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className={label}>Name</span>
              <input autoFocus value={name} disabled={busy} spellCheck={false} aria-invalid={touched.name && !!nameProblem}
                onChange={(e) => { setName(e.target.value); setTouched((t) => ({ ...t, name: true })); }}
                className={`${inputClass} font-mono`} placeholder="name" />
              {touched.name && nameProblem && <span className={error}>{nameProblem}</span>}
            </label>

            <label className="block space-y-1.5">
              <span className={label}>Type</span>
              <select value={type} disabled={busy} onChange={(e) => setType(e.target.value)} className={inputClass}>
                {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>

            {needsValue && (
              <label className="block space-y-1.5">
                <span className={label}>Value</span>
                {type === "string" ? (
                  <textarea value={value} disabled={busy} rows={3} placeholder={placeholder} aria-invalid={touched.value && !!valueProblem}
                    onChange={(e) => { setValue(e.target.value); setTouched((t) => ({ ...t, value: true })); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(e); }}
                    className={`${inputClass} resize-y font-mono`} />
                ) : (
                  <input value={value} disabled={busy} spellCheck={false} placeholder={placeholder} aria-invalid={touched.value && !!valueProblem}
                    onChange={(e) => { setValue(e.target.value); setTouched((t) => ({ ...t, value: true })); }}
                    className={`${inputClass} font-mono`} />
                )}
                {touched.value && valueProblem && <span className={error}>{valueProblem}</span>}
              </label>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className={buttonPrimary} disabled={!ready}
              title={ready ? undefined : nameProblem ?? valueProblem ?? undefined}>
              {busy ? "Inserting…" : "Insert"}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
