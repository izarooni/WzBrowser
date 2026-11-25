using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="File">The file the node was in, with unsaved changes.</param>
/// <param name="Strings">The String files names were deleted from, each now listed as open with unsaved changes.</param>
public record NodeDeleteResult(OpenedFileDto File, List<StringsDeleted> Strings);

/// <param name="Paths">Where the deleted entries were in it ("Eqp.img/Eqp/Weapon/1302000").</param>
public record StringsDeleted(OpenedFileDto File, List<string> Paths);

public sealed partial class WzService
{
    /// <summary>
    /// Deletes a node, in memory only. With <paramref name="strings"/>, String's entries naming what it is go too: an item,
    /// mob, NPC, map or skill, or every one in a folder or .img of them (see <see cref="StringIds"/>). Those String files
    /// become listed open files with unsaved changes, to be saved from their own windows.
    /// </summary>
    public NodeDeleteResult Delete(string id, string path, bool strings = false)
    {
        var entry = Get(id);
        path = Normalize(path);
        if (path.Length == 0) throw new InvalidDataException("The file root can't be deleted.");

        (string Image, HashSet<int> Ids)? names = null;
        lock (entry.Lock)
        {
            var node = Resolve(entry.File, path);
            if (strings) names = StringIds(entry, path, node);
        }

        // String first, so a String that can't be changed leaves the node in place. Its lock isn't held with this file's.
        var removed = new List<StringsDeleted>();
        var edits = new List<FileEdit?>();
        if (names is ({ } image, { Count: > 0 } ids))
        {
            foreach (var (fileId, stringEntry, img) in StringImages(entry.Path, image))
            {
                lock (stringEntry.Lock)
                {
                    var hits = new List<WzSubProperty>();
                    CollectStringEntries(img.WzProperties, ids, hits);
                    if (hits.Count == 0) continue;
                    using var stringEdit = new EditScope(stringEntry).Watch(img);
                    var paths = hits.Select(PathInImage).ToList();
                    foreach (var hit in hits) hit.Remove();
                    img.Changed = true;
                    Touch(stringEntry);
                    edits.Add(stringEdit.Finish());
                    stringEntry.Hidden = false;
                    removed.Add(new StringsDeleted(Describe(fileId, stringEntry), paths));
                }
            }
        }

        lock (entry.Lock)
        {
            // Looked up again: it may have gone while the lock was released.
            var node = Resolve(entry.File, path);
            using var edit = new EditScope(entry).Watch((node as WzObject)?.Parent);
            MarkChanged(node);
            ((WzObject)node).Remove();
            Touch(entry);
            edits.Add(edit.Finish());
            Record($"Delete {((WzObject)node).Name}", edits);
            return new NodeDeleteResult(Describe(id, entry), removed);
        }
    }

