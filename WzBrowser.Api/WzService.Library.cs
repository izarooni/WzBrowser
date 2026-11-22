using MapleLib.WzLib;
using MapleLib.WzLib.MSFile;
using MapleLib.WzLib.Util;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>
/// Reading the library's files for its tables (Mobs, Maps, Items, ...): finding them, opening them, reading values.
/// </summary>
public sealed partial class WzService
{
    private static string? Text(WzImageProperty? property) => property switch
    {
        WzStringProperty text => text.Value,
        WzIntProperty number => number.Value.ToString(),
        WzShortProperty number => number.Value.ToString(),
        WzLongProperty number => number.Value.ToString(),
        _ => null,
    };

    private static int? Int(WzImageProperty? property) => int.TryParse(Text(property), out var number) ? number : null;

    /// <summary>
    /// Files named {top}.wz, {top}_000.wz, ... under the library, without a modular folder's index stub.
    /// </summary>
    private IEnumerable<string> LibraryParts(string top, string extension) =>
        Directory.EnumerateFiles(Root!, top + "*" + extension, LibrarySearch)
            .Where(path => IsLibraryPart(path, top))
            .Order(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// {top}.wz itself, unless it's a modular folder's index stub, or one of the numbered parts {top}_000.wz,
    /// {top}_001.wz, ...
    /// </summary>
    private static bool IsLibraryPart(string path, string top)
    {
        var name = System.IO.Path.GetFileNameWithoutExtension(path);
        if (name == top) return !IsIndexStub(path);
        if (!name.StartsWith(top + "_")) return false;
        var digits = name[(top.Length + 1)..];
        return digits.Length > 0 && digits.All(char.IsAsciiDigit);
    }

    /// <summary>
    /// Every readable part of {top} in the library: {top}.wz, its modular parts, then any Data/Packs/{top}_*.ms pack.
    /// </summary>
    private IEnumerable<(WzFile File, string Source, string Encryption)> OpenSources(string top)
    {
        foreach (var path in LibraryParts(top, ".wz"))
            if (OpenReadOnly(path) is { } wz)
                yield return wz;
        // Newer installs pack some data into Data/Packs/{top}_00000.ms (always BMS), with the pictures in
        // Data/{top}/_Canvas.
        foreach (var path in LibraryParts(top, ".ms"))
            if (OpenPack(path) is { } file)
                yield return (file, path, nameof(WzMapleVersion.BMS));
    }

    private static WzFile? OpenPack(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            return new WzMsFile(stream, System.IO.Path.GetFileName(path), path).LoadAsWzFile();
        }
        catch
        {
            // unreadable pack: what it holds is just missing
            return null;
        }
    }

    /// <summary>One of String's images (Mob.img, Eqp.img, ...), or null when the library has none.</summary>
    private WzImage? OpenStrings(string image)
    {
        foreach (var path in LibraryParts("String", ".wz"))
        {
            if (OpenReadOnly(path) is not { } strings) continue;
            if (strings.File.WzDirectory.GetImageByName(image) is { } found) return found;
            strings.File.Dispose();
        }
        return null;
    }

    private static (WzFile File, string Source, string Encryption)? OpenReadOnly(string path)
    {
        try
        {
            var version = WzTool.DetectMapleVersion(path, out var gameVersion);
            var file = new WzFile(path, gameVersion, version);
            if (file.ParseWzFile() == WzFileParseStatus.Success)
            {
                ReadLog.Record(path);
                return (file, path, version.ToString());
            }
            file.Dispose();
        }
        catch
        {
            // unreadable part: skipped
        }
        return null;
    }
}
