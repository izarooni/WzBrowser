using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>An item with what its data says about it; anything it doesn't set is left out of <see cref="Stats"/>.</summary>
/// <param name="Slot">For equipment, the Character folder it's in (Cap, Coat, Weapon, ...); otherwise null.</param>
/// <param name="Price">info/price: what a shop pays for it; 0 when it doesn't say.</param>
/// <param name="Stats">Every number directly under info (reqLevel, incSTR, tuc, slotMax, cash, tradeBlock, ...), by its trimmed name.</param>
/// <param name="Effects">Every number under spec, for items used up (hp, mpR, pad, time, moveTo, ...); null when it has none.</param>
public record ItemDto(int Id, string? Slot, string? Name, string? Desc, int Price, Dictionary<string, int> Stats, Dictionary<string, int>? Effects);

public sealed partial class WzService
{
    /// <summary>The inventory tabs: where each keeps its data (Character/... or Item/...) and its names in String.</summary>
    private static readonly Dictionary<string, (string Top, string[] Dirs, string[] Strings)> ItemCategories = new()
    {
        ["equip"] = ("Character", [], ["Eqp.img"]),
        ["use"] = ("Item", ["Consume"], ["Consume.img"]),
        ["setup"] = ("Item", ["Install"], ["Ins.img"]),
        ["etc"] = ("Item", ["Etc"], ["Etc.img"]),
        ["cash"] = ("Item", ["Cash", "Pet"], ["Cash.img", "Pet.img"]),
    };

    /// <summary>Each category's items, read the first time it's asked for.</summary>
    private readonly Dictionary<string, List<ItemDto>> _items = [];
    /// <summary>Item id -> the image it's in, the node inside it (null when the image is the item), and its file.</summary>
    private readonly Dictionary<int, (WzImage Image, string? Node, string Source, string Encryption)> _itemImages = [];
    /// <summary>Taken after <see cref="_mobsLock"/> and <see cref="_mapsLock"/> when held with them, never before.</summary>
    private readonly object _itemsLock = new();

    /// <summary>True when the library has Item or Character files next to its Etc, quest archives or String.</summary>
    public bool HasItems => Root != null && MapAnchor() is { } anchor
        && (WzLayout.Find(anchor, "Item", "") != null || WzLayout.Find(anchor, "Character", "") != null);

    /// <summary>Every item in one inventory category (equip, use, setup, etc, cash) with String's name and description, sorted by id.</summary>
    public List<ItemDto> Items(string category)
    {
        if (Root == null) throw new InvalidDataException("This server isn't pinned to a folder.");
        category = category.ToLowerInvariant();
        if (!ItemCategories.TryGetValue(category, out var where)) throw new ArgumentException($"Unknown item category '{category}'.");
        var anchor = MapAnchor(); // takes the mob and map locks, which are never taken inside this one
        lock (_itemsLock)
        {
            if (_items.TryGetValue(category, out var cached)) return cached;

            var strings = new Dictionary<int, (string? Name, string? Desc)>();
            foreach (var image in where.Strings)
                if (OpenStrings(image) is { } img)
                {
                    CollectItemStrings(img.WzProperties, strings);
                    img.WzFileParent?.Dispose();
                }

            var items = new Dictionary<int, ItemDto>();
            void Add(int id, WzImage img, string? node, string? slot, string source, string encryption)
            {
                if (items.ContainsKey(id)) return; // the first file with an item wins
                var stats = Numbers(ItemPart(img, node, "info")) ?? [];
                var text = strings.GetValueOrDefault(id);
                items[id] = new ItemDto(id, slot, text.Name, text.Desc, stats.GetValueOrDefault("price"), stats, Numbers(ItemPart(img, node, "spec")));
                _itemImages[id] = (img, node, source, encryption);
            }

            if (anchor != null && where.Top == "Character")
            {
                // A classic Character.wz has a directory per slot; a modular install has a folder of parts per slot.
                foreach (var (dir, source, encryption) in ItemDirs(anchor, "Character", ""))
                    foreach (var slot in dir.WzDirectories) AddEquips(slot, slot.Name, source, encryption, Add);
                foreach (var slot in WzLayout.Subfolders(anchor, "Character"))
                    foreach (var (dir, source, encryption) in ItemDirs(anchor, "Character", slot))
                        AddEquips(dir, slot, source, encryption, Add);
            }
            else if (anchor != null)
                foreach (var name in where.Dirs)
                    foreach (var (dir, source, encryption) in ItemDirs(anchor, where.Top, name))
                        foreach (var img in dir.WzImages)
                        {
                            if (!img.Name.EndsWith(".img") || !int.TryParse(img.Name[..^4], out var group)) continue;
                            var wasParsed = img.Parsed;
                            // Pets are an image each (Pet/5000000.img); the rest are grouped by their first four digits (0200.img).
                            if (name == "Pet") Add(group, img, null, null, source, encryption);
                            else
                                foreach (var node in img.WzProperties)
                                    if (int.TryParse(node.Name, out var id)) Add(id, img, node.Name, null, source, encryption);
                            if (!wasParsed) img.UnparseImage(); // don't keep every item's icons in memory just for its stats
                        }

            return _items[category] = items.Values.OrderBy(i => i.Id).ToList();
        }
    }

