import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApi, DEFAULT_API_BASE, loadApiBase, loadDefaultApiBase, normalizeBase, saveApiBase, type Api } from "./api";

export type ConnectionStatus = "checking" | "online" | "offline";

interface Connection {
  api: Api;
  base: string;
  /** This deployment's default address (config.json's apiBase, or the built-in one). */
  defaultBase: string;
  status: ConnectionStatus;
  apiVersion: string | null;
  /**
   * The server is pinned to a library folder: the address can't be changed and files are picked from its list.
   * Kept from the last successful check, so it survives the server briefly going offline.
   */
  library: boolean;
  /** This computer may only view: the server is another machine, and edits can only be made on its own. */
  readOnly: boolean;
  setBase: (base: string) => void;
  recheck: () => void;
}

const Ctx = createContext<Connection | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  // Always start from the default so server-rendered and first-client markup agree; real value loads after mount.
  const [base, setBaseState] = useState(DEFAULT_API_BASE);
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [apiVersion, setApiVersion] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [defaultBase, setDefaultBase] = useState(DEFAULT_API_BASE);
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  // Don't poll until the deployment's default is known, or the built-in one would flash "offline" first.
  useEffect(() => {
    let cancelled = false;
    loadDefaultApiBase().then((d) => {
      if (cancelled) return;
      setDefaultBase(d);
      setBaseState(loadApiBase(d));
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  const api = useMemo(() => createApi(base), [base]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const h = await api.health();
        if (cancelled) return;
        setStatus("online");
        setApiVersion(h.version);
        setLibrary(!!h.library);
        setReadOnly(!!h.readOnly);
      } catch {
        if (cancelled) return;
        setStatus("offline");
        setApiVersion(null);
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    };
    setStatus("checking");
    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, tick, ready]);

  const setBase = useCallback((next: string) => {
    if (library) return;
    const normalized = normalizeBase(next, defaultBase);
    saveApiBase(normalized, defaultBase);
    setBaseState(normalized);
  }, [library, defaultBase]);

  const recheck = useCallback(() => setTick((t) => t + 1), []);

  const value = useMemo(
    () => ({ api, base, defaultBase, status, apiVersion, library, readOnly, setBase, recheck }),
    [api, base, defaultBase, status, apiVersion, library, readOnly, setBase, recheck],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConnection(): Connection {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConnection must be used inside <ConnectionProvider>");
  return c;
}
