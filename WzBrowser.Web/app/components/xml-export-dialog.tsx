import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { FsListing, LibraryFile, XmlExportJob } from "../lib/api";
import { useConnection } from "../lib/connection";
import { EncryptionSelect, libraryLabels } from "./file-picker";
import { ArrowUp, Check, Document, Folder, XMark } from "./icons";
import { buttonPrimary, buttonSecondary, inputClass } from "./ui";

const LAST_DIR_KEY = "wzbrowser.lastDir";
const LAST_OUTPUT_KEY = "wzbrowser.xmlOutput";

const read = (key: string) => {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
};
const write = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* not persisted */ }
};

/** "D:\Games\Data" + "xml" with the separator the path already uses. */
const join = (dir: string, name: string) => {
  const sep = dir.includes("/") && !dir.includes("\\") ? "/" : "\\";
  return dir.replace(/[\\/]+$/, "") + sep + name;
};

/** A modular file's index stub ({name}.wz beside {name}_000.wz) holds no data, so it isn't offered. */
const withoutStubs = <T extends { name: string }>(files: T[]) => {
  const names = new Set(files.map((f) => f.name.toLowerCase()));
  return files.filter((f) => !names.has(f.name.toLowerCase().replace(/\.wz$/, "_000.wz")));
};

const alertClass = "rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300";

/**
 * Converts .wz files into the XML folders a server reads ({output}/Mob.wz/0100100.img.xml). The conversion runs on
 * the API in the background; closing the dialog leaves it running, and reopening shows its progress.
 */
