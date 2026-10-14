# WzBrowser

Two independent programs:

| Project | What it is |
|---|---|
| `WzBrowser.Api` | C# (.NET 10, Windows) API using [MapleLib](https://github.com/lastbattle/MapleLib) (cloned to `deps/MapleLib`) to read local `.wz` files. Publishes as one self-contained exe. |
| `WzBrowser.Web` | Remix (SPA mode) + Tailwind frontend. Static files only, so host it anywhere. Works offline once loaded (service worker). |

## API

```powershell
cd WzBrowser.Api
dotnet publish -c Release -o ..\dist     # -> dist\WzBrowser.exe (single file, runs from any folder)
dist\WzBrowser.exe                       # listens on http://127.0.0.1:5178
```

Options: `--port N` (or `WZBROWSER_PORT`), `--host ADDR`, `--allow-origin https://my.site` (repeatable, or `WZBROWSER_ORIGINS`).
If the port is busy it uses the next free one. Only `localhost`/loopback origins and origins you allow may call it, because it can browse the local disk.

Endpoints: `GET /api/health`, `GET /api/fs?path=`, `GET|POST /api/files`, `DELETE /api/files/{id}`,
`GET /api/files/{id}/children?path=`, `/node`, `/png`, `/sound`.

## Using the workspace

The page is a pannable canvas (drag empty space, or scroll). Each opened file gets a floating window you can move, resize, collapse and close; positions are remembered.

| Action | How |
|---|---|
| Copy a node into another window | Drag its row onto a folder/image row (or an empty area for the file root). Hovering a closed folder opens it. |
| Move instead of copy | Hold **Shift** while dropping |
| Copy / cut / paste | **Ctrl+C / Ctrl+X / Ctrl+V** in the focused window (also buttons in the detail pane). The header shows what's on the clipboard. |
| Delete | **Delete** (asks first) |
| Navigate | Arrow keys, Enter/Space to expand, Home/End |
| Save | **Ctrl+S** or the Save button |
| Discard edits | Undo button in the window title bar |

What can go where: directories and `.img` images go into directories or the file root; properties (canvas, sound, sub-properties, values) go into an image or a sub-property/canvas/convex. A name clash gets a `_copy` suffix.

**Edits are in memory only.** Pasting, moving and deleting change the open file in the API's memory and mark the window *Unsaved*. **Save always writes a new file** next to the original (`Map.edited.wz`, `Map.edited2.wz`, …) and never overwrites anything; the original on disk is never modified by this app. Closing an unsaved window asks for confirmation.
Pasted nodes are copies, so `_inlink`/`_outlink` and UOL references inside them still point at their old paths and may not resolve in the target file.
Drag and drop needs a mouse (HTML5 drag events); on touch devices use the copy/paste buttons.

## Quest window

Opening a quest archive (any file whose root has `QuestInfo.img` and `Check.img`, normally `Quest.wz`) gives a **Quests** tab instead of the raw tree; the **Raw tree** tab is one click away and still supports drag, copy, paste and save.

- The list shows every quest as `{id} - {name}`. Search by id or name; arrow keys, PageUp/PageDown, Home and End move through it.
- Selecting a quest shows, from the four images: **About** (QuestInfo: name, group, journal text, summaries), **Requirements** (Check), **Dialogue** (Say) and **Actions** (Act). Each card has a *Raw tree* button that jumps to that node.
- Ids are turned into names (NPCs, items, mobs, maps, skills, other quests) using the `String.wz` in the same folder. Without it, plain ids are shown.
- Dialogue renders MapleStory's `#b #r #g` colours, `#e` bold, `#p/#t/#o/#m` names and `#L` choices.

### Links and hover pictures

Everything the quest view mentions is a link, including the names inside dialogue and inline item icons (`#i123#`):

| Link | Opens |
|---|---|
| Item (equipment, ids `1xxxxxx`) | `Character.wz`, e.g. `Coat/01042003.img` |
| Item (use / setup / etc / cash / pet) | `Item.wz`, e.g. `Etc/0403.img/04031003` |
| NPC | `Npc.wz`, e.g. `0002101.img` |
| Mob | `Mob.wz`, e.g. `0100100.img` |
| Map | `Map.wz`, e.g. `Map/Map1/100000000.img` |
| Skill | `Skill.wz`, e.g. `100.img/skill/1001004` |
| Quest | that quest in the same window (a **Back** button appears so you can retrace a chain of prerequisites) |

Clicking opens the target file in its own window (or brings it to the front if it is already open, panning the canvas if it was off screen) and selects the node in its raw tree. The files are looked up next to `Quest.wz`; one that isn't there gives an error toast.

Hovering a link shows a picture when there is one: the item's icon, the NPC/mob's standing sprite, the skill icon, or a map's minimap. Quests have no picture, so they get no tooltip.

Files opened only to fetch a picture stay out of the window list; they appear when you follow a link into them.

What the stages mean (checked against real data, and shown in the UI):

| Image | `0` | `1` |
|---|---|---|
| Check | requirements to **start** the quest | requirements to **complete** it |
| Say | offer conversation, before accepted | conversation once accepted (in progress / turn-in); `stop/*` holds the "not ready yet" lines |
| Act | actions when the quest is **accepted** | actions when it is **completed** |

In Act (and Check) an item's direction is decided by the **sign of `count`**, not the stage: a positive count gives the item and a negative count takes it, in both stages.

## Web

```powershell
cd WzBrowser.Web
npm install
npm run dev        # dev server on :5173
npm run build      # static site in build/client (includes sw.js)
npm run preview    # serve build/client on :4173 to try it
```

The app talks to `http://127.0.0.1:5178` by default. Change it in the UI (sliders icon) or at build time with `VITE_API_URL`.
If you host the site remotely, start the exe with `--allow-origin <your site origin>`.
The host only serves static files; WZ data never passes through it.

Notes: Chrome/Edge/Firefox allow an HTTPS page to call `http://127.0.0.1`; Safari doesn't, so use the site from `http://localhost` there.
Serve `sw.js` and `index.html` with `Cache-Control: no-cache` so updates reach users.

> The project path must not contain `#` (Vite can't build there).
