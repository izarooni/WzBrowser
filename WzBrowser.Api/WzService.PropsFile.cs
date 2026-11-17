using System.Text;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

// The ".props" file an image export writes into each of its folders, so the zip can be imported back with everything
// the PNGs alone would lose: delay, origin, z, the canvas' pixel format, the other values beside the pictures, names
// a file system can't hold, and whether a folder was an .img, a sub-property, a convex or a canvas.
//
// Binary, little-endian, strings as .NET BinaryWriter writes them (7-bit encoded length, then UTF-8):
//
//   "WZBP"  byte version (1)  byte kind  string name  int format  int count  entry[count]
//
//   kind:   1 image, 2 sub, 3 convex, 4 canvas  (the folder's own node; name is its real name, format is the canvas'
//           WZ pixel format, -1 for the others)
//   entry:  byte tag  string name  payload
//     1 null      -
//     2 short     short           3 int     int          4 long     long
//     5 float     float           6 double  double       7 string   string        8 uol    string
//     9 vector    int x, int y
//    10 sub       int count, entry[count]                 (a sub-property with no pictures inside, kept whole)
//    11 convex    int count, entry[count]
//    12 canvas    int format, string png, int count, entry[count]
//                 (png: its picture, a file in this folder; its children have no pictures inside)
//    13 folder    string folder, string png
//                 (a node whose children are in that subfolder, with a .props of its own saying what it is;
//                 png is its picture beside the folder when it's a canvas, else "")
//
// Sounds, Lua scripts and raw data aren't written. Canvas links (_inlink/_outlink) aren't either: the PNG holds the
// picture they point to, and an imported picture replaces the link, as an upload does.
public sealed partial class WzService
{
    internal const string PropsFileName = ".props";
    private static readonly byte[] PropsMagic = "WZBP"u8.ToArray();
    private const byte PropsVersion = 1;

    internal enum PropsKind : byte { Image = 1, Sub = 2, Convex = 3, Canvas = 4 }

    internal enum PropsTag : byte
    {
        Null = 1, Short, Int, Long, Float, Double, String, Uol, Vector, Sub, Convex, Canvas, Folder,
    }

    /// <summary>A parsed .props file: the folder's node and its children that aren't (only) files beside it.</summary>
    internal sealed record PropsFile(PropsKind Kind, string Name, int Format, List<PropsEntry> Entries);

    /// <param name="Value">For values: the number, string or (x, y); null otherwise.</param>
    /// <param name="Children">For an inline sub, convex or canvas.</param>
    /// <param name="Png">For a canvas: its picture's file name in this folder ("" for a folder that isn't a canvas).</param>
    /// <param name="Folder">For a folder entry: the subfolder holding its children.</param>
    internal sealed record PropsEntry(PropsTag Tag, string Name, object? Value = null, int Format = -1,
        List<PropsEntry>? Children = null, string Png = "", string Folder = "");

    // ------------------------------------------------------------ writing

    private static void WritePropsHeader(BinaryWriter w, PropsKind kind, string name, int format, int count)
    {
        w.Write(PropsMagic);
        w.Write(PropsVersion);
        w.Write((byte)kind);
        w.Write(name);
        w.Write(format);
        w.Write(count);
    }

    /// <summary>Writes a property that's kept whole in the .props (no pictures inside, or a value). False for one that isn't written.</summary>
    private static bool WriteInline(BinaryWriter w, WzImageProperty p, Func<WzCanvasProperty, string>? png)
    {
        switch (p)
        {
            case WzNullProperty: Tag(PropsTag.Null); break;
            case WzShortProperty s: Tag(PropsTag.Short); w.Write(s.Value); break;
            case WzIntProperty i: Tag(PropsTag.Int); w.Write(i.Value); break;
            case WzLongProperty l: Tag(PropsTag.Long); w.Write(l.Value); break;
            case WzFloatProperty f: Tag(PropsTag.Float); w.Write(f.Value); break;
            case WzDoubleProperty d: Tag(PropsTag.Double); w.Write(d.Value); break;
            case WzStringProperty s: Tag(PropsTag.String); w.Write(s.Value ?? ""); break;
            case WzUOLProperty u: Tag(PropsTag.Uol); w.Write(u.Value ?? ""); break;
            case WzVectorProperty v: Tag(PropsTag.Vector); w.Write(v.X.Value); w.Write(v.Y.Value); break;
            case WzSubProperty sp: Tag(PropsTag.Sub); WriteChildren(sp.WzProperties); break;
            case WzConvexProperty cv: Tag(PropsTag.Convex); WriteChildren(cv.WzProperties); break;
            case WzCanvasProperty c when png != null:
                Tag(PropsTag.Canvas);
                w.Write(CanvasFormat(c));
                w.Write(png(c));
                WriteChildren(c.WzProperties);
                break;
            default: return false;
        }
        return true;

        void Tag(PropsTag tag) { w.Write((byte)tag); w.Write(p.Name); }

        // The count goes first, so write the children to a buffer to count the ones that are written.
        void WriteChildren(IEnumerable<WzImageProperty>? children)
        {
            using var buffer = new MemoryStream();
            using var inner = new BinaryWriter(buffer, Encoding.UTF8, leaveOpen: true);
            var count = 0;
            foreach (var child in children ?? [])
                if (!IsCanvasLink(child) && WriteInline(inner, child, png)) count++;
            inner.Flush();
            w.Write(count);
            w.Write(buffer.GetBuffer(), 0, (int)buffer.Length);
        }
    }

