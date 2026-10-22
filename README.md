# WzBrowser

Two independent programs:

| Project | What it is |
|---|---|
| `WzBrowser.Api` | C# (.NET 10, Windows) API using [MapleLib](https://github.com/lastbattle/MapleLib) (a git submodule at `deps/MapleLib`) to read local `.wz` files. Publishes as one self-contained exe. |
| `WzBrowser.Web` | Remix (SPA mode) + Tailwind frontend. Static files only, so host it anywhere. Works offline once loaded (service worker). |

## Getting the source

MapleLib is pinned as a submodule. Clone with it, and have `git pull` keep it in step:

```powershell
git -c core.longpaths=true clone --recurse-submodules https://github.com/izarooni/WzBrowser.git
cd WzBrowser
git config submodule.recurse true                 # once per clone; build.bat also sets it
git -C deps/MapleLib config core.longpaths true    # some MapleLib paths exceed Windows' 260-character limit
```

(`git config --global core.longpaths true` covers the long paths for every repository instead.)

In an existing clone, `git submodule update --init` fetches it (`build.bat` does this before building).

## API

```powershell
cd WzBrowser.Api
dotnet publish -c Release -o ..\dist     # -> dist\WzBrowser.exe (single file, runs from any folder)
dist\WzBrowser.exe                       # listens on http://127.0.0.1:5178
```

Options: `--port N` (or `WZBROWSER_PORT`), `--host ADDR`, `--allow-origin https://my.site` (repeatable, or `WZBROWSER_ORIGINS`), `--root FOLDER`.
If the port is busy it uses the next free one. Only `localhost`/loopback origins and origins you allow may call it, because it can browse the local disk.

### Pinning the server to a folder

Set a library folder with `--root D:\Game\Data`, `WZBROWSER_ROOT`, or an `appsettings.json` next to the exe:

```json
{ "WzBrowser": { "Root": "D:\\Game\\Data" } }
```

