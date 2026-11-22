using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Path">The directory in the file ("Weapon"), or "" for the .imgs at the root.</param>
/// <param name="Label">What the menu shows: the directory's name, or for the root the slot folder's (a modular
/// part).</param>
/// <param name="Count">How many items are in it and the directories below it; null for Item tabs that keep a hundred
/// items to an .img, which would take reading each.</param>
public record CharacterSection(string Path, string Label, int? Count);

/// <param name="Path">The .img, from the file root ("Weapon/01302000.img"). Its picture is fetched on its own
/// (<see cref="WzService.CharacterPicture(string, string, CancellationToken)"/>), so listing a section doesn't read
/// every .img.</param>
/// <param name="Name">String's name for it, or null.</param>
/// <param name="Desc">String's description, or null.</param>
/// <param name="StringPath">Where String keeps its name and description ("Eqp.img/Eqp/Weapon/1302000"), or null.</param>
/// <param name="Texts">String's other text for it, in order: a skill's per-level descriptions ("h", "h1", "h2", ...,
/// "pdesc"), or anything else an item's entry holds. Null when there's none.</param>
public record CharacterItem(
    string Path,
    int? Id,
    string? Name,
    string? Desc,
    string? StringPath,
    List<CharacterText>? Texts = null);

public record CharacterText(string Key, string Value);

/// <param name="StringFileId">The String file the names came from (opened hidden), so the view can refetch after it
/// changes.</param>
public record CharacterItems(List<CharacterItem> Items, string? StringFileId);

/// <param name="Section">The section the item is in, used to find String's group for it when it has no entry yet.</param>
/// <param name="Texts">Other text to set by key ("h1", ...), added when the entry doesn't have it.</param>
public record CharacterStringRequest(
    int Id,
    string Section,
    string? Name,
    string? Desc,
    Dictionary<string, string>? Texts = null);

/// <param name="File">The String file, now listed as open and with unsaved changes.</param>
/// <param name="Path">The item's node in it.</param>
public record CharacterStringResult(
    OpenedFileDto File,
    string Path,
    string? Name,
    string? Desc,
    List<CharacterText>? Texts);

public sealed partial class WzService
{
    private const string EqpImg = "Eqp.img";

    /// <summary>An item's entry in String: where it is, and its name, description and other text.</summary>
    private sealed record ItemString(string Path, string? Name, string? Desc, List<CharacterText>? Texts);

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

    /// <summary>
    /// Skill.wz (or a renamed copy), a modular install's Data/Skill/Skill_000.wz, or an .ms pack of it.
    /// </summary>
    private static bool IsSkillFile(string path) => TopOf(path).Equals("Skill", StringComparison.OrdinalIgnoreCase);

    /// <summary>A Character, Item or Skill file: each is browsed as thumbnails by section, with String's names.</summary>
    private Entry GetCharacter(string id)
    {
        var entry = Get(id);
        if (entry.Kind is not ("character" or "item" or "skill"))
            throw new InvalidDataException("This file isn't a Character, Item or Skill file.");
        return entry;
    }

    /// <summary>
    /// The menu: each directory at the root (Weapon, Cap, Coat, ... or Consume, Etc, Cash, ...), and the root itself when
    /// it holds .imgs. Character's counts are its .imgs. Item's are left out where they'd mean reading every .img for its
    /// items, so listing the menu reads nothing. Skill's menu is its jobs (see <see cref="SkillSections"/>).
    /// </summary>
    public List<CharacterSection> CharacterSections(string id)
    {
        var entry = GetCharacter(id);
        if (entry.Kind == "skill") return SkillSections(entry);
        var isItemFile = entry.Kind == "item";
        lock (entry.Lock)
        {
            var root = entry.File.WzDirectory;
            var sections = root.WzDirectories
                .Select(directory => DirectorySection(directory, isItemFile))
                .OrderBy(section => section.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (root.WzImages.Count > 0)
            {
                var count = ItemCount(isItemFile, root.WzImages);
                sections.Insert(0, new CharacterSection("", RootLabel(entry, isItemFile), count));
            }
            return sections;
        }
    }

    private static CharacterSection DirectorySection(WzDirectory directory, bool isItemFile)
    {
        var count = ItemCount(isItemFile, Images(directory, "").Select(found => found.Image));
        return new CharacterSection(directory.Name, directory.Name, count);
    }

    /// <summary>
    /// How many items some .imgs hold: one each, except Item's groups of a hundred, left uncounted (null).
    /// </summary>
    private static int? ItemCount(bool isItemFile, IEnumerable<WzImage> images)
    {
        var list = images.ToList();
        if (isItemFile && !list.All(IsItemImage)) return null;
        return list.Count;
    }

    /// <summary>
    /// The menu's name for the .imgs at a file's root: a modular part's slot folder (Data/Character/Weapon/Weapon_000.wz,
    /// Data/Item/Consume/Consume_000.wz), else "Body & head" for Character and "Root" for Item.
    /// </summary>
    private static string RootLabel(Entry entry, bool isItemFile)
    {
        var folder = System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(entry.Path));
        var classicFolder = isItemFile ? "Item" : "Character";
        var isModularPart = folder != null
            && !folder.Equals(classicFolder, StringComparison.OrdinalIgnoreCase)
            && entry.File.WzDirectory.WzDirectories.Count == 0;
        if (isModularPart) return folder!;
        return isItemFile ? "Root" : "Body & head";
    }

