namespace WzBrowser.Api;

/// <summary>
/// Finds the files next to an archive in either install layout: classic, with the .wz files side by side
/// (Quest.wz, String.wz, Map.wz), or modular, with one folder per file split into parts and nested by directory
/// (Data/String/String_000.wz, Data/Map/Map/Map1/Map1_000.wz).
/// </summary>
internal static class WzLayout
{
    /// <summary>
    /// The files holding what a classic install keeps at <c>{top}.wz/{path}</c>, and the path left to resolve inside them.
    /// Classic: the file next to the archive and the whole path. Modular: the parts of the deepest folder the path's
    /// directories lead to, and the rest ("Map", "Map/Map1" -> Data/Map/Map/Map1/Map1_*.wz and "").
    /// </summary>
    public static (List<string> Files, string Path)? Find(string archivePath, string top, string path)
    {
        var classic = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(archivePath)!, top + ".wz");
        // In a modular install the archive can sit beside its own index stub (Data/Npc/Npc.wz next to Npc_000.wz).
        if (File.Exists(classic) && !File.Exists(System.IO.Path.ChangeExtension(classic, null) + "_000.wz")) return ([classic], path);
        if (DataRoot(archivePath) is not { } root) return null;

        var dir = System.IO.Path.Combine(root, top);
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var i = 0;
        while (i < segments.Length && !segments[i].EndsWith(".img", StringComparison.OrdinalIgnoreCase)
               && Directory.Exists(System.IO.Path.Combine(dir, segments[i])))
            dir = System.IO.Path.Combine(dir, segments[i++]);

        var parts = Parts(dir);
        return parts.Count == 0 ? null : (parts, string.Join('/', segments[i..]));
    }

    /// <summary>The folders below Data/{top} that hold parts (e.g. Character's Cap, Coat, ...); none in a classic install.</summary>
    public static List<string> Subfolders(string archivePath, string top)
    {
        var classic = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(archivePath)!, top + ".wz");
        if (File.Exists(classic) || DataRoot(archivePath) is not { } root) return [];
        var dir = System.IO.Path.Combine(root, top);
        if (!Directory.Exists(dir)) return [];
        return Directory.EnumerateDirectories(dir).Where(d => Parts(d).Count > 0)
            .Select(d => System.IO.Path.GetFileName(d)).Order(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>The Data folder of a modular install (the one holding String/String.ini), found by walking up from the archive.</summary>
    private static string? DataRoot(string archivePath)
    {
        for (var d = System.IO.Path.GetDirectoryName(archivePath); d != null; d = System.IO.Path.GetDirectoryName(d))
            if (File.Exists(System.IO.Path.Combine(d, "String", "String.ini"))) return d;
        return null;
    }

    /// <summary>A modular folder's data files ({name}_000.wz, {name}_001.wz, ...), without the {name}.wz index stub.</summary>
    private static List<string> Parts(string dir)
    {
        if (!Directory.Exists(dir)) return [];
        var name = System.IO.Path.GetFileName(dir);
        return Directory.EnumerateFiles(dir, name + "_*.wz")
            .Where(f => System.IO.Path.GetFileNameWithoutExtension(f)[(name.Length + 1)..] is { Length: > 0 } n && n.All(char.IsAsciiDigit))
            .Order(StringComparer.OrdinalIgnoreCase).ToList();
    }
}
