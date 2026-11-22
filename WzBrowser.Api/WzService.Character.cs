using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Path">The directory in the file ("Weapon"), or "" for the .imgs at the root.</param>
/// <param name="Label">What the menu shows: the directory's name, or for the root the slot folder's (a modular part).</param>
/// <param name="Count">How many items are in it and the directories below it; null for Item tabs that keep a hundred
/// items to an .img, which would take reading each.</param>
public record CharacterSection(string Path, string Label, int? Count);

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

    /// <summary>
    /// Item.wz (or a renamed copy), a modular install's Data/Item/{tab}/{tab}_000.wz, or an .ms pack of it.
    /// </summary>
    private static bool IsItemFile(string path) => TopOf(path).Equals("Item", StringComparison.OrdinalIgnoreCase);

    /// <summary>Skill.wz (or a renamed copy), a modular install's Data/Skill/Skill_000.wz, or an .ms pack of it.</summary>
    private static bool IsSkillFile(string path) => TopOf(path).Equals("Skill", StringComparison.OrdinalIgnoreCase);

    /// <summary>A Character, Item or Skill file: each is browsed as thumbnails by section, with String's names.</summary>
    private Entry GetCharacter(string id)
    {
        var entry = Get(id);
        if (entry.Kind is not ("character" or "item" or "skill")) throw new InvalidDataException("This file isn't a Character, Item or Skill file.");
        return entry;
    }

    /// <summary>
    /// Skill's menu: a job's .img each (100.img), by job id, named by String's bookName for it ("Warrior Basics"), else
    /// its id. Counts are left out: they'd take reading every job's .img.
    /// </summary>
    private List<CharacterSection> SkillSections(Entry entry)
    {
        List<(string Path, int Job)> jobs;
        lock (entry.Lock)
            jobs = Images(entry.File.WzDirectory, "")
                .Select(i => (i.Path, Job: IdOfImage(i.Image.Name)))
                .Where(j => j.Job != null)
                .Select(j => (j.Path, j.Job!.Value))
                .OrderBy(j => j.Value)
                .ToList();

        var books = new Dictionary<int, string>();
        if (StringImages(entry.Path, "Skill.img").FirstOrDefault() is ({ } _, { } strings, { } img))
            lock (strings.Lock)
                foreach (var (_, job) in jobs)
                    if (Text(FindStringEntry(img.WzProperties, job)?["bookName"]) is { Length: > 0 } book) books[job] = book;
        return jobs.Select(j => new CharacterSection(j.Path, books.GetValueOrDefault(j.Job) ?? j.Job.ToString(), null)).ToList();
    }

    /// <summary>
    /// An Item .img that is one item (Pet/5000000.img), not a group of a hundred (Consume/0200.img/02000000): it's named
    /// by a full item id, which is at least seven digits.
    /// </summary>
    private static bool IsItemImage(WzImage img) => IdOfImage(img.Name) >= 1_000_000;

    /// <summary>
    /// The menu: each directory at the root (Weapon, Cap, Coat, ... or Consume, Etc, Cash, ...), and the root itself when
    /// it holds .imgs. Character's counts are its .imgs. Item's are left out where they'd mean reading every .img for its
    /// items, so listing the menu reads nothing.
    /// </summary>
    public List<CharacterSection> CharacterSections(string id)
    {
        var entry = GetCharacter(id);
        if (entry.Kind == "skill") return SkillSections(entry);
        var item = entry.Kind == "item";
        int? Count(IEnumerable<WzImage> imgs)
        {
            var list = imgs.ToList();
            return item && !list.All(IsItemImage) ? null : list.Count;
        }
        lock (entry.Lock)
        {
            var root = entry.File.WzDirectory;
            var sections = root.WzDirectories
                .Select(d => new CharacterSection(d.Name, d.Name, Count(Images(d, "").Select(i => i.Image))))
                .OrderBy(s => s.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (root.WzImages.Count > 0)
            {
                // A modular part is one slot's .imgs at its root (Data/Character/Weapon/Weapon_000.wz, Data/Item/Consume/Consume_000.wz).
                var folder = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(entry.Path));
                var label = folder != null && !folder.Equals(item ? "Item" : "Character", StringComparison.OrdinalIgnoreCase) && root.WzDirectories.Count == 0
                    ? folder : item ? "Root" : "Body & head";
                sections.Insert(0, new CharacterSection("", label, Count(root.WzImages)));
            }
            return sections;
        }
    }

    /// <summary>
    /// One section's items with String's name and description, by id. In Character each .img is an item, and only names
    /// are read. In Item most .imgs hold a hundred items each (Consume/0200.img/02000000), so those are read for their
    /// items' names, then let go again.
    /// </summary>
    public CharacterItems CharacterSectionItems(string id, string? section)
    {
        var entry = GetCharacter(id);
        var found = new List<(string Path, int? Id)>();
        lock (entry.Lock)
        {
            // A skill section is a job's .img, its skills under skill/ (100.img/skill/1001003).
            if (entry.Kind == "skill")
            {
                if (Resolve(entry.File, section) is not WzImage job) throw new InvalidDataException("Not a job's .img of this file.");
                var wasParsed = job.Parsed;
                foreach (var node in job["skill"]?.WzProperties ?? Enumerable.Empty<WzImageProperty>())
                    if (int.TryParse(node.Name, out var n)) found.Add(($"{Normalize(section)}/skill/{node.Name}", n));
                if (!wasParsed) job.UnparseImage();
            }
            else
            {
                var dir = Resolve(entry.File, section) switch
                {
                    WzFile f => f.WzDirectory,
                    WzDirectory d => d,
                    _ => throw new InvalidDataException("Not a folder of this file."),
                };
                var prefix = Normalize(section) is { Length: > 0 } s ? s + "/" : "";
                foreach (var (img, path) in Images(dir, prefix))
                {
                    if (entry.Kind != "item" || IsItemImage(img))
                    {
                        found.Add((path, IdOfImage(img.Name)));
                        continue;
                    }
                    var wasParsed = img.Parsed;
                    foreach (var node in img.WzProperties)
                        if (int.TryParse(node.Name, out var n)) found.Add(($"{path}/{node.Name}", n));
                    if (!wasParsed) img.UnparseImage(); // don't keep every item's icons in memory just for its name
                }
            }
        }

        var (strings, stringFileId) = ItemStrings(entry, section);
        var items = found
            .Select(f => f.Id is { } n && strings.TryGetValue(n, out var s)
                ? new CharacterItem(f.Path, f.Id, s.Name, s.Desc, s.Path)
                : new CharacterItem(f.Path, f.Id, null, null, null))
            .OrderBy(i => i.Id ?? int.MaxValue).ThenBy(i => i.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new CharacterItems(items, stringFileId);
    }

    /// <summary>An item's picture as a PNG (see <see cref="CharacterPicture(object)"/>), or null when it has none.</summary>
    /// <param name="cancelled">The request was dropped (the view moved on): it's skipped once the file's lock comes free,
    /// so pictures nobody waits for anymore don't hold up the next section's list.</param>
    public byte[]? CharacterPicture(string id, string path, CancellationToken cancelled = default)
    {
        var entry = GetCharacter(id);
        return ReadItem(entry, path, node =>
            CharacterPicture(node) is { } rel && At(node, rel.TrimEnd('/')) is { } canvas ? RenderCanvas(entry, canvas) : null, cancelled);
    }

    /// <summary>
    /// An item's info (stats, price, requirements, ...) with everything below it, or null when it has none. A skill's is
    /// the whole skill (common, level/1, ..., its flags), since it has no info of its own.
    /// </summary>
    public PropTree? CharacterInfo(string id, string path)
    {
        var entry = GetCharacter(id);
        return ReadItem(entry, path, node =>
            entry.Kind == "skill" ? node is WzImageProperty skill ? ToTree(skill) : null
            : Child(node, "info") is { } info ? ToTree(info) : null);
    }

    /// <summary>
    /// Reads an item: an .img (Weapon/01302000.img, Pet/5000000.img) or an item node in one (Consume/0200.img/02000000).
    /// Its .img is parsed for this when it wasn't already, and let go again after.
    /// </summary>
    private static T? ReadItem<T>(Entry entry, string path, Func<object, T?> read, CancellationToken cancelled = default)
    {
        var segs = Normalize(path).Split('/', StringSplitOptions.RemoveEmptyEntries);
        var cut = Array.FindIndex(segs, s => s.EndsWith(".img", StringComparison.OrdinalIgnoreCase));
        lock (entry.Lock)
        {
            if (cancelled.IsCancellationRequested) return default;
            if (cut < 0 || Resolve(entry.File, string.Join('/', segs[..(cut + 1)])) is not WzImage img)
                throw new KeyNotFoundException("Not an item of this file.");
            var wasParsed = img.Parsed;
            if (!wasParsed) img.ParseImage();
            try
            {
                object node = img;
                foreach (var seg in segs[(cut + 1)..]) node = Child(node, seg) ?? throw new KeyNotFoundException("Not an item of this file.");
                return read(node);
            }
            finally
            {
                // Edited images are always parsed, so only ones read just for this go back to unread.
                if (!wasParsed) img.UnparseImage();
            }
        }
    }

    /// <summary>What a slash-separated path names below an .img or property, or null.</summary>
    private static WzImageProperty? At(object node, string rel)
    {
        object? at = node;
        foreach (var seg in rel.Split('/', StringSplitOptions.RemoveEmptyEntries)) at = Child(at, seg);
        return at as WzImageProperty;
    }

    private static int? IdOfImage(string name) =>
        name.EndsWith(".img", StringComparison.OrdinalIgnoreCase) && int.TryParse(name[..^4], out var n) ? n : null;

    /// <summary>
    /// Where an item's picture is, relative to its .img or node: its icon, else the first picture of its default look
    /// (faces, hair), its standing pose (bodies) or the front of a head, else the first one a few levels down.
    /// </summary>
    private static string? CharacterPicture(object item)
    {
        foreach (var rel in new[] { "info/icon", "info/iconRaw", "info/iconD", "info/iconRawD", "icon" })
            if (IsPicture(At(item, rel))) return rel;
        foreach (var name in new[] { "default", "stand1", "front", "walk1" })
            if (Child(item, name) is { } part && PicturePath(part, 3) is { } below) return $"{name}/{below}";
        foreach (var prop in Children(item))
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

    /// <summary>
    /// The String image naming a section's items: Eqp.img for all of Character; for Item, the one for its inventory tab
    /// (Consume.img, Ins.img, Etc.img, Cash.img, Pet.img), or null for a tab String doesn't name (Special).
    /// </summary>
    private static string? StringImageFor(Entry entry, string? section)
    {
        if (entry.Kind == "skill") return "Skill.img";
        if (entry.Kind != "item") return EqpImg;
        // As in a classic install, so a modular part's folder (Data/Item/Consume) counts as its tab.
        var tab = WzLayout.Classic(entry.Path, Normalize(section)).Path.Split('/')[0];
        return ItemStringImage(tab);
    }

    /// <summary>The String image naming an Item tab's items (Consume -> Consume.img), or null.</summary>
    private static string? ItemStringImage(string tab) => tab.ToLowerInvariant() switch
    {
        "consume" => "Consume.img",
        "install" => "Ins.img",
        "etc" => "Etc.img",
        "cash" => "Cash.img",
        "pet" => "Pet.img",
        _ => null,
    };

    /// <summary>The String files next to a Character or Item file that hold the section's String image (see <see cref="StringImages"/>).</summary>
    private IEnumerable<(string Id, Entry Entry, WzImage Image)> ItemStringFiles(Entry entry, string? section) =>
        StringImageFor(entry, section) is { } image ? StringImages(entry.Path, image) : [];

    /// <summary>Every entry in the section's String image (by id: its node's path, name and description), and that file's id.</summary>
    private (Dictionary<int, (string Path, string? Name, string? Desc)> Strings, string? FileId) ItemStrings(Entry item, string? section)
    {
        var strings = new Dictionary<int, (string Path, string? Name, string? Desc)>();
        foreach (var (fileId, entry, eqp) in ItemStringFiles(item, section))
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
    /// Sets an item's name and description in String (Eqp.img, or the Item tab's image), adding its entry and either value
    /// when missing. A new equipment entry goes under the group named like its section; a new Item one under the image's
    /// one group when it has one (Etc.img/Etc), else at its root. String becomes a listed open file with unsaved changes,
    /// to be saved from its window.
    /// </summary>
    public CharacterStringResult SetCharacterStrings(string id, CharacterStringRequest req)
    {
        var character = GetCharacter(id);
        if (req.Name == null && req.Desc == null) throw new ArgumentException("Nothing to change.");
        var image = StringImageFor(character, req.Section) ?? throw new InvalidDataException("String doesn't name the items in this section.");
        if (ItemStringFiles(character, req.Section).FirstOrDefault() is not ({ } fileId, { } entry, { } eqp))
            throw new FileNotFoundException($"No String file with {image} was found next to this file.");

        lock (entry.Lock)
        {
            var item = FindStringEntry(eqp.WzProperties, req.Id);
            if (item == null && character.Kind is "item" or "skill")
            {
                item = new WzSubProperty(req.Id.ToString());
                var groups = eqp.WzProperties.Where(p => !int.TryParse(p.Name, out _)).ToList();
                if (groups is [WzSubProperty group] && eqp.WzProperties.Count == 1) group.AddProperty(item);
                else eqp.AddProperty(item);
            }
            else if (item == null)
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
