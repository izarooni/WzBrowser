// Post-build step: writes build/client/sw.js with a precache list of every emitted file.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "client");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(out)
  .map((p) => relative(out, p).split(sep).join("/"))
  .filter((f) => f !== "sw.js" && !f.endsWith(".map"))
  .sort();

if (!files.includes("index.html")) {
  console.error("gen-sw: build/client/index.html is missing - is the Remix build in SPA mode?");
  process.exit(1);
}

const hash = createHash("sha1");
for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest("hex").slice(0, 12);

const precache = ["/", ...files.map((f) => "/" + f)].filter((u, i, a) => a.indexOf(u) === i);
// "/" is answered by the cached index.html in the fetch handler, so don't fetch it separately.
precache.splice(precache.indexOf("/"), 1);

const template = readFileSync(join(root, "scripts", "sw.template.js"), "utf8");
writeFileSync(
  join(out, "sw.js"),
  template.replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(precache, null, 2)),
);
console.log(`gen-sw: precaching ${precache.length} files (version ${version})`);
