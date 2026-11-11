using System.Globalization;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Entry">The numbered sub property in Category.img that holds it.</param>
public record CategorySubDto(string Entry, int Sub, string Name);
public record CategoryGroupDto(int Category, List<CategorySubDto> Subs);
public record CategoryTable(List<CategoryGroupDto> Categories);
/// <param name="DeletedCommodity">Commodity.img entries removed along with deleted sub tabs.</param>
/// <param name="PackageRefs">Package contents (CashPackage.img) removed with those entries.</param>
public record CategoryResult(CategoryTable Table, OpenedFileDto File, int DeletedCommodity = 0, int PackageRefs = 0);

public record CategoryAddRequest(int Category, string Name);
public record CategoryRenameRequest(string Entry, string Name);

/// <summary>
/// Etc.wz's Category.img: the Cash Shop's tabs. Each numbered entry pairs a Category (a top tab, fixed by the client)
/// and a CategorySub (a sub tab under it) with the Name shown. Only sub tabs are added or removed here.
/// </summary>
/// <remarks>
/// How the v83 client reads it (CCashShop::LoadData, CCSWnd_Tab::ChangeCategory):
/// <list type="bullet">
/// <item>Entries are fetched by name "0", "1", ... up to the entry count, so names must run 0..N-1 without gaps.</item>
/// <item>A category's sub tabs are its run of consecutive entries; the run's order is the order of the buttons.</item>
/// <item>Every Commodity SN in 10000000..79999999 must name an existing (Category, CategorySub) pair
///   (Category = SN / 10000000, CategorySub = SN / 100000 % 100), or the client terminates on entering the Cash Shop.</item>
/// <item>A category with no entries shows a placeholder ("The item is being prepared...", or "Recommended Items" for 1).</item>
/// </list>
/// Adding and deleting therefore renumber every entry, grouped by category, and deleting a sub tab also deletes the
/// Commodity entries filed under it.
/// </remarks>
public sealed partial class WzService
{
    private const string CategoryImg = "Category.img";

    /// <summary>The client's top tabs that Category.img can fill (9 is the wish list, 10 search results).</summary>
    private const int FirstCategory = 1, LastCategory = 8;

    /// <summary>Sub tabs grouped by Category, both in client order. Every client category is listed, even with no sub tabs.</summary>
    public CategoryTable Categories(string id)
    {
        var entry = GetEtcArchive(id);
        lock (entry.Lock) return CategoryTableOf(CategoryImage(entry));
    }

