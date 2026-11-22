using System.Net;
using System.Net.Sockets;
using WzBrowser.Api;

// Usage: WzBrowser.exe [--host 127.0.0.1] [--port 5178] [--allow-origin https://my.site]... [--root D:\Game\Data] [--read-only]
//   env: WZBROWSER_PORT, WZBROWSER_ORIGINS (comma separated), WZBROWSER_ROOT
// With a root, only the .wz files under it can be opened (picked from a list), and the disk can't be browsed. With
// --read-only, files can be viewed but not changed, by anyone.
var argList = args.ToList();
IEnumerable<string> ArgValues(string name) =>
    argList.Select((a, i) => (a, i)).Where(t => t.a == name && t.i + 1 < argList.Count).Select(t => argList[t.i + 1]);
var readOnly = argList.Contains("--read-only");

var builder = WebApplication.CreateBuilder(args);
builder.Logging.SetMinimumLevel(LogLevel.Warning);

var root = new[] { ArgValues("--root").FirstOrDefault(), Environment.GetEnvironmentVariable("WZBROWSER_ROOT") }
    .FirstOrDefault(r => !string.IsNullOrWhiteSpace(r));
var wzService = new WzService(root) { ReadOnly = readOnly };
if (wzService.Root != null && !Directory.Exists(wzService.Root))
    Console.WriteLine($"Warning: library folder '{wzService.Root}' doesn't exist.");
builder.Services.AddSingleton(wzService);
// MCP tools at /mcp for Claude and other agents, over the same open files (see WzMcpTools). Stateless: every bit of
// state already lives in WzService. With --read-only, its editing tools are refused (see WzMcpTools.Write).
// Results go to a model, so keep them compact: no "-style escaping and no null fields.
builder.Services.AddMcpServer().WithHttpTransport(o => o.Stateless = true).WithTools<WzMcpTools>(
    new System.Text.Json.JsonSerializerOptions(ModelContextProtocol.McpJsonUtilities.DefaultOptions)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    });

var host = ArgValues("--host").FirstOrDefault() ?? "127.0.0.1";
var requestedPort = int.TryParse(ArgValues("--port").FirstOrDefault() ?? Environment.GetEnvironmentVariable("WZBROWSER_PORT"), out var p) ? p : 5178;
var port = FindFreePort(host, requestedPort);
builder.WebHost.UseUrls($"http://{host}:{port}");

