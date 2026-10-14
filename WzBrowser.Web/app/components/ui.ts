// Shared Tailwind class strings, kept in a leaf module so components can import them without cycles.

export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";
export const card =
  "rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
export const inputClass =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-accent-500 focus:outline-2 focus:outline-offset-0 focus:outline-accent-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
