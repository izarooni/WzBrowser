using System.Text.RegularExpressions;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Path">The map's .img in the file.</param>
public record MapEntryDto(int Id, string Path, string? Name);

/// <summary>One thing placed in a map.</summary>
/// <param name="Kind">"back", "tile", "obj", "life", "reactor", "portal", "foothold", "ladder", "seat",
/// "area" (a rectangle), "misc" (a clock, ship, healer or pulley) or "bounds" (the view range, part of info).</param>
/// <param name="Layer">The layer (0-7) of a tile, object or foothold; -1 for everything else.</param>
/// <param name="Sprite">The key of its picture (see <see cref="WzService.MapSprite"/>), or null when it has none.</param>
/// <param name="Values">Its scalar properties (a seat's vector as x and y).</param>
public record MapItemDto(string Path, string Kind, int Layer, string? Sprite, Dictionary<string, string> Values);

/// <param name="OriginX">With OriginY, the point of the picture that sits at the item's position.</param>
/// <param name="Z">The drawing order the picture gives a tile.</param>
public record MapSpriteDto(int OriginX, int OriginY, int Z);

/// <param name="TileSets">Each layer's tile set (info/tS), "" when it has none.</param>
/// <param name="TileScales">Each layer's tile set's info/mag: how many times the usual size its tiles are.</param>
/// <param name="Minimap">The minimap's scalar properties (width, centerX, mag, ...), or null when it has no picture.</param>
public record MapLayoutDto(
    Dictionary<string, string> Info,
    List<string> TileSets,
    List<int> TileScales,
    Dictionary<string, string>? Minimap,
    List<MapItemDto> Items);

/// <param name="Path">Where the piece is in its set: "bsc/0" for a tile, "house/wall/3" for an object.</param>
public record MapPieceDto(string Path, string Sprite);

/// <param name="Op">
/// "set": gives the property a value; with a <paramref name="Type"/>, adds it (and the folders it's in) when missing.
/// "copy": copies a node to <paramref name="Target"/>. "move": moves it there. "delete": removes it.
/// </param>
/// <param name="Path">Inside the map's .img.</param>
/// <param name="From">For "copy" and "move": the map of the same file the node is in, when it's not this one.</param>
public record MapEditOp(
    string Op,
    string Path,
    string? Value = null,
    string? Type = null,
    string? Target = null,
    string? From = null);

/// <param name="Label">What the edit does, for the history.</param>
public record MapEditRequest(string Path, string Label, List<MapEditOp> Ops);

/// <param name="From">The path of the map to copy; a blank one is made without it.</param>
public record MapCreateRequest(int Id, string? From);
public record MapCreateResult(MapEntryDto Map, OpenedFileDto File);
public record NamedIdDto(int Id, string Name);

/// <summary>The map editor of Map.wz (or a modular part holding maps): what a map places, its pictures, and edits.</summary>
public sealed partial class WzService
{
    private const int MapLayers = 8;
    /// <summary>Most ids a name search returns.</summary>
    private const int MaxNameHits = 100;

    private static readonly Regex MapImageName = new(@"^\d{9}\.img$");
    private static readonly Regex MapFolderName = new(@"^Map\d$");

    /// <summary>A Map file with maps in it, which leaves out the modular parts that only hold tiles, objects, ...</summary>
    private static bool IsMapFile(string path, WzDirectory root) =>
        TopOf(path).Equals("Map", StringComparison.OrdinalIgnoreCase) && MapImages(root).Any();

    /// <summary>Every map's .img: in Map/Map0 ... Map/Map9, or at the root of a modular part.</summary>
    private static IEnumerable<(string Path, WzImage Image)> MapImages(WzDirectory root)
    {
        foreach (var image in root.WzImages)
            if (MapImageName.IsMatch(image.Name))
                yield return (image.Name, image);
        if (root.GetDirectoryByName("Map") is not { } maps) yield break;
        foreach (var folder in maps.WzDirectories)
            if (MapFolderName.IsMatch(folder.Name))
                foreach (var image in folder.WzImages)
                    if (MapImageName.IsMatch(image.Name))
                        yield return ($"{maps.Name}/{folder.Name}/{image.Name}", image);
    }

