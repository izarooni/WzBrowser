using System.Globalization;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Entry">The numbered sub property in Category.img that holds it.</param>
public record CategorySubDto(string Entry, int Sub, string Name);
public record CategoryGroupDto(int Category, List<CategorySubDto> Subs);
public record CategoryTable(List<CategoryGroupDto> Categories);
public record CategoryResult(CategoryTable Table, OpenedFileDto File);

public record CategoryAddRequest(int Category, string Name);
public record CategoryRenameRequest(string Entry, string Name);

/// <summary>
/// Etc.wz's Category.img: the Cash Shop's tabs. Each numbered entry pairs a Category (a top tab, fixed by the client)
/// and a CategorySub (a sub tab under it) with the Name shown. Only sub tabs are added or removed here.
/// </summary>
public sealed partial class WzService
{
    private const string CategoryImg = "Category.img";

    /// <summary>Sub tabs grouped by Category, both in ascending order.</summary>
    public CategoryTable Categories(string id)
    {
        var entry = GetEtcArchive(id);
        lock (entry.Lock) return CategoryTableOf(CategoryImage(entry));
    }

    /// <summary>
    /// Adds a sub tab under an existing Category, numbered with the lowest CategorySub that category doesn't use yet,
    /// in a new entry named one past the highest numbered entry.
    /// </summary>
    public CategoryResult AddCategorySub(string id, CategoryAddRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) throw new ArgumentException("A name is required.");
        var entry = GetEtcArchive(id);
        lock (entry.Lock)
        {
            var img = CategoryImage(entry);
            var siblings = img.WzProperties.Where(p => CategoryOf(p) == req.Category).ToList();
            if (siblings.Count == 0)
                throw new ArgumentException($"There is no Category {req.Category}; the client's categories are fixed, so only sub categories can be added.");

            var used = siblings.Select(SubOf).OfType<int>().ToHashSet();
            var sub = 0;
            while (used.Contains(sub)) sub++;

            // Keep the spelling and types the category's existing entries use (some files store Category as a string).
            var model = siblings[0];
            var next = img.WzProperties.Select(p => int.TryParse(p.Name, out var n) ? n : -1).DefaultIfEmpty(-1).Max() + 1;
            var item = new WzSubProperty(next.ToString(CultureInfo.InvariantCulture));
            foreach (var (name, value) in new[]
                     {
                         ("Category", req.Category.ToString(CultureInfo.InvariantCulture)),
                         ("CategorySub", sub.ToString(CultureInfo.InvariantCulture)),
                         ("Name", req.Name.Trim()),
                     })
            {
                var existing = FindProp(model, name);
                var type = existing != null && Describe(existing).Type is "int" or "short" or "long" or "string" ? Describe(existing).Type
                    : name == "Name" ? "string" : "int";
                var prop = NewValueProperty(existing?.Name ?? name, type);
                SetValue(prop, value);
                item.AddProperty(prop);
            }

            img.AddProperty(item);
            MarkChanged(img);
            Touch(entry);
            return new CategoryResult(CategoryTableOf(img), Describe(id, entry));
        }
    }

    /// <summary>Changes the Name shown for a sub tab.</summary>
    public CategoryResult RenameCategorySub(string id, CategoryRenameRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) throw new ArgumentException("A name is required.");
        var entry = GetEtcArchive(id);
        lock (entry.Lock)
        {
            var img = CategoryImage(entry);
            var item = img[req.Entry] as WzSubProperty ?? throw new KeyNotFoundException($"Entry '{req.Entry}' not found in {CategoryImg}.");
            var prop = FindProp(item, "Name");
            if (prop == null) item.AddProperty(prop = NewValueProperty("Name", "string"));
            SetValue(prop, req.Name.Trim());
            MarkChanged(item);
            Touch(entry);
            return new CategoryResult(CategoryTableOf(img), Describe(id, entry));
        }
    }

    /// <summary>
    /// Removes sub tabs by entry name. All must exist, or nothing is removed, and a category is never left without
    /// any sub tab (that would remove the category itself, which the client expects to find).
    /// </summary>
    public CategoryResult DeleteCategorySubs(string id, List<string> entries)
    {
        if (entries.Count == 0) throw new ArgumentException("Nothing to delete.");
        var entry = GetEtcArchive(id);
        lock (entry.Lock)
        {
            var img = CategoryImage(entry);
            var props = entries.Distinct().Select(name =>
                img[name] ?? throw new KeyNotFoundException($"Entry '{name}' not found in {CategoryImg}.")).ToList();

            foreach (var g in props.GroupBy(CategoryOf))
            {
                var total = img.WzProperties.Count(p => CategoryOf(p) == g.Key);
                if (g.Count() >= total)
                    throw new InvalidDataException($"Category {g.Key} needs at least one sub category; it can't be removed.");
            }

            foreach (var p in props) p.Remove();
            MarkChanged(img);
            Touch(entry);
            return new CategoryResult(CategoryTableOf(img), Describe(id, entry));
        }
    }

    // ------------------------------------------------------------------ helpers

    private static WzImage CategoryImage(Entry entry)
    {
        var img = entry.File.WzDirectory.GetImageByName(CategoryImg)
            ?? throw new KeyNotFoundException($"'{CategoryImg}' not found in {entry.File.Name}.");
        if (!img.Parsed) img.ParseImage();
        return img;
    }

    private static int? IntOf(WzImageProperty item, string name) =>
        FindProp(item, name) is { } p && int.TryParse(Describe(p).Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) ? n : null;

    private static int? CategoryOf(WzImageProperty item) => IntOf(item, "Category");
    private static int? SubOf(WzImageProperty item) => IntOf(item, "CategorySub");

    private static CategoryTable CategoryTableOf(WzImage img)
    {
        var groups = img.WzProperties
            .Where(p => CategoryOf(p) != null)
            .GroupBy(p => CategoryOf(p)!.Value)
            .OrderBy(g => g.Key)
            .Select(g => new CategoryGroupDto(g.Key, g
                .Select(p => new CategorySubDto(p.Name, SubOf(p) ?? -1, FindProp(p, "Name") is { } n ? Describe(n).Value ?? "" : ""))
                .OrderBy(s => s.Sub).ThenBy(s => s.Entry, StringComparer.Ordinal)
                .ToList()))
            .ToList();
        return new CategoryTable(groups);
    }
}