    /// <summary>
    /// Adds a sub tab at the end of a category, numbered with the lowest CategorySub that category doesn't use yet,
    /// then renumbers the entries so each category's sub tabs stay together.
    /// </summary>
    public CategoryResult AddCategorySub(string id, CategoryAddRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Name)) throw new ArgumentException("A name is required.");
        if (req.Category is < FirstCategory or > LastCategory)
            throw new ArgumentException($"Category {req.Category} isn't one of the client's tabs ({FirstCategory}-{LastCategory}).");
        var entry = GetEtcArchive(id);
        lock (entry.Lock)
        {
            var img = CategoryImage(entry);
            var siblings = img.WzProperties.Where(p => CategoryOf(p) == req.Category).ToList();

            var used = siblings.Select(SubOf).OfType<int>().ToHashSet();
            var sub = 0;
            while (used.Contains(sub)) sub++;
            if (sub > 99) throw new InvalidDataException($"Category {req.Category} has no free sub category number left (0-99).");

            // Keep the spelling and types the file already uses (some files store Category as a string).
            var model = siblings.FirstOrDefault() ?? img.WzProperties.FirstOrDefault();
            var next = img.WzProperties.Select(p => int.TryParse(p.Name, out var n) ? n : -1).DefaultIfEmpty(-1).Max() + 1;
            var item = new WzSubProperty(next.ToString(CultureInfo.InvariantCulture));
            foreach (var (name, value) in new[]
                     {
                         ("Category", req.Category.ToString(CultureInfo.InvariantCulture)),
                         ("CategorySub", sub.ToString(CultureInfo.InvariantCulture)),
                         ("Name", req.Name.Trim()),
                     })
            {
                var existing = model == null ? null : FindProp(model, name);
                var type = existing != null && Describe(existing).Type is "int" or "short" or "long" or "string" ? Describe(existing).Type
                    : name == "Name" ? "string" : "int";
                var prop = NewValueProperty(existing?.Name ?? name, type);
                SetValue(prop, value);
                item.AddProperty(prop);
            }

            img.AddProperty(item);
            RenumberCategories(img);
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
    /// Removes sub tabs by entry name, together with every Commodity.img entry whose SN files it under one of them
    /// (the client won't start the Cash Shop with an SN that names a missing tab), then renumbers the entries.
    /// All must exist, or nothing is removed.
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

            // Only drop commodities whose tab disappears entirely (a duplicate entry for the same tab would keep it).
            var remaining = img.WzProperties.Except(props).Select(TabOf).ToHashSet();
            var gone = props.Select(TabOf).Where(t => t != null && !remaining.Contains(t)).ToHashSet();

            var commodityImg = gone.Count == 0 ? null : CommodityImage(entry);
            var commodity = commodityImg == null ? [] : commodityImg.WzProperties
                .Where(p => SnOfEntry(p) is { } v && SnTab(v) is { } t && gone.Contains(t))
                .ToList();
            var packageRefs = commodity.Count > 0 ? RemoveCommodityEntries(entry, commodityImg!, commodity) : 0;

            foreach (var p in props) p.Remove();
            RenumberCategories(img);
            Touch(entry);
            return new CategoryResult(CategoryTableOf(img), Describe(id, entry), commodity.Count, packageRefs);
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
    private static (int, int)? TabOf(WzImageProperty item) => CategoryOf(item) is { } c && SubOf(item) is { } s ? (c, s) : null;

    /// <summary>The tab the client files an SN under, or null for SNs it doesn't file by tab.</summary>
    private static (int, int)? SnTab(int sn) => sn is >= 10000000 and < 80000000 ? (sn / 10000000, sn / 100000 % 100) : null;

    private static int NameOrder(WzImageProperty p) => int.TryParse(p.Name, out var n) ? n : int.MaxValue;

    /// <summary>
    /// Renames the entries "0".."N-1", grouped by Category (ascending) and in their current order within each,
    /// and stores them in that order. The client reads entries by those names and takes each run as one category.
    /// </summary>
    private static void RenumberCategories(WzImage img)
    {
        var ordered = img.WzProperties
            .Select((p, i) => (p, i))
            .OrderBy(x => CategoryOf(x.p) ?? int.MaxValue)
            .ThenBy(x => NameOrder(x.p))
            .ThenBy(x => x.i)
            .Select(x => x.p)
            .ToList();
        img.ClearProperties();
        for (var i = 0; i < ordered.Count; i++)
        {
            ordered[i].Name = i.ToString(CultureInfo.InvariantCulture);
            img.AddProperty(ordered[i]);
        }
        MarkChanged(img);
    }

    private static CategoryTable CategoryTableOf(WzImage img)
    {
        var byCategory = img.WzProperties
            .Where(p => CategoryOf(p) != null)
            .GroupBy(p => CategoryOf(p)!.Value)
            .ToDictionary(g => g.Key, g => g
                .OrderBy(NameOrder)
                .Select(p => new CategorySubDto(p.Name, SubOf(p) ?? -1, FindProp(p, "Name") is { } n ? Describe(n).Value ?? "" : ""))
                .ToList());
        var groups = Enumerable.Range(FirstCategory, LastCategory - FirstCategory + 1)
            .Union(byCategory.Keys)
            .Order()
            .Select(c => new CategoryGroupDto(c, byCategory.GetValueOrDefault(c) ?? []))
            .ToList();
        return new CategoryTable(groups);
    }
}
