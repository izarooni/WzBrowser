using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Maps">The maps the mob spawns in: those Etc lists for it, then any other map whose life places it.</param>
/// <param name="Known">The library's Mob data has the mob, so it has a sprite (Etc can list mobs an install no longer has).</param>
public record MobLocationDto(int Id, string? Name, List<int> Maps, bool Known);

/// <param name="MapNames">Map id -> "Street : Map" from String, for every map any mob is listed in.</param>
public record MobLocationsDto(List<MobLocationDto> Mobs, Dictionary<int, string> MapNames);

public sealed partial class WzService
{
    /// <summary>
    /// Etc's MobLocation.img (mob id -> the maps it spawns in) with String's mob and map names, read once.
    /// Null until first asked for.
    /// </summary>
    private MobLocationsDto? _mobLocations;
    /// <summary>The Etc part holding MobLocation.img; "" once looked for and not found.</summary>
    private string? _mobLocationsSource;
    /// <summary>Mob id -> its image and the file it came from (Mob.wz, its parts, or a Packs/Mob_*.ms pack).</summary>
    private Dictionary<int, (WzImage Image, string Source, string Encryption)>? _mobImages;
    private readonly object _mobsLock = new();

    private static readonly string[] MobLocationImages = ["MobLocation.img", "MobLocations.img"];

    /// <summary>True when the library has an Etc with MobLocation.img (cheap after the first call).</summary>
    public bool HasMobLocations => Root != null && MobLocationsSource() != null;

    public MobLocationsDto MobLocations()
    {
        if (Root == null) throw new InvalidDataException("This server isn't pinned to a folder.");
        lock (_mobsLock)
        {
            if (_mobLocations != null) return _mobLocations;
            var source = MobLocationsSource() ?? throw new KeyNotFoundException("The library's Etc has no MobLocation.img.");

            var spawns = new Dictionary<int, List<int>>();
            void Add(int mob, int map)
            {
                if (!spawns.TryGetValue(mob, out var maps)) spawns[mob] = maps = [];
                if (!maps.Contains(map)) maps.Add(map);
            }

            if (OpenReadOnly(source) is { File: var file })
                using (file)
                    if (MobLocationImages.Select(n => file.WzDirectory.GetImageByName(n)).FirstOrDefault(i => i != null) is { } img)
                        foreach (var mob in img.WzProperties)
                            if (int.TryParse(mob.Name, out var id))
                                foreach (var map in mob.WzProperties.Select(m => Int(m)).OfType<int>()) Add(id, map);
            // Etc's list can be stale (an install that renumbered its mobs and maps keeps the old one), so the maps' own
            // spawn points are added too.
            foreach (var (map, mob) in MapSpawns(source)) Add(mob, map);

            _mobImages ??= IndexMobImages();
            using var names = new NameIndex(source, InRoot);
            var mobNames = names.Resolve("mob", spawns.Keys);
            var mapNames = names.Resolve("map", spawns.Values.SelectMany(m => m).Distinct());
            var mobs = spawns.OrderBy(kv => kv.Key)
                .Select(kv => new MobLocationDto(kv.Key, mobNames.GetValueOrDefault(kv.Key), kv.Value, _mobImages.ContainsKey(kv.Key)))
                .ToList();
            return _mobLocations = new MobLocationsDto(mobs, mapNames);
        }
    }

    /// <summary>Every mob placed in a map's life (type "m"), from the Map files next to <paramref name="archive"/>.</summary>
    private List<(int Map, int Mob)> MapSpawns(string archive)
    {
        var spawns = new List<(int, int)>();
        for (var region = 0; region < 10; region++)
            InSibling(archive, "Map", $"Map/Map{region}", (e, dir) =>
            {
                foreach (var img in dir.WzImages)
                {
                    if (!img.Name.EndsWith(".img") || !int.TryParse(img.Name[..^4], out var map)) continue;
                    var wasParsed = img.Parsed;
                    foreach (var life in img["life"]?.WzProperties ?? Enumerable.Empty<WzImageProperty>())
                        if (Text(life["type"]) == "m" && Int(life["id"]) is { } mob) spawns.Add((map, mob));
                    if (!wasParsed) img.UnparseImage(); // don't keep every map in memory just for this
                }
                return null; // keep going through the other parts
            });
        return spawns;
    }

    /// <summary>The mob's standing sprite (or the first picture it has), following info/link to the mob it borrows from.</summary>
    public byte[]? MobSprite(int id)
    {
        lock (_mobsLock)
        {
            _mobImages ??= IndexMobImages();
            for (var hops = 0; hops < 4 && _mobImages.TryGetValue(id, out var mob); hops++)
            {
                foreach (var rel in new[] { "stand/0", "move/0", "fly/0", "stand", "move", "fly" })
                    if (mob.Image.GetFromPath(rel) is { } prop && FirstCanvas(prop) is { } canvas
                        && RenderCanvas(mob.Source, mob.Encryption, canvas) is { } png)
                        return png;
                if (Int(mob.Image["info"]?["link"]) is not { } link || link == id)
                    return FirstCanvas(mob.Image.WzProperties.Where(p => p.Name != "info")) is { } any ? RenderCanvas(mob.Source, mob.Encryption, any) : null;
                id = link;
            }
            return null;
        }
    }

    /// <summary>The map's minimap, from the Map files next to Etc.</summary>
    public byte[]? MapMinimap(int id) =>
        MobLocationsSource() is { } source ? Preview(LocateNear(source, "map", id), "map") : null;

    private string? MobLocationsSource()
    {
        lock (_mobsLock)
        {
            if (_mobLocationsSource == null)
            {
                _mobLocationsSource = "";
                foreach (var path in LibraryParts("Etc", ".wz"))
                {
                    if (OpenReadOnly(path) is not { File: var file }) continue;
                    using (file)
                        if (MobLocationImages.Any(n => file.WzDirectory.GetImageByName(n) != null)) { _mobLocationsSource = path; break; }
                }
            }
            return _mobLocationsSource is { Length: > 0 } s ? s : null;
        }
    }

    private Dictionary<int, (WzImage Image, string Source, string Encryption)> IndexMobImages()
    {
        var index = new Dictionary<int, (WzImage, string, string)>();
        foreach (var (file, source, encryption) in OpenSources("Mob"))
            foreach (var img in file.WzDirectory.WzImages)
                if (img.Name.EndsWith(".img") && int.TryParse(img.Name[..^4], out var id))
                    index.TryAdd(id, (img, source, encryption)); // the first file with a mob wins
        return index;
    }
}