    private Entry GetMapFile(string id)
    {
        var entry = Get(id);
        if (entry.Kind != "map") throw new InvalidDataException("This file has no maps.");
        return entry;
    }

    private static string RequireMapPath(string path)
    {
        var normalized = Normalize(path);
        var name = normalized[(normalized.LastIndexOf('/') + 1)..];
        if (!MapImageName.IsMatch(name)) throw new ArgumentException("That isn't a map.");
        return normalized;
    }

    public List<MapEntryDto> EditorMaps(string id)
    {
        var entry = GetMapFile(id);
        List<(int Id, string Path)> maps;
        NameIndex names;
        lock (entry.Lock)
        {
            maps = MapImages(entry.File.WzDirectory)
                .Select(map => (int.Parse(map.Image.Name[..^4]), map.Path))
                .ToList();
            names = entry.Names ??= new NameIndex(entry.Path, InRoot);
        }
        var found = names.Resolve("map", maps.Select(map => map.Id));
        return maps
            .OrderBy(map => map.Id)
            .Select(map => new MapEntryDto(map.Id, map.Path, found.GetValueOrDefault(map.Id)))
            .ToList();
    }

    public MapLayoutDto MapLayout(string id, string path)
    {
        var entry = GetMapFile(id);
        path = RequireMapPath(path);
        List<string> tileSets;
        MapLayoutDto layout;
        lock (entry.Lock)
        {
            var map = MapImage(entry, path);
            tileSets = Enumerable.Range(0, MapLayers).Select(layer => TileSetOf(map, layer)).ToList();
            var minimap = map["miniMap"]?["canvas"] != null ? ScalarsOf(map["miniMap"]) : null;
            layout = new MapLayoutDto(
                ScalarsOf(map["info"]),
                tileSets,
                [],
                minimap,
                MapItems(map).ToList());
        }
        // Tile sets can be in other files, whose locks are never taken while this one's is held.
        var scales = tileSets.Distinct().ToDictionary(set => set, set => TileScale(entry, set));
        return layout with { TileScales = tileSets.Select(set => scales[set]).ToList() };
    }

    private static WzImage MapImage(Entry entry, string path)
    {
        if (Resolve(entry.File, path) is not WzImage map) throw new ArgumentException("That isn't a map.");
        if (!map.Parsed) map.ParseImage();
        return map;
    }

    private int TileScale(Entry entry, string tileSet)
    {
        if (tileSet.Length == 0) return 1;
        var scale = ReadMapSet(entry, "Tile", tileSet, ReadScale);
        return int.TryParse(scale, out var number) && number > 0 ? number : 1;

        static string? ReadScale(Entry holder, WzImage image) => Text(image["info"]?["mag"]);
    }

    /// <summary>Where each picture sits; those that can't be found are left out.</summary>
    public Dictionary<string, MapSpriteDto> MapSprites(string id, string[] keys)
    {
        var entry = GetMapFile(id);
        var sprites = new Dictionary<string, MapSpriteDto>();
        foreach (var key in keys.Distinct())
            if (ReadSprite(entry, key, DescribeSprite) is { } sprite)
                sprites[key] = sprite;
        return sprites;
    }

    private static string TileSetOf(WzImage map, int layer) => Text(map[layer.ToString()]?["info"]?["tS"]) ?? "";

    private static IEnumerable<WzImageProperty> ChildrenOf(WzImageProperty? property) =>
        property?.WzProperties ?? Enumerable.Empty<WzImageProperty>();

    private static Dictionary<string, string> ScalarsOf(WzImageProperty? property)
    {
        var values = new Dictionary<string, string>();
        foreach (var child in ChildrenOf(property))
            if (Describe(child) is { Value: { } value, Type: not ("canvas" or "sound") })
                values[child.Name] = value;
        return values;
    }