    /// <summary>
    /// The String image naming what a node is, and the ids in it that the node holds, or null when String doesn't name it.
    /// Read as in a classic install (<see cref="WzLayout.Classic"/>):
    /// <list type="bullet">
    /// <item>Character: each .img is an item (Eqp.img).</item>
    /// <item>Item: Consume, Install, Etc and Cash keep items in .imgs of 100 (0200.img/02000000); Pet's .imgs are items.</item>
    /// <item>Mob, Npc, Map/Map: each .img is one.</item>
    /// <item>Skill: a job's .img (100.img) holds its skills under skill/; String names the job and each skill.</item>
    /// </list>
    /// A folder stands for every .img below it.
    /// </summary>
    private static (string Image, HashSet<int> Ids)? StringIds(Entry entry, string path, object node)
    {
        var (top, at) = WzLayout.Classic(entry.Path, path);
        if (entry.Kind == "character") top = "Character";
        var segs = at.Split('/');

        HashSet<int> ImageIds() => node switch
        {
            WzImage img => IdOfImage(img.Name) is { } n ? [n] : [],
            WzDirectory dir => Images(dir, "").Select(i => IdOfImage(i.Image.Name)).OfType<int>().ToHashSet(),
            _ => [],
        };
        static IEnumerable<int> Children(WzImage img) => img.WzProperties.Select(p => Id(p.Name)).OfType<int>();
        static int? Id(string name) => int.TryParse(name, out var n) ? n : null;

        switch (top.ToLowerInvariant())
        {
            case "character":
                return (EqpImg, ImageIds());
            case "mob":
                return ("Mob.img", ImageIds());
            case "npc":
                return ("Npc.img", ImageIds());
            case "map" when segs[0].Equals("Map", StringComparison.OrdinalIgnoreCase):
                return ("Map.img", ImageIds());
            case "item":
            {
                if (ItemStringImage(segs[0]) is not { } image) return null;
                if (image == "Pet.img") return (image, ImageIds());
                return node switch
                {
                    WzImageProperty p when segs.Length == 3 => Id(p.Name) is { } n ? (image, [n]) : null,
                    WzImage img => (image, Children(img).ToHashSet()),
                    WzDirectory dir => (image, Images(dir, "").SelectMany(i => Children(i.Image)).ToHashSet()),
                    _ => null,
                };
            }
            case "skill":
                return node switch
                {
                    WzImage img when IdOfImage(img.Name) is { } job =>
                        ("Skill.img", [job, .. img["skill"]?.WzProperties.Select(p => Id(p.Name)).OfType<int>() ?? []]),
                    WzImageProperty p when segs.Length == 3 && segs[1].Equals("skill", StringComparison.OrdinalIgnoreCase) =>
                        Id(p.Name) is { } n ? ("Skill.img", [n]) : null,
                    _ => null,
                };
            default:
                return null;
        }
    }

    /// <summary>
    /// The String files next to an archive that hold <paramref name="image"/>, opened as (hidden) open files so edits made
    /// to them show in String's own window and can be saved from there.
    /// </summary>
    private IEnumerable<(string Id, Entry Entry, WzImage Image)> StringImages(string archivePath, string image)
    {
        if (WzLayout.Find(archivePath, "String", "") is not var (files, _)) yield break;
        foreach (var path in files.Where(InRoot))
        {
            OpenedFileDto dto;
            try { dto = Open(path, null, hidden: true); }
            catch { continue; }
            var entry = Get(dto.Id);
            WzImage? img;
            lock (entry.Lock) img = entry.File.WzDirectory.GetImageByName(image);
            if (img != null) yield return (dto.Id, entry, img);
        }
    }

    /// <summary>String's entry for an id: the first node named by it, at any depth below the image's groups.</summary>
    private static WzSubProperty? FindStringEntry(IEnumerable<WzImageProperty> nodes, int id)
    {
        foreach (var node in nodes)
        {
            if (int.TryParse(node.Name, out var n)) { if (n == id && node is WzSubProperty sub) return sub; }
            else if (node.WzProperties is { Count: > 0 } children && FindStringEntry(children, id) is { } hit) return hit;
        }
        return null;
    }

    /// <summary>Every entry named by one of <paramref name="ids"/>, at any depth below the image's groups.</summary>
    private static void CollectStringEntries(IEnumerable<WzImageProperty> nodes, HashSet<int> ids, List<WzSubProperty> hits)
    {
        foreach (var node in nodes)
        {
            if (int.TryParse(node.Name, out var n)) { if (ids.Contains(n) && node is WzSubProperty sub) hits.Add(sub); }
            else if (node.WzProperties is { Count: > 0 } children) CollectStringEntries(children, ids, hits);
        }
    }

    /// <summary>A property's path from the file root, starting at its .img ("Eqp.img/Eqp/Weapon/1302000").</summary>
    private static string PathInImage(WzImageProperty prop)
    {
        var path = prop.Name;
        for (var p = prop.Parent; p != null; p = p.Parent)
        {
            if (p is WzImage img) return $"{img.Name}/{path}";
            path = $"{p.Name}/{path}";
        }
        return path;
    }
}
