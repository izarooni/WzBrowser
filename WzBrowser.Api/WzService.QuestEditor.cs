using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>One change inside a quest.</summary>
/// <param name="Op">
/// "set": give the property a <paramref name="Value"/>, adding it as <paramref name="Type"/> (and the folders it's in) when
/// missing. "folder": add an empty folder when missing. "delete": remove the node. "remove": remove a numbered entry of a
/// list, moving the ones after it up.
/// </param>
/// <param name="Section">"QuestInfo", "Check", "Say" or "Act".</param>
/// <param name="Path">Inside the quest's section, e.g. "0/npc"; empty for the section itself.</param>
public record QuestEditOp(string Op, int Quest, string Section, string Path, string? Value = null, string? Type = null);

public record QuestEditRequest(string Label, List<QuestEditOp> Ops);

/// <param name="From">A quest to copy; null for an empty one.</param>
/// <param name="After">A quest the new one follows: it leads to the new one, which requires it to be completed.</param>
public record QuestCreateRequest(int Id, int? From, int? After);

public sealed partial class WzService
{
    private static readonly string[] QuestSections = ["QuestInfo", "Check", "Say", "Act"];

    /// <summary>The client and server of a classic archive send quest ids as 16-bit numbers.</summary>
    private const int MaxClassicQuestId = ushort.MaxValue;

    /// <summary>Applies edits to one or more quests, all or nothing, as one step that can be undone.</summary>
    public OpenedFileDto EditQuests(string id, QuestEditRequest request)
    {
        if (request.Ops.Count is 0 or > MaxBatchOps)
            throw new ArgumentException($"A quest edit takes 1 to {MaxBatchOps} operations.");
        return ChangeQuests(id, request.Label, ApplyAll);

        void ApplyAll(Entry entry, EditScope edit)
        {
            foreach (var operation in request.Ops) ApplyQuestEdit(entry, edit, operation);
        }
    }

    /// <summary>Adds a quest under an id that no section uses yet.</summary>
    public OpenedFileDto CreateQuest(string id, QuestCreateRequest request)
    {
        return ChangeQuests(id, $"New quest {request.Id}", Create);

        void Create(Entry entry, EditScope edit)
        {
            RequireNewQuestId(entry, request.Id);
            if (entry.ModularQuests) AddQuestImage(entry, edit, request.Id);
            if (request.From is { } source) CopyQuest(entry, edit, source, request.Id);
            if (FindQuestSection(entry, request.Id, "QuestInfo")?["name"] == null)
                SetQuestValue(entry, edit, request.Id, "QuestInfo", "name", "New quest", "string");
            if (request.After is { } previous) ChainQuest(entry, edit, previous, request.Id);
        }
    }

    /// <summary>Removes every section of a quest. Other quests that mention it keep doing so.</summary>
    public OpenedFileDto DeleteQuest(string id, int questId)
    {
        return ChangeQuests(id, $"Delete quest {questId}", Remove);

        void Remove(Entry entry, EditScope edit)
        {
            RequireQuest(entry, questId);
            if (entry.ModularQuests)
            {
                var directory = entry.File.WzDirectory;
                edit.Watch(directory);
                directory.RemoveImage(directory.GetImageByName($"{questId}.img"));
                return;
            }
            foreach (var section in QuestSections)
            {
                if (FindQuestSection(entry, questId, section) is not { } node) continue;
                EditedImage(entry, edit, questId, section);
                node.Remove();
            }
        }
    }

    private OpenedFileDto ChangeQuests(string id, string label, Action<Entry, EditScope> change)
    {
        var entry = GetQuestArchive(id);
        lock (entry.Lock)
        {
            using var edit = new EditScope(entry);
            try
            {
                change(entry, edit);
            }
            catch
            {
                edit.Rollback();
                throw;
            }
            Touch(entry);
            Record(label, edit.Finish());
            return Describe(id, entry);
        }
    }

    private static void ApplyQuestEdit(Entry entry, EditScope edit, QuestEditOp operation)
    {
        var (quest, section) = (operation.Quest, operation.Section);
        if (!QuestSections.Contains(section)) throw new ArgumentException($"'{section}' isn't a quest section.");
        RequireQuest(entry, quest);
        var path = QuestNodePath(entry, quest, section, operation.Path);
        switch (operation.Op)
        {
            case "set" when operation.Value != null:
                SetQuestValue(entry, edit, quest, section, operation.Path, operation.Value, operation.Type);
                break;
            case "folder":
                EnsureFolder(EditedImage(entry, edit, quest, section), path);
                break;
            case "delete":
                NodeAt(EditedImage(entry, edit, quest, section), path).Remove();
                break;
            case "remove":
                RemoveNumbered(NodeAt(EditedImage(entry, edit, quest, section), path));
                break;
            default:
                throw new ArgumentException($"Unknown quest edit '{operation.Op}'.");
        }
    }