    private static IEnumerable<MapItemDto> MapItems(WzImage map)
    {
        foreach (var back in ItemsIn(map, "back", "back", -1, BackSprite)) yield return back;
        for (var layer = 0; layer < MapLayers; layer++)
        {
            var tileSet = TileSetOf(map, layer);
            foreach (var placed in ItemsIn(map, $"{layer}/obj", "obj", layer, ObjSprite)) yield return placed;
            foreach (var tile in ItemsIn(map, $"{layer}/tile", "tile", layer, TileSprite)) yield return tile;

            string? TileSprite(Dictionary<string, string> values) => KeyOf("tile", tileSet, values, "u", "no");
        }
        foreach (var reactor in ItemsIn(map, "reactor", "reactor", -1, ReactorSprite)) yield return reactor;
        foreach (var life in ItemsIn(map, "life", "life", -1, LifeSprite)) yield return life;
        foreach (var portal in ItemsIn(map, "portal", "portal", -1, PortalSprite)) yield return portal;
        foreach (var ladder in ItemsIn(map, "ladderRope", "ladder", -1, NoSprite)) yield return ladder;
        foreach (var foothold in Footholds(map)) yield return foothold;
        foreach (var seat in Seats(map)) yield return seat;
        foreach (var folder in AreaFolders)
            foreach (var area in ItemsIn(map, folder, "area", -1, NoSprite))
                if (area.Values.ContainsKey("x1"))
                    yield return area;
        foreach (var name in MiscNodes)
            if (map[name] is WzSubProperty misc)
                yield return new MapItemDto(name, "misc", -1, MiscSprite(name, misc), ScalarsOf(misc));
        if (map["info"] is { } info && ViewRange.All(side => info[side] != null))
        {
            var sides = ScalarsOf(info).Where(value => ViewRange.Contains(value.Key));
            yield return new MapItemDto("info", "bounds", -1, null, new(sides));
        }
    }

    /// <summary>Folders of rectangles (x1, y1, x2, y2).</summary>
    private static readonly string[] AreaFolders = ["ToolTip", "area", "swimArea", "BuffZone"];
    /// <summary>One-off things a map can have, each a node of its own.</summary>
    private static readonly string[] MiscNodes = ["clock", "shipObj", "healer", "pulley"];
    private static readonly string[] ViewRange = ["VRLeft", "VRTop", "VRRight", "VRBottom"];

    /// <summary>shipObj/shipObj, healer/healer and pulley/pulley name their object: "Map/Obj/set.img/l0/l1/l2".</summary>
    private static string? MiscSprite(string name, WzImageProperty misc)
    {
        const string prefix = "Map/Obj/";
        if (Text(misc[name]) is not { } path || !path.StartsWith(prefix)) return null;
        return "obj/" + path[prefix.Length..].Replace(".img/", "/");
    }

    private static IEnumerable<MapItemDto> ItemsIn(
        WzImage map,
        string folder,
        string kind,
        int layer,
        Func<Dictionary<string, string>, string?> spriteOf)
    {
        foreach (var child in ChildrenOf(map.GetFromPath(folder)))
        {
            if (child is not WzSubProperty) continue;
            var values = ScalarsOf(child);
            yield return new MapItemDto($"{folder}/{child.Name}", kind, layer, spriteOf(values), values);
        }
    }

    private static IEnumerable<MapItemDto> Footholds(WzImage map)
    {
        foreach (var layer in ChildrenOf(map["foothold"]))
            foreach (var group in ChildrenOf(layer))
                foreach (var foothold in ChildrenOf(group))
                {
                    var path = $"foothold/{layer.Name}/{group.Name}/{foothold.Name}";
                    var layerNumber = int.TryParse(layer.Name, out var number) ? number : -1;
                    yield return new MapItemDto(path, "foothold", layerNumber, null, ScalarsOf(foothold));
                }
    }

    private static IEnumerable<MapItemDto> Seats(WzImage map)
    {
        foreach (var seat in ChildrenOf(map["seat"]))
            if (seat is WzVectorProperty point)
                yield return new MapItemDto($"seat/{seat.Name}", "seat", -1, null, new()
                {
                    ["x"] = point.X.Value.ToString(),
                    ["y"] = point.Y.Value.ToString(),
                });
    }

