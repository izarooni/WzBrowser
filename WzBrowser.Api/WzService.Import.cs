using System.IO.Compression;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Images">Canvases given a new picture.</param>
/// <param name="Properties">Values set (new or changed).</param>
/// <param name="Created">Nodes that didn't exist before: directories, .imgs, sub-properties, canvases, values.</param>
/// <param name="Warnings">What was skipped, and why (at most 50).</param>
public record ImportResult(string Path, OpenedFileDto File, int Images, int Properties, int Created, List<string> Warnings);

public sealed partial class WzService
{
    private const int MaxImportWarnings = 50;

    /// <summary>A folder of the uploaded zip: its subfolders and files by name, and its parsed .props if it has one.</summary>
    private sealed class ZipFolder(string path)
    {
        public string Path { get; } = path;
        public Dictionary<string, ZipFolder> Folders { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, ZipArchiveEntry> Files { get; } = new(StringComparer.OrdinalIgnoreCase);
        public PropsFile? Props { get; set; }
        public string Child(string name) => Path.Length == 0 ? name : $"{Path}/{name}";
    }

    private sealed class ImportRun(Entry entry, WzPngFormat? quality)
    {
        public Entry Entry { get; } = entry;
        /// <summary>The format every picture is stored in; null to keep the exported one (else the canvas' own, else lossless).</summary>
        public WzPngFormat? Quality { get; } = quality;
        public int Images, Properties, Created;
        public List<string> Warnings { get; } = [];
        public void Warn(string text) { if (Warnings.Count < MaxImportWarnings) Warnings.Add(text); }
    }

    /// <summary>
    /// Puts a zip of folders and PNGs into a node, the reverse of <see cref="ExportPngs"/>: folders become the
    /// directories, .imgs and sub-properties of the same name (created when missing), PNGs become canvases, and each
    /// folder's .props (if any) restores the values, real names, kinds and pixel formats the export recorded. What's
    /// already there is kept unless the zip has something of the same name, which replaces it; a node of another type
    /// (a value where the zip has a folder, say) is swapped for the zip's. A zip whose only folder is named like the node
    /// (as its own export is) goes into the node itself. In memory only, like every other edit.
    /// </summary>
    /// <param name="quality">The pixel format to store every picture in (see <see cref="SetPng"/>); null or "keep" for
    /// the format the export recorded, else the canvas' current one, else lossless.</param>
    public ImportResult ImportZip(string id, string? path, Stream zipStream, string? quality)
    {
        var format = quality?.Trim().ToLowerInvariant() switch
        {
            null or "" or "keep" => (WzPngFormat?)null,
            "lossless" => WzPngFormat.Format2,
            var key => FormatFromKey(key) is { } f && Writable(f) == f ? f : throw new ArgumentException($"Unknown image quality '{quality}'."),
        };

        ZipArchive zip;
        try { zip = new ZipArchive(zipStream, ZipArchiveMode.Read, leaveOpen: true); }
        catch (InvalidDataException) { throw new InvalidDataException("That file isn't a zip."); }
        using (zip)
        {
            var top = ReadZip(zip);
            var entry = Get(id);
            lock (entry.Lock)
            {
                path = Normalize(path);
                var target = Resolve(entry.File, path);
                if (target is WzUOLProperty uol) target = uol.GetLinkedWzImageProperty() ?? throw new InvalidDataException("This link doesn't lead anywhere.");
                var run = new ImportRun(entry, format);

                // Its own export: a single folder named like the node (and, for a canvas, its picture beside it).
                var name = target switch
                {
                    WzFile => System.IO.Path.GetFileNameWithoutExtension(entry.Path),
                    WzObject o => o.Name,
                    _ => "",
                };
                var own = ZipName(name);
                var content = top;
                ZipArchiveEntry? ownPng = null;
                var onlyOwn = top.Folders.Keys.All(k => k.Equals(own, StringComparison.OrdinalIgnoreCase))
                    && top.Files.Keys.All(k => k.Equals(own + ".png", StringComparison.OrdinalIgnoreCase));
                if (onlyOwn && (top.Folders.Count > 0 || top.Files.Count > 0) && (top.Files.Count == 0 || target is WzCanvasProperty))
                {
                    content = top.Folders.GetValueOrDefault(own) ?? new ZipFolder(own);
                    ownPng = top.Files.GetValueOrDefault(own + ".png");
                }

                switch (target)
                {
                    case WzFile f: ImportDirectory(run, f.WzDirectory, content); break;
                    case WzDirectory d: ImportDirectory(run, d, content); break;
                    case IPropertyContainer pc:
                        if (target is WzImage img && !img.Parsed) img.ParseImage();
                        if (target is WzCanvasProperty canvas && ReadPicture(run, ownPng) is { } pixels)
                            StorePicture(run, canvas, pixels, content.Props?.Kind == PropsKind.Canvas ? content.Props.Format : -1, hadPicture: true);
                        ImportContainer(run, pc, content);
                        break;
                    default: throw new InvalidDataException($"Nothing can be imported into a {Kind(target)}.");
                }

                var changed = run.Images + run.Properties + run.Created > 0;
                if (!changed && run.Warnings.Count == 0) throw new InvalidDataException("The zip has no folders or PNGs to import.");
                if (changed) Touch(entry);
                return new ImportResult(path, Describe(id, entry), run.Images, run.Properties, run.Created, run.Warnings);
            }
        }
    }

