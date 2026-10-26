using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Archive">The quest archive holding the quest, by its library name (see <see cref="LibraryFile.Name"/>).</param>
/// <param name="Starts">The NPC hands the quest out (Check/0/npc).</param>
/// <param name="Ends">The NPC completes it (Check/1/npc).</param>
public record NpcQuestDto(int Id, string Name, string Archive, bool Starts, bool Ends);

public record NpcDto(int Id, string? Name, List<NpcQuestDto> Quests);

public sealed partial class WzService
{
    /// <summary>The NPCs the library's quests start or end at, with the open archives' revisions it was built from.</summary>
    private (string Key, List<NpcDto> Npcs)? _npcQuests;
    /// <summary>The library's first quest archive, whose neighbours hold the NPCs; "" once looked for and not found.</summary>
    private string? _firstQuestArchive;
    private readonly object _npcsLock = new();

    /// <summary>True when the library has a quest archive whose NPCs can be listed (cheap after the first call).</summary>
    public bool HasNpcQuests => Root != null && FirstQuestArchive() != null;

    /// <summary>
    /// Every NPC that a quest in the library starts or ends at (Check/0/npc, Check/1/npc), with String's names, sorted
    /// by id. Rebuilt when an archive's contents change.
    /// </summary>
    public List<NpcDto> NpcQuests()
    {
        if (Root == null) throw new InvalidDataException("This server isn't pinned to a folder.");
        lock (_npcsLock)
        {
            var archives = QuestArchives().Select(f => (f.Name, Entry: Get(Open(f.Path, null, hidden: true).Id))).ToList();
            var key = string.Join("|", archives.Select(a => $"{a.Name}:{a.Entry.Revision}"));
            if (_npcQuests is { } cached && cached.Key == key) return cached.Npcs;

            var byNpc = new Dictionary<int, Dictionary<(string, int), NpcQuestDto>>();
            void Add(int npc, string archive, int quest, string name, bool starts)
            {
                if (!byNpc.TryGetValue(npc, out var quests)) byNpc[npc] = quests = [];
                var q = quests.GetValueOrDefault((archive, quest)) ?? new NpcQuestDto(quest, name, archive, false, false);
                quests[(archive, quest)] = starts ? q with { Starts = true } : q with { Ends = true };
            }

            foreach (var (archive, entry) in archives)
                lock (entry.Lock)
                    foreach (var (quest, check) in QuestChecks(entry))
                    {
                        var name = QuestName(entry, quest);
                        if (IntOf(check["0"]?["npc"]) is { } start) Add(start, archive, quest, name, starts: true);
                        if (IntOf(check["1"]?["npc"]) is { } end) Add(end, archive, quest, name, starts: false);
                    }

            Dictionary<int, string> names = [];
            if (archives.Count > 0)
                using (var index = new NameIndex(archives[0].Entry.Path, InRoot))
                    names = index.Resolve("npc", byNpc.Keys);
            var npcs = byNpc.OrderBy(kv => kv.Key)
                .Select(kv => new NpcDto(kv.Key, names.GetValueOrDefault(kv.Key), kv.Value.Values.OrderBy(q => q.Id).ToList()))
                .ToList();
            _npcQuests = (key, npcs);
            return npcs;
        }
    }

    /// <summary>The NPC's standing sprite, following info/link to the NPC it borrows its look from.</summary>
    public byte[]? NpcSprite(int id)
    {
        if (FirstQuestArchive() is not { } archive) return null;
        for (var hops = 0; hops < 4; hops++)
        {
            var loc = LocateNear(archive, "npc", id);
            if (loc == null) return null;
            if (Preview(loc, "npc") is { } png) return png;
            var entry = Get(loc.FileId);
            int? link;
            lock (entry.Lock) link = Resolve(entry.File, loc.Path) is WzImage img ? Int(img["info"]?["link"]) : null;
            if (link is not { } next || next == id) return null;
            id = next;
        }
        return null;
    }

    /// <summary>Each quest's Check section: Check.img/{id} in a classic archive, {id}.img/Check in a modular one.</summary>
    private static IEnumerable<(int Quest, WzImageProperty Check)> QuestChecks(Entry entry)
    {
        if (entry.ModularQuests)
        {
            foreach (var img in entry.File.WzDirectory.WzImages)
                if (ModularQuestId(img.Name) is { } qid && img["Check"] is { } check)
                    yield return (qid, check);
        }
        else
        {
            foreach (var p in entry.File.WzDirectory.GetImageByName("Check.img")?.WzProperties ?? Enumerable.Empty<WzImageProperty>())
                if (int.TryParse(p.Name, out var qid))
                    yield return (qid, p);
        }
    }

    private string? FirstQuestArchive()
    {
        lock (_npcsLock)
        {
            if (_firstQuestArchive == null)
            {
                try { _firstQuestArchive = QuestArchives().FirstOrDefault()?.Path ?? ""; }
                catch (DirectoryNotFoundException) { return null; } // looked for again once the folder exists
            }
            return _firstQuestArchive is { Length: > 0 } s ? s : null;
        }
    }

    private IEnumerable<LibraryFile> QuestArchives() => Library(browsableOnly: true).Where(f => f.Kind == "quest");
}