    private static string? NoSprite(Dictionary<string, string> values) => null;

    /// <summary>Portal types in the order their numbers (pt) go, as MapHelper.img names them.</summary>
    private static readonly string[] PortalTypes =
        ["sp", "pi", "pv", "pc", "pg", "pgi", "tp", "ps", "psi", "pcs", "ph", "psh", "pcj", "pci", "pcig"];

    private static string? PortalSprite(Dictionary<string, string> values)
    {
        if (!int.TryParse(values.GetValueOrDefault("pt"), out var type)) return null;
        return type >= 0 && type < PortalTypes.Length ? $"portal/{PortalTypes[type]}" : null;
    }

    private static string? ObjSprite(Dictionary<string, string> values) =>
        KeyOf("obj", values.GetValueOrDefault("oS"), values, "l0", "l1", "l2");

    private static string? BackSprite(Dictionary<string, string> values)
    {
        var set = values.GetValueOrDefault("bS");
        var number = values.GetValueOrDefault("no");
        if (string.IsNullOrEmpty(set) || string.IsNullOrEmpty(number)) return null;
        var folder = values.GetValueOrDefault("ani") == "1" ? "ani" : "back";
        return $"back/{set}/{folder}/{number}";
    }

    private static string? LifeSprite(Dictionary<string, string> values)
    {
        if (!int.TryParse(values.GetValueOrDefault("id"), out var id)) return null;
        return values.GetValueOrDefault("type") == "n" ? $"npc/{id:D7}" : $"mob/{id:D7}";
    }

    private static string? ReactorSprite(Dictionary<string, string> values) =>
        int.TryParse(values.GetValueOrDefault("id"), out var id) ? $"reactor/{id:D7}" : null;

    private static string? KeyOf(string kind, string? set, Dictionary<string, string> values, params string[] names)
    {
        var parts = names.Select(name => values.GetValueOrDefault(name)).Prepend(set).ToList();
        return parts.Any(string.IsNullOrEmpty) ? null : $"{kind}/{string.Join('/', parts)}";
    }

    // ------------------------------------------------------------ pictures

    /// <summary>The PNG of a picture named by its key: "tile/grassySoil/bsc/0", "obj/acc1/a/b/0", "mob/0100100".</summary>
    public byte[]? MapSprite(string id, string key) => ReadSprite(GetMapFile(id), key, RenderCanvasOf);

    private byte[]? RenderCanvasOf(Entry entry, WzCanvasProperty canvas) => RenderCanvas(entry, canvas);

    private static MapSpriteDto DescribeSprite(Entry entry, WzCanvasProperty canvas)
    {
        var origin = canvas["origin"] as WzVectorProperty;
        return new MapSpriteDto(origin?.X.Value ?? 0, origin?.Y.Value ?? 0, Int(canvas["z"]) ?? 0);
    }

    /// <summary>Reads the canvas a key names, under its file's lock. Null when it can't be found.</summary>
    private T? ReadSprite<T>(Entry entry, string key, Func<Entry, WzCanvasProperty, T?> read) where T : class
    {
        var parts = key.Split('/', 3);
        if (parts.Length < 2) return null;
        var rest = parts.Length > 2 ? parts[2] : "";
        return parts[0] switch
        {
            "tile" => ReadMapImage(entry, "Tile", parts[1], FindPiece, read),
            "obj" => ReadMapImage(entry, "Obj", parts[1], FindPiece, read),
            "back" => ReadMapImage(entry, "Back", parts[1], FindPiece, read),
            "mob" => ReadCreature(entry, "Mob", parts[1], read),
            "npc" => ReadCreature(entry, "Npc", parts[1], read),
            "reactor" => ReadCreature(entry, "Reactor", parts[1], read),
            "portal" => ReadMapImage(entry, "", "MapHelper", FindPortal, read),
            _ => null,
        };

        WzCanvasProperty? FindPiece(WzImage image) => Frame(image.GetFromPath(rest));

        WzCanvasProperty? FindPortal(WzImage image) => Frame(image.GetFromPath($"portal/editor/{parts[1]}"));
    }

