using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Path">The directory in the file ("Weapon"), or "" for the .imgs at the root.</param>
/// <param name="Label">What the menu shows: the directory's name, or for the root the slot folder's (a modular part).</param>
/// <param name="Count">How many .imgs are in it and the directories below it.</param>
public record CharacterSection(string Path, string Label, int Count);

/// <param name="Path">The .img, from the file root ("Weapon/01302000.img"). Its picture is fetched on its own
/// (<see cref="WzService.CharacterPicture(string, string)"/>), so listing a section doesn't read every .img.</param>
/// <param name="Name">String's name for it, or null.</param>
/// <param name="Desc">String's description, or null.</param>
/// <param name="StringPath">Where String keeps its name and description ("Eqp.img/Eqp/Weapon/1302000"), or null.</param>
public record CharacterItem(string Path, int? Id, string? Name, string? Desc, string? StringPath);

/// <param name="StringFileId">The String file the names came from (opened hidden), so the view can refetch after it changes.</param>
public record CharacterItems(List<CharacterItem> Items, string? StringFileId);

/// <param name="Section">The section the item is in, used to find String's group for it when it has no entry yet.</param>
public record CharacterStringRequest(int Id, string Section, string? Name, string? Desc);
/// <param name="File">The String file, now listed as open and with unsaved changes.</param>
/// <param name="Path">The item's node in it.</param>
public record CharacterStringResult(OpenedFileDto File, string Path, string? Name, string? Desc);


public sealed partial class WzService
{
    private const string EqpImg = "Eqp.img";

