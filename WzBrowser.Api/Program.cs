using System.Net;
using System.Net.Sockets;
using WzBrowser.Api;

// Usage: WzBrowser.exe [--host 127.0.0.1] [--port 5178] [--allow-origin https://my.site]...
//   env: WZBROWSER_PORT, WZBROWSER_ORIGINS (comma separated)
var argList = args.ToList();
IEnumerable<string> ArgValues(string name) =>
    argList.Select((a, i) => (a, i)).Where(t => t.a == name && t.i + 1 < argList.Count).Select(t => argList[t.i + 1]);

var host = ArgValues("--host").FirstOrDefault() ?? "127.0.0.1";
var requestedPort = int.TryParse(ArgValues("--port").FirstOrDefault() ?? Environment.GetEnvironmentVariable("WZBROWSER_PORT"), out var p) ? p : 5178;
var port = FindFreePort(host, requestedPort);

var extraOrigins = ArgValues("--allow-origin")
    .Concat((Environment.GetEnvironmentVariable("WZBROWSER_ORIGINS") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
    .Select(o => o.TrimEnd('/'))
    .ToHashSet(StringComparer.OrdinalIgnoreCase);

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://{host}:{port}");
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddSingleton<WzService>();

// This API can browse the local disk, so only loopback origins and explicitly allowed origins may call it.
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

var api = app.MapGroup("/api");

api.MapGet("/health", () => new { status = "ok", port, version = "1.0.0" });

// ---- local file system browsing (for the folder / file picker) ----
api.MapGet("/fs", (string? path) =>
{
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
api.MapPost("/files/{id}/save", (string id, SaveRequest? req, WzService wz) => wz.Save(id, req?.Path));
api.MapPost("/files/{id}/revert", (string id, WzService wz) => wz.Revert(id));
// Quest archives (Quest.wz): list, per-quest detail from the four images, and id -> name lookups.
api.MapGet("/files/{id}/quests", (string id, WzService wz) => wz.Quests(id));
api.MapGet("/files/{id}/quests/{questId:int}", (string id, int questId, WzService wz) => wz.Quest(id, questId));
api.MapPost("/files/{id}/lookup", (string id, LookupRequest req, WzService wz) => wz.Lookup(id, req));
// Links from a quest archive to the things it mentions (items, NPCs, mobs, maps, skills) in the neighbouring files.
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

app.MapGet("/", () => Results.Text($"WzBrowser API listening on http://{host}:{port}\nOpen the WzBrowser web app and point it at this address.\n", "text/plain"));

Console.WriteLine($"WzBrowser API listening on http://{host}:{port}  (Ctrl+C to quit)");
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
