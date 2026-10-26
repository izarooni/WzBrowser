using MapleLib.WzLib;
using MapleLib.WzLib.MSFile;
using MapleLib.WzLib.Util;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Levels">What each level does (String's h1, h2, ...), or the single template "h" when the skill has no per-level text.</param>
/// <param name="Hidden">Marked invisible: a helper the client uses internally, not shown in the skill window.</param>
public record SkillDto(int Id, string? Name, string? Desc, int MaxLevel, bool Hidden, List<string> Levels);

/// <param name="Job">The job id the skills belong to (0 Beginner, 100 Warrior, 110 Fighter, ...).</param>
/// <param name="Book">The skill book's title from String (e.g. "Warrior Basics").</param>
public record SkillBookDto(int Job, string? Book, bool HasIcon, List<SkillDto> Skills);

public sealed partial class WzService
{
    /// <summary>
    /// Every job's skills in a pinned library, read once from wherever the install keeps them: Skill.wz, a modular
    /// Data/Skill/Skill_*.wz, or a Data/Packs/Skill_*.ms pack. Null until first asked for; empty without a library.
    /// </summary>
    private SkillData? _skills;
    private readonly object _skillsLock = new();

    private sealed class SkillData
    {
        public List<SkillBookDto> Books { get; } = [];
        /// <summary>Skill id -> its icon, and the file it came from (where its _outlink is resolved from).</summary>
        public Dictionary<int, (WzImageProperty Icon, string Source, string Encryption)> Icons { get; } = [];
        public Dictionary<int, (WzImageProperty Icon, string Source, string Encryption)> BookIcons { get; } = [];
    }

    /// <summary>True when the library has skill data (cheap after the first call).</summary>
    public bool HasSkills => Root != null && LoadSkills().Books.Count > 0;

    public List<SkillBookDto> Skills()
    {
        if (Root == null) throw new InvalidDataException("This server isn't pinned to a folder.");
        return LoadSkills().Books;
    }

    public byte[]? SkillIcon(int id) => RenderSkillIcon(LoadSkills().Icons, id);
    public byte[]? SkillBookIcon(int job) => RenderSkillIcon(LoadSkills().BookIcons, job);

    private byte[]? RenderSkillIcon(Dictionary<int, (WzImageProperty Icon, string Source, string Encryption)> icons, int id)
    {
        if (!icons.TryGetValue(id, out var icon)) return null;
        lock (_skillsLock) return RenderCanvas(icon.Source, icon.Encryption, icon.Icon);
    }

    private SkillData LoadSkills()
    {
        lock (_skillsLock)
        {
            if (_skills != null) return _skills;
            var data = new SkillData();
            _skills = data;
            if (Root == null) return data;

            var strings = OpenStrings("Skill.img");
            foreach (var (file, source, encryption) in OpenSources("Skill"))
                foreach (var img in file.WzDirectory.WzImages.OrderBy(i => i.Name, StringComparer.Ordinal))
                {
                    if (!img.Name.EndsWith(".img") || !int.TryParse(img.Name[..^4], out var job)) continue;
                    if (data.Books.Any(b => b.Job == job) || img["skill"] is not { } list) continue; // the first file with a job wins

                    var skills = new List<SkillDto>();
                    foreach (var s in list.WzProperties)
                    {
                        if (!int.TryParse(s.Name, out var id)) continue;
                        var text = strings?[s.Name];
                        skills.Add(new SkillDto(id, Text(text?["name"]), Text(text?["desc"]), MaxLevel(s),
                            Int(s["invisible"]) == 1, LevelText(text, s["common"])));
                        if (s["icon"] is { } icon) data.Icons.TryAdd(id, (icon, source, encryption));
                    }
                    var bookIcon = img["info"]?["icon"];
                    if (bookIcon != null) data.BookIcons[job] = (bookIcon, source, encryption);
                    data.Books.Add(new SkillBookDto(job, Text(strings?[img.Name[..^4]]?["bookName"]), bookIcon != null, skills));
                }
            data.Books.Sort((a, b) => a.Job.CompareTo(b.Job));
            return data;
        }
    }

