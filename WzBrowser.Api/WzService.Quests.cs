using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public record QuestSummary(int Id, string Name);

/// <summary>A property and everything below it, in file order (dialogue pages and branches are positional).</summary>
public record PropTree(string Name, string Type, string? Value, List<PropTree>? Children);

public record QuestDetail(int Id, string Name, PropTree? Info, PropTree? Check, PropTree? Say, PropTree? Act);

public record LookupRequest(List<int>? Npc, List<int>? Item, List<int>? Mob, List<int>? Map, List<int>? Skill, List<int>? Quest);

public sealed partial class WzService
{
    /// <summary>Every quest in QuestInfo.img as id + name, sorted by id.</summary>
    public List<QuestSummary> Quests(string id)
    {
        var entry = GetQuestArchive(id);
        lock (entry.Lock)
        {
            var info = QuestImage(entry, "QuestInfo.img");
            var list = new List<QuestSummary>(info.WzProperties.Count);
            foreach (var p in info.WzProperties)
                if (int.TryParse(p.Name, out var qid))
                    list.Add(new QuestSummary(qid, (p["name"] as WzStringProperty)?.Value ?? ""));
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
            PropTree? Section(string image) =>
                QuestImage(entry, image)[questId.ToString()] is { } p ? ToTree(p) : null;

            var info = Section("QuestInfo.img");
            var (check, say, act) = (Section("Check.img"), Section("Say.img"), Section("Act.img"));
            if (info == null && check == null && say == null && act == null)
                throw new KeyNotFoundException($"Quest {questId} not found.");
            var name = info?.Children?.FirstOrDefault(c => c.Name == "name")?.Value ?? "";
            return new QuestDetail(questId, name, info, check, say, act);
        }
    }

    /// <summary>Resolves ids to names. Kinds that can't be resolved (no String.wz) simply come back empty.</summary>
    public Dictionary<string, Dictionary<int, string>> Lookup(string id, LookupRequest req)
    {
        var entry = GetLinkingArchive(id);
        NameIndex names;
        lock (entry.Lock) names = entry.Names ??= new NameIndex(entry.Path);

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
                var info = QuestImage(entry, "QuestInfo.img");
                foreach (var qid in req.Quest)
                    if ((info[qid.ToString()]?["name"] as WzStringProperty)?.Value is { Length: > 0 } name)
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
