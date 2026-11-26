using MapleLib.WzLib;

namespace WzBrowser.Api;

/// <param name="Name">"Street : Map" from String.</param>
/// <param name="Npcs">The NPCs standing in the map (its life's NPCs that aren't hidden), in the order it places them.</param>
public record MapDto(int Id, string? Name, List<int> Npcs);

public sealed partial class WzService
{
    /// <summary>What each map's life places: mob id -> spawn points, and the NPCs. Read once; null until first asked for.</summary>
    private Dictionary<int, MapLife>? _mapLife;
    /// <summary>Every map with NPCs in it, read once. Null until first asked for.</summary>
    private List<MapDto>? _maps;
    /// <summary>The library's first String part, the anchor when there's neither MobLocation.img nor a quest archive; "" once looked for and not found.</summary>
    private string? _stringAnchor;
    /// <summary>Taken after <see cref="_mobsLock"/> when both are held, never before it.</summary>
    private readonly object _mapsLock = new();

    private sealed record MapLife(Dictionary<int, int> Mobs, List<int> Npcs);

    /// <summary>True when the library has Map files next to its Etc, quest archives or String (cheap after the first call).</summary>
    public bool HasMaps => Root != null && MapAnchor() is { } anchor && WzLayout.Find(anchor, "Map", "Map/Map1") != null;

    /// <summary>Every map in the library's Map files whose life places an NPC, with String's names, sorted by id.</summary>
    public List<MapDto> Maps()
    {
        if (Root == null) throw new InvalidDataException("This server isn't pinned to a folder.");
        // The anchor first: it takes the mob lock, which is never taken inside this one.
        var anchor = MapAnchor();
        var lives = MapLives();
        lock (_mapsLock)
        {
            if (_maps != null) return _maps;

            var maps = lives.Where(life => life.Value.Npcs.Count > 0).ToList();
            Dictionary<int, string> names = [];
            if (anchor != null)
                names = new NameIndex(anchor, InRoot).Resolve("map", maps.Select(map => map.Key));
            return _maps = maps
                .OrderBy(map => map.Key)
                .Select(map => new MapDto(map.Key, names.GetValueOrDefault(map.Key), map.Value.Npcs))
                .ToList();
        }
    }

    /// <summary>Every map's life (type "m" mobs, type "n" NPCs), from the Map files next to <see cref="MapAnchor"/>.</summary>
    private Dictionary<int, MapLife> MapLives()
    {
        var anchor = MapAnchor();
        lock (_mapsLock)
        {
            if (_mapLife != null) return _mapLife;
            var lives = new Dictionary<int, MapLife>();
            var links = new Dictionary<int, int>();
            for (var region = 0; anchor != null && region < 10; region++)
                InSibling(anchor, "Map", $"Map/Map{region}", (e, dir) =>
                {
                    foreach (var img in dir.WzImages)
                    {
                        if (!img.Name.EndsWith(".img") || !int.TryParse(img.Name[..^4], out var map) || lives.ContainsKey(map)) continue;
                        var wasParsed = img.Parsed;
                        var life = new MapLife([], []);
                        foreach (var l in img["life"]?.WzProperties ?? Enumerable.Empty<WzImageProperty>())
                        {
                            if (Int(l["id"]) is not { } id) continue;
                            switch (Text(l["type"]))
                            {
                                case "m": life.Mobs[id] = life.Mobs.GetValueOrDefault(id) + 1; break;
                                case "n" when Int(l["hide"]) != 1 && !life.Npcs.Contains(id): life.Npcs.Add(id); break;
                            }
                        }
                        lives[map] = life;
                        if (Int(img["info"]?["link"]) is { } link && link != map) links[map] = link;
                        if (!wasParsed) img.UnparseImage(); // don't keep every map in memory just for this
                    }
                    return null; // keep going through the other parts
                });
            // A map with info/link is drawn from the map it names, life and all.
            foreach (var (map, link) in links)
                if (lives[map] is { Mobs.Count: 0, Npcs.Count: 0 } && lives.TryGetValue(link, out var shared)) lives[map] = shared;
            return _mapLife = lives;
        }
    }

    /// <summary>
    /// A library file next to the Map and String files: Etc's MobLocation part, else the first quest archive, else the
    /// first String part.
    /// </summary>
    private string? MapAnchor()
    {
        if ((MobLocationsSource() ?? FirstQuestArchive()) is { } known) return known;
        lock (_mapsLock)
        {
            if (_stringAnchor == null)
            {
                try { _stringAnchor = LibraryParts("String", ".wz").FirstOrDefault() ?? ""; }
                catch (DirectoryNotFoundException) { return null; } // looked for again once the folder exists
            }
            return _stringAnchor is { Length: > 0 } s ? s : null;
        }
    }
}