    private T? ReadMapImage<T>(
        Entry entry,
        string folder,
        string set,
        Func<WzImage, WzCanvasProperty?> find,
        Func<Entry, WzCanvasProperty, T?> read) where T : class
    {
        return ReadMapSet(entry, folder, set, ReadCanvas);

        T? ReadCanvas(Entry holder, WzImage image) => find(image) is { } canvas ? read(holder, canvas) : null;
    }

    /// <summary>Reads a .img of Map.wz (in its root when <paramref name="folder"/> is "").</summary>
    private T? ReadMapSet<T>(Entry entry, string folder, string set, Func<Entry, WzImage, T?> read) where T : class
    {
        var imageName = set + ".img";
        // The open file's own folder first: it may be a copy with another name than Map.wz.
        lock (entry.Lock)
        {
            var root = entry.File.WzDirectory;
            var own = folder.Length == 0 ? root : root.GetDirectoryByName(folder);
            if (own?.GetImageByName(imageName) is { } image)
            {
                if (!image.Parsed) image.ParseImage();
                return read(entry, image);
            }
        }
        return ReadNearby(entry, "Map", folder, imageName, read);
    }

    /// <summary>A mob, NPC or reactor, following info/link to the one whose pictures it uses.</summary>
    private T? ReadCreature<T>(Entry entry, string top, string id, Func<Entry, WzCanvasProperty, T?> read)
        where T : class
    {
        string? link = null;
        var found = ReadNearby(entry, top, "", id + ".img", ReadStanding);
        if (found != null || link == null) return found;
        return ReadNearby(entry, top, "", link.PadLeft(7, '0') + ".img", ReadStanding);

        T? ReadStanding(Entry holder, WzImage image) =>
            FindStanding(image) is { } canvas ? read(holder, canvas) : null;

        WzCanvasProperty? FindStanding(WzImage image)
        {
            link = Text(image["info"]?["link"]);
            foreach (var pose in new[] { "stand", "fly", "move", "0", "default" })
                if (Frame(image[pose]) is { } canvas)
                    return canvas;
            return null;
        }
    }

    private T? ReadNearby<T>(
        Entry entry,
        string top,
        string folder,
        string imageName,
        Func<Entry, WzImage, T?> read) where T : class
    {
        T? result = null;
        InSibling(entry.Path, top, folder, ReadIn);
        return result;

        string? ReadIn(Entry sibling, WzDirectory directory)
        {
            if (Img(directory, imageName) is not { } image) return null;
            if (!image.Parsed) image.ParseImage();
            result = read(sibling, image);
            return image.Name;
        }
    }

    /// <summary>
    /// The canvas itself, or the first frame below it. A canvas' own _inlink isn't followed here, since its origin is
    /// on the canvas that has the link.
    /// </summary>
    private static WzCanvasProperty? Frame(WzImageProperty? property)
    {
        for (var depth = 0; property != null && depth < 5; depth++)
        {
            if (property is WzUOLProperty link) property = link.GetLinkedWzImageProperty();
            if (property is WzCanvasProperty canvas) return canvas;
            property = property?["0"] ?? ChildrenOf(property).FirstOrDefault(child => child is WzCanvasProperty);
        }
        return null;
    }

    // ------------------------------------------------------------ palette

    private static string PaletteFolder(string kind) => kind switch
    {
        "tile" => "Tile",
        "obj" => "Obj",
        "back" => "Back",
        _ => throw new ArgumentException("The palette has \"tile\", \"obj\" and \"back\"."),
    };

