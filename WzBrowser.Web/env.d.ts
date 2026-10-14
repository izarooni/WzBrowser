/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Build-time default for the WzBrowser API base URL. */
  readonly VITE_API_URL?: string;
}