export function XmlExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, status, library } = useConnection();
  const [job, setJob] = useState<XmlExportJob | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [output, setOutput] = useState(() => read(LAST_OUTPUT_KEY));
  const [outputTouched, setOutputTouched] = useState(() => read(LAST_OUTPUT_KEY) !== "");
  const [encryption, setEncryption] = useState("Auto");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = job?.state === "running";

  // Poll while it runs; stop once it's finished.
  useEffect(() => {
    if (!job || job.state !== "running") return;
    const timer = setTimeout(() => {
      api.xmlExport(job.id).then(setJob).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 500);
    return () => clearTimeout(timer);
  }, [api, job]);

  /** Suggests "{folder}\xml" until the user picks an output folder of their own. */
  const suggestOutput = useCallback((dir: string) => {
    if (!outputTouched && dir) setOutput(join(dir, "xml"));
  }, [outputTouched]);

  const toggle = (path: string, on?: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on ?? !next.has(path)) next.add(path); else next.delete(path);
    return next;
  });

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const out = output.trim();
      setJob(await api.startXmlExport([...selected], out, encryption));
      write(LAST_OUTPUT_KEY, out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    try { setJob(await api.cancelXmlExport(job.id)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
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
              <DialogTitle className="text-xl font-semibold">Convert to server XML</DialogTitle>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Each file becomes a folder of .img.xml files (Mob.wz/0100100.img.xml), the layout servers load. Images and sounds are left out.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
              <XMark className="size-5" />
            </button>
          </div>

          {status !== "online" ? (
            <p className="px-8 pb-16 pt-6 text-center text-sm text-zinc-500">The WzBrowser API isn't reachable. Start WzBrowser.exe, then try again.</p>
          ) : job ? (
            <Progress job={job} error={error} onCancel={cancel} onNew={() => { setJob(null); setError(null); }} onClose={onClose} />
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto border-y border-zinc-100 dark:border-zinc-800">
                {library
                  ? <LibrarySource open={open} selected={selected} toggle={toggle} suggestOutput={suggestOutput} />
                  : <FolderSource open={open} selected={selected} toggle={toggle} suggestOutput={suggestOutput} />}
              </div>

              <div className="space-y-5 p-8 pt-6">
                <div className="space-y-2">
                  <label htmlFor="xml-output" className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Output folder</label>
                  <input
                    id="xml-output"
                    value={output}
                    onChange={(e) => { setOutput(e.target.value); setOutputTouched(true); }}
                    placeholder="D:\Server\wz"
                    spellCheck={false}
                    className={`${inputClass} font-mono`}
                  />
                  <p className="text-xs text-zinc-400">Files already there are overwritten.</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Encryption</span>
                    <div className="w-44"><EncryptionSelect value={encryption} onChange={setEncryption} /></div>
                  </div>
                  <button
                    type="button"
                    className={buttonPrimary}
                    disabled={starting || running || selected.size === 0 || !output.trim()}
                    onClick={start}
                  >
                    {starting ? "Starting…" : `Convert ${selected.size || ""} file${selected.size === 1 ? "" : "s"}`}
                  </button>
                </div>

                {error && <div role="alert" className={alertClass}>{error}</div>}
              </div>
            </>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

interface SourceProps {
  open: boolean;
  selected: Set<string>;
  toggle: (path: string, on?: boolean) => void;
  suggestOutput: (dir: string) => void;
}

function CheckRow({ checked, onClick, label, title, hint }: { checked: boolean; onClick: () => void; label: string; title?: string; hint?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={title}
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
    >
      <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-accent-600 bg-accent-600 text-white" : "border-zinc-300 dark:border-zinc-600"}`}>
        {checked && <Check className="size-3.5" strokeWidth={2.5} />}
      </span>
      <Document className="size-5 shrink-0 text-accent-500" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {hint && <span className="text-xs tabular-nums text-zinc-400">{hint}</span>}
    </button>
  );
}

function SelectAll({ paths, selected, toggle }: { paths: string[]; selected: Set<string>; toggle: SourceProps["toggle"] }) {
  if (paths.length === 0) return null;
  const all = paths.every((p) => selected.has(p));
  return (
    <button type="button" className="text-sm font-medium text-accent-600 hover:underline dark:text-accent-400" onClick={() => paths.forEach((p) => toggle(p, !all))}>
      {all ? "Select none" : `Select all ${paths.length}`}
    </button>
  );
}

const formatSize = (bytes: number | null) => {
  if (bytes == null) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
};

/** Browses the disk; folders open, .wz files tick. Ticked files stay ticked when moving to another folder. */
function FolderSource({ open, selected, toggle, suggestOutput }: SourceProps) {
  const { api } = useConnection();
  const [listing, setListing] = useState<FsListing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = useCallback(async (path: string): Promise<boolean> => {
    setError(null);
    try {
      const l = await api.fs(path);
      setListing(l);
      setPathInput(l.path);
      write(LAST_DIR_KEY, l.path);
      suggestOutput(l.path);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [api, suggestOutput]);

  useEffect(() => {
    if (!open) return;
    const last = read(LAST_DIR_KEY);
    go(last).then((ok) => { if (!ok && last) go(""); });
    // Only on opening: `go` changes as the suggested output does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const files = useMemo(() => withoutStubs(listing?.entries.filter((e) => !e.isDirectory) ?? []), [listing]);
  const dirs = listing?.entries.filter((e) => e.isDirectory) ?? [];
  const elsewhere = [...selected].filter((p) => !files.some((f) => f.path === p)).length;

  const submit = (e: FormEvent) => { e.preventDefault(); go(pathInput.trim()); };

  return (
    <div className="space-y-4 p-4">
      <form onSubmit={submit} className="flex gap-3 px-4 pt-2">
        <button
          type="button"
          aria-label="Parent folder"
          disabled={!listing || listing.parent == null}
          onClick={() => listing?.parent != null && go(listing.parent)}
          className="rounded-xl border border-zinc-300 px-3.5 text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ArrowUp className="size-5" />
        </button>
        <input value={pathInput} onChange={(e) => setPathInput(e.target.value)} placeholder="D:\Games\MapleStory" spellCheck={false} className={`${inputClass} font-mono`} />
        <button type="submit" className={buttonSecondary}>Go</button>
      </form>

      {error && <div role="alert" className={`mx-4 ${alertClass}`}>{error}</div>}

      <div className="flex items-center justify-between gap-4 px-4 text-xs text-zinc-500">
        <span>{elsewhere > 0 && `${elsewhere} selected in other folders`}</span>
        <SelectAll paths={files.map((f) => f.path)} selected={selected} toggle={toggle} />
      </div>

      <ul className="space-y-1">
        {dirs.map((d) => (
          <li key={d.path}>
            <button type="button" onClick={() => go(d.path)} className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-800/70">
              <span className="size-5 shrink-0" />
              <Folder className="size-5 shrink-0 text-amber-500" />
              <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
            </button>
          </li>
        ))}
        {files.map((f) => (
          <li key={f.path}>
            <CheckRow checked={selected.has(f.path)} onClick={() => toggle(f.path)} label={f.name} hint={formatSize(f.size)} />
          </li>
        ))}
        {listing && dirs.length === 0 && files.length === 0 && <li className="px-4 py-10 text-center text-sm text-zinc-500">No folders or .wz files here.</li>}
      </ul>
    </div>
  );
}

/** A pinned server's files, each with a tick box. */
function LibrarySource({ open, selected, toggle, suggestOutput }: SourceProps) {
  const { api } = useConnection();
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api.library()
      .then((list) => {
        if (cancelled) return;
        setFiles(list);
        // The library folder: a file's absolute path minus its relative name.
        const f = list[0];
        if (f) suggestOutput(f.path.slice(0, f.path.length - f.name.length).replace(/[\\/]+$/, ""));
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, api]);

  const labels = useMemo(() => libraryLabels(files ?? []), [files]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!files) return [];
    return needle ? files.filter((f) => f.name.toLowerCase().includes(needle) || labels.get(f.path)!.toLowerCase().includes(needle)) : files;
  }, [files, labels, query]);

  return (
    <div className="space-y-4 p-4">
      {error && <div role="alert" className={`mx-4 ${alertClass}`}>{error}</div>}
      {files && files.length > 10 && (
        <div className="px-4 pt-2">
          <input aria-label="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${files.length} files, type to filter`} spellCheck={false} className={inputClass} />
        </div>
      )}
      <div className="flex justify-end px-4"><SelectAll paths={visible.map((f) => f.path)} selected={selected} toggle={toggle} /></div>
      {!files ? (
        <div className="space-y-2 p-2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800" />)}</div>
      ) : (
        <ul className="space-y-1">
          {visible.map((f) => (
            <li key={f.path}>
              <CheckRow checked={selected.has(f.path)} onClick={() => toggle(f.path)} label={labels.get(f.path)!} title={f.name} hint={formatSize(f.size)} />
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-10 text-center text-sm text-zinc-500">{files.length === 0 ? "The library folder has no .wz files." : "No files match."}</li>}
        </ul>
      )}
    </div>
  );
}

const stateText: Record<XmlExportJob["state"], string> = {
  running: "Converting…",
  done: "Done",
  failed: "Finished with errors",
  cancelled: "Cancelled",
};

function Progress({ job, error, onCancel, onNew, onClose }: { job: XmlExportJob; error: string | null; onCancel: () => void; onNew: () => void; onClose: () => void }) {
  const running = job.state === "running";
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto border-y border-zinc-100 p-8 py-6 dark:border-zinc-800">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <span className="font-semibold">{stateText[job.state]}</span>
          <span className="truncate font-mono text-xs text-zinc-500" title={job.output}>{job.output}</span>
        </div>
        <ul className="space-y-4">
          {job.files.map((f, i) => {
            const pct = f.total > 0 ? Math.round((f.images / f.total) * 100) : f.state === "done" ? 100 : 0;
            return (
              <li key={i} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate font-medium">{f.name} <span className="font-normal text-zinc-400">→ {f.folder}</span></span>
                  <span className="shrink-0 text-xs tabular-nums text-zinc-500">
                    {f.state === "waiting" ? "Waiting" : f.state === "failed" ? "Failed" : f.state === "running" && f.total === 0 ? "Opening…" : `${f.images.toLocaleString()} / ${f.total.toLocaleString()}`}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${f.state === "failed" ? "bg-rose-500" : f.state === "cancelled" ? "bg-zinc-400" : "bg-accent-600"}`}
                    style={{ width: `${f.state === "failed" ? 100 : pct}%` }}
                  />
                </div>
                {f.error && <p className="text-xs text-rose-600 dark:text-rose-400">{f.error}</p>}
              </li>
            );
          })}
        </ul>
        {error && <div role="alert" className={`mt-5 ${alertClass}`}>{error}</div>}
      </div>
      <div className="flex justify-end gap-3 p-8 pt-6">
        {running
          ? <button type="button" className={buttonSecondary} onClick={onCancel}>Cancel</button>
          : <button type="button" className={buttonSecondary} onClick={onNew}>Convert more</button>}
        <button type="button" className={buttonPrimary} onClick={onClose}>{running ? "Hide" : "Close"}</button>
      </div>
    </>
  );
}