    /// <summary>
    /// Skill's menu: a job's .img each (100.img), by job id, named by String's bookName for it ("Warrior Basics"), else
    /// its id. Counts are left out: they'd take reading every job's .img.
    /// </summary>
    private List<CharacterSection> SkillSections(Entry entry)
    {
        var jobs = new List<(string Path, int Job)>();
        lock (entry.Lock)
            foreach (var (image, path) in Images(entry.File.WzDirectory, ""))
                if (IdOfImage(image.Name) is { } job)
                    jobs.Add((path, job));

        var books = SkillBookNames(entry, jobs.Select(job => job.Job));
        return jobs
            .OrderBy(job => job.Job)
            .Select(job => new CharacterSection(job.Path, books.GetValueOrDefault(job.Job) ?? job.Job.ToString(), null))
            .ToList();
    }

    /// <summary>String's bookName for each job that has one ("Warrior Basics" for 100).</summary>
    private Dictionary<int, string> SkillBookNames(Entry entry, IEnumerable<int> jobs)
    {
        var books = new Dictionary<int, string>();
        if (StringImages(entry.Path, "Skill.img").FirstOrDefault() is not (_, { } stringFile, { } skillStrings))
            return books;
        lock (stringFile.Lock)
            foreach (var job in jobs)
                if (Text(FindStringEntry(skillStrings.WzProperties, job)?["bookName"]) is { Length: > 0 } book)
                    books[job] = book;
        return books;
    }

    /// <summary>
    /// An Item .img that is one item (Pet/5000000.img), not a group of a hundred (Consume/0200.img/02000000): it's named
    /// by a full item id, which is at least seven digits.
    /// </summary>
    private static bool IsItemImage(WzImage image) => IdOfImage(image.Name) >= 1_000_000;

