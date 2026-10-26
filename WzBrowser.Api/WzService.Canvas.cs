using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO.Compression;
using MapleLib.Helpers;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public sealed partial class WzService
{
    /// <summary>
    /// A newer client format MapleLib doesn't know: RGB565 with one pixel per 16x16 block, like 517 but tagged 1537
    /// (e.g. Map/Back/back_dryRock.img/back/0, a flat sky colour).
    /// </summary>
    private const int BlockRgb565Format = 1537;

    /// <summary>
    /// Read-only handles on the _Canvas parts that _outlinks point into, by path, opened the first time one is needed and
    /// shared by every file that links there. Null when the part couldn't be read.
    /// </summary>
    private readonly ConcurrentDictionary<string, CanvasPart> _canvasParts = new(StringComparer.OrdinalIgnoreCase);

    private sealed class CanvasPart(WzFile? file)
    {
        public WzFile? File { get; } = file;
        // Like opened files, a part parses lazily and isn't thread safe.
        public object Lock { get; } = new();
    }

    /// <summary>PNG bytes of a canvas property (following _inlink/_outlink and UOLs), or null if it isn't one.</summary>
    private byte[]? RenderCanvas(Entry entry, WzImageProperty prop) => RenderCanvas(entry.Path, entry.Encryption, prop);

    /// <param name="source">The file the property is in, which _outlinks are resolved from.</param>
    /// <param name="encryption">How that file is encrypted; its _Canvas parts are the same.</param>
    private byte[]? RenderCanvas(string source, string encryption, WzImageProperty prop)
    {
        var canvas = prop as WzCanvasProperty ?? prop.GetLinkedWzImageProperty() as WzCanvasProperty;
        if (canvas == null) return null;

        // A modular install keeps the pixels apart from the data: the canvas here is a 1x1 stub whose _outlink
        // ("Map/Back/_Canvas/back_dryRock.img/back/0") names the real one in Data/Map/Back/_Canvas/_Canvas_*.wz.
        var linked = canvas.GetLinkedWzImageProperty() as WzCanvasProperty ?? canvas;
        if (ReferenceEquals(linked, canvas) && canvas[WzCanvasProperty.OutlinkPropertyName]?.GetString() is { Length: > 0 } outlink)
            return RenderOutlink(source, encryption, outlink) ?? Encode(canvas);
        return Encode(linked);
    }

    private byte[]? RenderOutlink(string source, string encryption, string outlink)
    {
        var slash = outlink.IndexOf('/');
        if (slash <= 0 || WzLayout.Find(source, outlink[..slash], outlink[(slash + 1)..]) is not { } found) return null;

        foreach (var path in found.Files.Where(InRoot))
        {
            var part = _canvasParts.GetOrAdd(path, p => new CanvasPart(OpenCanvasPart(p, encryption)));
            if (part.File == null) continue;
            lock (part.Lock)
            {
                object? target;
                try { target = Resolve(part.File, found.Path); }
                catch (KeyNotFoundException) { continue; } // the image is in another part
                if (target is WzCanvasProperty canvas)
                    return Encode(canvas.GetLinkedWzImageProperty() as WzCanvasProperty ?? canvas);
            }
        }
        return null;
    }

    private static WzFile? OpenCanvasPart(string path, string encryption)
    {
        try
        {
            var file = new WzFile(path, -1, Enum.Parse<WzMapleVersion>(encryption));
            if (file.ParseWzFile() == WzFileParseStatus.Success) return file;
            file.Dispose();
        }
        catch
        {
            // unreadable part: images linking into it fall back to their stub
        }
        return null;
    }

    private static byte[]? Encode(WzCanvasProperty canvas)
    {
        using var bitmap = canvas.PngProperty is { Format: (WzPngFormat)BlockRgb565Format } png ? DecodeBlockRgb565(png) : canvas.GetBitmap();
        if (bitmap == null) return null;
        using var ms = new MemoryStream();
        bitmap.Save(ms, ImageFormat.Png);
        return ms.ToArray();
    }

    private static Bitmap DecodeBlockRgb565(WzPngProperty png)
    {
        int width = png.Width, height = png.Height;
        var raw = new byte[(width + 15) / 16 * ((height + 15) / 16) * 2];
        using (var inflate = new ZLibStream(new MemoryStream(png.GetCompressedBytes(false)), CompressionMode.Decompress))
            inflate.ReadExactly(raw);

        var bitmap = new Bitmap(width, height, PixelFormat.Format16bppRgb565);
        var data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format16bppRgb565);
        try { PngUtility.DecompressImage_PixelDataForm517(raw, width, height, bitmap, data); }
        finally { bitmap.UnlockBits(data); }
        return bitmap;
    }
}
