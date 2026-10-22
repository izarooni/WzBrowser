using MapleLib.WzLib;
using MapleLib.WzLib.Util;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>
/// Resolves ids (NPC, mob, item, map, skill) to display names using the String.wz that sits next to a quest archive
/// (or, in a modular install, the parts in Data/String). These are loaded as private, read-only handles that are never
/// listed as open files, and each kind is built the first time it is asked for. Without them every lookup returns nothing.
/// </summary>
public sealed class NameIndex : IDisposable
{
    private readonly List<string> _stringWzPaths;
    private readonly object _lock = new();
    private readonly Dictionary<string, Dictionary<int, string>> _kinds = new();
    private List<WzFile>? _files;

    /// <param name="allowed">Which files may be read (a server pinned to a folder reads nothing outside it).</param>
    public NameIndex(string questWzPath, Func<string, bool> allowed)
    {
        _stringWzPaths = (WzLayout.Find(questWzPath, "String", "")?.Files ?? []).Where(allowed).ToList();
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

    private Dictionary<int, string> Kind(string kind)
    {
        if (_kinds.TryGetValue(kind, out var cached)) return cached;
        var names = new Dictionary<int, string>();
        _kinds[kind] = names; // cache even when empty so a missing String.wz isn't re-probed on every request

        foreach (var file in Open())
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

    /// <summary>The String files that could be read; a broken one is skipped rather than failing every lookup.</summary>
    private List<WzFile> Open()
    {
        if (_files != null) return _files;
        _files = [];
        foreach (var path in _stringWzPaths)
        {
            try
            {
                var version = WzTool.DetectMapleVersion(path, out var gameVersion);
                var file = new WzFile(path, gameVersion, version);
                if (file.ParseWzFile() == WzFileParseStatus.Success) _files.Add(file);
                else file.Dispose();
            }
            catch
            {
                // unreadable part: names from it just stay unresolved
            }
        }
        return _files;
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
            foreach (var f in _files ?? []) f.Dispose();
            _files = null;
            _kinds.Clear();
        }
    }
}
