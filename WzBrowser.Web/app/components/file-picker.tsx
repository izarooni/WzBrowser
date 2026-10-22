import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Dialog, DialogBackdrop, DialogPanel, DialogTitle, Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ENCRYPTIONS, type FsListing, type LibraryFile, type OpenedFile } from "../lib/api";
import { useConnection } from "../lib/connection";
import { ArrowUp, Check, ChevronUpDown, Document, Folder, XMark } from "./icons";
import { buttonPrimary, buttonSecondary, inputClass } from "./ui";

const LAST_DIR_KEY = "wzbrowser.lastDir";

const readLastDir = () => {
  try { return localStorage.getItem(LAST_DIR_KEY) ?? ""; } catch { return ""; }
};
const writeLastDir = (dir: string) => {
  try { localStorage.setItem(LAST_DIR_KEY, dir); } catch { /* not persisted */ }
};

const formatSize = (bytes: number | null) => {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
};

export function EncryptionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Listbox value={value} onChange={onChange}>
      <div className="relative">
        <ListboxButton className="flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-left text-sm shadow-sm focus:outline-2 focus:outline-accent-500/40 dark:border-zinc-700 dark:bg-zinc-950">
          <span>{value}</span>
          <ChevronUpDown className="size-4 text-zinc-400" />
        </ListboxButton>
        <ListboxOptions
          anchor="bottom start"
          transition
          className="z-[60] w-(--button-width) rounded-xl border border-zinc-200 bg-white p-2 shadow-lg transition duration-100 [--anchor-gap:6px] focus:outline-none data-[closed]:opacity-0 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {ENCRYPTIONS.map((enc) => (
            <ListboxOption
              key={enc}
              value={enc}
              className="group flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm data-[focus]:bg-accent-50 dark:data-[focus]:bg-zinc-800"
            >
              <span>{enc}</span>
              <Check className="invisible size-4 text-accent-600 group-data-[selected]:visible" />
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

interface PickerProps { open: boolean; onClose: () => void; onOpened: (file: OpenedFile) => void }

/** Browses the disk, or, when the server is pinned to a library folder, picks from the files it offers. */
export function FilePicker(props: PickerProps) {
  const { library } = useConnection();
  return library ? <LibraryPicker {...props} /> : <FolderPicker {...props} />;
}