    private static void SetQuestValue(
        Entry entry, EditScope edit, int quest, string section, string path, string value, string? type)
    {
        var image = EditedImage(entry, edit, quest, section);
        var full = QuestNodePath(entry, quest, section, path);
        // Some texts are there as a null, which holds no value.
        if (type != null && FindNode(image, full) is WzNullProperty empty) empty.Remove();
        SetMapValue(image, full, value, type);
    }

    /// <summary>The image a quest's section is in, watched and marked as changed.</summary>
    private static WzImage EditedImage(Entry entry, EditScope edit, int questId, string section)
    {
        var image = QuestImage(entry, entry.ModularQuests ? $"{questId}.img" : $"{section}.img");
        edit.Watch(image);
        image.Changed = true;
        return image;
    }

    /// <summary>A path inside a quest's section, from the image that section is in.</summary>
    private static string QuestNodePath(Entry entry, int questId, string section, string path)
    {
        var root = entry.ModularQuests ? section : questId.ToString();
        var inner = Normalize(path);
        return inner.Length == 0 ? root : $"{root}/{inner}";
    }

    private static void RemoveNumbered(WzImageProperty node)
    {
        if (!int.TryParse(node.Name, out var number) || node.Parent is not IPropertyContainer list)
            throw new InvalidDataException($"'{node.Name}' isn't a numbered entry.");
        node.Remove();
        while (list[(number + 1).ToString()] is { } next && next.PropertyType == node.PropertyType)
            next.Name = number++.ToString();
    }

    private static void CopyQuest(Entry entry, EditScope edit, int source, int target)
    {
        RequireQuest(entry, source);
        foreach (var section in QuestSections)
        {
            if (FindQuestSection(entry, source, section) is not { } node) continue;
            var image = EditedImage(entry, edit, target, section);
            PlaceNode(image, node.DeepClone(), QuestNodePath(entry, target, section, ""));
        }
    }

    private static void ChainQuest(Entry entry, EditScope edit, int previous, int next)
    {
        RequireQuest(entry, previous);
        // A quest leads to one other only, so one that already does is left alone; the requirement links them too.
        if (FindQuestSection(entry, previous, "Act")?["1"]?["nextQuest"] == null)
            SetQuestValue(entry, edit, previous, "Act", "1/nextQuest", next.ToString(), "int");

        var required = FindQuestSection(entry, next, "Check")?["0"]?["quest"];
        var number = 0;
        while (required?[number.ToString()] != null) number++;
        SetQuestValue(entry, edit, next, "Check", $"0/quest/{number}/id", previous.ToString(), "int");
        SetQuestValue(entry, edit, next, "Check", $"0/quest/{number}/state", "2", "int");
    }

    private static void AddQuestImage(Entry entry, EditScope edit, int questId)
    {
        var directory = entry.File.WzDirectory;
        edit.Watch(directory);
        directory.AddImage(new WzImage($"{questId}.img") { Parsed = true, Changed = true });
    }

    private static void RequireNewQuestId(Entry entry, int questId)
    {
        if (questId < 1) throw new ArgumentException("A quest id is at least 1.");
        if (!entry.ModularQuests && questId > MaxClassicQuestId)
            throw new ArgumentException($"A quest id is at most {MaxClassicQuestId}.");
        if (QuestExists(entry, questId)) throw new InvalidDataException($"Quest {questId} exists.");
    }

    private static void RequireQuest(Entry entry, int questId)
    {
        if (!QuestExists(entry, questId)) throw new KeyNotFoundException($"Quest {questId} not found.");
    }

    /// <summary>Whether any section uses the id, including for a quest that has no QuestInfo and so isn't listed.</summary>
    private static bool QuestExists(Entry entry, int questId)
    {
        if (entry.ModularQuests) return entry.File.WzDirectory.GetImageByName($"{questId}.img") != null;
        return QuestSections.Any(HasQuest);

        bool HasQuest(string section) => FindQuestSection(entry, questId, section) != null;
    }

    /// <summary>Like <see cref="QuestSection"/>, but null when the archive hasn't the section's image.</summary>
    private static WzImageProperty? FindQuestSection(Entry entry, int questId, string section) => entry.ModularQuests
        ? QuestSection(entry, questId, section)
        : entry.File.WzDirectory.GetImageByName($"{section}.img")?[questId.ToString()];
}
