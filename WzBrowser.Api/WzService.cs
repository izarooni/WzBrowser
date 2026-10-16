using System.Collections.Concurrent;
using System.Drawing.Imaging;
using MapleLib.WzLib;
using MapleLib.WzLib.Util;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public record NodeDto(
    string Name,
    string Type,
    bool HasChildren,
    string? Value = null,
    int? Width = null,
    int? Height = null);

/// <param name="Kind">"quest" for a quest archive (QuestInfo.img + Check.img at the root), otherwise "generic".</param>
/// <param name="Revision">Changes whenever the file's contents change (paste, delete, revert) so views know to refetch.</param>
public record OpenedFileDto(string Id, string Name, string Path, string Encryption, int Version, int ChildCount, bool Dirty, string? SavedTo, string Kind, long Revision);

public record SoundData(byte[] Bytes, string ContentType);

/// <param name="Link">Set when the sprite is a link (UOL, _inlink, _outlink): its value, shown instead of the image.</param>
public record ObjRefResult(string Path, NodeDto Node, string? Link);

public record PasteRequest(string SourceId, string SourcePath, string? TargetPath, bool Move);
public record PasteResult(string Path, NodeDto Node, OpenedFileDto File, OpenedFileDto? SourceFile);
public record SaveResult(string Path, long Size, OpenedFileDto File);

/// <summary>Holds opened WZ files and resolves slash-separated paths inside them.</summary>
public sealed partial class WzService
{
    private static long _revisionCounter;
    private static long NextRevision() => Interlocked.Increment(ref _revisionCounter);

    private sealed class Entry(WzFile file, string path, string encryption)
    {
        public WzFile File { get; } = file;
        public string Path { get; } = path;
        public string Encryption { get; } = encryption;
        // MapleLib parses lazily and is not thread safe, so serialise access per file.
        public object Lock { get; } = new();
        /// <summary>True when the in-memory tree differs from the file on disk.</summary>
        public bool Dirty { get; set; }
        public string? SavedTo { get; set; }
        public string Kind { get; set; } = "generic";
        public long Revision { get; set; } = NextRevision();
        /// <summary>Lazily created name lookups (String.wz); only used by quest archives.</summary>
        public NameIndex? Names { get; set; }
        /// <summary>
        /// Opened internally (e.g. Item.wz for a tooltip image) and not listed until a link actually opens it.
        /// </summary>
        public bool Hidden { get; set; }
        /// <summary>Equipment id -> "Category/00000000.img", built the first time an equip is looked up.</summary>
        public Dictionary<int, string>? EquipIndex { get; set; }
    }

    /// <summary>Records that the file's contents changed.</summary>
    private static void Touch(Entry e) { e.Dirty = true; e.Revision = NextRevision(); }

    // SaveToDisk writes a temp file relative to the process directory and uses a static string cache.
    private static readonly object SaveLock = new();

    private readonly ConcurrentDictionary<string, Entry> _files = new();