    /// <summary>Highest level: one entry per level under "level", or common/maxLevel for skills written as formulas.</summary>
    private static int MaxLevel(WzImageProperty skill) =>
        skill["level"]?.WzProperties.Count is > 0 and var n ? n : Int(skill["common"]?["maxLevel"]) ?? 0;

    private static List<string> LevelText(WzImageProperty? text, WzImageProperty? common)
    {
        if (text == null) return [];
        var levels = text.WzProperties
            .Where(p => p.Name.Length > 1 && p.Name[0] == 'h' && p.Name[1..].All(char.IsAsciiDigit))
            .OrderBy(p => int.Parse(p.Name[1..]))
            .Select(p => Text(p) ?? "")
            .ToList();
        if (levels.Count > 0 || Text(text["h"]) is not { } template) return levels;
        // A formula skill shares one template; fill in the values it names (#x, #mpCon, ...) where common has them.
        foreach (var value in common?.WzProperties.OrderByDescending(p => p.Name.Length) ?? Enumerable.Empty<WzImageProperty>())
            if (Text(value) is { } v) template = template.Replace("#" + value.Name, v);
        return [template];
    }

    private static string? Text(WzImageProperty? p) => p switch
    {
        WzStringProperty s => s.Value,
        WzIntProperty i => i.Value.ToString(),
        WzShortProperty i => i.Value.ToString(),
        WzLongProperty i => i.Value.ToString(),
        _ => null,
    };

    private static int? Int(WzImageProperty? p) => int.TryParse(Text(p), out var n) ? n : null;

    /// <summary>Files named {top}.wz, {top}_000.wz, ... under the library, without a modular folder's index stub.</summary>
    private IEnumerable<string> LibraryParts(string top, string extension) =>
        Directory.EnumerateFiles(Root!, top + "*" + extension, SearchOption.AllDirectories)
            .Where(f => System.IO.Path.GetFileNameWithoutExtension(f) is var n
                        && (n == top ? !File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(f)!, top + "_000" + extension))
                            : n.StartsWith(top + "_") && n[(top.Length + 1)..] is { Length: > 0 } digits && digits.All(char.IsAsciiDigit)))
            .Order(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Every readable part of {top} in the library: {top}.wz, its modular parts, then any Data/Packs/{top}_*.ms pack.
    /// </summary>
    private IEnumerable<(WzFile File, string Source, string Encryption)> OpenSources(string top)
    {
        foreach (var path in LibraryParts(top, ".wz"))
            if (OpenReadOnly(path) is { } wz) yield return wz;
        // Newer installs pack some data into Data/Packs/{top}_00000.ms (always BMS), with the pictures in Data/{top}/_Canvas.
        foreach (var path in LibraryParts(top, ".ms"))
        {
            WzFile? file = null;
            try
            {
                using var stream = File.OpenRead(path);
                file = new WzMsFile(stream, System.IO.Path.GetFileName(path), path).LoadAsWzFile();
            }
            catch
            {
                // unreadable pack: what it holds is just missing
            }
            if (file != null) yield return (file, path, nameof(WzMapleVersion.BMS));
        }
    }

    /// <summary>One of String's images (Skill.img: names, descriptions, per-level text), or null when the library has none.</summary>
    private WzImage? OpenStrings(string image)
    {
        foreach (var path in LibraryParts("String", ".wz"))
        {
            if (OpenReadOnly(path) is not { } s) continue;
            if (s.File.WzDirectory.GetImageByName(image) is { } img) return img;
            s.File.Dispose();
        }
        return null;
    }

    private static (WzFile File, string Source, string Encryption)? OpenReadOnly(string path)
    {
        try
        {
            var version = WzTool.DetectMapleVersion(path, out var gameVersion);
            var file = new WzFile(path, gameVersion, version);
            if (file.ParseWzFile() == WzFileParseStatus.Success) return (file, path, version.ToString());
            file.Dispose();
        }
        catch
        {
            // unreadable part: skipped
        }
        return null;
    }
}
