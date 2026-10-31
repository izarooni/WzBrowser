using System.Drawing;
using System.Drawing.Imaging;
using System.IO.Compression;
using System.Runtime.InteropServices;
using MapleLib.Helpers;
using MapleLib.WzLib.WzProperties;
using Microsoft.Xna.Framework.Graphics;

namespace WzBrowser.Api;

// Replacing a canvas' picture with an uploaded image, in a pixel format the caller picks.
//
// Upload qualities (the `quality` value of PUT /api/files/{id}/png; the web app's list is lib/image-quality.ts):
//
//   value      WZ format  pixel layout                      what is lost                         clients
//   ---------  ---------  --------------------------------  -----------------------------------  ----------------
//   bgra8888   2          32-bit B,G,R,A, 8 bits each       nothing (exact)                      all
//              (default; "lossless" is accepted too. Largest: 4 bytes per pixel before zlib.)
//   argb4444   1          16-bit, 4 bits per channel        colour and alpha rounded to 16       all
//                                                           levels (up to +-8 of 255)
//              (the classic sprite format; most pre-Big Bang sprites are stored this way)
//   argb1555   257        16-bit, 5 bits per colour,        colour to 32 levels (+-4); alpha     all
//                         1 alpha bit                       becomes on/off (solid at >= 128)
//   rgb565     513        16-bit, 5/6/5 bits R/G/B          colour to 32/64 levels (+-4);        all
//                                                           all transparency (for backgrounds)
//   dxt3       1026       4x4 blocks: 2 colours + 4-bit     colour quantised per block (on a     Big Bang+ only
//                         alpha per pixel                   gradient up to ~42 of 255); alpha to
//                                                           16 levels
//   dxt5       2050       4x4 blocks: 2 colours +           colour as DXT3; alpha interpolated   Big Bang+ only
//                         interpolated alpha                (better for smooth fades)
//   keep       -          the canvas' current format        as for that format                   as before
//              (the block formats 517 and 1537 are written as 513 and greyscale DXT3 (3) as 1026;
//              BC7 (4098) can't be written, so it becomes 2)
//
// DXT images are padded with transparent pixels to a multiple of 4 on each side; the origin is measured from the
// top-left, so the sprite stays in place in game but the canvas grows by up to 3 pixels each way.
//
// MapleLib's own choice (setting WzPngProperty.PNG) is never used: it picks a format from the pixels, often a lossy
// one, DXT (unreadable by pre-Big Bang clients unless ImageFormatDetector.UsePreBigBangImageFormats is set), or 517,
// which keeps one colour per 16x16 block and ruins anything that isn't a flat background.
public sealed partial class WzService
{
    /// <summary>
    /// Replaces a canvas' picture with an uploaded image (PNG, JPEG, BMP, GIF; the first frame of an animated one).
    /// The canvas' children (origin, delay, ...) are kept, but an _inlink/_outlink is removed, since it would
    /// otherwise still be shown instead of the new picture. In memory only, like every other edit.
    /// </summary>
    /// <param name="quality">The pixel format to store: bgra8888 (lossless, the default), argb4444, argb1555, rgb565,
    /// dxt3, dxt5, or keep (the canvas' current one). See the table at the top of this file for what each loses.</param>
    public NodeEditResult SetPng(string id, string path, byte[] imageBytes, string? quality)
    {
        var image = DecodeImage(imageBytes);
        var entry = Get(id);
        lock (entry.Lock)
        {
            path = Normalize(path);
            if (Resolve(entry.File, path) is not WzCanvasProperty canvas)
                throw new InvalidDataException("Only a canvas property can take an image.");
            if (canvas.PngProperty == null) throw new InvalidDataException("This canvas has no image data to replace.");

            var format = quality?.Trim().ToLowerInvariant() switch
            {
                null or "" or "lossless" => WzPngFormat.Format2,
                "keep" => Writable(canvas.PngProperty.Format),
                var key => FormatFromKey(key) is { } f && Writable(f) == f ? f
                    : throw new ArgumentException($"Unknown image quality '{quality}'."),
            };

            // DXT works on 4x4 blocks. Transparent padding on the right and bottom keeps the sprite where it was,
            // since the origin is measured from the top-left.
            if (format is WzPngFormat.Format1026 or WzPngFormat.Format2050) image = PadTo4(image);
            canvas.PngProperty.SetCompressedBytes(Encode(image, format), image.Width, image.Height, format);
            foreach (var link in new[] { WzCanvasProperty.InlinkPropertyName, WzCanvasProperty.OutlinkPropertyName })
                canvas[link]?.Remove();

            MarkChanged(canvas);
            Touch(entry);
            return new NodeEditResult(path, Describe(canvas), Describe(id, entry));
        }
    }

    /// <summary>The name the API and web app use for a canvas' pixel format.</summary>
    internal static string FormatKey(WzPngFormat format) => format switch
    {
        WzPngFormat.Format1 => "argb4444",
        WzPngFormat.Format2 => "bgra8888",
        WzPngFormat.Format3 => "dxt3-gray",
        WzPngFormat.Format257 => "argb1555",
        WzPngFormat.Format513 => "rgb565",
        WzPngFormat.Format517 or (WzPngFormat)BlockRgb565Format => "rgb565-block",
        WzPngFormat.Format1026 => "dxt3",
        WzPngFormat.Format2050 => "dxt5",
        WzPngFormat.Format4098 => "bc7",
        _ => ((int)format).ToString(),
    };

    private static WzPngFormat? FormatFromKey(string key) =>
        Enum.GetValues<WzPngFormat>().Cast<WzPngFormat?>().FirstOrDefault(f => FormatKey(f!.Value) == key);