    /// <summary>
    /// Character.wz (or a renamed copy), a modular install's Data/Character/{slot}/{slot}_000.wz, or an .ms pack of it.
    /// </summary>
    private static bool IsCharacterFile(string path)
    {
        var stem = System.IO.Path.GetFileNameWithoutExtension(path);
        if (stem.Equals("Character", StringComparison.OrdinalIgnoreCase)
            || stem.StartsWith("Character.", StringComparison.OrdinalIgnoreCase)
            || stem.StartsWith("Character_", StringComparison.OrdinalIgnoreCase)) return true;
        var dir = System.IO.Path.GetDirectoryName(path);
        for (var i = 0; i < 2 && dir != null; i++, dir = System.IO.Path.GetDirectoryName(dir))
            if (System.IO.Path.GetFileName(dir).Equals("Character", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    private Entry GetCharacter(string id)
    {
        var entry = Get(id);
        if (entry.Kind != "character") throw new InvalidDataException("This file isn't a Character file.");
        return entry;
    }

    /// <summary>The menu: each directory at the root (Weapon, Cap, Coat, ...), and the root itself when it holds .imgs.</summary>
    public List<CharacterSection> CharacterSections(string id)
    {
        var entry = GetCharacter(id);
        lock (entry.Lock)
        {
            var root = entry.File.WzDirectory;
            var sections = root.WzDirectories
                .Select(d => new CharacterSection(d.Name, d.Name, Images(d, "").Count()))
                .OrderBy(s => s.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (root.WzImages.Count > 0)
            {
                // A modular part is one slot's .imgs at its root (Data/Character/Weapon/Weapon_000.wz).
                var folder = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(entry.Path));
                var label = folder != null && !folder.Equals("Character", StringComparison.OrdinalIgnoreCase) && root.WzDirectories.Count == 0
                    ? folder : "Body & head";
                sections.Insert(0, new CharacterSection("", label, root.WzImages.Count));
            }
            return sections;
        }
    }

    /// <summary>One section's .imgs with String's name and description, by id. Only names are read, not the .imgs.</summary>
    public CharacterItems CharacterSectionItems(string id, string? section)
    {
        var entry = GetCharacter(id);
        var found = new List<(string Path, int? Id)>();
        lock (entry.Lock)
        {
            var dir = Resolve(entry.File, section) switch
            {
                WzFile f => f.WzDirectory,
                WzDirectory d => d,
                _ => throw new InvalidDataException("Not a folder of this file."),
            };
            var prefix = Normalize(section) is { Length: > 0 } s ? s + "/" : "";
            foreach (var (img, path) in Images(dir, prefix)) found.Add((path, IdOfImage(img.Name)));
        }

        var (strings, stringFileId) = EquipStrings(entry.Path);
        var items = found
            .Select(f => f.Id is { } n && strings.TryGetValue(n, out var s)
                ? new CharacterItem(f.Path, f.Id, s.Name, s.Desc, s.Path)
                : new CharacterItem(f.Path, f.Id, null, null, null))
            .OrderBy(i => i.Id ?? int.MaxValue).ThenBy(i => i.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new CharacterItems(items, stringFileId);
    }

    /// <summary>An item's picture as a PNG (see <see cref="CharacterPicture(WzImage)"/>), or null when it has none.</summary>
    public byte[]? CharacterPicture(string id, string path)
    {
        var entry = GetCharacter(id);
        lock (entry.Lock)
        {
            if (Resolve(entry.File, path) is not WzImage img) throw new KeyNotFoundException("Not an .img of this file.");
            var wasParsed = img.Parsed;
            if (!wasParsed) img.ParseImage();
            try
            {
                return CharacterPicture(img) is { } rel && img.GetFromPath(rel.TrimEnd('/')) is { } canvas ? RenderCanvas(entry, canvas) : null;
            }
            finally
            {
                // Edited images are always parsed, so only ones read just for this go back to unread.
                if (!wasParsed) img.UnparseImage();
            }
        }
    }

    /// <summary>An item's info (stats, price, requirements, ...) with everything below it, or null when it has none.</summary>
    public PropTree? CharacterInfo(string id, string path)
    {
        var entry = GetCharacter(id);
        lock (entry.Lock)
        {
            if (Resolve(entry.File, path) is not WzImage img) throw new KeyNotFoundException("Not an .img of this file.");
            var wasParsed = img.Parsed;
            if (!wasParsed) img.ParseImage();
            try { return img["info"] is { } info ? ToTree(info) : null; }
            finally { if (!wasParsed) img.UnparseImage(); }
        }
    }

    private static int? IdOfImage(string name) =>
        name.EndsWith(".img", StringComparison.OrdinalIgnoreCase) && int.TryParse(name[..^4], out var n) ? n : null;

    /// <summary>
    /// Where an item's picture is, relative to its .img: its icon, else the first picture of its default look (faces,
    /// hair), its standing pose (bodies) or the front of a head, else the first one a few levels down.
    /// </summary>
    private static string? CharacterPicture(WzImage img)
    {
        foreach (var rel in new[] { "info/icon", "info/iconRaw", "info/iconD", "info/iconRawD" })
            if (IsPicture(img.GetFromPath(rel))) return rel;
        foreach (var name in new[] { "default", "stand1", "front", "walk1" })
            if (img[name] is { } part && PicturePath(part, 3) is { } below) return $"{name}/{below}";
        foreach (var prop in img.WzProperties)
            if (prop.Name != "info" && PicturePath(prop, 2) is { } below) return $"{prop.Name}/{below}";
        return null;
    }

    /// <summary>The path below a property to its first picture (itself when it is one: ""), looking <paramref name="depth"/> levels down.</summary>
    private static string? PicturePath(WzImageProperty prop, int depth)
    {
        if (IsPicture(prop)) return "";
        if (depth == 0 || prop.WzProperties is not { Count: > 0 } children) return null;
        foreach (var child in children)
            if (IsPicture(child)) return child.Name;
        foreach (var child in children)
            if (PicturePath(child, depth - 1) is { Length: > 0 } below) return $"{child.Name}/{below}";
        return null;
    }

    /// <summary>The String files next to a Character file that hold Eqp.img (see <see cref="StringImages"/>).</summary>
    private IEnumerable<(string Id, Entry Entry, WzImage Eqp)> EquipStringFiles(string characterPath) =>
        StringImages(characterPath, EqpImg);

    /// <summary>Every equipment entry in String's Eqp.img (by id: its node's path, name and description), and that file's id.</summary>
    private (Dictionary<int, (string Path, string? Name, string? Desc)> Strings, string? FileId) EquipStrings(string characterPath)
    {
        var strings = new Dictionary<int, (string Path, string? Name, string? Desc)>();
        foreach (var (fileId, entry, eqp) in EquipStringFiles(characterPath))
        {
            lock (entry.Lock)
            {
                void Walk(IEnumerable<WzImageProperty> nodes, string path)
                {
                    foreach (var node in nodes)
                    {
                        var at = $"{path}/{node.Name}";
                        if (int.TryParse(node.Name, out var n))
                            strings.TryAdd(n, (at, Text(node["name"]), Text(node["desc"])));
                        else if (node.WzProperties is { Count: > 0 } children)
                            Walk(children, at);
                    }
                }
                Walk(eqp.WzProperties, path: eqp.Name);
            }
            return (strings, fileId);
        }
        return (strings, null);
    }

    /// <summary>String keeps a few slots under another name than Character does.</summary>
    private static readonly Dictionary<string, string> StringGroups = new(StringComparer.OrdinalIgnoreCase)
    {
        ["TamingMob"] = "Taming",
    };

    /// <summary>
    /// Sets an item's name and description in String's Eqp.img, adding its entry (under the group named like its section)
    /// and either value when missing. String becomes a listed open file with unsaved changes, to be saved from its window.
    /// </summary>
    public CharacterStringResult SetCharacterStrings(string id, CharacterStringRequest req)
    {
        var character = GetCharacter(id);
        if (req.Name == null && req.Desc == null) throw new ArgumentException("Nothing to change.");
        if (EquipStringFiles(character.Path).FirstOrDefault() is not ({ } fileId, { } entry, { } eqp))
            throw new FileNotFoundException("No String file with Eqp.img was found next to this file.");

        lock (entry.Lock)
        {
            var item = FindStringEntry(eqp.WzProperties, req.Id);
            if (item == null)
            {
                var section = Normalize(req.Section);
                var slot = section.Length > 0 ? section[(section.LastIndexOf('/') + 1)..]
                    : System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(character.Path)) ?? "";
                var group = StringGroups.GetValueOrDefault(slot, slot);
                if ((eqp["Eqp"] ?? eqp.WzProperties.FirstOrDefault()) is not { } top || top[group] is not WzSubProperty parent)
                    throw new InvalidDataException($"String's {EqpImg} has no '{group}' group to add item {req.Id} to.");
                item = new WzSubProperty(req.Id.ToString());
                parent.AddProperty(item);
            }

            void Set(string name, string? value)
            {
                // Leaving a value it doesn't have blank doesn't add an empty one.
                if (value == null || value.Length == 0 && item[name] == null) return;
                if (item[name] is WzStringProperty s) s.Value = value;
                else
                {
                    item[name]?.Remove();
                    item.AddProperty(new WzStringProperty(name, value));
                }
            }
            Set("name", req.Name);
            Set("desc", req.Desc);

            eqp.Changed = true;
            Touch(entry);
            entry.Hidden = false;

            return new CharacterStringResult(Describe(fileId, entry), PathInImage(item), Text(item["name"]), Text(item["desc"]));
        }
    }
}
