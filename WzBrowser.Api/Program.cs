using System.Net;
using System.Net.Sockets;
using WzBrowser.Api;

// Usage: WzBrowser.exe [--host 127.0.0.1] [--port 5178] [--allow-origin https://my.site]... [--root D:\Game\Data]
//   env: WZBROWSER_PORT, WZBROWSER_ORIGINS (comma separated), WZBROWSER_ROOT
//   appsettings.json next to the exe: { "WzBrowser": { "Root": "D:\\Game\\Data" } }
// With a root, only the .wz files under it can be opened (picked from a list), and the disk can't be browsed. Callers
// on other computers, or reaching it through a reverse proxy (how a hosted web app shares it), may view but not change.
var argList = args.ToList();
IEnumerable<string> ArgValues(string name) =>
    argList.Select((a, i) => (a, i)).Where(t => t.a == name && t.i + 1 < argList.Count).Select(t => argList[t.i + 1]);

// Content root = the exe's folder, so appsettings.json is found there whatever the working directory.
var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = AppContext.BaseDirectory });
builder.Logging.SetMinimumLevel(LogLevel.Warning);

var root = new[] { ArgValues("--root").FirstOrDefault(), Environment.GetEnvironmentVariable("WZBROWSER_ROOT"), builder.Configuration["WzBrowser:Root"] }
    .FirstOrDefault(r => !string.IsNullOrWhiteSpace(r));
var wzService = new WzService(root);
if (wzService.Root != null && !Directory.Exists(wzService.Root))
    Console.WriteLine($"Warning: library folder '{wzService.Root}' doesn't exist.");
builder.Services.AddSingleton(wzService);

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

// Other computers may look but not touch: the open files and their unsaved edits are shared by everyone, and saving
// writes to the server's disk. Opening files and following links only add files to the shared list, so they're allowed.
// A reverse proxy connects from loopback, but it says whom it forwards for in these headers.
string[] proxyHeaders = ["X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "Forwarded", "X-Real-IP", "Via", "X-ARR-LOG-ID"];
bool IsRemote(HttpContext ctx) =>
    ctx.Connection.RemoteIpAddress is { } ip && !IPAddress.IsLoopback(ip)
    || proxyHeaders.Any(ctx.Request.Headers.ContainsKey);
var remoteAllowed = new System.Text.RegularExpressions.Regex(@"^/api/files(/[^/]+/(lookup|ref/open))?/?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
app.Use(async (ctx, next) =>
{
    var method = ctx.Request.Method;
    if (IsRemote(ctx) && !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method))
        && !(HttpMethods.IsPost(method) && remoteAllowed.IsMatch(ctx.Request.Path.Value ?? "")))
    {
        ctx.Response.StatusCode = 403;
        await ctx.Response.WriteAsJsonAsync(new { error = "View only: changes can only be made on the server's own computer." });
        return;
    }
    await next();
});

var api = app.MapGroup("/api");

// `library` tells the web app this server is pinned to a folder: it then lists /library instead of browsing /fs,
// and keeps its API address fixed. `readOnly`: this caller is on another computer (or behind a proxy) and may only view.
api.MapGet("/health", (WzService wz, HttpContext ctx) =>
    new { status = "ok", port, version = "1.0.0", library = wz.Root != null, readOnly = IsRemote(ctx) });

// ---- the files a pinned server offers ----
api.MapGet("/library", (WzService wz) => wz.Library());

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
    foreach (var f in dir.EnumerateFiles("*.wz").OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase))
        entries.Add(new FsEntry(f.Name, f.FullName, false, f.Length));

    return new FsListing(full, dir.Parent?.FullName ?? "", entries);
});