The server then only opens `.wz` files inside that folder (and its subfolders), only saves inside it, and refuses `/api/fs`.
`GET /api/library` lists the files (a modular folder's `Name.wz` index stub is left out, since the data is in `Name_000.wz`), and `/api/health` reports `"library": true`.
The web app sees that: its API address becomes read-only, and **Open file…** shows a dropdown of the library's files (type to filter) instead of the folder browser.

### Sharing a library through a hosted web app

The API only ever listens on `127.0.0.1` (unless `--host` says otherwise) and never serves the web app. To let other people browse a pinned library, host the web app (see [Web](#web)) and have the same web server forward `/api/` to the API, e.g. with IIS URL Rewrite + ARR or nginx `proxy_pass http://127.0.0.1:5178;`. Then point the web app at its own origin with a `config.json` next to `index.html`:

```json
{ "apiBase": "/" }
```

- Requests that arrive through a proxy (they carry `X-Forwarded-For`, `Forwarded`, `X-Real-IP` or `Via`) or from another computer are **view only**: they can open library files, read quests and follow links, but can't edit, save, revert or close files. `/api/health` reports `"readOnly": true` and the header shows *View only*. Open files and unsaved edits are shared by everyone, so changes are made on the server itself, by calling the API at `http://127.0.0.1:5178` directly. **Make sure the proxy sends one of those headers** (IIS ARR and most proxies send `X-Forwarded-For`; in nginx add `proxy_set_header X-Forwarded-For $remote_addr;`).
- There is no login: anyone who can reach the site can view the library.

Endpoints: `GET /api/health`, `GET /api/fs?path=`, `GET|POST /api/files`, `DELETE /api/files/{id}`,
`GET /api/files/{id}/children?path=`, `/node` (`PATCH` renames a property or sets its value), `/png`, `/sound`, `GET|PUT|POST /api/files/{id}/commodity`.

## Using the workspace

The page is a pannable canvas (drag empty space, or scroll). Each opened file gets a floating window you can move, resize, collapse and close; positions are remembered.

| Action | How |
|---|---|
| Copy a node into another window | Drag its row onto a folder/image row (or an empty area for the file root). Hovering a closed folder opens it. |
| Move instead of copy | Hold **Shift** while dropping |
| Copy / cut / paste | **Ctrl+C / Ctrl+X / Ctrl+V** in the focused window (also buttons in the detail pane). The header shows what's on the clipboard. |
| Delete | **Delete** (asks first) |
| Edit a property | In the detail pane, click its name to rename it or its value to change it. **Enter** saves, **Esc** cancels (Shift+Enter adds a line in a string). |
| Navigate | Arrow keys, Enter/Space to expand, Home/End |
| Save | **Ctrl+S** or the Save button |
| Discard edits | Undo button in the window title bar |

Every property can be renamed. Values can be set on `int`, `short`, `long` (range-checked), `float`, `double`, `string`, `vector` (written `x, y`) and `uol` (the link path) properties; sub, canvas, convex, sound and null properties have no value of their own. Directories and `.img` images can't be renamed.

What can go where: directories and `.img` images go into directories or the file root; properties (canvas, sound, sub-properties, values) go into an image or a sub-property/canvas/convex. A name clash gets a `_copy` suffix.

**Edits are in memory only.** Pasting, moving and deleting change the open file in the API's memory and mark the window *Unsaved*. **Save always writes a new file** next to the original (`Map.edited.wz`, `Map.edited2.wz`, …) and never overwrites anything; the original on disk is never modified by this app. Closing an unsaved window asks for confirmation.
Pasted nodes are copies, so `_inlink`/`_outlink` and UOL references inside them still point at their old paths and may not resolve in the target file.
Drag and drop needs a mouse (HTML5 drag events); on touch devices use the copy/paste buttons.

## Quest window

Opening a quest archive gives a **Quests** tab instead of the raw tree; the **Raw tree** tab is one click away and still supports drag, copy, paste and save.

Two layouts are recognised:

| Layout | File | Where a quest's sections are |
|---|---|---|
| Classic | `Quest.wz` (root has `QuestInfo.img` and `Check.img`) | `QuestInfo.img/1000`, `Check.img/1000`, `Say.img/1000`, `Act.img/1000` |
| Modular | `Data/Quest/QuestData/QuestData_000.wz` (root has one `{id}.img` per quest) | `1000.img/QuestInfo`, `1000.img/Check`, `1000.img/Say`, `1000.img/Act` |

In a modular install the neighbouring files are found in their own folders under `Data` (`Data/String/String_000.wz`, `Data/Npc/Npc_000.wz`, `Data/Item/Etc/Etc_000.wz`, `Data/Character/Weapon/Weapon_000.wz`, `Data/Map/Map/Map1/Map1_000.wz`, ...). Mobs and skills that only exist in `Data/Packs/*.ms` can't be linked.

- The list shows every quest as `{id} - {name}`. Search by id or name; arrow keys, PageUp/PageDown, Home and End move through it.
- Selecting a quest shows, from the four images: **About** (QuestInfo: name, group, journal text, summaries), **Requirements** (Check), **Dialogue** (Say) and **Actions** (Act). Each card has a *Raw tree* button that jumps to that node.
- Ids are turned into names (NPCs, items, mobs, maps, skills, other quests) using the `String.wz` in the same folder (or `Data/String` in a modular install). Without it, plain ids are shown.
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

Clicking opens the target file in its own window (or brings it to the front if it is already open, panning the canvas if it was off screen) and selects the node in its raw tree. The files are looked up next to `Quest.wz` (or under `Data` for a modular install); one that isn't there gives an error toast.

Hovering a link shows a picture when there is one: the item's icon, the NPC/mob's standing sprite, the skill icon, or a map's minimap. Quests have no picture, so they get no tooltip.

Files opened only to fetch a picture stay out of the window list; they appear when you follow a link into them.

What the stages mean (checked against real data, and shown in the UI):

| Image | `0` | `1` |
|---|---|---|
| Check | requirements to **start** the quest | requirements to **complete** it |
| Say | offer conversation, before accepted | conversation once accepted (in progress / turn-in); `stop/*` holds the "not ready yet" lines |
| Act | actions when the quest is **accepted** | actions when it is **completed** |

In Act (and Check) an item's direction is decided by the **sign of `count`**, not the stage: a positive count gives the item and a negative count takes it, in both stages.

## Commodity window (Etc.wz)

Opening a file with `Commodity.img` at its root (normally `Etc.wz`) gives a **Commodity** tab for the Cash Shop list; the **Raw tree** tab is next to it.

- One row per entry. The columns are every property name used by any entry, each showing its type (`int`, `string`, …). Click a header to sort (again for descending, a third time for file order). Search matches the entry number, any value, the item id and the item name.
- Click a value (or focus it and press Enter) to edit it. The input fits the type: whole numbers are checked against the range of `short`/`int`/`long`, `float`/`double` take decimals, strings take any text. **Enter** saves, **Esc** cancels, **Tab** saves and moves to the next value. A `—` cell means the entry lacks that property; editing it adds it with the column's type. Other types (sub, canvas, …) are shown but are edited in the raw tree.
- `OnSale` is a checkbox. To set a range, hold **Shift** and click two boxes: the first click toggles that row and marks it as the start (outlined); the second gives every row between them, in the order shown, the same value. Keep Shift held to keep extending from the last row clicked. Releasing Shift or leaving the window clears the start, so the next range needs Shift pressed again. A range is saved as a single edit. `Gender` (0 male, 1 female, 2 both) and `Class` (0 New, 1 Sale, 2 Hot, 3 Event, 4 none) get a picker.
- The **Item** column shows the item's icon and name (from `String.wz`, `Character.wz` and `Item.wz` in the same folder) and links to it like the quest view does.
- **Add entry** asks for an item id and whether it is a donor item. The entry is named one past the highest entry number and gets the defaults [CashCommodities](https://github.com/izarooni/CashCommodities) uses: Count 1, Gender 2, OnSale 1, Period 90, Price 4000, Priority 99, Class 4. Property names follow the spelling the file already uses.
- The SN is generated the way CashCommodities does it: `10000000` for donor items or `20000000` for regular ones, plus the item's Cash Shop category × `100000`, plus the lowest free number from 1. For example, a regular hat gets the first free `200000xx`.
- The first column selects rows for deletion. Shift-click works there the same way as on `OnSale`, and the header box selects or clears every row the search shows. **Delete** next to the search box removes all selected rows in one edit, after asking; the dialog says if some of them are hidden by the search.
- Each row has **Raw** (show it in the raw tree) and delete buttons. Edits work like any other edit: in memory until you save a new file.

## Web

```powershell
cd WzBrowser.Web
npm install
npm run dev        # dev server on :5173
npm run build      # static site in build/client (includes sw.js)
npm run preview    # serve build/client on :4173 to try it
```

The app talks to `http://127.0.0.1:5178` by default. To change the default for a deployment, put a `config.json` next to `index.html` in the hosted files (no rebuild needed):

```json
{ "apiBase": "https://wz-api.example.com" }
```

A path such as `"/"` means this site's own origin (an API proxied under its `/api/`). Without `config.json`, the default is `VITE_API_URL` at build time, else `http://127.0.0.1:5178`. Each visitor can still change the address in the UI (sliders icon), which overrides the default for their browser, except when the server is pinned to a library folder.
If you host the site remotely, start the exe with `--allow-origin <your site origin>`.
The host only serves static files; WZ data never passes through it.

Notes: Chrome/Edge/Firefox allow an HTTPS page to call `http://127.0.0.1`; Safari doesn't, so use the site from `http://localhost` there.
Serve `sw.js` and `index.html` with `Cache-Control: no-cache` so updates reach users.

> The project path must not contain `#` (Vite can't build there).
