using MapleLib.WzLib;
using MapleLib.WzLib.Util;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>
/// Resolves ids (NPC, mob, item, map, skill) to display names using the String.wz that sits next to a quest archive
/// (or, in a modular install, the parts in Data/String). Each kind is built the first time it is asked for, from
/// private, read-only handles that are let go of straight after, so String.wz isn't held once its window is closed.
/// When the String files on disk change (replaced, added, removed), every kind is read again on its next lookup.
/// Without them every lookup returns nothing.
/// </summary>
public sealed class NameIndex
{
    /// <summary>How long a check of the String files on disk holds before they're looked at again.</summary>
    private static readonly TimeSpan RecheckAfter = TimeSpan.FromSeconds(2);

    private readonly string _questWzPath;
    private readonly Func<string, bool> _allowed;
    private readonly object _lock = new();
    private readonly Dictionary<string, Dictionary<int, string>> _kinds = new();
    private List<string> _stringWzPaths = [];
    /// <summary>Each String file's path, write time and size when the kinds were read.</summary>
    private string _stamp = "";
    private DateTime _checkedAt = DateTime.MinValue;

    /// <param name="allowed">Which files may be read (a server pinned to a folder reads nothing outside it).</param>
    public NameIndex(string questWzPath, Func<string, bool> allowed)
    {
        _questWzPath = questWzPath;
        _allowed = allowed;
    }

    public Dictionary<int, string> Resolve(string kind, IEnumerable<int> ids)
    {
        var result = new Dictionary<int, string>();
        lock (_lock)
        {
            var names = Kind(kind);
            foreach (var id in ids)
                if (names.TryGetValue(id, out var name)) result[id] = name;
        }
        return result;
    }

    /// <summary>The entries whose id or name contains the text, by id.</summary>
    public List<KeyValuePair<int, string>> Search(string kind, string text, int limit)
    {
        lock (_lock)
            return Kind(kind)
                .Where(Matches)
                .OrderBy(entry => entry.Key)
                .Take(limit)
                .ToList();

        bool Matches(KeyValuePair<int, string> entry) =>
            entry.Value.Contains(text, StringComparison.OrdinalIgnoreCase)
            || entry.Key.ToString("D7").Contains(text);
    }

    private Dictionary<int, string> Kind(string kind)
    {
        ForgetWhenChanged();
        if (_kinds.TryGetValue(kind, out var cached)) return cached;
        var names = new Dictionary<int, string>();
        _kinds[kind] = names; // cache even when empty so a missing String.wz isn't re-probed on every request

        var files = Open();
        try
        {
            foreach (var file in files)
                CollectKind(file, kind, names);
        }
        finally
        {
            foreach (var file in files) file.Dispose();
        }
        return names;
    }

    /// <summary>Drops every kind read when the String files on disk have changed since, so they're read again.</summary>
    private void ForgetWhenChanged()
    {
        var now = DateTime.UtcNow;
        if (now - _checkedAt < RecheckAfter) return;
        _checkedAt = now;

        var paths = (WzLayout.Find(_questWzPath, "String", "")?.Files ?? []).Where(_allowed).ToList();
        var stamp = string.Join("|", paths.Select(StampOf));
        if (stamp == _stamp) return;
        _stamp = stamp;
        _stringWzPaths = paths;
        _kinds.Clear();
    }

    private static string StampOf(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists) return path;
        return $"{path}:{info.LastWriteTimeUtc.Ticks}:{info.Length}";
    }

    private static void CollectKind(WzFile file, string kind, Dictionary<int, string> names)
    {
        switch (kind)
        {
            case "npc": Collect(file, "Npc.img", names); break;
            case "mob": Collect(file, "Mob.img", names); break;
            case "skill": Collect(file, "Skill.img", names); break;
            case "map": Collect(file, "Map.img", names, isMap: true); break;
            case "item":
                // Equipment is grouped by category (Eqp.img/Eqp/Cap/...), so Collect recurses through non-numeric nodes.
                foreach (var img in new[] { "Eqp.img", "Consume.img", "Ins.img", "Etc.img", "Cash.img" })
                    Collect(file, img, names);
                break;
        }
    }

    /// <summary>The String files that could be read; a broken one is skipped rather than failing every lookup.</summary>
    private List<WzFile> Open()
    {
        var files = new List<WzFile>();
        foreach (var path in _stringWzPaths)
        {
            try
            {
                var version = WzTool.DetectMapleVersion(path, out var gameVersion);
                var file = new WzFile(path, gameVersion, version);
                if (file.ParseWzFile() == WzFileParseStatus.Success)
                {
                    files.Add(file);
                    ReadLog.Record(path);
                }
                else file.Dispose();
            }
            catch
            {
                // unreadable part: names from it just stay unresolved
            }
        }
        return files;
    }

    private static void Collect(WzFile file, string imageName, Dictionary<int, string> into, bool isMap = false)
    {
        var image = file.WzDirectory.GetImageByName(imageName);
        if (image == null) return;
        Walk(image.WzProperties, into, isMap);
    }

    /// <summary>
    /// Numeric children are entries (id -> name); anything else is a grouping level (region, equipment category)
    /// that gets searched too.
    /// </summary>
    private static void Walk(IEnumerable<WzImageProperty> nodes, Dictionary<int, string> into, bool isMap)
    {
        foreach (var node in nodes)
        {
            if (int.TryParse(node.Name, out var id))
            {
                var name = isMap ? MapName(node) : (node["name"] as WzStringProperty)?.Value;
                if (!string.IsNullOrEmpty(name)) into[id] = name;
            }
            else if (node.WzProperties is { Count: > 0 } children)
            {
                Walk(children, into, isMap);
            }
        }
    }

    private static string? MapName(WzImageProperty node)
    {
        var street = (node["streetName"] as WzStringProperty)?.Value;
        var name = (node["mapName"] as WzStringProperty)?.Value;
        if (string.IsNullOrEmpty(name)) return street;
        return string.IsNullOrEmpty(street) ? name : $"{street} : {name}";
    }
}
