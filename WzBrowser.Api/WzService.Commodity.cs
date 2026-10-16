using System.Globalization;
using System.Numerics;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

public record CommodityCell(string Type, string? Value);
/// <param name="Cells">One per column, in column order; null where the entry has no such property.</param>
public record CommodityRow(string Name, List<CommodityCell?> Cells);
public record CommodityColumn(string Name, string Type);
public record CommodityTable(List<CommodityColumn> Columns, List<CommodityRow> Rows);

/// <param name="Type">Type to create the property with when the entry doesn't have it yet.</param>
public record CommoditySetRequest(string Entry, string Property, string Type, string Value);
/// <param name="Donor">Donor items get SNs from 10000000, regular ones from 20000000.</param>
public record CommodityAddRequest(int ItemId, bool Donor);
public record CommodityRowResult(List<CommodityColumn> Columns, CommodityRow Row, OpenedFileDto File);

/// <summary>Etc.wz's Commodity.img: the Cash Shop catalogue, one numbered sub property per entry.</summary>
public sealed partial class WzService
{
    private const string CommodityImg = "Commodity.img";

    /// <summary>
    /// Values for a new entry, in the order CashCommodities writes them
    /// (https://github.com/izarooni/CashCommodities). Class 4 means "no tag".
    /// </summary>
    private static readonly (string Name, int Value)[] CommodityDefaults =
    [
        ("Count", 1), ("Gender", 2), ("ItemId", 0), ("OnSale", 1), ("Period", 90),
        ("Price", 4000), ("Priority", 99), ("Class", 4), ("SN", 0),
    ];

    /// <summary>Every entry, with the union of all property names as columns (in first-seen order).</summary>
    public CommodityTable Commodity(string id)
    {
        var entry = GetEtcArchive(id);
        lock (entry.Lock)
        {
            var img = CommodityImage(entry);
            var columns = CommodityColumns(img);
            var rows = new List<CommodityRow>(img.WzProperties.Count);
            foreach (var p in img.WzProperties) rows.Add(CommodityRowOf(p, columns));
            return new CommodityTable(columns, rows);
        }
    }

    /// <summary>Sets one value, creating the property (as <see cref="CommoditySetRequest.Type"/>) when it's missing.</summary>
    public CommodityRowResult SetCommodity(string id, CommoditySetRequest req)
    {
        var entry = GetEtcArchive(id);
        lock (entry.Lock)
        {
            var img = CommodityImage(entry);
            var item = img[req.Entry] ?? throw new KeyNotFoundException($"Entry '{req.Entry}' not found in {CommodityImg}.");
            if (item is not WzSubProperty sub) throw new InvalidDataException($"Entry '{req.Entry}' isn't a sub property.");

            var prop = sub[req.Property];
            if (prop == null)
            {
                if (string.IsNullOrWhiteSpace(req.Property)) throw new ArgumentException("A property name is required.");
                sub.AddProperty(prop = NewValueProperty(req.Property, req.Type));
            }
            SetValue(prop, req.Value);
            MarkChanged(sub);
            Touch(entry);

            var columns = CommodityColumns(img);
            return new CommodityRowResult(columns, CommodityRowOf(sub, columns), Describe(id, entry));
        }
    }

