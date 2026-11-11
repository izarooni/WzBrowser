using System.Globalization;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>
/// Keeps Commodity.img and CashPackage.img in the layout the v83 client reads them in:
/// <list type="bullet">
/// <item>Commodity.img entries are fetched by name "0".."N-1" (sub_480C4D); a gap stops the load.</item>
/// <item>CCashShop::LoadData files entries under their SN's tab in name order and takes each tab as one run of
///   consecutive entries; a tab split into several runs keeps only its last run.</item>
/// <item>A package's contents, CashPackage.img/{itemId}/SN/"0".."N-1", are read until the first missing or zero
///   value (sub_47FF89).</item>
/// </list>
/// </summary>
public sealed partial class WzService
{
    private const string CashPackageImg = "CashPackage.img";

    private static int? SnOfEntry(WzImageProperty item) =>
        FindProp(item, "SN") is { } p && int.TryParse(Describe(p).Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;

    /// <summary>
    /// Removes Commodity entries, renumbers the rest and takes their SNs out of every package (unless another entry
    /// still has the same SN). Packages left empty stay, with an empty SN list.
    /// </summary>
    /// <returns>How many package contents were removed.</returns>
    private static int RemoveCommodityEntries(Entry entry, WzImage commodity, IReadOnlyCollection<WzImageProperty> items)
    {
        var removed = items.Select(SnOfEntry).OfType<int>().ToHashSet();
        foreach (var p in items) p.Remove();
        RenumberCommodity(commodity);
        MarkChanged(commodity);
        removed.ExceptWith(commodity.WzProperties.Select(SnOfEntry).OfType<int>());
        return EditPackages(entry, sn => removed.Contains(sn) ? null : sn);
    }

    /// <summary>
    /// Renames Commodity entries "0".."N-1" so each tab's entries are consecutive: a tab's entries move up to where the
    /// tab first appears, everything else keeps its order. Does nothing when the file is already laid out that way.
    /// </summary>
    /// <returns>Whether any entry was renamed or moved.</returns>
    private static bool RenumberCommodity(WzImage img)
    {
        var items = img.WzProperties
            .Select((p, i) => (P: p, Pos: i))
            .OrderBy(x => int.TryParse(x.P.Name, out var n) ? n : int.MaxValue)
            .ThenBy(x => x.Pos)
            .Select((x, i) => (x.P, Index: i, Tab: SnOfEntry(x.P) is { } sn ? SnTab(sn) : null))
            .ToList();
        var first = new Dictionary<(int, int), int>();
        foreach (var x in items)
            if (x.Tab is { } t) first.TryAdd(t, x.Index);
        var ordered = items
            .OrderBy(x => x.Tab is { } t ? first[t] : x.Index)
            .ThenBy(x => x.Index)
            .Select(x => x.P)
            .ToList();

        var inPlace = true;
        for (var i = 0; i < ordered.Count && inPlace; i++)
            inPlace = ReferenceEquals(ordered[i], img.WzProperties[i]) && ordered[i].Name == i.ToString(CultureInfo.InvariantCulture);
        if (inPlace) return false;

        img.ClearProperties();
        for (var i = 0; i < ordered.Count; i++)
        {
            ordered[i].Name = i.ToString(CultureInfo.InvariantCulture);
            img.AddProperty(ordered[i]);
        }
        MarkChanged(img);
        return true;
    }

    /// <summary>
    /// Maps every SN in every package's contents through <paramref name="map"/> (null drops it) and renumbers each
    /// changed list "0".."N-1". Missing CashPackage.img is fine.
    /// </summary>
    /// <returns>How many contents were dropped or changed.</returns>
    private static int EditPackages(Entry entry, Func<int, int?> map)
    {
        var img = entry.File.WzDirectory.GetImageByName(CashPackageImg);
        if (img == null) return 0;
        if (!img.Parsed) img.ParseImage();

        var changed = 0;
        foreach (var package in img.WzProperties)
        {
            if (FindProp(package, "SN") is not WzSubProperty list) continue;
            var contents = list.WzProperties
                .OrderBy(p => int.TryParse(p.Name, out var n) ? n : int.MaxValue)
                .ToList();
            var kept = new List<WzImageProperty>(contents.Count);
            var edits = 0;
            foreach (var p in contents)
            {
                if (!int.TryParse(Describe(p).Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var sn)) { kept.Add(p); continue; }
                var to = map(sn);
                if (to == sn) { kept.Add(p); continue; }
                edits++;
                if (to is { } v) { SetValue(p, v.ToString(CultureInfo.InvariantCulture)); kept.Add(p); }
            }
            if (edits == 0) continue;

            list.ClearProperties();
            for (var i = 0; i < kept.Count; i++)
            {
                kept[i].Name = i.ToString(CultureInfo.InvariantCulture);
                list.AddProperty(kept[i]);
            }
            changed += edits;
        }
        if (changed > 0) MarkChanged(img);
        return changed;
    }
}