    /// <summary>The zip as a folder tree, every .props parsed up front so a bad one stops the import before anything changes.</summary>
    private static ZipFolder ReadZip(ZipArchive zip)
    {
        var top = new ZipFolder("");
        foreach (var e in zip.Entries)
        {
            var parts = e.FullName.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0 || parts.Any(p => p is "." or "..")) continue;
            // Finder's resource forks aren't part of the tree.
            if (parts[0] == "__MACOSX") continue;
            var folder = top;
            foreach (var part in parts[..^1])
            {
                if (!folder.Folders.TryGetValue(part, out var next)) folder.Folders[part] = next = new ZipFolder(folder.Child(part));
                folder = next;
            }
            var last = parts[^1];
            if (e.FullName.EndsWith('/'))
            {
                if (!folder.Folders.ContainsKey(last)) folder.Folders[last] = new ZipFolder(folder.Child(last));
            }
            else if (last == PropsFileName)
            {
                using var s = e.Open();
                using var ms = new MemoryStream();
                s.CopyTo(ms);
                ms.Position = 0;
                folder.Props = ReadProps(ms, e.FullName);
            }
            else folder.Files[last] = e;
        }
        return top;
    }

    // ------------------------------------------------------------ directories

    private void ImportDirectory(ImportRun run, WzDirectory dir, ZipFolder folder)
    {
        foreach (var (key, sub) in folder.Folders)
        {
            // An export names images without ".img"; its .props has the real name.
            var name = sub.Props?.Kind == PropsKind.Image ? sub.Props.Name : key;
            var existing = (WzObject?)dir.GetDirectoryByName(name) ?? dir.GetImageByName(name)
                ?? (name.EndsWith(".img", StringComparison.OrdinalIgnoreCase) ? null : dir.GetImageByName(name + ".img"));
            if (sub.Props is { Kind: not PropsKind.Image })
            {
                run.Warn($"'{sub.Path}' is a {sub.Props.Kind.ToString().ToLowerInvariant()} property; it belongs inside an .img, not a directory.");
                continue;
            }

            switch (existing)
            {
                case WzDirectory d: ImportDirectory(run, d, sub); break;
                case WzImage img:
                    if (!img.Parsed) img.ParseImage();
                    ImportContainer(run, img, sub);
                    break;
                default:
                    // A folder holding pictures or values directly is an .img; one holding only folders, a directory.
                    if (sub.Props != null || sub.Files.Count > 0)
                    {
                        var created = new WzImage(name.EndsWith(".img", StringComparison.OrdinalIgnoreCase) ? name : name + ".img") { Parsed = true };
                        dir.AddImage(created);
                        run.Created++;
                        ImportContainer(run, created, sub);
                    }
                    else
                    {
                        var created = new WzDirectory(name, run.Entry.File);
                        dir.AddDirectory(created);
                        run.Created++;
                        ImportDirectory(run, created, sub);
                    }
                    break;
            }
        }
        foreach (var file in folder.Files.Keys)
            run.Warn($"'{folder.Child(file)}' was skipped: a directory holds only folders and .imgs; put it in an .img's folder.");
    }

