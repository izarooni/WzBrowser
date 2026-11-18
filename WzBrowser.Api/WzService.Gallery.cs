using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Path">The node the thumbnail stands for (an .img, a skill, an item, an animation).</param>
/// <param name="Label">What to show under the thumbnail: the .img's name, else the name from String, else the path.</param>
/// <param name="Title">More about it for a tooltip: the name from String under an .img's name, or the path under a name.</param>
/// <param name="Picture">The canvas to show, for /png (an animation's first frame).</param>
/// <param name="Frames">Set when the thumbnail is an animation: its frames in order.</param>
public record GalleryItem(string Path, string Label, string? Title, string Picture, List<GalleryFrame>? Frames);

/// <param name="Delay">How long the frame shows, in milliseconds.</param>
public record GalleryFrame(string Picture, int Delay);

/// <summary>One part of a gallery as it is read, so thumbnails show while the rest of the file is still being read.</summary>
/// <param name="Items">The thumbnails found since the last chunk.</param>
/// <param name="Done">The last chunk: the whole file has been read.</param>
/// <param name="Truncated">The file has more than <see cref="WzService.GalleryLimit"/> thumbnails; the rest were left out.</param>
public record GalleryChunk(List<GalleryItem> Items, bool Done, bool Truncated);

public sealed partial class WzService
{
    public const int GalleryLimit = 20000;

    /// <summary>Where a thing's picture is looked for, best first: its first stand, move or fly frame, then its icon.</summary>
    private static readonly string[] GalleryAnimations = ["stand", "move", "fly"];
    private static readonly string[] GalleryIcons = ["icon", "iconRaw"];

