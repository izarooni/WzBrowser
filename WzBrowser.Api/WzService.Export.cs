using System.IO.Compression;
using System.Text;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public sealed partial class WzService
{
    /// <summary>
    /// Every canvas under a node, as PNGs in a zip laid out like the tree ("0100100/stand/0.png", ".img" dropped from
    /// folder names). Links (_inlink/_outlink) render the picture they point to; UOLs aren't followed, so nothing is
    /// exported twice. Each folder of an .img also gets a <see cref="PropsFileName"/> holding everything else in it
    /// (delay, origin, the canvases' pixel formats, real names, ...; see WzService.PropsFile.cs), so
    /// <see cref="ImportZip"/> can put the zip back as it was. Images with no pictures in them are left out of a folder's
    /// export. The zip is built in a temp file deleted when the returned stream closes.
    /// </summary>
    /// <returns>The zip and its suggested file name.</returns>
    public (Stream Zip, string FileName) ExportPngs(string id, string? path)
    {
        var entry = Get(id);
        var temp = new FileStream(System.IO.Path.GetTempFileName(), FileMode.Create, FileAccess.ReadWrite, FileShare.None, 1 << 16,
            FileOptions.DeleteOnClose);
        var count = 0;
        string rootName;
        try
        {
            using (var zip = new ZipArchive(temp, ZipArchiveMode.Create, leaveOpen: true))
            lock (entry.Lock)
            {
                var root = Resolve(entry.File, path);
                rootName = ZipName(string.IsNullOrEmpty(path) ? System.IO.Path.GetFileNameWithoutExtension(entry.Path) : path.Split('/')[^1]);
                var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var hasCanvas = new Dictionary<WzImageProperty, bool>(ReferenceEqualityComparer.Instance);

                // Whether a property is or holds a picture, so it needs a folder rather than being kept whole in a .props.
                bool HoldsCanvas(WzImageProperty p)
                {
                    if (p is WzCanvasProperty) return true;
                    if (p is WzUOLProperty || p.WzProperties == null) return false;
                    if (hasCanvas.TryGetValue(p, out var known)) return known;
                    return hasCanvas[p] = p.WzProperties.Any(HoldsCanvas);
                }

                // Names differing only in case (or in characters a zip can't hold) would overwrite each other on Windows.
                string Unique(string zipPath, string suffix)
                {
                    var name = zipPath + suffix;
                    for (var n = 2; !used.Add(name); n++) name = $"{zipPath}~{n}{suffix}";
                    return name;
                }

                /// <returns>The PNG's name within its folder, or "" when the canvas has no picture to render.</returns>
                string AddPng(string zipPath, WzImageProperty canvas)
                {
                    var png = RenderCanvas(entry, canvas);
                    if (png == null) return "";
                    var name = Unique(zipPath, ".png");
                    using (var s = zip.CreateEntry(name, CompressionLevel.Fastest).Open()) s.Write(png);
                    count++;
                    return name[(name.LastIndexOf('/') + 1)..];
                }

                // A node's children into folder `dir`: pictures as PNGs, the ones holding pictures as subfolders, the
                // rest whole in the folder's .props, written last since the zip takes one entry at a time.
                void Container(IEnumerable<WzImageProperty>? props, string dir, PropsKind kind, string name, int format)
                {
                    using var buffer = new MemoryStream();
                    using var w = new BinaryWriter(buffer, Encoding.UTF8, leaveOpen: true);
                    var entries = 0;
                    foreach (var p in props ?? [])
                    {
                        if (IsCanvasLink(p)) continue;
                        var pp = dir + "/" + ZipName(p.Name);
                        if (p is WzCanvasProperty c)
                        {
                            var png = AddPng(pp, c);
                            if (c.WzProperties?.Any(HoldsCanvas) == true)
                            {
                                var folder = Unique(pp, "/").TrimEnd('/');
                                WriteFolderEntry(w, c.Name, folder[(dir.Length + 1)..], png);
                                Container(c.WzProperties, folder, PropsKind.Canvas, c.Name, CanvasFormat(c));
                            }
                            else WriteInline(w, c, _ => png);
                            entries++;
                        }
                        else if (p is WzSubProperty or WzConvexProperty && HoldsCanvas(p))
                        {
                            var folder = Unique(pp, "/").TrimEnd('/');
                            WriteFolderEntry(w, p.Name, folder[(dir.Length + 1)..], "");
                            Container(p.WzProperties, folder, p is WzConvexProperty ? PropsKind.Convex : PropsKind.Sub, p.Name, -1);
                            entries++;
                        }
                        else if (WriteInline(w, p, null)) entries++;
                    }
                    w.Flush();
                    using var s = zip.CreateEntry(dir + "/" + PropsFileName, CompressionLevel.Fastest).Open();
                    using var header = new BinaryWriter(s, Encoding.UTF8, leaveOpen: true);
                    WritePropsHeader(header, kind, name, format, entries);
                    header.Flush();
                    s.Write(buffer.GetBuffer(), 0, (int)buffer.Length);
                }

                void Image(WzImage img, string dir, bool always)
                {
                    if (!img.Parsed) img.ParseImage();
                    if (always || img.WzProperties.Any(HoldsCanvas)) Container(img.WzProperties, dir, PropsKind.Image, img.Name, -1);
                }

                void Dir(WzDirectory d, string dir)
                {
                    foreach (var sub in d.WzDirectories) Dir(sub, dir + "/" + ZipName(sub.Name));
                    foreach (var img in d.WzImages) Image(img, Unique(dir + "/" + ZipName(img.Name), "/").TrimEnd('/'), always: false);
                }

                if (root is WzUOLProperty uol) root = uol.GetLinkedWzImageProperty() ?? uol;
                switch (root)
                {
                    case WzFile f: Dir(f.WzDirectory, rootName); break;
                    case WzDirectory d: Dir(d, rootName); break;
                    case WzImage img: Image(img, rootName, always: true); break;
                    case WzCanvasProperty c:
                        AddPng(rootName, c);
                        Container(c.WzProperties, rootName, PropsKind.Canvas, c.Name, CanvasFormat(c));
                        break;
                    case WzSubProperty or WzConvexProperty:
                        var p = (WzImageProperty)root;
                        Container(p.WzProperties, rootName, p is WzConvexProperty ? PropsKind.Convex : PropsKind.Sub, p.Name, -1);
                        break;
                }
            }
            if (count == 0) throw new KeyNotFoundException("There are no images in here.");
            temp.Position = 0;
            return (temp, rootName + ".zip");
        }
        catch
        {
            temp.Dispose();
            throw;
        }
    }

    /// <summary>The pixel format a canvas' picture is stored in (the one its _inlink points to, for a link).</summary>
    private static int CanvasFormat(WzCanvasProperty c) =>
        (int)((c.GetLinkedWzImageProperty() as WzCanvasProperty ?? c).PngProperty.Format);

    /// <summary>A tree name as a zip path segment: ".img" dropped, characters Windows can't use in file names replaced.</summary>
    private static string ZipName(string name)
    {
        if (name.EndsWith(".img", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        var chars = name.Select(c => c < 32 || "\\/:*?\"<>|".Contains(c) ? '_' : c).ToArray();
        var s = new string(chars).TrimEnd('.', ' ');
        return s.Length == 0 ? "_" : s;
    }
}
