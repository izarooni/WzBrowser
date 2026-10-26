using MapleLib.WzLib;

namespace WzBrowser.Api;

/// <param name="Count">How many spawn points the map's life has for the mob; 0 when only Etc's MobLocation.img lists it there.</param>
public record MapMobDto(int Id, int Count);

/// <param name="Name">"Street : Map" from String.</param>
/// <param name="Mobs">The mobs that spawn in the map, in the order its life places them, then any only Etc lists.</param>
/// <param name="Npcs">The NPCs standing in the map (its life's NPCs that aren't hidden), in the order it places them.</param>
public record MapDto(int Id, string? Name, List<MapMobDto> Mobs, List<int> Npcs);

/// <param name="MobNames">Mob id -> String's name, for every mob in any map.</param>
/// <param name="NpcNames">NPC id -> String's name, for every NPC in any map.</param>
public record MapsDto(List<MapDto> Maps, Dictionary<int, string> MobNames, Dictionary<int, string> NpcNames);

public sealed partial class WzService
{
    /// <summary>What each map's life places: mob id -> spawn points, and the NPCs. Read once; null until first asked for.</summary>
    private Dictionary<int, MapLife>? _mapLife;
    /// <summary>Every map with its mobs and NPCs and their names, read once. Null until first asked for.</summary>
    private MapsDto? _maps;
    /// <summary>The library's first String part, the anchor when there's neither MobLocation.img nor a quest archive; "" once looked for and not found.</summary>
    private string? _stringAnchor;
    /// <summary>Taken after <see cref="_mobsLock"/> when both are held, never before it.</summary>
    private readonly object _mapsLock = new();

    private sealed record MapLife(Dictionary<int, int> Mobs, List<int> Npcs);

    /// <summary>True when the library has Map files next to its Etc, quest archives or String (cheap after the first call).</summary>
    public bool HasMaps => Root != null && MapAnchor() is { } anchor && WzLayout.Find(anchor, "Map", "Map/Map1") != null;

    /// <summary>
    /// Every map in the library's Map files (plus any Etc's MobLocation.img lists a mob in), with the mobs and NPCs its life
    /// places and String's names, sorted by id.
    /// </summary>
    public MapsDto Maps()
    {
        if (Root == null) throw new InvalidDataException("This server isn't pinned to a folder.");
        // Etc's lists and the anchor first: they take the mob lock, which is never taken inside this one.
        var listed = HasMobLocations ? MobLocations() : null;
        var anchor = MapAnchor();
        var lives = MapLives();
        lock (_mapsLock)
        {
            if (_maps != null) return _maps;

            var maps = lives.ToDictionary(kv => kv.Key, kv => (Mobs: kv.Value.Mobs.Select(m => new MapMobDto(m.Key, m.Value)).ToList(), kv.Value.Npcs));
            // Etc can list a mob in a map whose life doesn't place it (one a script or reactor summons).
            foreach (var mob in listed?.Mobs ?? [])
                foreach (var id in mob.Maps)
                {
                    if (!maps.TryGetValue(id, out var map)) maps[id] = map = (new List<MapMobDto>(), new List<int>());
                    if (!map.Mobs.Exists(m => m.Id == mob.Id)) map.Mobs.Add(new MapMobDto(mob.Id, 0));
                }

            Dictionary<int, string> mapNames = [], mobNames = [], npcNames = [];
            if (anchor != null)
                using (var names = new NameIndex(anchor, InRoot))
                {
                    mapNames = names.Resolve("map", maps.Keys);
                    mobNames = names.Resolve("mob", maps.Values.SelectMany(m => m.Mobs).Select(m => m.Id).Distinct());
                    npcNames = names.Resolve("npc", maps.Values.SelectMany(m => m.Npcs).Distinct());
                }
            var list = maps.OrderBy(kv => kv.Key)
                .Select(kv => new MapDto(kv.Key, mapNames.GetValueOrDefault(kv.Key), kv.Value.Mobs, kv.Value.Npcs))
                .ToList();
            return _maps = new MapsDto(list, mobNames, npcNames);
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