    /// <summary>The item's icon (info/icon, else info/iconRaw).</summary>
    public byte[]? ItemIcon(int id)
    {
        var category = (id / 1000000) switch { 1 => "equip", 2 => "use", 3 => "setup", 4 => "etc", 5 => "cash", _ => null };
        if (category == null) return null;
        Items(category);
        lock (_itemsLock)
        {
            if (!_itemImages.TryGetValue(id, out var at)) return null;
            var info = ItemPart(at.Image, at.Node, "info");
            foreach (var rel in new[] { "icon", "iconRaw" })
                if (info?[rel] is { } prop && FirstCanvas(prop) is { } canvas && RenderCanvas(at.Source, at.Encryption, canvas) is { } png)
                    return png;
            return null;
        }
    }

    /// <summary>An item's info or spec: in its own image, or under its node in a group's.</summary>
    private static WzImageProperty? ItemPart(WzImage img, string? node, string part) => node == null ? img[part] : img[node]?[part];

    /// <summary>A slot's equipment images ("01002000.img"), and those in any folders below it.</summary>
    private static void AddEquips(WzDirectory dir, string slot, string source, string encryption,
        Action<int, WzImage, string?, string?, string, string> add)
    {
        foreach (var img in dir.WzImages)
        {
            // Character also holds bodies, faces and hair (ids below 1000000); equipment is 1xxxxxx.
            if (!img.Name.EndsWith(".img") || !int.TryParse(img.Name[..^4], out var id) || id / 1000000 != 1) continue;
            var wasParsed = img.Parsed;
            add(id, img, null, slot, source, encryption);
            if (!wasParsed) img.UnparseImage();
        }
        foreach (var sub in dir.WzDirectories) AddEquips(sub, slot, source, encryption, add);
    }

    /// <summary>
    /// The directories holding what a classic install keeps at <c>{top}.wz/{dir}</c>, opened read-only and kept open
    /// (icons are read from them later).
    /// </summary>
    private IEnumerable<(WzDirectory Dir, string Source, string Encryption)> ItemDirs(string anchor, string top, string dir)
    {
        if (WzLayout.Find(anchor, top, dir) is not var (files, rest)) yield break;
        foreach (var path in files.Where(InRoot))
        {
            if (OpenReadOnly(path) is not { } wz) continue;
            WzDirectory? node = wz.File.WzDirectory;
            foreach (var segment in rest.Split('/', StringSplitOptions.RemoveEmptyEntries)) node = node?.GetDirectoryByName(segment);
            if (node == null) { wz.File.Dispose(); continue; }
            yield return (node, wz.Source, wz.Encryption);
        }
    }

    /// <summary>The numbers directly under a node, by name; null when it has none.</summary>
    private static Dictionary<string, int>? Numbers(WzImageProperty? node)
    {
        Dictionary<string, int>? numbers = null;
        foreach (var p in node?.WzProperties ?? Enumerable.Empty<WzImageProperty>())
            if (p is WzIntProperty or WzShortProperty or WzLongProperty or WzStringProperty && Int(p) is { } n)
                (numbers ??= []).TryAdd(p.Name.Trim(), n); // some installs write "reqLevel " beside "reqLevel"
        return numbers;
    }

    /// <summary>String's entries (numeric nodes with name and desc), looking through grouping levels (Eqp/Cap, Etc).</summary>
    private static void CollectItemStrings(IEnumerable<WzImageProperty> nodes, Dictionary<int, (string? Name, string? Desc)> into)
    {
        foreach (var node in nodes)
        {
            if (int.TryParse(node.Name, out var id))
                into.TryAdd(id, (Text(node["name"]) is { Length: > 0 } name ? name : null, Text(node["desc"]) is { Length: > 0 } desc ? desc : null));
            else if (node.WzProperties is { Count: > 0 } children)
                CollectItemStrings(children, into);
        }
    }
}