    // ------------------------------------------------------------ properties

    /// <summary>A folder's contents into an .img or property: its .props' entries first, then the files and folders it doesn't list.</summary>
    private void ImportContainer(ImportRun run, IPropertyContainer into, ZipFolder folder)
    {
        var usedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var usedFolders = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var e in folder.Props?.Entries ?? [])
        {
            if (e.Tag == PropsTag.Folder)
            {
                usedFolders.Add(e.Folder);
                var png = Png(e.Png);
                if (!folder.Folders.TryGetValue(e.Folder, out var sub))
                {
                    run.Warn($"'{folder.Child(e.Folder)}' is missing from the zip; '{e.Name}' was skipped.");
                    continue;
                }
                var kind = sub.Props?.Kind ?? (e.Png.Length > 0 ? PropsKind.Canvas : PropsKind.Sub);
                ImportNode(run, into, e.Name, kind, sub, png, sub.Props?.Format ?? -1, exact: true, folder.Child(e.Folder));
            }
            else ImportEntry(run, into, e, folder, Png);
        }

        // Folders and pictures the .props doesn't list: added by hand, or a zip made without one.
        foreach (var (key, sub) in folder.Folders)
        {
            if (usedFolders.Contains(key)) continue;
            var png = Png(key + ".png");
            var kind = sub.Props?.Kind ?? (png != null ? PropsKind.Canvas : PropsKind.Sub);
            ImportNode(run, into, sub.Props?.Name ?? key, kind, sub, png, sub.Props?.Format ?? -1, exact: sub.Props != null, sub.Path);
        }
        foreach (var (key, file) in folder.Files)
        {
            if (usedFiles.Contains(key)) continue;
            if (!key.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            {
                run.Warn($"'{folder.Child(key)}' was skipped: only PNGs and folders are imported.");
                continue;
            }
            usedFiles.Add(key);
            ImportNode(run, into, key[..^4], PropsKind.Canvas, null, file, -1, exact: false, folder.Child(key));
        }

        ZipArchiveEntry? Png(string name)
        {
            if (name.Length == 0 || !folder.Files.TryGetValue(name, out var file)) return null;
            usedFiles.Add(name);
            return file;
        }
    }

    /// <summary>
    /// A sub, convex or canvas from a folder and/or PNG: the existing one of that name when it has the right type (any
    /// container when <paramref name="exact"/> is false, i.e. the kind was only guessed), else a new one.
    /// </summary>
    private void ImportNode(ImportRun run, IPropertyContainer into, string name, PropsKind kind, ZipFolder? folder,
        ZipArchiveEntry? png, int format, bool exact, string where)
    {
        if (kind == PropsKind.Image)
        {
            run.Warn($"'{where}' is an .img; it can only go into a directory.");
            return;
        }
        if (!ValidName(run, name, where)) return;
        var existing = into[name];
        var fits = existing switch
        {
            WzCanvasProperty => kind == PropsKind.Canvas || !exact,
            WzSubProperty => kind == PropsKind.Sub || (!exact && png == null),
            WzConvexProperty => kind == PropsKind.Convex || (!exact && png == null),
            _ => false,
        };
        // A guessed folder with a picture beside it must become a canvas to show it.
        if (!exact && png != null) kind = PropsKind.Canvas;
        // Read the picture before anything is replaced, so an unreadable one leaves the node as it was.
        var pixels = ReadPicture(run, png);

        WzImageProperty node;
        if (fits) node = existing!;
        else
        {
            if (kind == PropsKind.Canvas && pixels == null)
            {
                if (png == null) run.Warn($"'{where}' was skipped: the canvas' PNG is missing.");
                return;
            }
            node = kind switch
            {
                PropsKind.Canvas => new WzCanvasProperty(name),
                PropsKind.Convex => new WzConvexProperty(name),
                _ => new WzSubProperty(name),
            };
            if (!Place(run, into, node, existing, where)) return;
        }

        if (pixels != null && node is WzCanvasProperty canvas) StorePicture(run, canvas, pixels, format, hadPicture: fits);
        if (folder != null) ImportContainer(run, (IPropertyContainer)node, folder);
    }