// ---- WZ files ----
api.MapGet("/files", (WzService wz) => wz.List());
api.MapPost("/files", (OpenRequest req, WzService wz) => wz.Open(req.Path, req.Encryption));
api.MapDelete("/files/{id}", (string id, WzService wz) => wz.Close(id) ? Results.NoContent() : Results.NotFound());
api.MapGet("/files/{id}/children", (string id, string? path, WzService wz) => wz.Children(id, path));
api.MapGet("/files/{id}/search", (string id, string q, int? depth, WzService wz) => wz.Search(id, q, depth ?? 3));
api.MapGet("/files/{id}/node",(string id, string? path, WzService wz) => wz.Node(id, path));
// Edits live in memory until saved; Save always writes a new file.
api.MapPost("/files/{id}/paste", (string id, PasteRequest req, WzService wz) => wz.Paste(id, req));
api.MapDelete("/files/{id}/node", (string id, string path, WzService wz) => wz.Delete(id, path));
api.MapPatch("/files/{id}/node", (string id, NodeEditRequest req, WzService wz) => wz.EditNode(id, req));
api.MapPost("/files/{id}/save", (string id, SaveRequest? req, WzService wz) => wz.Save(id, req?.Path));
api.MapPost("/files/{id}/revert", (string id, WzService wz) => wz.Revert(id));
// Quest archives (Quest.wz): list, per-quest detail from the four images, and id -> name lookups.
api.MapGet("/files/{id}/quests", (string id, WzService wz) => wz.Quests(id));
api.MapGet("/files/{id}/quests/{questId:int}", (string id, int questId, WzService wz) => wz.Quest(id, questId));
api.MapPost("/files/{id}/lookup", (string id, LookupRequest req, WzService wz) => wz.Lookup(id, req));
// Etc.wz's Commodity.img (Cash Shop entries): the whole table, set one value, add an entry with a generated SN.
api.MapGet("/files/{id}/commodity", (string id, WzService wz) => wz.Commodity(id));
api.MapPut("/files/{id}/commodity", (string id, List<CommoditySetRequest> sets, WzService wz) => wz.SetCommodity(id, sets));
api.MapPost("/files/{id}/commodity", (string id, CommodityAddRequest req, WzService wz) => wz.AddCommodity(id, req));
api.MapPost("/files/{id}/commodity/delete", (string id, List<string> entries, WzService wz) => wz.DeleteCommodity(id, entries));
// Links from a quest archive (or Etc.wz) to the things it mentions (items, NPCs, mobs, maps, skills) in the neighbouring files.
api.MapPost("/files/{id}/ref/open", (string id, RefOpenRequest req, WzService wz) => wz.OpenRef(id, req));
api.MapGet("/files/{id}/preview", (string id, string kind, int refId, HttpContext ctx, WzService wz) =>
{
    var png = wz.RefPreview(id, kind, refId);
    if (png == null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "private, max-age=300";
    return Results.File(png, "image/png");
});
api.MapGet("/files/{id}/png", (string id, string path, WzService wz) =>
    Results.File(wz.Png(id, path), "image/png"));
// A placed map object (Map/.../obj/N) -> the sprite it shows, at Obj/{oS}.img/{l0}/{l1}/{l2}.
// 204 when the node isn't a map object; 404 when it is but the sprite can't be found.
api.MapGet("/files/{id}/objref", (string id, string path, WzService wz) =>
    wz.ObjRef(id, path) is { } r ? Results.Ok(r) : Results.NoContent());
api.MapGet("/files/{id}/sound", (string id, string path, WzService wz) =>
{
    var s = wz.Sound(id, path);
    return Results.File(s.Bytes, s.ContentType, enableRangeProcessing: true);
});
api.MapFallback(() => Results.NotFound(new { error = "Unknown API route." }));

app.MapGet("/",() => Results.Text($"WzBrowser API listening on http://{host}:{port}\nOpen the WzBrowser web app and point it at this address.\n", "text/plain"));

Console.WriteLine($"WzBrowser API listening on http://{host}:{port}  (Ctrl+C to quit)");
if (wzService.Root != null) Console.WriteLine($"Serving only the .wz files in {wzService.Root} (view only through a proxy or from other computers)");
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
