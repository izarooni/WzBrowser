using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public record RefOpenRequest(string Kind, int Id);
public record RefOpenResult(OpenedFileDto File, string Path);

/// <summary>
/// Turns "item 1042003", "npc 2100", ... into the node that holds it in the neighbouring WZ files
/// (Character.wz, Item.wz, Npc.wz, Mob.wz, Map.wz, Skill.wz), opening them in the background when needed.
/// </summary>
public sealed partial class WzService
{
    private sealed record RefLoc(string FileId, string Path);

    /// <summary>
    /// Opens (if needed) the file holding the referenced node and makes it a visible, normal open file.
    /// Returns the node's path inside that file so the client can reveal it.
    /// </summary>
    public RefOpenResult OpenRef(string questId, RefOpenRequest req)
    {
        var loc = LocateRef(questId, req.Kind, req.Id)
            ?? throw new KeyNotFoundException($"{req.Kind} {req.Id} wasn't found in the WZ files next to this archive.");
        var entry = Get(loc.FileId);
        entry.Hidden = false;
        return new RefOpenResult(Describe(loc.FileId, entry), loc.Path);
    }

    /// <summary>A small picture for the referenced thing (icon, standing sprite, minimap), or null if there is none.</summary>
    public byte[]? RefPreview(string questId, string kind, int id)
    {
        var loc = LocateRef(questId, kind, id);
        if (loc == null) return null;
        var entry = Get(loc.FileId);
        lock (entry.Lock)
        {
            var node = Resolve(entry.File, loc.Path);
            WzImageProperty? Sub(string rel) => node switch
            {
                WzImage img => img.GetFromPath(rel),
                WzImageProperty p => (p.GetLinkedWzImageProperty() ?? p).GetFromPath(rel),
                _ => null,
            };

            var candidates = kind switch
            {
                "item" => new[] { "info/icon", "info/iconRaw" },
                "skill" => new[] { "icon", "iconMouseOver" },
                "map" => new[] { "miniMap/canvas" },
                _ => new[] { "stand/0", "stand", "move/0", "move", "fly/0", "default/0", "info/icon" },
            };
            foreach (var rel in candidates)
            {
                var prop = Sub(rel);
                if (prop != null && FirstCanvas(prop) is { } canvas && RenderCanvas(canvas) is { } png) return png;
            }
            // A map without a minimap has no sensible single picture; everything else falls back to any canvas below it.
            IEnumerable<WzImageProperty>? below = node switch { WzImage i => i.WzProperties, WzImageProperty p => p.WzProperties, _ => null };
            if (kind != "map" && below != null && FirstCanvas(below) is { } any) return RenderCanvas(any);
            return null;
        }
    }

    // ------------------------------------------------------------------ locating

    private RefLoc? LocateRef(string questId, string kind, int id)
    {
        var quest = GetLinkingArchive(questId);
        var dir = System.IO.Path.GetDirectoryName(quest.Path)!;

        switch (kind)
        {
            case "npc":
                return InSibling(dir, "Npc.wz", (e, root) => Img(root, $"{id}.img", $"{id:D7}.img") is { } img ? img.Name : null);
            case "mob":
                return InSibling(dir, "Mob.wz", (e, root) => Img(root, $"{id:D7}.img", $"{id}.img") is { } img ? img.Name : null);
            case "map":
                return InSibling(dir, "Map.wz", (e, root) =>
                    root.GetDirectoryByName("Map")?.GetDirectoryByName($"Map{id / 100000000}") is { } d
                    && Img(d, $"{id:D9}.img") is { } img ? $"Map/{d.Name}/{img.Name}" : null);
            case "skill":
                return InSibling(dir, "Skill.wz", (e, root) =>
                {
                    var img = Img(root, $"{id / 10000}.img", $"{id / 10000:D3}.img");
                    return img == null ? null : $"{img.Name}/skill/{id}";
                });
            case "item" when id / 1000000 == 1:
                return InSibling(dir, "Character.wz", (e, root) =>
                    (e.EquipIndex ??= BuildEquipIndex(root)).TryGetValue(id, out var p) ? p : null);
            case "item":
                return InSibling(dir, "Item.wz", (e, root) => LocateItem(root, id));
            default:
                return null;
        }
    }

    /// <summary>Opens `fileName` next to the quest archive (hidden if it isn't open yet) and runs the finder against it.</summary>
    private RefLoc? InSibling(string dir, string fileName, Func<Entry, WzDirectory, string?> find)
    {
        var path = System.IO.Path.Combine(dir, fileName);
        if (!File.Exists(path)) return null;

        OpenedFileDto dto;
        try { dto = Open(path, null, hidden: true); }
        catch { return null; }

        var entry = Get(dto.Id);
        lock (entry.Lock)
        {
            var found = find(entry, entry.File.WzDirectory);
            return found == null ? null : new RefLoc(dto.Id, found);
        }
    }

    private static WzImage? Img(WzDirectory dir, params string[] names)
    {
        foreach (var n in names)
            if (dir.GetImageByName(n) is { } img) return img;
        return null;
    }

    /// <summary>Item.wz groups by category (Consume/Install/Etc/Cash), then by the first four digits of the id.</summary>
    private static string? LocateItem(WzDirectory root, int id)
    {
        var category = (id / 1000000) switch { 2 => "Consume", 3 => "Install", 4 => "Etc", 5 => "Cash", _ => null };
        if (category == null) return null;
        var node = $"{id:D8}";

        if (root.GetDirectoryByName(category) is { } dir && Img(dir, $"{id / 10000:D4}.img") is { } img && img[node] != null)
            return $"{category}/{img.Name}/{node}";

        // Pets live in Pet/<id>.img rather than in the Cash groups.
        if (root.GetDirectoryByName("Pet") is { } pets && Img(pets, $"{id}.img") is { } pet)
            return $"Pet/{pet.Name}";
        return null;
    }

    /// <summary>Equipment images are named by full id ("01002008.img") and spread over category folders.</summary>
    private static Dictionary<int, string> BuildEquipIndex(WzDirectory root)
    {
        var index = new Dictionary<int, string>();
        void Add(WzDirectory d, string prefix)
        {
            foreach (var img in d.WzImages)
                if (int.TryParse(System.IO.Path.GetFileNameWithoutExtension(img.Name), out var id))
                    index[id] = prefix + img.Name;
            foreach (var sub in d.WzDirectories) Add(sub, prefix + sub.Name + "/");
        }
        Add(root, "");
        return index;
    }

    // ------------------------------------------------------------------ images

    /// <summary>The property itself if it is a canvas, otherwise the first canvas found a few levels below it.</summary>
    private static WzCanvasProperty? FirstCanvas(WzImageProperty prop)
    {
        var target = prop.GetLinkedWzImageProperty() ?? prop;
        if (target is WzCanvasProperty c) return c;
        return target.WzProperties == null ? null : FirstCanvas(target.WzProperties);
    }

    private static WzCanvasProperty? FirstCanvas(IEnumerable<WzImageProperty> props, int depth = 0)
    {
        var level = props.ToList();
        foreach (var p in level)
            if ((p.GetLinkedWzImageProperty() ?? p) is WzCanvasProperty c) return c;
        if (depth >= 3) return null;
        foreach (var p in level)
        {
            var t = p.GetLinkedWzImageProperty() ?? p;
            if (t is WzCanvasProperty || t.WzProperties is not { Count: > 0 } kids) continue;
            if (FirstCanvas(kids, depth + 1) is { } found) return found;
        }
        return null;
    }
}
