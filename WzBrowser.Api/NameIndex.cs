using MapleLib.WzLib;
using MapleLib.WzLib.Util;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>
/// Resolves ids (NPC, mob, item, map, skill) to display names using the String.wz that sits next to a quest archive.
/// String.wz is loaded as a private, read-only handle that is never listed as an open file, and each kind is built
/// the first time it is asked for. When there is no String.wz every lookup just returns nothing.
/// </summary>
public sealed class NameIndex : IDisposable
{
    private readonly string _stringWzPath;
    private readonly object _lock = new();
    private readonly Dictionary<string, Dictionary<int, string>> _kinds = new();
    private WzFile? _file;
    private bool _loadAttempted;

    public NameIndex(string questWzPath)
    {
        _stringWzPath = Path.Combine(Path.GetDirectoryName(questWzPath) ?? "", "String.wz");
    }

    public bool Available => File.Exists(_stringWzPath);

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

    private Dictionary<int, string> Kind(string kind)
    {
        if (_kinds.TryGetValue(kind, out var cached)) return cached;
        var names = new Dictionary<int, string>();
        _kinds[kind] = names; // cache even when empty so a missing String.wz isn't re-probed on every request

        var file = Open();
        if (file == null) return names;

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
        return names;
    }

    private WzFile? Open()
    {
        if (_file != null || _loadAttempted) return _file;
        _loadAttempted = true;
        if (!Available) return null;
        try
        {
            var version = WzTool.DetectMapleVersion(_stringWzPath, out var gameVersion);
            var file = new WzFile(_stringWzPath, gameVersion, version);
            if (file.ParseWzFile() != WzFileParseStatus.Success) { file.Dispose(); return null; }
            return _file = file;
        }
        catch
        {
            return null;
        }
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

    public void Dispose()
    {
        lock (_lock)
        {
            _file?.Dispose();
            _file = null;
            _kinds.Clear();
        }
    }
}