    private static void WriteFolderEntry(BinaryWriter w, string name, string folder, string png)
    {
        w.Write((byte)PropsTag.Folder);
        w.Write(name);
        w.Write(folder);
        w.Write(png);
    }

    private static bool IsCanvasLink(WzImageProperty p) =>
        p.Parent is WzCanvasProperty && p.Name is WzCanvasProperty.InlinkPropertyName or WzCanvasProperty.OutlinkPropertyName;

    // ------------------------------------------------------------ reading

    internal static PropsFile ReadProps(Stream s, string where)
    {
        try
        {
            using var r = new BinaryReader(s, Encoding.UTF8, leaveOpen: true);
            if (!r.ReadBytes(4).AsSpan().SequenceEqual(PropsMagic)) throw new InvalidDataException("it isn't a WzBrowser .props file");
            var version = r.ReadByte();
            if (version != PropsVersion) throw new InvalidDataException($"it's version {version}, newer than this server reads");
            var kind = (PropsKind)r.ReadByte();
            if (!Enum.IsDefined(kind)) throw new InvalidDataException($"unknown kind {(byte)kind}");
            var name = r.ReadString();
            var format = r.ReadInt32();
            return new PropsFile(kind, name, format, ReadEntries(r, 0));
        }
        catch (Exception ex) when (ex is EndOfStreamException or InvalidDataException or IOException or DecoderFallbackException)
        {
            throw new InvalidDataException($"'{where}' can't be read: {(ex is EndOfStreamException ? "it's cut short" : ex.Message)}.");
        }
    }

    private static List<PropsEntry> ReadEntries(BinaryReader r, int depth)
    {
        if (depth > 64) throw new InvalidDataException("it nests too deeply");
        var count = r.ReadInt32();
        if (count < 0 || count > 1_000_000) throw new InvalidDataException($"it claims {count} entries");
        var list = new List<PropsEntry>(Math.Min(count, 1024));
        for (var i = 0; i < count; i++)
        {
            var tag = (PropsTag)r.ReadByte();
            var name = r.ReadString();
            list.Add(tag switch
            {
                PropsTag.Null => new PropsEntry(tag, name),
                PropsTag.Short => new PropsEntry(tag, name, r.ReadInt16()),
                PropsTag.Int => new PropsEntry(tag, name, r.ReadInt32()),
                PropsTag.Long => new PropsEntry(tag, name, r.ReadInt64()),
                PropsTag.Float => new PropsEntry(tag, name, r.ReadSingle()),
                PropsTag.Double => new PropsEntry(tag, name, r.ReadDouble()),
                PropsTag.String or PropsTag.Uol => new PropsEntry(tag, name, r.ReadString()),
                PropsTag.Vector => new PropsEntry(tag, name, (r.ReadInt32(), r.ReadInt32())),
                PropsTag.Sub or PropsTag.Convex => new PropsEntry(tag, name, Children: ReadEntries(r, depth + 1)),
                PropsTag.Canvas => ReadCanvas(r, tag, name, depth),
                PropsTag.Folder => new PropsEntry(tag, name, Folder: r.ReadString(), Png: r.ReadString()),
                _ => throw new InvalidDataException($"unknown entry type {(byte)tag}"),
            });
        }
        return list;
    }

    private static PropsEntry ReadCanvas(BinaryReader r, PropsTag tag, string name, int depth)
    {
        var format = r.ReadInt32();
        var png = r.ReadString();
        return new PropsEntry(tag, name, Format: format, Png: png, Children: ReadEntries(r, depth + 1));
    }
}