    /// <summary>The tile, object or background sets there are.</summary>
    public List<string> MapSets(string id, string kind)
    {
        var entry = GetMapFile(id);
        var folder = PaletteFolder(kind);
        var sets = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        lock (entry.Lock)
            if (entry.File.WzDirectory.GetDirectoryByName(folder) is { } own)
                AddSets(own);
        if (sets.Count == 0) InSibling(entry.Path, "Map", folder, CollectSets);
        return [.. sets];

        void AddSets(WzDirectory directory)
        {
            foreach (var image in directory.WzImages)
                if (image.Name.EndsWith(".img"))
                    sets.Add(image.Name[..^4]);
        }

        string? CollectSets(Entry sibling, WzDirectory directory)
        {
            AddSets(directory);
            return null; // keep going through the other parts
        }
    }

    /// <summary>Every piece of a tile set (u/no), an object set (l0/l1/l2) or a background set (back/no, ani/no).</summary>
    public List<MapPieceDto> MapPieces(string id, string kind, string set)
    {
        var entry = GetMapFile(id);
        var folder = PaletteFolder(kind);
        var depth = kind == "obj" ? 3 : 2;
        var pieces = new List<MapPieceDto>();
        lock (entry.Lock)
            if (entry.File.WzDirectory.GetDirectoryByName(folder) is { } own && CollectPieces(entry, own) != null)
                return pieces;
        InSibling(entry.Path, "Map", folder, CollectPieces);
        return pieces;

        string? CollectPieces(Entry holder, WzDirectory directory)
        {
            if (Img(directory, set + ".img") is not { } image) return null;
            if (!image.Parsed) image.ParseImage();
            foreach (var child in image.WzProperties)
                if (kind == "back" ? child.Name is "back" or "ani" : child.Name != "info")
                    Collect(child, child.Name, 1);
            return image.Name;
        }

        void Collect(WzImageProperty property, string path, int level)
        {
            if (level == depth)
            {
                pieces.Add(new MapPieceDto(path, $"{kind}/{set}/{path}"));
                return;
            }
            if (property is WzCanvasProperty) return;
            foreach (var child in ChildrenOf(property)) Collect(child, $"{path}/{child.Name}", level + 1);
        }
    }

    // ------------------------------------------------------------ editing

    /// <summary>Applies edits inside one map, all or nothing, as one step that can be undone.</summary>
    public OpenedFileDto EditMap(string id, MapEditRequest request)
    {
        var entry = GetMapFile(id);
        var path = RequireMapPath(request.Path);
        if (request.Ops.Count is 0 or > MaxBatchOps)
            throw new ArgumentException($"A map edit takes 1 to {MaxBatchOps} operations.");
        lock (entry.Lock)
        {
            var map = MapImage(entry, path);
            using var edit = new EditScope(entry).Watch(map);
            try
            {
                foreach (var operation in request.Ops) ApplyMapEdit(entry, edit, map, operation);
            }
            catch
            {
                edit.Rollback();
                throw;
            }
            return MapEdited(id, entry, map, request.Label, edit);
        }
    }

    private OpenedFileDto MapEdited(string id, Entry entry, WzImage map, string label, EditScope edit)
    {
        map.Changed = true;
        Touch(entry);
        Record(label, edit.Finish());
        return Describe(id, entry);
    }

    private static void ApplyMapEdit(Entry entry, EditScope edit, WzImage map, MapEditOp operation)
    {
        var path = Normalize(operation.Path);
        switch (operation.Op)
        {
            case "set" when operation.Value != null:
                SetMapValue(map, path, operation.Value, operation.Type);
                break;
            case "copy":
                PlaceNode(map, NodeAt(Source(), path).DeepClone(), operation.Target);
                break;
            case "move":
                var source = Source();
                edit.Watch(source);
                var node = NodeAt(source, path);
                node.Remove();
                source.Changed = true;
                PlaceNode(map, node, operation.Target);
                break;
            case "delete":
                NodeAt(map, path).Remove();
                break;
            default:
                throw new ArgumentException($"Unknown map edit '{operation.Op}'.");
        }

        WzImage Source() => operation.From == null ? map : MapImage(entry, RequireMapPath(operation.From));
    }