    /// <summary>One .props entry kept whole: a value, or a sub/convex/canvas with its children inline.</summary>
    private void ImportEntry(ImportRun run, IPropertyContainer into, PropsEntry e, ZipFolder folder, Func<string, ZipArchiveEntry?> png)
    {
        var where = folder.Child(e.Name);
        if (!ValidName(run, e.Name, where)) return;
        var existing = into[e.Name];
        switch (e.Tag)
        {
            case PropsTag.Sub or PropsTag.Convex or PropsTag.Canvas:
            {
                var isCanvas = e.Tag == PropsTag.Canvas;
                var file = isCanvas ? png(e.Png) : null;
                var picture = ReadPicture(run, file);
                var fits = e.Tag switch
                {
                    PropsTag.Canvas => existing is WzCanvasProperty,
                    PropsTag.Convex => existing is WzConvexProperty,
                    _ => existing is WzSubProperty,
                };
                WzImageProperty node;
                if (fits) node = existing!;
                else
                {
                    if (isCanvas && picture == null)
                    {
                        if (file == null) run.Warn($"'{where}' was skipped: the canvas' PNG{(e.Png.Length > 0 ? $" ({e.Png})" : "")} is missing.");
                        return;
                    }
                    node = e.Tag switch
                    {
                        PropsTag.Canvas => new WzCanvasProperty(e.Name),
                        PropsTag.Convex => new WzConvexProperty(e.Name),
                        _ => new WzSubProperty(e.Name),
                    };
                    if (!Place(run, into, node, existing, where)) return;
                }
                if (picture != null) StorePicture(run, (WzCanvasProperty)node, picture, e.Format, hadPicture: fits);
                var children = new ZipFolder(where) { Props = new PropsFile(PropsKind.Sub, e.Name, -1, e.Children ?? []) };
                foreach (var child in e.Children ?? []) ImportEntry(run, (IPropertyContainer)node, child, children, _ => null);
                return;
            }
            default:
            {
                var value = NewValue(e);
                if (value == null)
                {
                    run.Warn($"'{where}' was skipped: unknown entry type {(byte)e.Tag}.");
                    return;
                }
                if (existing != null && existing.GetType() == value.GetType())
                {
                    if (SameValue(existing, value)) return;
                    CopyValue(value, existing);
                    MarkChanged(existing);
                    run.Properties++;
                    return;
                }
                if (Place(run, into, value, existing, where)) run.Properties++;
                return;
            }
        }
    }

    private static bool ValidName(ImportRun run, string name, string where)
    {
        if (name.Length > 0 && !name.Contains('/')) return true;
        run.Warn($"'{where}' was skipped: a property's name can't be empty or contain '/'.");
        return false;
    }

    /// <summary>Adds a new node, in place of <paramref name="existing"/> (of another type) when there is one.</summary>
    private static bool Place(ImportRun run, IPropertyContainer into, WzImageProperty node, WzImageProperty? existing, string where)
    {
        if (into is WzConvexProperty && node is not WzExtended)
        {
            run.Warn($"'{where}' was skipped: a convex property can only hold vectors, links and sub-properties.");
            return false;
        }
        if (existing != null)
        {
            MarkChanged(existing);
            existing.Remove();
        }
        into.AddProperty(node);
        MarkChanged(node);
        run.Created++;
        return true;
    }

    private static WzImageProperty? NewValue(PropsEntry e) => e.Tag switch
    {
        PropsTag.Null => new WzNullProperty(e.Name),
        PropsTag.Short => new WzShortProperty(e.Name, (short)e.Value!),
        PropsTag.Int => new WzIntProperty(e.Name, (int)e.Value!),
        PropsTag.Long => new WzLongProperty(e.Name, (long)e.Value!),
        PropsTag.Float => new WzFloatProperty(e.Name, (float)e.Value!),
        PropsTag.Double => new WzDoubleProperty(e.Name, (double)e.Value!),
        PropsTag.String => new WzStringProperty(e.Name, (string)e.Value!),
        PropsTag.Uol => new WzUOLProperty(e.Name, (string)e.Value!),
        PropsTag.Vector => e.Value is (int x, int y) ? new WzVectorProperty(e.Name, x, y) : null,
        _ => null,
    };