    /// <summary>
    /// Adds an entry named one past the highest numbered entry, filled with CashCommodities' defaults and a fresh SN.
    /// Property names follow the spelling the file already uses (e.g. "gender" vs "Gender").
    /// </summary>
    public CommodityRowResult AddCommodity(string id, CommodityAddRequest req)
    {
        if (req.ItemId <= 0) throw new ArgumentException("Item id must be a positive number.");
        var entry = GetEtcArchive(id);
        lock (entry.Lock)
        {
            var img = CommodityImage(entry);
            var columns = CommodityColumns(img);

            var next = img.WzProperties.Select(p => int.TryParse(p.Name, out var n) ? n : -1).DefaultIfEmpty(-1).Max() + 1;
            var sub = new WzSubProperty(next.ToString(CultureInfo.InvariantCulture));
            var sn = GenerateSn(img, req.Donor, req.ItemId);

            foreach (var (name, value) in CommodityDefaults)
            {
                var existing = columns.FirstOrDefault(c => c.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
                var prop = NewValueProperty(existing?.Name ?? name, existing?.Type ?? "int");
                var v = name switch { "ItemId" => req.ItemId, "SN" => sn, _ => value };
                SetValue(prop, v.ToString(CultureInfo.InvariantCulture));
                sub.AddProperty(prop);
            }

            img.AddProperty(sub);
            MarkChanged(img);
            Touch(entry);

            columns = CommodityColumns(img);
            return new CommodityRowResult(columns, CommodityRowOf(sub, columns), Describe(id, entry));
        }
    }

    // ------------------------------------------------------------------ SN

    /// <summary>
    /// CashCommodities' scheme: 1xxxxxxx for donor items, 2xxxxxxx for regular ones; the next digit (times 100000)
    /// is the Cash Shop category the client files the item under; then the lowest free number from 1.
    /// </summary>
    private static int GenerateSn(WzImage img, bool donor, int itemId)
    {
        var used = new HashSet<int>();
        foreach (var p in img.WzProperties)
            if (FindProp(p, "SN") is { } snProp && int.TryParse(Describe(snProp).Value, out var v)) used.Add(v);

        var sn = (donor ? 10000000 : 20000000) + SnCategory(itemId, donor) * 100000;
        var i = 1;
        while (used.Contains(sn + i)) i++;
        return sn + i;
    }

    private static int SnCategory(int itemId, bool donor)
    {
        var type = itemId / 10000;
        if (type == 100) return 0;                                  // hat
        if (donor && type is >= 101 and <= 103) return 1;           // donor accessory
        if (!donor && type == 101) return 1;                        // face accessory
        if (!donor && type == 102) return 2;                        // eye accessory
        if (type == 104) return donor ? 3 : 4;                      // top
        if (type == 105) return donor ? 2 : 3;                      // overall
        if (type == 106) return donor ? 4 : 5;                      // bottom
        if (type == 107) return donor ? 5 : 6;                      // shoes
        if (type == 108) return donor ? 6 : 7;                      // gloves
        if (type == 170) return donor ? 7 : 8;                      // weapon
        if (!donor && type == 111) return 9;                        // ring
        if (type == 110) return donor ? 8 : 11;                     // cape
        if (type == 500) return donor ? 9 : 0;                      // pet
        return 10;
    }

    // ------------------------------------------------------------------ helpers

    private Entry GetEtcArchive(string id)
    {
        var entry = Get(id);
        if (entry.Kind != "etc") throw new InvalidDataException($"This file has no {CommodityImg}.");
        return entry;
    }

    private static WzImage CommodityImage(Entry entry)
    {
        var img = entry.File.WzDirectory.GetImageByName(CommodityImg)
            ?? throw new KeyNotFoundException($"'{CommodityImg}' not found in {entry.File.Name}.");
        if (!img.Parsed) img.ParseImage();
        return img;
    }

    /// <summary>Each property name seen in any entry, typed by the first entry that has it.</summary>
    private static List<CommodityColumn> CommodityColumns(WzImage img)
    {
        var columns = new List<CommodityColumn>();
        var seen = new HashSet<string>();
        foreach (var item in img.WzProperties)
        {
            if (item.WzProperties == null) continue;
            foreach (var p in item.WzProperties)
                if (seen.Add(p.Name)) columns.Add(new CommodityColumn(p.Name, Describe(p).Type));
        }
        return columns;
    }

    private static CommodityRow CommodityRowOf(WzImageProperty item, List<CommodityColumn> columns)
    {
        var cells = new List<CommodityCell?>(columns.Count);
        foreach (var c in columns)
            cells.Add(item[c.Name] is { } p && Describe(p) is var d ? new CommodityCell(d.Type, d.Value) : null);
        return new CommodityRow(item.Name, cells);
    }

    /// <summary>A child by name, ignoring case (older data spells some names in lower case).</summary>
    private static WzImageProperty? FindProp(WzImageProperty parent, string name) =>
        parent[name] ?? parent.WzProperties?.FirstOrDefault(p => p.Name.Equals(name, StringComparison.OrdinalIgnoreCase));

    private static WzImageProperty NewValueProperty(string name, string type) => type switch
    {
        "int" => new WzIntProperty(name, 0),
        "short" => new WzShortProperty(name, 0),
        "long" => new WzLongProperty(name, 0),
        "float" => new WzFloatProperty(name, 0),
        "double" => new WzDoubleProperty(name, 0),
        "string" => new WzStringProperty(name, ""),
        _ => throw new ArgumentException($"A {type} property can't be created here."),
    };

    /// <summary>Parses <paramref name="value"/> for the property's own type and stores it.</summary>
    private static void SetValue(WzImageProperty prop, string value)
    {
        var v = value.Trim();
        switch (prop)
        {
            case WzIntProperty p: p.Value = Parse<int>(prop, v); break;
            case WzShortProperty p: p.Value = Parse<short>(prop, v); break;
            case WzLongProperty p: p.Value = Parse<long>(prop, v); break;
            case WzFloatProperty p: p.Value = Parse<float>(prop, v); break;
            case WzDoubleProperty p: p.Value = Parse<double>(prop, v); break;
            case WzStringProperty p: p.Value = value; break;
            default: throw new ArgumentException($"{prop.Name} is a {Describe(prop).Type} property and can't be edited here.");
        }
    }

    /// <summary>Out-of-range and non-finite values are rejected rather than wrapped or stored.</summary>
    private static T Parse<T>(WzImageProperty prop, string v) where T : INumber<T>
    {
        if (T.TryParse(v, CultureInfo.InvariantCulture, out var n) && T.IsFinite(n)) return n;
        throw new ArgumentException($"'{v}' isn't a valid {Describe(prop).Type} for {prop.Name}.");
    }
}
