import type { LinksFunction } from "@remix-run/node";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse, useRouteError } from "@remix-run/react";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "./components/shell";
import { buttonPrimary } from "./components/ui";
import { ConnectionProvider } from "./lib/connection";
import { WorkspaceProvider } from "./lib/workspace";
import stylesheet from "./tailwind.css?url";

export const links: LinksFunction = () => [
    { rel: "stylesheet", href: stylesheet },
    { rel: "icon", href: "/favicon.ico", sizes: "16x16 24x24 32x32 48x48" },
    { rel: "apple-touch-icon", href: "/icon-192.png" },
    { rel: "manifest", href: "/manifest.webmanifest" },
];

// Runs before first paint so the saved / OS theme applies without a flash.
const themeScript = `try{var t=localStorage.getItem('wzbrowser.theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export function Layout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta name="theme-color" content="#4f46e5" />
                <title>WzBrowser</title>
                <script dangerouslySetInnerHTML={{ __html: themeScript }} />
                <Meta />
                <Links />
            </head>
            <body>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function App() {
    // Cache the app shell so it keeps loading when the host is unreachable. API calls are never intercepted.
    useEffect(() => {
        if (import.meta.env.PROD && "serviceWorker" in navigator) {
            navigator.serviceWorker.register("/sw.js").catch(() => { /* e.g. insecure context; app still works online */ });
        }
    }, []);

    return (
        <ConnectionProvider>
            <WorkspaceProvider>
                <AppShell>
                    <Outlet />
                </AppShell>
            </WorkspaceProvider>
        </ConnectionProvider>
    );
}

export function HydrateFallback() {
    return (
        <div className="grid min-h-dvh place-items-center text-sm text-zinc-500">
            <span className="animate-pulse">Loading WzBrowser…</span>
        </div>
    );
}

export function ErrorBoundary() {
    const error = useRouteError();
    const message = isRouteErrorResponse(error)
        ? `${error.status} ${error.statusText}`
        : error instanceof Error ? error.message : "Unknown error";
    return (
        <ConnectionProvider>
            <WorkspaceProvider>
                <AppShell>
                    <div className="mx-auto max-w-lg space-y-6 px-6 py-24 text-center">
                        <h1 className="text-2xl font-semibold">Something went wrong</h1>
                        <p className="font-mono text-sm text-zinc-500">{message}</p>
                        <a href="/" className={buttonPrimary}>Back to start</a>
                    </div>
                </AppShell>
            </WorkspaceProvider>
        </ConnectionProvider>
    );
}