    private static void SetMapValue(WzImage map, string path, string value, string? type)
    {
        if (FindNode(map, path) is { } existing)
        {
            SetValue(existing, value);
            return;
        }
        if (type == null) throw new KeyNotFoundException($"'{path}' isn't in the map.");
        var (folder, name) = SplitPath(path);
        var property = type == "vector" ? new WzVectorProperty(name, 0, 0) : NewValueProperty(name, type);
        SetValue(property, value);
        EnsureFolder(map, folder).AddProperty(property);
    }

    private static void PlaceNode(WzImage map, WzImageProperty node, string? target)
    {
        var (folder, name) = SplitPath(Normalize(target));
        var parent = EnsureFolder(map, folder);
        if (parent[name] != null) throw new InvalidDataException($"'{target}' is already in the map.");
        node.Name = name;
        parent.AddProperty(node);
    }

    private static (string Folder, string Name) SplitPath(string path)
    {
        var slash = path.LastIndexOf('/');
        var name = path[(slash + 1)..];
        if (name.Length == 0) throw new ArgumentException("A name is required.");
        return (slash < 0 ? "" : path[..slash], name);
    }

    private static WzImageProperty? FindNode(WzImage map, string path)
    {
        WzImageProperty? node = null;
        foreach (var segment in path.Split('/'))
        {
            node = node == null ? map[segment] : node[segment];
            if (node == null) return null;
        }
        return node;
    }

    private static WzImageProperty NodeAt(WzImage map, string path) =>
        FindNode(map, path) ?? throw new KeyNotFoundException($"'{path}' isn't in the map.");

    private static IPropertyContainer EnsureFolder(WzImage map, string folder)
    {
        IPropertyContainer parent = map;
        foreach (var segment in folder.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (parent[segment] is not { } child)
            {
                child = new WzSubProperty(segment);
                parent.AddProperty(child);
            }
            parent = child as IPropertyContainer
                ?? throw new InvalidDataException($"'{segment}' can't hold other properties.");
        }
        return parent;
    }

    // ------------------------------------------------------------ whole maps

    /// <summary>Adds a blank map or a copy of one, unsaved like any other edit.</summary>
    public MapCreateResult CreateMap(string id, MapCreateRequest request)
    {
        var entry = GetMapFile(id);
        if (request.Id is < 0 or > 999999999) throw new ArgumentException("A map id has at most nine digits.");
        var name = $"{request.Id:D9}.img";
        lock (entry.Lock)
        {
            var root = entry.File.WzDirectory;
            var (directory, folder) = MapFolder(root, request.Id);
            if (directory.GetImageByName(name) != null) throw new InvalidDataException($"Map {request.Id:D9} exists.");
            WzImage map;
            if (request.From == null) map = BlankMap(name, request.Id);
            else map = MapImage(entry, RequireMapPath(request.From)).DeepClone();
            map.Name = name;
            map.Parsed = true;
            map.Changed = true;
            using var edit = new EditScope(entry).Watch(directory);
            directory.AddImage(map);
            Touch(entry);
            Record($"New map {request.Id:D9}", edit.Finish());
            var created = new MapEntryDto(request.Id, Join(folder, name), null);
            return new MapCreateResult(created, Describe(id, entry));
        }
    }

    private static (WzDirectory Directory, string Folder) MapFolder(WzDirectory root, int id)
    {
        var name = $"Map{id / 100000000}";
        if (root.GetDirectoryByName("Map") is { } maps)
        {
            if (maps.GetDirectoryByName(name) is { } folder) return (folder, $"{maps.Name}/{folder.Name}");
            throw new InvalidDataException($"This file has no {name} folder for that id.");
        }
        // A modular part holds the maps of one folder at its root.
        if (MapImages(root).Any(map => map.Image.Name[0] == name[^1])) return (root, "");
        throw new InvalidDataException("Maps with that first digit are in another file.");
    }