function FolderPicker({ open, onClose, onOpened }: PickerProps) {
  const { api, status } = useConnection();
  const [listing, setListing] = useState<FsListing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [encryption, setEncryption] = useState("Auto");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(async (path: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const l = await api.fs(path);
      setListing(l);
      setPathInput(l.path);
      writeLastDir(l.path);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!open || status !== "online") return;
    const last = readLastDir();
    // A stale remembered folder shouldn't trap the user: fall back to the drive list.
    go(last).then((ok) => { if (!ok && last) go(""); });
  }, [open, status, go]);

  const openFile = async (path: string) => {
    setOpening(path);
    setError(null);
    try {
      const file = await api.open(path, encryption);
      onOpened(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };

  const submitPath = (e: FormEvent) => {
    e.preventDefault();
    const p = pathInput.trim();
    if (!p) return go("");
    if (/\.wz$/i.test(p)) openFile(p);
    else go(p);
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6">
        <DialogPanel
          transition
          className="flex max-h-[85dvh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl transition duration-200 data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-start justify-between gap-6 p-8 pb-6">
            <div className="space-y-2">
              <DialogTitle className="text-xl font-semibold">Open a WZ file</DialogTitle>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Browse to a game folder, or paste a path to a .wz file.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
              <XMark className="size-5" />
            </button>
          </div>

          <div className="space-y-5 px-8 pb-6">
            <form onSubmit={submitPath} className="flex gap-3">
              <button
                type="button"
                aria-label="Parent folder"
                disabled={!listing || listing.parent == null}
                onClick={() => listing?.parent != null && go(listing.parent)}
                className="rounded-xl border border-zinc-300 px-3.5 text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <ArrowUp className="size-5" />
              </button>
              <input
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder="D:\Games\MapleStory"
                spellCheck={false}
                className={`${inputClass} font-mono`}
              />
              <button type="submit" className={buttonSecondary}>Go</button>
            </form>

            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Encryption</span>
              <div className="w-44"><EncryptionSelect value={encryption} onChange={setEncryption} /></div>
              <span className="text-xs text-zinc-400">Auto works for most files.</span>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-100 p-4 dark:border-zinc-800">
            {status !== "online" ? (
              <p className="px-4 py-16 text-center text-sm text-zinc-500">The WzBrowser API isn't reachable. Start WzBrowser.exe, then try again.</p>
            ) : loading && !listing ? (
              <div className="space-y-2 p-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800" />)}</div>
            ) : listing && listing.entries.length === 0 ? (
              <p className="px-4 py-16 text-center text-sm text-zinc-500">No folders or .wz files here.</p>
            ) : (
              <ul className="space-y-1">
                {listing?.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      disabled={opening !== null}
                      onClick={() => (entry.isDirectory ? go(entry.path) : openFile(entry.path))}
                      className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm transition hover:bg-zinc-50 disabled:opacity-60 dark:hover:bg-zinc-800/70"
                    >
                      {entry.isDirectory
                        ? <Folder className="size-5 shrink-0 text-amber-500" />
                        : <Document className="size-5 shrink-0 text-accent-500" />}
                      <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
                      {opening === entry.path
                        ? <span className="animate-pulse text-xs text-zinc-500">Opening…</span>
                        : <span className="text-xs tabular-nums text-zinc-400">{formatSize(entry.size)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

/** A pinned server's files in one dropdown; typing narrows it (matches anywhere in the relative path). */
function LibraryPicker({ open, onClose, onOpened }: PickerProps) {
  const { api, status } = useConnection();
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [selected, setSelected] = useState<LibraryFile | null>(null);
  const [query, setQuery] = useState("");
  const [encryption, setEncryption] = useState("Auto");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || status !== "online") return;
    let cancelled = false;
    setError(null);
    api.library()
      .then((list) => { if (!cancelled) setFiles(list); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [open, status, api]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!files) return [];
    return needle ? files.filter((f) => f.name.toLowerCase().includes(needle)) : files;
  }, [files, query]);

  const openFile = async (file: LibraryFile | null) => {
    if (!file) return;
    setOpening(true);
    setError(null);
    try {
      onOpened(await api.open(file.path, encryption));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-zinc-950/40 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6">
        <DialogPanel
          transition
          className="w-full max-w-2xl space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl transition duration-200 data-[closed]:scale-95 data-[closed]:opacity-0 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-2">
              <DialogTitle className="text-xl font-semibold">Open a WZ file</DialogTitle>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Pick one of the files this server offers.</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
              <XMark className="size-5" />
            </button>
          </div>

          {status !== "online" ? (
            <p className="py-10 text-center text-sm text-zinc-500">The WzBrowser API isn't reachable. Start WzBrowser.exe, then try again.</p>
          ) : (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); openFile(selected); }}>
              <Combobox value={selected} onChange={setSelected} onClose={() => setQuery("")} disabled={!files || opening}>
                <div className="relative">
                  <ComboboxInput
                    aria-label="File"
                    autoFocus
                    displayValue={(f: LibraryFile | null) => f?.name ?? ""}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={files ? `${files.length} files, type to filter` : "Loading files…"}
                    spellCheck={false}
                    className={`${inputClass} pr-10 font-mono`}
                  />
                  <ComboboxButton aria-label="Show all files" className="absolute inset-y-0 right-0 flex items-center px-3">
                    <ChevronUpDown className="size-4 text-zinc-400" />
                  </ComboboxButton>
                </div>
                <ComboboxOptions
                  anchor="bottom start"
                  transition
                  className="z-[60] max-h-80 w-(--input-width) overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2 shadow-lg transition duration-100 [--anchor-gap:6px] empty:invisible focus:outline-none data-[closed]:opacity-0 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {visible.map((f) => (
                    <ComboboxOption
                      key={f.path}
                      value={f}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm data-[focus]:bg-accent-50 dark:data-[focus]:bg-zinc-800"
                    >
                      <Document className="size-4 shrink-0 text-accent-500" />
                      <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
                      <span className="text-xs tabular-nums text-zinc-400">{formatSize(f.size)}</span>
                      <Check className="invisible size-4 text-accent-600 group-data-[selected]:visible" />
                    </ComboboxOption>
                  ))}
                </ComboboxOptions>
              </Combobox>
              {files?.length === 0 && <p className="text-sm text-zinc-500">The library folder has no .wz files.</p>}

              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Encryption</span>
                <div className="w-44"><EncryptionSelect value={encryption} onChange={setEncryption} /></div>
              </div>

              {error && (
                <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
                <button type="submit" className={buttonPrimary} disabled={!selected || opening}>{opening ? "Opening…" : "Open"}</button>
              </div>
            </form>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