    /// <summary>The closest format this server can write: the block and grey variants map to their plain ones, BC7 to lossless.</summary>
    private static WzPngFormat Writable(WzPngFormat format) => format switch
    {
        WzPngFormat.Format1 or WzPngFormat.Format2 or WzPngFormat.Format257 or WzPngFormat.Format513
            or WzPngFormat.Format1026 or WzPngFormat.Format2050 => format,
        WzPngFormat.Format517 or (WzPngFormat)BlockRgb565Format => WzPngFormat.Format513,
        WzPngFormat.Format3 => WzPngFormat.Format1026,
        _ => WzPngFormat.Format2,
    };

    /// <summary>An image's pixels as BGRA, 4 bytes per pixel, rows without padding (Format32bppArgb's memory layout).</summary>
    private sealed record Pixels(int Width, int Height, byte[] Bgra);

    private static Pixels DecodeImage(byte[] bytes)
    {
        if (bytes.Length == 0) throw new ArgumentException("No image was uploaded.");
        Image source;
        try { source = Image.FromStream(new MemoryStream(bytes)); }
        catch (ArgumentException) { throw new InvalidDataException("That file isn't an image this server can read (use PNG, JPEG, BMP or GIF)."); }
        using (source)
        {
            if (source is not Bitmap bitmap) throw new InvalidDataException("That file isn't a picture made of pixels.");
            if (bitmap.Width > 8192 || bitmap.Height > 8192)
                throw new InvalidDataException($"The image is {bitmap.Width}x{bitmap.Height}; at most 8192x8192 is allowed.");
            // Read the pixels directly rather than drawing onto a new bitmap: GDI+ draws through premultiplied alpha,
            // which rounds off the colour of semi-transparent pixels.
            var rowBytes = bitmap.Width * 4;
            var bgra = new byte[rowBytes * bitmap.Height];
            var data = bitmap.LockBits(new Rectangle(0, 0, bitmap.Width, bitmap.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                for (var y = 0; y < bitmap.Height; y++)
                    Marshal.Copy(data.Scan0 + y * data.Stride, bgra, y * rowBytes, rowBytes);
            }
            finally { bitmap.UnlockBits(data); }
            return new Pixels(bitmap.Width, bitmap.Height, bgra);
        }
    }

    /// <summary>The image grown to multiples of 4 on each side, with transparent pixels.</summary>
    private static Pixels PadTo4(Pixels image)
    {
        int w = (image.Width + 3) & ~3, h = (image.Height + 3) & ~3;
        if (w == image.Width && h == image.Height) return image;
        var bgra = new byte[w * h * 4];
        for (var y = 0; y < image.Height; y++)
            Buffer.BlockCopy(image.Bgra, y * image.Width * 4, bgra, y * w * 4, image.Width * 4);
        return new Pixels(w, h, bgra);
    }

    /// <summary>The canvas data for <paramref name="format"/>: the packed pixels, zlib-compressed.</summary>
    private static byte[] Encode(Pixels image, WzPngFormat format)
    {
        // Scale an 8-bit channel to `max` levels, rounding to the nearest.
        static int Q(byte v, int max) => (v * max + 127) / 255;

        var raw = format switch
        {
            WzPngFormat.Format2 => image.Bgra,
            WzPngFormat.Format1 => Pack16(image, (b, g, r, a) => Q(b, 15) | Q(g, 15) << 4 | Q(r, 15) << 8 | Q(a, 15) << 12),
            WzPngFormat.Format257 => Pack16(image, (b, g, r, a) => Q(b, 31) | Q(g, 31) << 5 | Q(r, 31) << 10 | (a >= 128 ? 0x8000 : 0)),
            WzPngFormat.Format513 => Pack16(image, (b, g, r, _) => Q(b, 31) | Q(g, 63) << 5 | Q(r, 31) << 11),
            WzPngFormat.Format1026 or WzPngFormat.Format2050 => Dxt(image, format),
            _ => throw new ArgumentException($"Can't write format {format}."),
        };

        using var ms = new MemoryStream();
        using (var z = new ZLibStream(ms, CompressionLevel.Optimal, leaveOpen: true)) z.Write(raw);
        return ms.ToArray();
    }

    /// <summary>One little-endian 16-bit value per pixel.</summary>
    private static byte[] Pack16(Pixels image, Func<byte, byte, byte, byte, int> pack)
    {
        var src = image.Bgra;
        var dst = new byte[src.Length / 2];
        for (int i = 0, o = 0; i < src.Length; i += 4, o += 2)
        {
            var v = pack(src[i], src[i + 1], src[i + 2], src[i + 3]);
            dst[o] = (byte)v;
            dst[o + 1] = (byte)(v >> 8);
        }
        return dst;
    }

    /// <summary>DXT3 (1026) or DXT5 (2050) blocks, from MapleLib's encoder.</summary>
    private static byte[] Dxt(Pixels image, WzPngFormat format)
    {
        using var bitmap = new Bitmap(image.Width, image.Height, PixelFormat.Format32bppArgb);
        var data = bitmap.LockBits(new Rectangle(0, 0, image.Width, image.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try
        {
            var rowBytes = image.Width * 4;
            for (var y = 0; y < image.Height; y++)
                Marshal.Copy(image.Bgra, y * rowBytes, data.Scan0 + y * data.Stride, rowBytes);
        }
        finally { bitmap.UnlockBits(data); }

        var (written, bytes) = PngUtility.CompressImageToPngFormat(bitmap,
            format == WzPngFormat.Format2050 ? SurfaceFormat.Dxt5 : SurfaceFormat.Dxt3, isGrayscale: false);
        if (written != format) throw new InvalidOperationException($"MapleLib wrote {written} instead of {format}.");
        return bytes;
    }
}
