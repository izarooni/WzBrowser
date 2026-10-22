using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public record QuestSummary(int Id, string Name);

/// <summary>A property and everything below it, in file order (dialogue pages and branches are positional).</summary>
public record PropTree(string Name, string Type, string? Value, List<PropTree>? Children);

/// <summary>Where each section lives in the raw tree: "QuestInfo.img/1000" in a classic archive, "1000.img/QuestInfo" in a modular one.</summary>
public record QuestPaths(string Info, string Check, string Say, string Act);

public record QuestDetail(int Id, string Name, PropTree? Info, PropTree? Check, PropTree? Say, PropTree? Act, QuestPaths Paths);

public record LookupRequest(List<int>? Npc, List<int>? Item, List<int>? Mob, List<int>? Map, List<int>? Skill, List<int>? Quest);

public sealed partial class WzService
{
    /// <summary>Every quest (in QuestInfo.img, or each {id}.img of a modular archive) as id + name, sorted by id.</summary>
    public List<QuestSummary> Quests(string id)
    {
        var entry = GetQuestArchive(id);
        lock (entry.Lock)
        {
            var list = new List<QuestSummary>();
            if (entry.ModularQuests)
            {
                // A quest that has no QuestInfo is still listed (unnamed) so its other sections can be viewed.
                foreach (var img in entry.File.WzDirectory.WzImages)
                    if (ModularQuestId(img.Name) is { } qid)
                        list.Add(new QuestSummary(qid, (img["QuestInfo"]?["name"] as WzStringProperty)?.Value ?? ""));
            }
            else
            {
                foreach (var p in QuestImage(entry, "QuestInfo.img").WzProperties)
                    if (int.TryParse(p.Name, out var qid))
                        list.Add(new QuestSummary(qid, (p["name"] as WzStringProperty)?.Value ?? ""));
            }
            list.Sort((a, b) => a.Id.CompareTo(b.Id));
            return list;
        }
    }

    /// <summary>One quest's data from QuestInfo, Check, Say and Act.</summary>
    public QuestDetail Quest(string id, int questId)
    {
        var entry = GetQuestArchive(id);
        lock (entry.Lock)
        {
            PropTree? Section(string name) => QuestSection(entry, questId, name) is { } p ? ToTree(p) : null;

            var info = Section("QuestInfo");
            var (check, say, act) = (Section("Check"), Section("Say"), Section("Act"));
            if (info == null && check == null && say == null && act == null)
                throw new KeyNotFoundException($"Quest {questId} not found.");
            var name = info?.Children?.FirstOrDefault(c => c.Name == "name")?.Value ?? "";
            var paths = new QuestPaths(SectionPath(entry, questId, "QuestInfo"), SectionPath(entry, questId, "Check"),
                SectionPath(entry, questId, "Say"), SectionPath(entry, questId, "Act"));
            return new QuestDetail(questId, name, info, check, say, act, paths);
        }
    }

    /// <summary>Resolves ids to names. Kinds that can't be resolved (no String.wz) simply come back empty.</summary>
    public Dictionary<string, Dictionary<int, string>> Lookup(string id, LookupRequest req)
    {
        var entry = GetLinkingArchive(id);
        NameIndex names;
        lock (entry.Lock) names = entry.Names ??= new NameIndex(entry.Path, InRoot);

        var result = new Dictionary<string, Dictionary<int, string>>
        {
            ["npc"] = names.Resolve("npc", req.Npc ?? []),
            ["item"] = names.Resolve("item", req.Item ?? []),
            ["mob"] = names.Resolve("mob", req.Mob ?? []),
            ["map"] = names.Resolve("map", req.Map ?? []),
            ["skill"] = names.Resolve("skill", req.Skill ?? []),
            ["quest"] = [],
        };

        if (req.Quest is { Count: > 0 } && entry.Kind == "quest")
        {
            // Quest names come from the open archive itself, so they reflect unsaved edits too.
            lock (entry.Lock)
            {
                foreach (var qid in req.Quest)
                    if ((QuestSection(entry, qid, "QuestInfo")?["name"] as WzStringProperty)?.Value is { Length: > 0 } name)
                        result["quest"][qid] = name;
            }
        }
        return result;
    }

    private Entry GetQuestArchive(string id)
    {
        var entry = Get(id);
        if (entry.Kind != "quest") throw new InvalidDataException("This file isn't a quest archive.");
        return entry;
    }

    /// <summary>A file whose views link to things in the neighbouring files: a quest archive or Etc.wz.</summary>
    private Entry GetLinkingArchive(string id)
    {
        var entry = Get(id);
        if (entry.Kind is not ("quest" or "etc")) throw new InvalidDataException("This file doesn't link to other files.");
        return entry;
    }

    private static WzImage QuestImage(Entry entry, string name) =>
        entry.File.WzDirectory.GetImageByName(name) ?? throw new KeyNotFoundException($"'{name}' not found in {entry.File.Name}.");

    /// <summary>
    /// A quest's QuestInfo, Check, Say or Act. A classic archive has one image per section keyed by quest id
    /// (QuestInfo.img/1000); a modular one (Data/Quest/QuestData) has one image per quest holding the sections (1000.img/QuestInfo).
    /// </summary>
    private static WzImageProperty? QuestSection(Entry entry, int questId, string section) => entry.ModularQuests
        ? entry.File.WzDirectory.GetImageByName($"{questId}.img")?[section]
        : QuestImage(entry, section + ".img")[questId.ToString()];

    private static string SectionPath(Entry entry, int questId, string section) =>
        entry.ModularQuests ? $"{questId}.img/{section}" : $"{section}.img/{questId}";

    private static int? ModularQuestId(string imageName) =>
        imageName.EndsWith(".img", StringComparison.OrdinalIgnoreCase) && int.TryParse(imageName[..^4], out var id) ? id : null;

    /// <summary>The modular layout: images named by quest id, the first of which has a QuestInfo or Check section.</summary>
    private static bool IsModularQuestArchive(WzDirectory root) =>
        root.WzImages.FirstOrDefault(i => ModularQuestId(i.Name) != null) is { } img && (img["QuestInfo"] ?? img["Check"]) != null;

    private static PropTree ToTree(WzImageProperty prop)
    {
        var node = Describe(prop);
        List<PropTree>? children = null;
        if (prop is not WzUOLProperty && prop.WzProperties is { Count: > 0 } kids)
        {
            children = new List<PropTree>(kids.Count);
            foreach (var k in kids) children.Add(ToTree(k));
        }
        return new PropTree(node.Name, node.Type, node.Value, children);
    }
}
