using System.IO.Compression;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public sealed partial class WzService
{
    /// <summary>
    /// Every canvas under a node, as PNGs in a zip laid out like the tree ("0100100/stand/0.png", ".img" dropped from
    /// folder names). Links (_inlink/_outlink) render the picture they point to; UOLs aren't followed, so nothing is
    /// exported twice. The zip is built in a temp file deleted when the returned stream closes.
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

                void Add(string zipPath, WzImageProperty canvas)
                {
                    var png = RenderCanvas(entry, canvas);
                    if (png == null) return;
                    var name = zipPath + ".png";
                    // Names differing only in case (or in characters a zip can't hold) would overwrite each other on Windows.
                    for (var n = 2; !used.Add(name); n++) name = $"{zipPath}~{n}.png";
                    using var s = zip.CreateEntry(name, CompressionLevel.Fastest).Open();
                    s.Write(png);
                    count++;
                }

                void Props(IEnumerable<WzImageProperty>? props, string dir)
                {
                    if (props == null) return;
                    foreach (var p in props)
                    {
                        var pp = dir + "/" + ZipName(p.Name);
                        if (p is WzCanvasProperty) Add(pp, p);
                        if (p is not WzUOLProperty) Props(p.WzProperties, pp);
                    }
                }

                void Image(WzImage img, string dir)
                {
                    if (!img.Parsed) img.ParseImage();
                    Props(img.WzProperties, dir);
                }

                void Dir(WzDirectory d, string dir)
                {
                    foreach (var sub in d.WzDirectories) Dir(sub, dir + "/" + ZipName(sub.Name));
                    foreach (var img in d.WzImages) Image(img, dir + "/" + ZipName(img.Name));
                }

                switch (root)
                {
                    case WzFile f: Dir(f.WzDirectory, rootName); break;
                    case WzDirectory d: Dir(d, rootName); break;
                    case WzImage img: Image(img, rootName); break;
                    case WzCanvasProperty c: Add(rootName, c); Props(c.WzProperties, rootName); break;
                    case WzImageProperty p: Props((p is WzUOLProperty ? p.GetLinkedWzImageProperty() ?? p : p).WzProperties, rootName); break;
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

    /// <summary>A tree name as a zip path segment: ".img" dropped, characters Windows can't use in file names replaced.</summary>
    private static string ZipName(string name)
    {
        if (name.EndsWith(".img", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        var chars = name.Select(c => c < 32 || "\\/:*?\"<>|".Contains(c) ? '_' : c).ToArray();
        var s = new string(chars).TrimEnd('.', ' ');
        return s.Length == 0 ? "_" : s;
    }
}