    /// <summary>
    /// One section's items with String's name and description, by id. In Character each .img is an item, and only
    /// names are read. In Item most .imgs hold a hundred items each (Consume/0200.img/02000000), and in Skill a job's
    /// .img holds its skills, so those are read for their items' ids, then let go again.
    /// </summary>
    public CharacterItems CharacterSectionItems(string id, string? section)
    {
        var entry = GetCharacter(id);
        List<(string Path, int? Id)> found;
        lock (entry.Lock)
            found = entry.Kind == "skill" ? SkillsIn(entry, section) : ItemsIn(entry, section);

        var (strings, stringFileId) = ItemStrings(entry, section);
        var items = found
            .Select(item => WithStrings(item.Path, item.Id, strings))
            .OrderBy(item => item.Id ?? int.MaxValue)
            .ThenBy(item => item.Path, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return new CharacterItems(items, stringFileId);
    }

    /// <summary>
    /// A job's skills: the section is the job's .img, with its skills under skill/ (100.img/skill/1001003).
    /// </summary>
    private static List<(string Path, int? Id)> SkillsIn(Entry entry, string? section)
    {
        if (Resolve(entry.File, section) is not WzImage job)
            throw new InvalidDataException("Not a job's .img of this file.");
        var skillsPath = $"{Normalize(section)}/skill";
        return WithParsed(job, image => NumberedChildren(image["skill"]?.WzProperties, skillsPath));
    }

    /// <summary>A Character or Item section's items: an .img each, or each item in Item's groups of a hundred.</summary>
    private static List<(string Path, int? Id)> ItemsIn(Entry entry, string? section)
    {
        var directory = Resolve(entry.File, section) switch
        {
            WzFile file => file.WzDirectory,
            WzDirectory folder => folder,
            _ => throw new InvalidDataException("Not a folder of this file."),
        };
        var prefix = Normalize(section) is { Length: > 0 } normalized ? normalized + "/" : "";
        var found = new List<(string Path, int? Id)>();
        foreach (var (image, path) in Images(directory, prefix))
        {
            if (entry.Kind != "item" || IsItemImage(image))
                found.Add((path, IdOfImage(image.Name)));
            else
                found.AddRange(WithParsed(image, group => NumberedChildren(group.WzProperties, path)));
        }
        return found;
    }

    /// <summary>The nodes named by a number (an id), with their paths below <paramref name="parentPath"/>.</summary>
    private static List<(string Path, int? Id)> NumberedChildren(IEnumerable<WzImageProperty>? nodes, string parentPath)
    {
        var found = new List<(string Path, int? Id)>();
        foreach (var node in nodes ?? [])
            if (int.TryParse(node.Name, out var id))
                found.Add(($"{parentPath}/{node.Name}", id));
        return found;
    }

    private static CharacterItem WithStrings(string path, int? id, Dictionary<int, ItemString> strings)
    {
        if (id is { } known && strings.TryGetValue(known, out var text))
            return new CharacterItem(path, id, text.Name, text.Desc, text.Path, text.Texts);
        return new CharacterItem(path, id, null, null, null);
    }

    /// <summary>
    /// An item's picture as a PNG (see <see cref="CharacterPicture(object)"/>), or null when it has none.
    /// </summary>
    /// <param name="cancelled">The request was dropped (the view moved on): it's skipped once the file's lock comes free,
    /// so pictures nobody waits for anymore don't hold up the next section's list.</param>
    public byte[]? CharacterPicture(string id, string path, CancellationToken cancelled = default)
    {
        var entry = GetCharacter(id);
        return ReadItem(entry, path, RenderPicture, cancelled);

        byte[]? RenderPicture(object item)
        {
            if (CharacterPicture(item) is not { } relativePath || At(item, relativePath.TrimEnd('/')) is not { } canvas)
                return null;
            return RenderCanvas(entry, canvas);
        }
    }

    /// <summary>
    /// An item's info (stats, price, requirements, ...) with everything below it, or null when it has none. A skill's is
    /// the whole skill (common, level/1, ..., its flags), since it has no info of its own.
    /// </summary>
    public PropTree? CharacterInfo(string id, string path)
    {
        var entry = GetCharacter(id);
        return ReadItem(entry, path, InfoTree);

        PropTree? InfoTree(object item)
        {
            if (entry.Kind == "skill") return item is WzImageProperty skill ? ToTree(skill) : null;
            return Child(item, "info") is { } info ? ToTree(info) : null;
        }
    }

    /// <summary>
    /// Reads an item: an .img (Weapon/01302000.img, Pet/5000000.img) or an item node in one (Consume/0200.img/02000000).
    /// Its .img is parsed for this when it wasn't already, and let go again after.
    /// </summary>
    private static T? ReadItem<T>(Entry entry, string path, Func<object, T?> read, CancellationToken cancelled = default)
    {
        var segments = Normalize(path).Split('/', StringSplitOptions.RemoveEmptyEntries);
        var imageIndex = Array.FindIndex(segments, IsImageName);
        if (imageIndex < 0) throw new KeyNotFoundException("Not an item of this file.");
        lock (entry.Lock)
        {
            if (cancelled.IsCancellationRequested) return default;
            if (Resolve(entry.File, string.Join('/', segments[..(imageIndex + 1)])) is not WzImage image)
                throw new KeyNotFoundException("Not an item of this file.");
            return WithParsed(image, ReadNode);
        }

        T? ReadNode(WzImage image)
        {
            object node = image;
            foreach (var segment in segments[(imageIndex + 1)..])
                node = Child(node, segment) ?? throw new KeyNotFoundException("Not an item of this file.");
            return read(node);
        }
    }

    /// <summary>
    /// Runs <paramref name="read"/> on an .img, parsing it first when it wasn't, and letting it go again after, so
    /// reading a section doesn't keep every item's pictures in memory. Edited images are always parsed, so they stay.
    /// </summary>
    private static T WithParsed<T>(WzImage image, Func<WzImage, T> read)
    {
        var wasParsed = image.Parsed;
        if (!wasParsed) image.ParseImage();
        try
        {
            return read(image);
        }
        finally
        {
            if (!wasParsed) image.UnparseImage();
        }
    }

    /// <summary>What a slash-separated path names below an .img or property, or null.</summary>
    private static WzImageProperty? At(object node, string relativePath)
    {
        object? current = node;
        foreach (var segment in relativePath.Split('/', StringSplitOptions.RemoveEmptyEntries))
            current = Child(current, segment);
        return current as WzImageProperty;
    }

    private static bool IsImageName(string name) => name.EndsWith(".img", StringComparison.OrdinalIgnoreCase);

    private static int? IdOfImage(string name) => IsImageName(name) && int.TryParse(name[..^4], out var id) ? id : null;

    /// <summary>
    /// Where an item's picture is, relative to its .img or node: its icon, else the first picture of its default look
    /// (faces, hair), its standing pose (bodies) or the front of a head, else the first one a few levels down.
    /// </summary>
    private static string? CharacterPicture(object item)
    {
        foreach (var relativePath in new[] { "info/icon", "info/iconRaw", "info/iconD", "info/iconRawD", "icon" })
            if (IsPicture(At(item, relativePath))) return relativePath;
        foreach (var name in new[] { "default", "stand1", "front", "walk1" })
            if (Child(item, name) is { } part && PicturePath(part, 3) is { } below) return $"{name}/{below}";
        foreach (var property in Children(item))
            if (property.Name != "info" && PicturePath(property, 2) is { } below) return $"{property.Name}/{below}";
        return null;
    }

    /// <summary>
    /// The path below a property to its first picture (itself when it is one: ""), looking <paramref name="depth"/>
    /// levels down.
    /// </summary>
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
    /// The String image naming a section's items: Eqp.img for all of Character, Skill.img for Skill; for Item, the one
    /// for its inventory tab (Consume.img, Ins.img, Etc.img, Cash.img, Pet.img), or null for a tab String doesn't name
    /// (Special).
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

    /// <summary>
    /// The String files next to a Character, Item or Skill file that hold the section's String image
    /// (see <see cref="StringImages"/>).
    /// </summary>
    private IEnumerable<(string Id, Entry Entry, WzImage Image)> ItemStringFiles(Entry entry, string? section) =>
        StringImageFor(entry, section) is { } image ? StringImages(entry.Path, image) : [];

    /// <summary>Every entry in the section's String image by id, and that String file's id.</summary>
    private (Dictionary<int, ItemString> Strings, string? FileId) ItemStrings(Entry entry, string? section)
    {
        var strings = new Dictionary<int, ItemString>();
        if (ItemStringFiles(entry, section).FirstOrDefault() is not ({ } fileId, { } stringFile, { } image))
            return (strings, null);
        lock (stringFile.Lock)
            CollectStrings(image.WzProperties, image.Name, strings);
        return (strings, fileId);
    }

    /// <summary>
    /// Adds each entry named by an id among <paramref name="nodes"/>, looking inside groups (Eqp/Weapon).
    /// </summary>
    private static void CollectStrings(
        IEnumerable<WzImageProperty> nodes,
        string path,
        Dictionary<int, ItemString> strings)
    {
        foreach (var node in nodes)
        {
            var nodePath = $"{path}/{node.Name}";
            if (int.TryParse(node.Name, out var id))
                strings.TryAdd(id, new ItemString(nodePath, Text(node["name"]), Text(node["desc"]), OtherTexts(node)));
            else if (node.WzProperties is { Count: > 0 } children)
                CollectStrings(children, nodePath, strings);
        }
    }

    /// <summary>An entry's text besides its name and description, "h" before "h1" before "h2" ... before "h10".</summary>
    private static List<CharacterText>? OtherTexts(WzImageProperty node)
    {
        var texts = node.WzProperties?
            .Where(property => property is WzStringProperty && property.Name is not ("name" or "desc"))
            .Select(property => new CharacterText(property.Name, Text(property) ?? ""))
            .OrderBy(text => KeyStem(text.Key), StringComparer.OrdinalIgnoreCase)
            .ThenBy(text => KeyNumber(text.Key))
            .ToList();
        return texts is { Count: > 0 } ? texts : null;
    }

    /// <summary>A key without its number ("h" for "h12").</summary>
    private static string KeyStem(string key) => key.TrimEnd(Digits);

    /// <summary>A key's number (12 for "h12"), or -1 when it has none, so "h" comes before "h1".</summary>
    private static int KeyNumber(string key) =>
        int.TryParse(key.AsSpan(KeyStem(key).Length), out var number) ? number : -1;

    /// <summary>String keeps a few slots under another name than Character does.</summary>
    private static readonly Dictionary<string, string> StringGroups = new(StringComparer.OrdinalIgnoreCase)
    {
        ["TamingMob"] = "Taming",
    };

    /// <summary>
    /// Sets an item's name, description and other text in String (Eqp.img, Skill.img, or the Item tab's image), adding
    /// its entry and any value when missing (see <see cref="AddStringEntry"/>). String becomes a listed open file with
    /// unsaved changes, to be saved from its window.
    /// </summary>
    public CharacterStringResult SetCharacterStrings(string id, CharacterStringRequest request)
    {
        var character = GetCharacter(id);
        if (request.Name == null && request.Desc == null && request.Texts is not { Count: > 0 })
            throw new ArgumentException("Nothing to change.");
        foreach (var key in request.Texts?.Keys ?? Enumerable.Empty<string>())
            if (key.Length == 0 || key.Contains('/') || key is "name" or "desc")
                throw new ArgumentException($"'{key}' isn't a text to set here.");
        var image = StringImageFor(character, request.Section)
            ?? throw new InvalidDataException("String doesn't name the items in this section.");
        if (ItemStringFiles(character, request.Section).FirstOrDefault() is not ({ } fileId, { } entry, { } strings))
            throw new FileNotFoundException($"No String file with {image} was found next to this file.");

        lock (entry.Lock)
        {
            var item = FindStringEntry(strings.WzProperties, request.Id) ?? AddStringEntry(character, strings, request);
            SetText(item, "name", request.Name);
            SetText(item, "desc", request.Desc);
            foreach (var (key, value) in request.Texts ?? [])
                SetText(item, key, value);

            strings.Changed = true;
            Touch(entry);
            entry.Hidden = false;

            return new CharacterStringResult(
                Describe(fileId, entry),
                PathInImage(item),
                Text(item["name"]),
                Text(item["desc"]),
                OtherTexts(item));
        }
    }

    /// <summary>
    /// Adds an entry for an item String has none for. An Item or Skill one goes under the image's one group when
    /// that's all it holds (Etc.img/Etc), else at its root; an equipment one under the group named like its section
    /// (Eqp/Weapon).
    /// </summary>
    private static WzSubProperty AddStringEntry(Entry character, WzImage strings, CharacterStringRequest request)
    {
        var item = new WzSubProperty(request.Id.ToString());
        if (character.Kind is "item" or "skill")
        {
            if (strings.WzProperties is [WzSubProperty group] && !int.TryParse(group.Name, out _))
                group.AddProperty(item);
            else
                strings.AddProperty(item);
            return item;
        }

        var section = Normalize(request.Section);
        var slot = section.Length > 0
            ? section[(section.LastIndexOf('/') + 1)..]
            : System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(character.Path)) ?? "";
        var groupName = StringGroups.GetValueOrDefault(slot, slot);
        var top = strings["Eqp"] ?? strings.WzProperties.FirstOrDefault();
        if (top?[groupName] is not WzSubProperty parent)
            throw new InvalidDataException($"String's {EqpImg} has no '{groupName}' group to add item {request.Id} to.");
        parent.AddProperty(item);
        return item;
    }

    /// <summary>Sets one of an entry's texts. Leaving one it doesn't have blank doesn't add an empty one.</summary>
    private static void SetText(WzSubProperty item, string name, string? value)
    {
        if (value == null || value.Length == 0 && item[name] == null) return;
        if (item[name] is WzStringProperty text)
        {
            text.Value = value;
            return;
        }
        item[name]?.Remove();
        item.AddProperty(new WzStringProperty(name, value));
    }
}
