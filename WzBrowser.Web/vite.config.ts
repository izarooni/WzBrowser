import { vitePlugin as remix } from "@remix-run/dev";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // SPA mode: `remix vite:build` emits a static site (build/client) with no server component,
    // so it can be hosted anywhere and still work offline once loaded.
    remix({
      ssr: false,
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tailwindcss(),
  ],
  server: { port: 5173 },
});
