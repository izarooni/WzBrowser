namespace WzBrowser.Api;

/// <summary>
/// The other .wz files a request read on behalf of the file it's about (String.wz for names, Npc.wz for a sprite, ...).
/// They're sent back in the <see cref="Header"/> response header so the web app can open a window for each.
/// </summary>
public static class ReadLog
{
    public const string Header = "X-Wz-Read";
    /// <summary>A modular install splits a file into many parts; past this many the rest aren't reported.</summary>
    private const int Max = 32;

    private static readonly AsyncLocal<HashSet<string>?> Current = new();

    /// <summary>Starts collecting for the current request; whatever it calls (and awaits) records into the set.</summary>
    public static HashSet<string> Begin()
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Current.Value = set;
        return set;
    }

    public static void Record(string path)
    {
        var set = Current.Value;
        if (set == null) return;
        var fullPath = Path.GetFullPath(path);
        lock (set)
            if (set.Count < Max)
                set.Add(fullPath);
    }

    /// <summary>The header's value: each path URI-escaped, comma separated. Null when nothing was read.</summary>
    public static string? Format(HashSet<string> set)
    {
        string[] paths;
        lock (set) paths = [.. set];
        return paths.Length == 0 ? null : string.Join(",", paths.Select(Uri.EscapeDataString));
    }
}