    private static WzImage BlankMap(string name, int id)
    {
        var map = new WzImage(name) { Parsed = true };
        var values = new (string Path, string Type, string Value)[]
        {
            ("info/version", "int", "10"),
            ("info/cloud", "int", "0"),
            ("info/town", "int", "0"),
            ("info/returnMap", "int", id.ToString()),
            ("info/forcedReturn", "int", "999999999"),
            ("info/mobRate", "float", "1"),
            ("info/bgm", "string", "Bgm00/GoPicnic"),
            ("info/mapMark", "string", "None"),
            ("info/hideMinimap", "int", "0"),
            ("info/moveLimit", "int", "0"),
            ("info/fieldLimit", "int", "0"),
            ("info/VRLeft", "int", "-800"),
            ("info/VRTop", "int", "-600"),
            ("info/VRRight", "int", "800"),
            ("info/VRBottom", "int", "600"),
            ("portal/0/pn", "string", "sp"),
            ("portal/0/pt", "int", "0"),
            ("portal/0/x", "int", "0"),
            ("portal/0/y", "int", "0"),
            ("portal/0/tm", "int", "999999999"),
            ("portal/0/tn", "string", ""),
        };
        foreach (var (path, type, value) in values) SetMapValue(map, path, value, type);
        for (var layer = 0; layer < MapLayers; layer++)
            foreach (var part in new[] { "info", "tile", "obj" })
                EnsureFolder(map, $"{layer}/{part}");
        foreach (var folder in new[] { "back", "life", "foothold", "ladderRope", "reactor" }) EnsureFolder(map, folder);
        return map;
    }

    /// <summary>miniMap/mag: the minimap is 2 to this power times smaller than the map.</summary>
    private const int MinimapMagnification = 4;

    /// <summary>Stores a picture of the map as its minimap, a sixteenth of its size each way.</summary>
    /// <param name="centerX">With <paramref name="centerY"/>, how far the map's 0, 0 is from its top left.</param>
    public OpenedFileDto SetMinimap(
        string id,
        string path,
        byte[] picture,
        int width,
        int height,
        int centerX,
        int centerY)
    {
        var pixels = DecodeImage(picture);
        var entry = GetMapFile(id);
        path = RequireMapPath(path);
        lock (entry.Lock)
        {
            var map = MapImage(entry, path);
            using var edit = new EditScope(entry).Watch(map);
            map["miniMap"]?.Remove();
            var canvas = new WzCanvasProperty("canvas");
            ReplacePicture(canvas, pixels, WzPngFormat.Format1);
            EnsureFolder(map, "miniMap").AddProperty(canvas);
            var values = new[]
            {
                ("width", width),
                ("height", height),
                ("centerX", centerX),
                ("centerY", centerY),
                ("mag", MinimapMagnification),
            };
            foreach (var (name, value) in values) SetMapValue(map, $"miniMap/{name}", value.ToString(), "int");
            return MapEdited(id, entry, map, "Redraw minimap", edit);
        }
    }

    // ------------------------------------------------------------ names and music

    /// <summary>The mobs, NPCs, items, maps or skills whose id or String name contains the text.</summary>
    public List<NamedIdDto> SearchNames(string id, string kind, string text)
    {
        if (kind is not ("mob" or "npc" or "item" or "map" or "skill"))
            throw new ArgumentException($"'{kind}' names can't be searched.");
        var entry = Get(id);
        if (entry.Kind is not ("map" or "quest")) throw new InvalidDataException("This file has nothing to pick names for.");
        NameIndex names;
        lock (entry.Lock) names = entry.Names ??= new NameIndex(entry.Path, InRoot);
        return names.Search(kind, text.Trim(), MaxNameHits).Select(hit => new NamedIdDto(hit.Key, hit.Value)).ToList();
    }

    /// <summary>The music info/bgm names, e.g. "Bgm00/FloralLife". Null when Sound hasn't it.</summary>
    public SoundData? MapMusic(string id, string name)
    {
        var entry = GetMapFile(id);
        var parts = Normalize(name).Split('/', 2);
        if (parts.Length < 2) return null;
        return ReadNearby(entry, "Sound", "", parts[0] + ".img", ReadSound);

        SoundData? ReadSound(Entry holder, WzImage image) =>
            image.GetFromPath(parts[1])?.GetLinkedWzImageProperty() is WzBinaryProperty sound ? SoundOf(sound) : null;
    }
}