    /// <summary>A modular install's picture file: _Canvas*.wz in a _Canvas folder (Data/Mob/_Canvas/_Canvas_000.wz).</summary>
    private static bool IsCanvasFile(string path) =>
        System.IO.Path.GetFileName(path).StartsWith("_Canvas", StringComparison.OrdinalIgnoreCase)
        && System.IO.Path.GetFileName(System.IO.Path.GetDirectoryName(path)) is { } dir
        && dir.Equals("_Canvas", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Which String names a _Canvas file's ids are, from the folders above it: Mob, Npc, Skill (not MobSkill), Item/* and
    /// Character/* (items), Map/Map/Map0 (maps). Null when its ids aren't named anywhere.
    /// </summary>
    private static string? CanvasNames(string path)
    {
        var canvasDir = System.IO.Path.GetDirectoryName(path);
        var parent = System.IO.Path.GetDirectoryName(canvasDir);
        string? Name(string? dir) => dir == null ? null : System.IO.Path.GetFileName(dir).ToLowerInvariant();
        var (p, g) = (Name(parent), Name(System.IO.Path.GetDirectoryName(parent)));
        return p switch
        {
            "mob" => "mob",
            "npc" => "npc",
            "skill" => "skill",
            _ when g is "item" or "character" && p != "afterimage" => "item",
            _ when g == "map" && p!.StartsWith("map") && p.Length > 3 => "map",
            _ => null,
        };
    }

    /// <summary>How often a chunk goes out while reading: after this many thumbnails, or this long.</summary>
    private const int GalleryChunkItems = 300;
    private static readonly TimeSpan GalleryChunkTime = TimeSpan.FromMilliseconds(150);

    /// <summary>
    /// A _Canvas file as thumbnails, in chunks as its .imgs are read. Each thing in it (an .img, or a node inside one: a
    /// skill, an item) shows its first stand, move or fly frame, else its icon or iconRaw (also under info). Anything else
    /// that is a series of numbered pictures (0, 1, 2, ...) shows as an animation. The file is locked one .img at a time,
    /// so its pictures can be fetched while the rest is still being read.
    /// </summary>
    public IEnumerable<GalleryChunk> Gallery(string id)
    {
        var entry = Get(id);
        if (entry.Kind != "canvas") throw new InvalidDataException("This file isn't a _Canvas file.");
        return GalleryChunks(entry);
    }

    private IEnumerable<GalleryChunk> GalleryChunks(Entry entry)
    {
        List<(WzImage Image, string Path)> images;
        NameIndex names;
        lock (entry.Lock)
        {
            names = entry.Names ??= new NameIndex(entry.Path, InRoot);
            images = Images(entry.File.WzDirectory, "").ToList();
        }
        var kind = CanvasNames(entry.Path);

        var found = new List<(string Path, bool IsImage, string Picture, List<GalleryFrame>? Frames)>();
        var total = 0;
        var truncated = false;

        void Add(string path, object node, string picture, List<GalleryFrame>? frames)
        {
            if (total >= GalleryLimit) { truncated = true; return; }
            total++;
            found.Add((path, node is WzImage, picture, frames));
        }

        // iconsOnly: below a thing found by its info/icon (a skill book's job, an item group), only things with their own
        // picture count; the rest of it is that thing's parts, not more things.
        void Visit(object node, string path, bool iconsOnly)
        {
            if (truncated) return;
            foreach (var name in GalleryAnimations)
                if (FirstFrame(Child(node, name)) is { } frame) { Add(path, node, $"{path}/{name}/{frame}", null); return; }
            foreach (var name in GalleryIcons)
                if (IsPicture(Child(node, name))) { Add(path, node, $"{path}/{name}", null); return; }

            var viaInfo = false;
            foreach (var name in GalleryIcons)
                if (IsPicture(Child(Child(node, "info"), name))) { Add(path, node, $"{path}/info/{name}", null); viaInfo = true; break; }

            if (!viaInfo && !iconsOnly && Frames(node, path) is { Count: > 0 } frames)
            {
                Add(path, node, frames[0].Picture, frames.Count > 1 ? frames : null);
                return;
            }
            foreach (var child in Children(node))
                if (child is WzSubProperty && !(viaInfo && child.Name == "info"))
                    Visit(child, $"{path}/{child.Name}", iconsOnly || viaInfo);
        }

        // Names come from the String files beside the install; without them, the ids and paths stand in.
        static int? IdOf(string path)
        {
            var name = path[(path.LastIndexOf('/') + 1)..];
            if (name.EndsWith(".img", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
            return int.TryParse(name, out var n) ? n : null;
        }

        // An .img is labelled like a file, with its name on hover; a node inside one by its name, with its path on hover.
        List<GalleryItem> Take()
        {
            var resolved = kind != null ? names.Resolve(kind, found.Select(f => IdOf(f.Path)).OfType<int>()) : [];
            string? NameOf(string path) => IdOf(path) is { } n && resolved.TryGetValue(n, out var name) ? name : null;
            var items = found.Select(f => f.IsImage
                ? new GalleryItem(f.Path, f.Path[(f.Path.LastIndexOf('/') + 1)..], NameOf(f.Path), f.Picture, f.Frames)
                : NameOf(f.Path) is { } name
                    ? new GalleryItem(f.Path, name, f.Path, f.Picture, f.Frames)
                    : new GalleryItem(f.Path, f.Path, null, f.Picture, f.Frames)).ToList();
            found.Clear();
            return items;
        }

        var since = System.Diagnostics.Stopwatch.StartNew();
        foreach (var (img, path) in images)
        {
            lock (entry.Lock)
            {
                // The file may have been edited between .imgs; one that was removed is just skipped.
                if (img.Parent == null) continue;
                Visit(img, path, iconsOnly: false);
            }
            if (truncated) break;
            if (found.Count >= GalleryChunkItems || found.Count > 0 && since.Elapsed >= GalleryChunkTime)
            {
                yield return new GalleryChunk(Take(), Done: false, Truncated: false);
                since.Restart();
            }
        }
        yield return new GalleryChunk(Take(), Done: true, truncated);
    }

    /// <summary>Every image in a directory and the ones below it, with its path from the file root.</summary>
    private static IEnumerable<(WzImage Image, string Path)> Images(WzDirectory dir, string prefix)
    {
        foreach (var img in dir.WzImages) yield return (img, prefix + img.Name);
        foreach (var sub in dir.WzDirectories)
            foreach (var found in Images(sub, prefix + sub.Name + "/")) yield return found;
    }

    private static WzImageProperty? Child(object? node, string name) => node switch
    {
        WzImage img => img[name],
        WzImageProperty prop => prop[name],
        _ => null,
    };

    private static IEnumerable<WzImageProperty> Children(object node) => node switch
    {
        WzImage img => img.WzProperties,
        WzImageProperty prop => (IEnumerable<WzImageProperty>?)prop.WzProperties ?? [],
        _ => [],
    };

    private static bool IsPicture(WzImageProperty? prop) => prop is WzCanvasProperty or WzUOLProperty;

    /// <summary>The numbered pictures directly under a node (0, 1, 2, ...), in order, with each one's delay.</summary>
    private static List<GalleryFrame> Frames(object node, string path) =>
        Children(node)
            .Where(p => IsPicture(p) && int.TryParse(p.Name, out _))
            .OrderBy(p => int.Parse(p.Name))
            .Select(p => new GalleryFrame($"{path}/{p.Name}",
                Int((p as WzCanvasProperty ?? p.GetLinkedWzImageProperty() as WzCanvasProperty)?["delay"]) is int d and > 0 ? d : 100))
            .ToList();

    /// <summary>The lowest numbered frame of an animation that is (or links to) a picture.</summary>
    private static string? FirstFrame(WzImageProperty? animation) =>
        animation?.WzProperties?
            .Where(p => IsPicture(p) && int.TryParse(p.Name, out _))
            .OrderBy(p => int.Parse(p.Name))
            .FirstOrDefault()?.Name;
}