    /// <param name="hidden">Open without listing it (used for sibling files read on behalf of a quest archive).
    /// Opening a hidden file normally makes it visible.</param>
    public OpenedFileDto Open(string path, string? encryption, bool hidden = false)
    {
        path = System.IO.Path.GetFullPath(path);
        if (!File.Exists(path)) throw new FileNotFoundException("WZ file not found.", path);

        var id = Convert.ToHexString(System.Security.Cryptography.SHA1.HashData(
            System.Text.Encoding.UTF8.GetBytes(path.ToLowerInvariant())))[..12].ToLowerInvariant();
        if (_files.TryGetValue(id, out var existing))
        {
            if (!hidden) existing.Hidden = false;
            return Describe(id, existing);
        }

        if (WzTool.IsListFile(path))
            throw new InvalidDataException("This is a legacy list-format file (e.g. List.wz), not a standard WZ archive.");

        var auto = string.IsNullOrWhiteSpace(encryption) || encryption.Equals("auto", StringComparison.OrdinalIgnoreCase);
        short gameVersion = -1;
        var detected = auto ? WzTool.DetectMapleVersion(path, out gameVersion) : Enum.Parse<WzMapleVersion>(encryption!, ignoreCase: true);

        // MapleLib's detection can pick a wrong IV (e.g. a server using a custom one from ZLZ.dll), which shows up as
        // garbled entry names. In auto mode, check the names and fall through the other encryptions until they read sensibly.
        var candidates = new List<WzMapleVersion> { detected };
        if (auto)
        {
            if (File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(path)!, "ZLZ.dll"))) candidates.Add(WzMapleVersion.GETFROMZLZ);
            candidates.AddRange([WzMapleVersion.GMS, WzMapleVersion.EMS, WzMapleVersion.BMS, WzMapleVersion.CLASSIC]);
        }

        WzFile? file = null;
        var version = detected;
        string? lastError = null;
        foreach (var candidate in candidates.Distinct())
        {
            WzFile? attempt = null;
            try
            {
                attempt = new WzFile(path, candidate == detected ? gameVersion : (short)-1, candidate);
                var status = attempt.ParseWzFile();
                if (status != WzFileParseStatus.Success) { lastError = status.GetErrorDescription(); attempt.Dispose(); continue; }
                if (auto && !LooksDecrypted(attempt.WzDirectory)) { lastError = "Entry names are garbled."; attempt.Dispose(); continue; }
                file = attempt;
                version = candidate;
                break;
            }
            catch (Exception ex)
            {
                lastError = ex.Message;
                attempt?.Dispose();
            }
        }
        if (file == null) throw new InvalidDataException($"Could not open WZ file ({lastError}).");

        var root = file.WzDirectory;
        var entry = new Entry(file, path, version.ToString())
        {
            Kind = root.GetImageByName("QuestInfo.img") != null && root.GetImageByName("Check.img") != null ? "quest" : "generic",
            Hidden = hidden,
        };
        _files[id] = entry;
        return Describe(id, entry);
    }

    // Real entry names are plain identifiers ("Cap", "01002008.img", "UIWindow.img", "Bgm00.img").
    private static readonly System.Text.RegularExpressions.Regex SaneName = new(@"^[A-Za-z0-9_.\- ']+$");

    /// <summary>
    /// With the wrong IV, names decode to junk that can still look printable (e.g. "??Z?!??"), so require them to match
    /// the identifier pattern. A few odd names are tolerated.
    /// </summary>
    private static bool LooksDecrypted(WzDirectory dir)
    {
        var names = dir.WzDirectories.Select(d => d.Name).Concat(dir.WzImages.Select(i => i.Name)).Take(30).ToList();
        return names.Count == 0 || names.Count(n => SaneName.IsMatch(n)) >= names.Count * 0.9;
    }

    public IEnumerable<OpenedFileDto> List() => _files.Where(kv => !kv.Value.Hidden).Select(kv => Describe(kv.Key, kv.Value));

    public bool Close(string id)
    {
        if (!_files.TryRemove(id, out var entry)) return false;
        lock (entry.Lock)
        {
            entry.Names?.Dispose();
            entry.File.Dispose();
        }
        return true;
    }

    public List<NodeDto> Children(string id, string? path)
    {
        var entry = Get(id);
        lock (entry.Lock)
        {
            var node = Resolve(entry.File, path);
            var result = new List<NodeDto>();
            switch (node)
            {
                case WzFile f: AddDirectory(f.WzDirectory, result); break;
                case WzDirectory d: AddDirectory(d, result); break;
                case WzImage img:
                    if (!img.Parsed) img.ParseImage();
                    foreach (var p in img.WzProperties) result.Add(Describe(p));
                    break;
                case WzImageProperty p:
                    var target = p is WzUOLProperty ? p.GetLinkedWzImageProperty() ?? p : p;
                    if (target.WzProperties != null)
                        foreach (var c in target.WzProperties) result.Add(Describe(c));
                    break;
            }
            return result;
        }
    }

    /// <summary>
    /// Paths of nodes whose name contains <paramref name="query"/>: every directory and .img, plus properties
    /// up to <paramref name="depth"/> levels inside each .img. A match isn't searched below; its subtree is shown whole.
    /// </summary>
    public List<string> Search(string id, string query, int depth, int limit = 500)
    {
        var results = new List<string>();
        query = query.Trim();
        if (query.Length == 0) return results;
        var entry = Get(id);
        lock (entry.Lock)
        {
            bool Hit(string name) => name.Contains(query, StringComparison.OrdinalIgnoreCase);

            void Props(IEnumerable<WzImageProperty>? props, string path, int left)
            {
                if (props == null || left <= 0) return;
                foreach (var p in props)
                {
                    if (results.Count >= limit) return;
                    var pp = path + "/" + p.Name;
                    if (Hit(p.Name)) { results.Add(pp); continue; }
                    Props((p is WzUOLProperty ? p.GetLinkedWzImageProperty() ?? p : p).WzProperties, pp, left - 1);
                }
            }

            void Dir(WzDirectory dir, string path)
            {
                foreach (var d in dir.WzDirectories)
                {
                    if (results.Count >= limit) return;
                    var dp = path.Length == 0 ? d.Name : path + "/" + d.Name;
                    if (Hit(d.Name)) results.Add(dp);
                    Dir(d, dp);
                }
                foreach (var img in dir.WzImages)
                {
                    if (results.Count >= limit) return;
                    var ip = path.Length == 0 ? img.Name : path + "/" + img.Name;
                    if (Hit(img.Name)) { results.Add(ip); continue; }
                    if (!img.Parsed) img.ParseImage();
                    Props(img.WzProperties, ip, depth);
                }
            }

            Dir(entry.File.WzDirectory, "");
        }
        return results;
    }

    public NodeDto Node(string id, string? path)
    {
        var entry = Get(id);
        lock (entry.Lock) return Describe(Resolve(entry.File, path));
    }

    public byte[] Png(string id, string path)
    {
        var entry = Get(id);
        lock (entry.Lock)
        {
            var node = Resolve(entry.File, path);
            return (node is WzImageProperty prop ? RenderCanvas(prop) : null)
                ?? throw new KeyNotFoundException("Node is not an image.");
        }
    }

    /// <summary>PNG bytes of a canvas property (following _inlink/_outlink and UOLs), or null if it isn't one.</summary>
    private static byte[]? RenderCanvas(WzImageProperty prop)
    {
        using var bitmap = prop switch
        {
            WzCanvasProperty canvas => canvas.GetLinkedWzCanvasBitmap(),
            _ when prop.GetLinkedWzImageProperty() is WzCanvasProperty linked => linked.GetLinkedWzCanvasBitmap(),
            _ => null,
        };
        if (bitmap == null) return null;
        using var ms = new MemoryStream();
        bitmap.Save(ms, ImageFormat.Png);
        return ms.ToArray();
    }

    /// <summary>
    /// For a placed map object (".../obj/8" or one of its children such as "l0"), the sprite it refers to at
    /// "Obj/{oS}.img/{l0}/{l1}/{l2}" in the same file. Null when the node isn't an object or the sprite is missing.
    /// </summary>
    public ObjRefResult? ObjRef(string id, string path)
    {
        var entry = Get(id);
        lock (entry.Lock)
        {
            var node = Resolve(entry.File, path) as WzImageProperty;
            var obj = node?["oS"] != null ? node : node?.Parent is WzImageProperty p && p["oS"] != null ? p : null;
            if (obj == null) return null;

            var parts = new[] { "oS", "l0", "l1", "l2" }.Select(n => obj[n]?.GetString()).ToArray();
            if (parts.Any(string.IsNullOrEmpty))
                throw new KeyNotFoundException("This object is missing one of oS, l0, l1, l2.");

            var targetPath = $"Obj/{parts[0]}.img/{parts[1]}/{parts[2]}/{parts[3]}";
            var target = Resolve(entry.File, targetPath);
            return new ObjRefResult(targetPath, Describe(target), LinkOf(target));
        }
    }

    /// <summary>The link a node stands for (a UOL's value, or a canvas' _inlink/_outlink), checking frame 0 of a sub.</summary>
    private static string? LinkOf(object node)
    {
        static string? Own(WzImageProperty? p) => p switch
        {
            WzUOLProperty u => u.Value,
            WzCanvasProperty c => (c["_inlink"] ?? c["_outlink"])?.GetString(),
            _ => null,
        };
        return node is WzImageProperty prop ? Own(prop) ?? (prop is WzSubProperty ? Own(prop["0"]) : null) : null;
    }

    public SoundData Sound(string id, string path)
    {
        var entry = Get(id);
        lock (entry.Lock)
        {
            var node = Resolve(entry.File, path);
            if (node is WzImageProperty prop && prop.GetLinkedWzImageProperty() is WzBinaryProperty sound)
                return sound.IsWaveFile
                    ? new SoundData(sound.GetBytesForWAVPlayback(), "audio/wav")
                    : new SoundData(sound.GetBytes(false), "audio/mpeg");
            throw new KeyNotFoundException("Node is not a sound.");
        }
    }

    // ---------------------------------------------------------------- helpers

    private Entry Get(string id) =>
        _files.TryGetValue(id, out var e) ? e : throw new KeyNotFoundException($"No open file with id '{id}'.");

    private static OpenedFileDto Describe(string id, Entry e)
    {
        int count;
        lock (e.Lock) count = e.File.WzDirectory.WzDirectories.Count + e.File.WzDirectory.WzImages.Count;
        return new OpenedFileDto(id, System.IO.Path.GetFileName(e.Path), e.Path, e.Encryption, e.File.Version, count, e.Dirty, e.SavedTo, e.Kind, e.Revision);
    }

    // ------------------------------------------------------------ editing (in memory only)

    /// <summary>Copies (or moves) a node from one open file into a container of another (or the same) file.</summary>
    public PasteResult Paste(string targetId, PasteRequest req)
    {
        var target = Get(targetId);
        var source = Get(req.SourceId);
        var same = ReferenceEquals(target, source);

        // Lock in a fixed order so two concurrent cross-file pastes can't deadlock.
        var (first, second) = string.CompareOrdinal(targetId, req.SourceId) <= 0 ? (target, source) : (source, target);
        lock (first.Lock)
        lock (same ? new object() : second.Lock)
            return PasteLocked(targetId, target, source, req);
    }

    private PasteResult PasteLocked(string targetId, Entry target, Entry source, PasteRequest req)
    {
        var sourcePath = Normalize(req.SourcePath);
        var targetPath = Normalize(req.TargetPath);
        if (sourcePath.Length == 0) throw new InvalidDataException("A whole file can't be copied; pick a node inside it.");

        var node = Resolve(source.File, sourcePath);
        var destination = Resolve(target.File, targetPath);
        object container = destination is WzFile f ? f.WzDirectory : destination;

        if (req.Move && ReferenceEquals(source, target) &&
            (targetPath == sourcePath || targetPath.StartsWith(sourcePath + "/", StringComparison.Ordinal)))
            throw new InvalidDataException("A node can't be moved into itself.");

        object added;
        switch (node)
        {
            case WzDirectory d when container is WzDirectory td:
            {
                var clone = d.DeepClone();
                clone.Name = UniqueName(d.Name, n => td.GetDirectoryByName(n) != null || td.GetImageByName(n) != null);
                td.AddDirectory(clone);
                added = clone;
                break;
            }
            case WzImage i when container is WzDirectory td:
            {
                var clone = i.DeepClone();
                clone.Name = UniqueName(i.Name, n => td.GetDirectoryByName(n) != null || td.GetImageByName(n) != null);
                td.AddImage(clone);
                added = clone;
                break;
            }
            case WzImageProperty p when container is IPropertyContainer pc:
            {
                var clone = p.DeepClone();
                clone.Name = UniqueName(p.Name, n => pc[n] != null);
                pc.AddProperty(clone);
                MarkChanged(container);
                added = clone;
                break;
            }
            default:
                throw new InvalidDataException($"A {Kind(node)} can't be pasted into a {Kind(container)}.");
        }

        var newPath = Join(targetPath, ((WzObject)added).Name);
        Touch(target);

        OpenedFileDto? sourceDto = null;
        if (req.Move)
        {
            MarkChanged(node);
            ((WzObject)node).Remove();
            Touch(source);
            if (!ReferenceEquals(source, target)) sourceDto = Describe(req.SourceId, source);
        }

        return new PasteResult(newPath, Describe(added), Describe(targetId, target), sourceDto);
    }

    public OpenedFileDto Delete(string id, string path)
    {
        var entry = Get(id);
        lock (entry.Lock)
        {
            path = Normalize(path);
            if (path.Length == 0) throw new InvalidDataException("The file root can't be deleted.");
            var node = Resolve(entry.File, path);
            MarkChanged(node);
            ((WzObject)node).Remove();
            Touch(entry);
            return Describe(id, entry);
        }
    }

    /// <summary>Writes the current state to a NEW file. The original is never overwritten.</summary>
    public SaveResult Save(string id, string? outPath)
    {
        var entry = Get(id);
        lock (entry.Lock)
        lock (SaveLock)
        {
            string target;
            if (string.IsNullOrWhiteSpace(outPath))
            {
                var dir = System.IO.Path.GetDirectoryName(entry.Path)!;
                var stem = System.IO.Path.GetFileNameWithoutExtension(entry.Path);
                target = System.IO.Path.Combine(dir, $"{stem}.edited.wz");
                for (var n = 2; File.Exists(target); n++)
                    target = System.IO.Path.Combine(dir, $"{stem}.edited{n}.wz");
            }
            else
            {
                target = System.IO.Path.GetFullPath(outPath);
                if (File.Exists(target)) throw new InvalidDataException($"'{target}' already exists; this app never overwrites files.");
            }

            var previous = Directory.GetCurrentDirectory();
            Directory.SetCurrentDirectory(System.IO.Path.GetDirectoryName(target)!);
            try { entry.File.SaveToDisk(target); }
            finally { Directory.SetCurrentDirectory(previous); }

            entry.Dirty = false;
            entry.SavedTo = target;
            return new SaveResult(target, new FileInfo(target).Length, Describe(id, entry));
        }
    }

    /// <summary>Discards in-memory edits by reloading the file from disk.</summary>
    public OpenedFileDto Revert(string id)
    {
        var entry = Get(id);
        var (path, encryption) = (entry.Path, entry.Encryption);
        Close(id);
        return Open(path, encryption);
    }

    private static string Normalize(string? path) => string.Join('/', (path ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries));
    private static string Join(string parent, string name) => parent.Length == 0 ? name : $"{parent}/{name}";

    private static string Kind(object node) => node switch
    {
        WzDirectory => "directory",
        WzImage => "image",
        WzImageProperty p => p.PropertyType.ToString().ToLowerInvariant() + " property",
        _ => node.GetType().Name,
    };

    /// <summary>MapleLib only re-serialises images flagged as changed, and nested edits don't flag the image.</summary>
    private static void MarkChanged(object node)
    {
        switch (node)
        {
            case WzImage i: i.Changed = true; break;
            case WzImageProperty p: if (p.ParentImage is { } img) img.Changed = true; break;
        }
    }

    private static string UniqueName(string name, Func<string, bool> exists)
    {
        if (!exists(name)) return name;
        var ext = name.EndsWith(".img", StringComparison.OrdinalIgnoreCase) ? ".img" : "";
        var stem = name[..^ext.Length];
        for (var n = 1; ; n++)
        {
            var candidate = n == 1 ? $"{stem}_copy{ext}" : $"{stem}_copy{n}{ext}";
            if (!exists(candidate)) return candidate;
        }
    }

    private static object Resolve(WzFile file, string? path)
    {
        object current = file;
        if (string.IsNullOrEmpty(path)) return current;

        foreach (var segment in path.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            current = current switch
            {
                WzFile f => (object?)f.WzDirectory.GetDirectoryByName(segment) ?? f.WzDirectory.GetImageByName(segment),
                WzDirectory d => (object?)d.GetDirectoryByName(segment) ?? d.GetImageByName(segment),
                WzImage img => img[segment],
                WzImageProperty p => (p is WzUOLProperty ? p.GetLinkedWzImageProperty() ?? p : p)[segment],
                _ => null,
            } ?? throw new KeyNotFoundException($"'{segment}' not found in path '{path}'.");
        }
        return current;
    }

    private static void AddDirectory(WzDirectory dir, List<NodeDto> into)
    {
        foreach (var d in dir.WzDirectories) into.Add(Describe(d));
        foreach (var i in dir.WzImages) into.Add(Describe(i));
    }

    private static NodeDto Describe(object node) => node switch
    {
        WzFile f => new NodeDto(f.Name, "file", true),
        WzDirectory d => new NodeDto(d.Name, "directory", d.WzDirectories.Count + d.WzImages.Count > 0),
        // Images are parsed lazily, so assume they can be expanded.
        WzImage i => new NodeDto(i.Name, "image", true),
        WzCanvasProperty c => new NodeDto(c.Name, "canvas", c.WzProperties?.Count > 0,
            Width: c.PngProperty?.Width, Height: c.PngProperty?.Height,
            Value: c.PngProperty is { } png ? $"{png.Width}x{png.Height}" : null),
        WzVectorProperty v => new NodeDto(v.Name, "vector", false, $"{v.X.Value}, {v.Y.Value}"),
        WzBinaryProperty s => new NodeDto(s.Name, "sound", false, $"{s.Length} ms"),
        WzUOLProperty u => new NodeDto(u.Name, "uol", false, u.Value),
        WzSubProperty sp => new NodeDto(sp.Name, "sub", sp.WzProperties.Count > 0),
        WzConvexProperty cv => new NodeDto(cv.Name, "convex", cv.WzProperties.Count > 0),
        WzStringProperty s => new NodeDto(s.Name, "string", false, s.Value),
        WzIntProperty n => new NodeDto(n.Name, "int", false, n.Value.ToString()),
        WzShortProperty n => new NodeDto(n.Name, "short", false, n.Value.ToString()),
        WzLongProperty n => new NodeDto(n.Name, "long", false, n.Value.ToString()),
        WzFloatProperty n => new NodeDto(n.Name, "float", false, n.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)),
        WzDoubleProperty n => new NodeDto(n.Name, "double", false, n.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)),
        WzNullProperty n => new NodeDto(n.Name, "null", false),
        WzImageProperty p => new NodeDto(p.Name, p.PropertyType.ToString().ToLowerInvariant(), p.WzProperties?.Count > 0),
        _ => new NodeDto(node.ToString() ?? "?", "unknown", false),
    };
}