var extraOrigins = ArgValues("--allow-origin")
    .Concat((Environment.GetEnvironmentVariable("WZBROWSER_ORIGINS") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    .Select(o => o.TrimEnd('/'))
    .ToHashSet(StringComparer.OrdinalIgnoreCase);

// This API can browse the local disk (or edit its library), so only loopback origins and explicitly allowed origins may
// call it from a browser. A web app sharing it through a reverse proxy calls its own origin and needs no CORS.
builder.Services.AddCors(o => o.AddDefaultPolicy(policy => policy
    .SetIsOriginAllowed(origin =>
        extraOrigins.Contains(origin.TrimEnd('/')) ||
        (Uri.TryCreate(origin, UriKind.Absolute, out var u) && (u.IsLoopback || u.Host == "localhost")))
    .AllowAnyHeader()
    .AllowAnyMethod()
    .SetPreflightMaxAge(TimeSpan.FromMinutes(10))));

var app = builder.Build();

app.UseExceptionHandler(errors => errors.Run(async ctx =>
{
    var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    ctx.Response.StatusCode = ex switch
    {
        KeyNotFoundException or FileNotFoundException or DirectoryNotFoundException => 404,
        ArgumentException or InvalidDataException => 400,
        UnauthorizedAccessException => 403,
        _ => 500,
    };
    await ctx.Response.WriteAsJsonAsync(new { error = ex?.Message ?? "Unknown error" });
}));

// Chrome's Private Network Access: a public page calling a private/loopback address sends this preflight header
// and requires the matching response header. Registered before UseCors because CORS short-circuits preflights;
// the header is only added once the CORS middleware has approved the origin.
app.Use(async (ctx, next) =>
{
    if (HttpMethods.IsOptions(ctx.Request.Method) &&
        ctx.Request.Headers.ContainsKey("Access-Control-Request-Private-Network"))
        ctx.Response.OnStarting(() =>
        {
            if (ctx.Response.Headers.ContainsKey("Access-Control-Allow-Origin"))
                ctx.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
            return Task.CompletedTask;
        });
    await next();
});

app.UseCors();

// With --read-only, everyone (this computer too) may look but not touch: nothing is edited, saved or converted. Opening
// files and following links only add files to the shared list, so they're allowed. MCP is all POSTs, so it passes here
// and WzMcpTools refuses its editing tools itself.
var readOnlyAllowed = new System.Text.RegularExpressions.Regex(@"^(/api/files(/[^/]+/(lookup|ref/open))?/?|/mcp(/.*)?)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
app.Use(async (ctx, next) =>
{
    var method = ctx.Request.Method;
    if (readOnly && !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        && !(HttpMethods.IsPost(method) && readOnlyAllowed.IsMatch(ctx.Request.Path.Value ?? "")))
    {
        ctx.Response.StatusCode = 403;
        await ctx.Response.WriteAsJsonAsync(new { error = "This server is read only." });
        return;
    }
    await next();
});

// A read only library (--root with --read-only) shows everyone, this computer too, only the files' own views and tables:
// no raw tree, node values, images or sounds, and no links into other files (they open in the raw tree). Name lookups
// and link previews stay.
var browseOnly = wzService.Root != null && readOnly;
var rawRoutes = new System.Text.RegularExpressions.Regex(@"^/api/files/[^/]+/(children|search|node|png|pngs|sound|objref|ref/open)/?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
app.Use(async (ctx, next) =>
{
    if (browseOnly && rawRoutes.IsMatch(ctx.Request.Path.Value ?? ""))
    {
        ctx.Response.StatusCode = 403;
        await ctx.Response.WriteAsJsonAsync(new { error = "Only the files' own views and tables are available." });
        return;
    }
    await next();
});

var api = app.MapGroup("/api");

// `library` tells the web app this server is pinned to a folder: it then lists /library instead of browsing /fs,
// and keeps its API address fixed. `readOnly`: the server runs with --read-only, so everyone may only view.
// `browseOnly`: a read only library, so only files with a view or table of their own are offered, and only through those.
api.MapGet("/health", (WzService wz, HttpContext ctx) =>
    new { status = "ok", port, version = "1.0.0", library = wz.Root != null, readOnly, browseOnly, skills = wz.HasSkills, mobs = wz.HasMobs, mobLocations = wz.HasMobLocations, maps = wz.HasMaps, items = wz.HasItems, npcs = wz.HasNpcQuests });

// ---- the files a pinned server offers ----
// The tables below read the pinned library; without one, `?file=` names an open file whose install they read instead.
api.MapGet("/library", (WzService wz, HttpContext ctx) => wz.Library(browsableOnly: browseOnly));
// Every job's skills across the library (Skill.wz or a Packs/Skill_*.ms pack, with String's names), and their icons.
api.MapGet("/skills", (string? file, WzService wz) => wz.Tables(file).Skills());
api.MapGet("/skills/{id:int}/icon", (int id, string? file, HttpContext ctx, WzService wz) => LibraryPng(wz.Tables(file).SkillIcon(id), ctx));
api.MapGet("/skills/books/{job:int}/icon", (int job, string? file, HttpContext ctx, WzService wz) => LibraryPng(wz.Tables(file).SkillBookIcon(job), ctx));
// Every mob in the library's Mob data with its stats (level, HP, EXP, attack, defence, ...) and String's name.
api.MapGet("/mobs", (string? file, WzService wz) => wz.Tables(file).Mobs());
// Etc's MobLocation.img: each mob and the maps it spawns in, with names, the mob's sprite and the maps' minimaps.
api.MapGet("/mobs/locations", (string? file, WzService wz) => wz.Tables(file).MobLocations());
api.MapGet("/mobs/{id:int}/sprite", (int id, string? file, HttpContext ctx, WzService wz) => LibraryPng(wz.Tables(file).MobSprite(id), ctx));
// Every map with the mobs and NPCs its life places (and the mobs Etc lists there), with names.
api.MapGet("/maps", (string? file, WzService wz) => wz.Tables(file).Maps());
api.MapGet("/maps/{id:int}/minimap", (int id, string? file, HttpContext ctx, WzService wz) => LibraryPng(wz.Tables(file).MapMinimap(id), ctx));
// Every item in one inventory tab (equip, use, setup, etc, cash) with its stats, String's name and description, and its icon.
api.MapGet("/items/{category}", (string category, string? file, WzService wz) => wz.Tables(file).Items(category));
api.MapGet("/items/{id:int}/icon", (int id, string? file, HttpContext ctx, WzService wz) => LibraryPng(wz.Tables(file).ItemIcon(id), ctx));
// The NPCs the library's quests start and end at, with the quests, and each NPC's sprite.
api.MapGet("/npcs/quests", (string? file, WzService wz) => wz.Tables(file).NpcQuests());
api.MapGet("/npcs/{id:int}/sprite", (int id, string? file, HttpContext ctx, WzService wz) => LibraryPng(wz.Tables(file).NpcSprite(id), ctx));
static IResult LibraryPng(byte[]? png, HttpContext ctx)
{
    if (png == null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "private, max-age=300";
    return Results.File(png, "image/png");
}

// ---- local file system browsing (for the folder / file picker) ----
api.MapGet("/fs", (string? path, WzService wz) =>
{
    if (wz.Root != null) throw new UnauthorizedAccessException("This server only offers the files in its library folder.");
    if (string.IsNullOrWhiteSpace(path))
    {
        var drives = DriveInfo.GetDrives().Where(d => d.IsReady)
            .Select(d => new FsEntry(d.Name, d.Name, true, null)).ToList();
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return new FsListing("", null, [new FsEntry("Home", home, true, null), .. drives]);
    }

    var full = Path.GetFullPath(path);
    if (!Directory.Exists(full)) throw new DirectoryNotFoundException($"Directory not found: {full}");

    var dir = new DirectoryInfo(full);
    var entries = new List<FsEntry>();
    foreach (var d in dir.EnumerateDirectories().OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase))
    {
        if ((d.Attributes & (FileAttributes.Hidden | FileAttributes.System)) != 0) continue;
        entries.Add(new FsEntry(d.Name, d.FullName, true, null));
    }
    foreach (var f in dir.EnumerateFiles("*.wz").Concat(dir.EnumerateFiles("*.ms")).OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase))
        entries.Add(new FsEntry(f.Name, f.FullName, false, f.Length));

    return new FsListing(full, dir.Parent?.FullName ?? "", entries);
});

// The names at a file's root, shown under it in the picker. Reads only the directory table, never an image.
api.MapGet("/fs/peek", (string path, WzService wz) =>
{
    if (wz.Root != null) throw new UnauthorizedAccessException("This server only offers the files in its library folder.");
    return wz.Peek(path);
});

// ---- WZ files ----
api.MapGet("/files", (WzService wz, HttpContext ctx) => wz.List(browsableOnly: browseOnly));
api.MapPost("/files", (OpenRequest req, WzService wz, HttpContext ctx) => wz.Open(req.Path, req.Encryption, browsableOnly: browseOnly));
api.MapDelete("/files/{id}", (string id, WzService wz) => wz.Close(id) ? Results.NoContent() : Results.NotFound());
api.MapGet("/files/{id}/children", (string id, string? path, WzService wz) => wz.Children(id, path));
api.MapGet("/files/{id}/search", (string id, string q, int? depth, WzService wz) => wz.Search(id, q, depth ?? 3));
api.MapGet("/files/{id}/node",(string id, string? path, WzService wz) => wz.Node(id, path));
// Edits live in memory until saved; Save always writes a new file.
api.MapPost("/files/{id}/paste", (string id, PasteRequest req, WzService wz) => wz.Paste(id, req));
// strings=true also deletes String's names for what the node is (an item, mob, NPC, map or skill, or a folder of them).
api.MapDelete("/files/{id}/node", (string id, string path, bool? strings, WzService wz) => wz.Delete(id, path, strings ?? false));
api.MapPatch("/files/{id}/node", (string id, NodeEditRequest req, WzService wz) => wz.EditNode(id, req));
api.MapPost("/files/{id}/node", (string id, NodeCreateRequest req, WzService wz) => wz.CreateNode(id, req));
api.MapPost("/files/{id}/save", (string id, SaveRequest? req, WzService wz) => wz.Save(id, req?.Path));
api.MapPost("/files/{id}/revert", (string id, WzService wz) => wz.Revert(id));
// Quest archives (Quest.wz): list, per-quest detail from the four images, and id -> name lookups.
api.MapGet("/files/{id}/quests", (string id, WzService wz) => wz.Quests(id));
api.MapGet("/files/{id}/quests/{questId:int}", (string id, int questId, WzService wz) => wz.Quest(id, questId));
api.MapGet("/files/{id}/quests/{questId:int}/chain", (string id, int questId, WzService wz) => wz.QuestChain(id, questId));
api.MapPost("/files/{id}/lookup", (string id, LookupRequest req, WzService wz) => wz.Lookup(id, req));
// Etc.wz's Commodity.img (Cash Shop entries): the whole table, set one value, add an entry with a generated SN.
api.MapGet("/files/{id}/commodity", (string id, WzService wz) => wz.Commodity(id));
api.MapPut("/files/{id}/commodity", (string id, List<CommoditySetRequest> sets, WzService wz) => wz.SetCommodity(id, sets));
api.MapPost("/files/{id}/commodity", (string id, CommodityAddRequest req, WzService wz) => wz.AddCommodity(id, req));
api.MapPost("/files/{id}/commodity/delete", (string id, List<string> entries, WzService wz) => wz.DeleteCommodity(id, entries));

// Etc.wz's Category.img (Cash Shop tabs): sub tabs grouped by their fixed Category; add, rename and delete sub tabs.
api.MapGet("/files/{id}/category", (string id, WzService wz) => wz.Categories(id));
api.MapPost("/files/{id}/category", (string id, CategoryAddRequest req, WzService wz) => wz.AddCategorySub(id, req));
api.MapPut("/files/{id}/category", (string id, CategoryRenameRequest req, WzService wz) => wz.RenameCategorySub(id, req));
api.MapPost("/files/{id}/category/delete", (string id, List<string> entries, WzService wz) => wz.DeleteCategorySubs(id, entries));
// Links from a quest archive (or Etc.wz) to the things it mentions (items, NPCs, mobs, maps, skills) in the neighbouring files.
api.MapPost("/files/{id}/ref/open", (string id, RefOpenRequest req, WzService wz) => wz.OpenRef(id, req));
api.MapGet("/files/{id}/preview", (string id, string kind, int refId, HttpContext ctx, WzService wz) =>
{
    var png = wz.RefPreview(id, kind, refId);
    if (png == null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "private, max-age=300";
    return Results.File(png, "image/png");
});
// A _Canvas file as thumbnails: each thing's first stand, move or fly frame, else its icon; other numbered series animate.
// Sent as it is read, a JSON GalleryChunk per line, so the thumbnails found so far show while the rest load.
api.MapGet("/files/{id}/gallery", async (string id, HttpContext ctx, WzService wz,
    Microsoft.Extensions.Options.IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions> json) =>
{
    var chunks = wz.Gallery(id).GetEnumerator(); // a file that isn't a _Canvas file throws here, as a plain error
    var abort = ctx.RequestAborted;
    ctx.Response.ContentType = "application/x-ndjson";
    try
    {
        // Reading .imgs blocks, so it runs off the request's thread.
        while (!abort.IsCancellationRequested && await Task.Run(chunks.MoveNext, abort))
        {
            await System.Text.Json.JsonSerializer.SerializeAsync(ctx.Response.Body, chunks.Current, json.Value.SerializerOptions, abort);
            await ctx.Response.Body.WriteAsync("\n"u8.ToArray(), abort);
            await ctx.Response.Body.FlushAsync(abort);
        }
    }
    catch (OperationCanceledException) { /* the page stopped listening */ }
    catch (Exception ex)
    {
        // Too late for an error status; the page reads this line as the error.
        await System.Text.Json.JsonSerializer.SerializeAsync(ctx.Response.Body, new { error = ex.Message }, json.Value.SerializerOptions);
        await ctx.Response.Body.WriteAsync("\n"u8.ToArray());
    }
    finally { chunks.Dispose(); }
});
// Character.wz, Item.wz and Skill.wz as thumbnails, a section (Weapon, Consume, a job's skills, ...) at a time, with
// String's names, which can be edited in String.
api.MapGet("/files/{id}/character", (string id, WzService wz) => wz.CharacterSections(id));
api.MapGet("/files/{id}/character/items", (string id, string? section, WzService wz) => wz.CharacterSectionItems(id, section));
// Each item's picture and info are fetched on their own, so a section lists at once and pictures load as they scroll in.
api.MapGet("/files/{id}/character/picture", (string id, string path, HttpContext ctx, WzService wz) =>
    wz.CharacterPicture(id, path, ctx.RequestAborted) is { } png ? Results.File(png, "image/png") : Results.NotFound());
// 204 when the item has no info.
api.MapGet("/files/{id}/character/info", (string id, string path, WzService wz) =>
    wz.CharacterInfo(id, path) is { } info ? Results.Ok(info) : Results.NoContent());
api.MapPut("/files/{id}/character/strings", (string id, CharacterStringRequest req, WzService wz) => wz.SetCharacterStrings(id, req));
api.MapGet("/files/{id}/png", (string id, string path, WzService wz) =>
    Results.File(wz.Png(id, path), "image/png"));
// Every canvas under a node (a folder, .img or property), as PNGs in a zip laid out like the tree.
api.MapGet("/files/{id}/pngs", (string id, string? path, WzService wz) =>
{
    var (zip, name) = wz.ExportPngs(id, path);
    return Results.File(zip, "application/zip", name);
});
// The reverse: a zip of folders and PNGs (an export, or one made by hand) put into a node; the body is the zip itself.
// Folders become directories, .imgs and sub-properties (created when missing), PNGs canvases, and each folder's .props
// restores what the export recorded. `quality` as for PUT png below; by default each picture keeps its exported format.
api.MapPost("/files/{id}/import", async (string id, string? path, string? quality, HttpContext ctx, WzService wz) =>
{
    // A whole file's export is far over the default 30 MB body limit.
    if (ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
        limit.MaxRequestBodySize = 4L << 30;
    // ZipArchive needs to seek, so the upload goes to a temp file first.
    await using var temp = new FileStream(Path.GetTempFileName(), FileMode.Create, FileAccess.ReadWrite, FileShare.None, 1 << 16,
        FileOptions.DeleteOnClose | FileOptions.Asynchronous);
    await ctx.Request.Body.CopyToAsync(temp);
    if (temp.Length == 0) throw new ArgumentException("No zip was uploaded.");
    temp.Position = 0;
    return wz.ImportZip(id, path, temp, quality);
});
// Replaces a canvas' picture; the request body is the image file itself (PNG, JPEG, BMP or GIF).
// `quality`: the pixel format to store: bgra8888 (lossless, the default), argb4444, argb1555, rgb565, dxt3, dxt5
// (Big Bang+ clients only), or keep. What each loses is documented at the top of WzService.CanvasUpload.cs.
api.MapPut("/files/{id}/png", async (string id, string path, string? quality, HttpRequest req, WzService wz) =>
{
    using var ms = new MemoryStream();
    await req.Body.CopyToAsync(ms);
    return wz.SetPng(id, path, ms.ToArray(), quality);
});
// A placed map object (Map/.../obj/N) -> the sprite it shows, at Obj/{oS}.img/{l0}/{l1}/{l2}.
// 204 when the node isn't a map object; 404 when it is but the sprite can't be found.
api.MapGet("/files/{id}/objref", (string id, string path, WzService wz) =>
    wz.ObjRef(id, path) is { } r ? Results.Ok(r) : Results.NoContent());
api.MapGet("/files/{id}/sound", (string id, string path, WzService wz) =>
{
    var s = wz.Sound(id, path);
    return Results.File(s.Bytes, s.ContentType, enableRangeProcessing: true);
});
// ---- converting .wz files to server XML ({Output}/Mob.wz/0100100.img.xml), in the background ----
api.MapPost("/xml-export", (XmlExportRequest req, WzService wz) => wz.StartXmlExport(req));
api.MapGet("/xml-export/{id}", (string id, WzService wz) => wz.XmlExportStatus(id));
api.MapDelete("/xml-export/{id}", (string id, WzService wz) => wz.CancelXmlExport(id));
api.MapFallback(() => Results.NotFound(new { error = "Unknown API route." }));
app.MapMcp("/mcp");

app.MapGet("/",() => Results.Text($"WzBrowser API listening on http://{host}:{port}\nOpen the WzBrowser web app and point it at this address.\n", "text/plain"));

Console.WriteLine($"WzBrowser API listening on http://{host}:{port}  (Ctrl+C to quit)");
Console.WriteLine($"MCP server: http://{host}:{port}/mcp");
if (wzService.Root != null) Console.WriteLine($"Serving only the .wz files in {wzService.Root}");
if (readOnly) Console.WriteLine("Read only: files can be viewed but not changed");
app.Run();

static int FindFreePort(string host, int preferred)
{
    var address = IPAddress.TryParse(host, out var ip) ? ip : IPAddress.Loopback;
    for (var candidate = preferred; candidate < preferred + 50; candidate++)
    {
        try
        {
            using var l = new TcpListener(address, candidate);
            l.Start();
            return candidate;
        }
        catch (SocketException) { }
    }
    throw new InvalidOperationException($"No free port found starting at {preferred}.");
}

record OpenRequest(string Path, string? Encryption);
record SaveRequest(string? Path);
record FsEntry(string Name, string Path, bool IsDirectory, long? Size);
record FsListing(string Path, string? Parent, List<FsEntry> Entries);