    private static bool SameValue(WzImageProperty a, WzImageProperty b) => (a, b) switch
    {
        (WzNullProperty, WzNullProperty) => true,
        (WzShortProperty x, WzShortProperty y) => x.Value == y.Value,
        (WzIntProperty x, WzIntProperty y) => x.Value == y.Value,
        (WzLongProperty x, WzLongProperty y) => x.Value == y.Value,
        (WzFloatProperty x, WzFloatProperty y) => x.Value.Equals(y.Value),
        (WzDoubleProperty x, WzDoubleProperty y) => x.Value.Equals(y.Value),
        (WzStringProperty x, WzStringProperty y) => x.Value == y.Value,
        (WzUOLProperty x, WzUOLProperty y) => x.Value == y.Value,
        (WzVectorProperty x, WzVectorProperty y) => x.X.Value == y.X.Value && x.Y.Value == y.Y.Value,
        _ => false,
    };

    private static void CopyValue(WzImageProperty from, WzImageProperty to)
    {
        switch (from, to)
        {
            case (WzShortProperty x, WzShortProperty y): y.Value = x.Value; break;
            case (WzIntProperty x, WzIntProperty y): y.Value = x.Value; break;
            case (WzLongProperty x, WzLongProperty y): y.Value = x.Value; break;
            case (WzFloatProperty x, WzFloatProperty y): y.Value = x.Value; break;
            case (WzDoubleProperty x, WzDoubleProperty y): y.Value = x.Value; break;
            case (WzStringProperty x, WzStringProperty y): y.Value = x.Value; break;
            case (WzUOLProperty x, WzUOLProperty y): y.Value = x.Value; break;
            case (WzVectorProperty x, WzVectorProperty y): y.X.Value = x.X.Value; y.Y.Value = x.Y.Value; break;
        }
    }

    // ------------------------------------------------------------ pictures

    /// <summary>A PNG from the zip, decoded; null (with a warning) when there's none or it can't be read.</summary>
    private static Pixels? ReadPicture(ImportRun run, ZipArchiveEntry? png)
    {
        if (png == null) return null;
        try
        {
            if (png.Length > 64 << 20) throw new InvalidDataException("it's larger than 64 MB");
            using var s = png.Open();
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            return DecodeImage(ms.ToArray());
        }
        catch (Exception ex) when (ex is InvalidDataException or ArgumentException or IOException)
        {
            run.Warn($"'{png.FullName}' was skipped: {ex.Message.TrimEnd('.')}.");
            return null;
        }
    }

    /// <summary>
    /// Stores a picture as a canvas', removing its _inlink/_outlink as an upload does. The format: the run's quality if
    /// it has one, else the exported one (<paramref name="format"/>, -1 for none), else the canvas' own when it had a
    /// picture, else lossless.
    /// </summary>
    private static void StorePicture(ImportRun run, WzCanvasProperty canvas, Pixels image, int format, bool hadPicture)
    {
        var target = run.Quality
            ?? (format >= 0 && Enum.IsDefined((WzPngFormat)format) ? (WzPngFormat?)Writable((WzPngFormat)format) : null)
            ?? (hadPicture ? Writable(canvas.PngProperty.Format) : WzPngFormat.Format2);
        if (target is WzPngFormat.Format1026 or WzPngFormat.Format2050) image = PadTo4(image);
        canvas.PngProperty.SetCompressedBytes(Encode(image, target), image.Width, image.Height, target);
        foreach (var link in new[] { WzCanvasProperty.InlinkPropertyName, WzCanvasProperty.OutlinkPropertyName })
            canvas[link]?.Remove();
        MarkChanged(canvas);
        run.Images++;
    }
}
