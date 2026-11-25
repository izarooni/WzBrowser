import type { ReactNode } from "react";
import { Archive } from "./icons";

export function Card({ title, subtitle, onOpenRaw, children }: { title: string; subtitle?: string; onOpenRaw?: () => void; children: ReactNode }) {
    return (
        <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h3 className="text-base font-semibold">{title}</h3>
                    {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
                </div>
                {onOpenRaw && (
                    <button type="button" onClick={onOpenRaw} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                        <Archive className="size-3.5" />Raw tree
                    </button>
                )}
            </div>
            {children}
        </section>
    );
}

export function StageCard({ label, stage, children, empty }: { label: string; stage: number | string; children: ReactNode; empty: boolean }) {
    return (
        <div className="min-w-0 space-y-4 rounded-xl bg-zinc-50 p-5 dark:bg-zinc-950/60">
            <div className="flex items-center gap-2.5">
                <span className="grid size-5 place-items-center rounded-md bg-zinc-200 font-mono text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{stage}</span>
                <h4 className="text-sm font-semibold">{label}</h4>
            </div>
            {empty ? <p className="text-sm text-zinc-400">Nothing set.</p> : children}
        </div>
    );
}
