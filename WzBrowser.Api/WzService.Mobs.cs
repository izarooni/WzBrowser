using MapleLib.WzLib;

namespace WzBrowser.Api;

/// <summary>A mob's stats from its info node in Mob data; anything the mob doesn't set is 0.</summary>
/// <param name="Elements">info/elemAttr as written: a letter per element (F fire, I ice, L lightning, S poison, H holy,
/// D dark, P physical) and how it takes it (1 immune, 2 resists, 3 weak), e.g. "F2I3".</param>
/// <param name="Link">The mob it borrows its animations from (info/link), if any.</param>
public record MobDto(
    int Id, string? Name, int Level, long MaxHp, long MaxMp, long Exp,
    int PhysicalAttack, int MagicAttack, int PhysicalDefense, int MagicDefense,
    int Accuracy, int Avoid, int Speed, bool Boss, bool Undead, string? Elements, int? Link);

public sealed partial class WzService
{
    /// <summary>Every mob in the library's Mob data with its stats and String's name, read once. Null until first asked for.</summary>
    private List<MobDto>? _mobs;

    /// <summary>True when the library has Mob data (cheap after the first call).</summary>
    public bool HasMobs
    {
        get
        {
            if (Root == null) return false;
            lock (_mobsLock) return (_mobImages ??= IndexMobImages()).Count > 0;
        }
    }

    public List<MobDto> Mobs()
    {
        if (Root == null) throw new InvalidDataException("This server isn't pinned to a folder.");
        lock (_mobsLock)
        {
            if (_mobs != null) return _mobs;
            _mobImages ??= IndexMobImages();

            var names = new Dictionary<int, string>();
            if (OpenStrings("Mob.img") is { } strings)
            {
                foreach (var m in strings.WzProperties)
                    if (int.TryParse(m.Name, out var id) && Text(m["name"]) is { Length: > 0 } name) names[id] = name;
                strings.WzFileParent?.Dispose();
            }

            var mobs = new List<MobDto>(_mobImages.Count);
            foreach (var (id, (img, _, _)) in _mobImages.OrderBy(kv => kv.Key))
            {
                var wasParsed = img.Parsed;
                var info = img["info"];
                long Long(string name) => long.TryParse(Text(info?[name]), out var n) ? n : 0;
                int Stat(string name) => Int(info?[name]) ?? 0;
                mobs.Add(new MobDto(id, names.GetValueOrDefault(id), Stat("level"), Long("maxHP"), Long("maxMP"), Long("exp"),
                    Stat("PADamage"), Stat("MADamage"), Stat("PDDamage"), Stat("MDDamage"), Stat("acc"), Stat("eva"), Stat("speed"),
                    Stat("boss") == 1, Stat("undead") == 1, Text(info?["elemAttr"]) is { Length: > 0 } e ? e : null,
                    Int(info?["link"]) is { } link && link != id ? link : null));
                if (!wasParsed) img.UnparseImage(); // don't keep every mob's frames in memory just for its stats
            }
            return _mobs = mobs;
        }
    }
}
