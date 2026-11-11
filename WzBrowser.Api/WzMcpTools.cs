using System.ComponentModel;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace WzBrowser.Api;

/// <param name="More">This node has children that weren't included (depth or node budget reached).</param>
public record NodeTree(string Name, string Type, string? Value, List<NodeTree>? Children, bool? More = null);

/// <param name="Node">Null when the path couldn't be read; see <paramref name="Error"/>.</param>
public record PathRead(string Path, NodeTree? Node, string? Error);

/// <summary>
/// MCP tools over the same <see cref="WzService"/> the web app uses, served at /mcp. Files opened or edited here show up
/// in the web app too, and edits stay in memory until saved (always to a new file).
/// </summary>
[McpServerToolType]
public sealed class WzMcpTools(WzService wz)
{
    private const string PathHelp =
        "Paths are slash-separated from the file root, e.g. \"0100100.img/info/exp\" or \"Map/Map1/100000000.img/info\"; \"\" is the root.";

    // ---------------------------------------------------------------- files

    [McpServerTool(Name = "wz_library", ReadOnly = true)]
    [Description("Lists every .wz file in the server's library folder (only when it was started with --root). Open one with wz_open.")]
    public List<LibraryFile> Library() => Run(() => wz.Library());

    [McpServerTool(Name = "wz_list_files", ReadOnly = true)]
    [Description("Lists the open .wz files (shared with the web app) with their ids, kind and whether they have unsaved edits.")]
    public List<OpenedFileDto> ListFiles() => Run(() => wz.List().ToList());

    [McpServerTool(Name = "wz_open")]
    [Description("Opens a .wz file and returns its id, which every other tool takes. Opening an already open file returns the same id.")]
    public OpenedFileDto Open(
        [Description("Full path to the .wz file.")] string path,
        [Description("auto (default), GMS, EMS, BMS, CLASSIC or GETFROMZLZ.")] string? encryption = null) =>
        Run(() => wz.Open(path, encryption));

    [McpServerTool(Name = "wz_close", Destructive = true)]
    [Description("Closes an open file. Unsaved edits are lost.")]
    public string Close([Description("File id.")] string file) =>
        Run(() => wz.Close(file) ? "Closed." : throw new KeyNotFoundException($"No open file with id '{file}'."));

    [McpServerTool(Name = "wz_save")]
    [Description("Writes the file with its edits to a NEW .wz file (Name.edited.wz, Name.edited2.wz, ... beside it, or `path`). Never overwrites anything. The open file then continues from the new one.")]
    public SaveResult Save(
        [Description("File id.")] string file,
        [Description("Optional full path for the new file; must not exist.")] string? path = null) =>
        Run(() => wz.Save(file, path));

    [McpServerTool(Name = "wz_revert", Destructive = true)]
    [Description("Discards all unsaved edits to a file by reloading it from disk.")]
    public OpenedFileDto Revert([Description("File id.")] string file) => Run(() => wz.Revert(file));

    // ---------------------------------------------------------------- reading

    [McpServerTool(Name = "wz_children", ReadOnly = true)]
    [Description("Lists the children of a node (directories, images or properties) with their types and values. " + PathHelp)]
    public List<NodeDto> Children([Description("File id.")] string file, [Description("Node path; omit for the root.")] string? path = null) =>
        Run(() => wz.Children(file, path));

    [McpServerTool(Name = "wz_get_nodes", ReadOnly = true)]
    [Description("Reads many nodes in one call, each with its value and, up to `depth` levels, its children's names, types and values. " +
                 "Use it to read a whole .img (depth 3-4) or the same property across many images. A path that fails gets an error and the rest still return. " + PathHelp)]
    public List<PathRead> GetNodes(
        [Description("File id.")] string file,
        [Description("Node paths to read.")] List<string> paths,
        [Description("Levels of children to include, 0-6 (default 0: just the node).")] int depth = 0,
        [Description("Most nodes to return across all paths (default 5000, max 50000); deeper ones are marked `more`.")] int maxNodes = 5000) =>
        Run(() =>
        {
            depth = Math.Clamp(depth, 0, 6);
            var budget = Math.Clamp(maxNodes, 1, 50000);
            var results = new List<PathRead>();
            foreach (var path in paths)
            {
                try { results.Add(new PathRead(path, Tree(file, path, wz.Node(file, path), depth, ref budget), null)); }
                catch (Exception ex) { results.Add(new PathRead(path, null, ex.Message)); }
            }
            return results;
        });

    private NodeTree Tree(string file, string path, NodeDto node, int depth, ref int budget)
    {
        budget--;
        if (!node.HasChildren) return new NodeTree(node.Name, node.Type, node.Value, null);
        if (depth == 0 || budget <= 0) return new NodeTree(node.Name, node.Type, node.Value, null, More: true);
        var children = new List<NodeTree>();
        var more = false;
        foreach (var c in wz.Children(file, path))
        {
            if (budget <= 0) { more = true; break; }
            children.Add(Tree(file, path.Length == 0 ? c.Name : $"{path.TrimEnd('/')}/{c.Name}", c, depth - 1, ref budget));
        }
        return new NodeTree(node.Name, node.Type, node.Value, children, more ? true : null);
    }

    [McpServerTool(Name = "wz_search", ReadOnly = true)]
    [Description("Finds nodes whose NAME contains `query` (case-insensitive) and returns their paths. Searches every directory and .img, " +
                 "and properties up to `depth` levels inside each .img; a match's own subtree isn't searched. " +
                 "Give `files` (open file ids) or `folder` (every .wz under it; omit both to use the library folder). " +
                 "Folder files with hits stay open (their ids are returned); the others are closed again.")]
    public List<FileSearchResult> Search(
        [Description("Text to find in node names.")] string query,
        [Description("Open file ids to search.")] List<string>? files = null,
        [Description("Folder of .wz files to search instead (defaults to the library folder).")] string? folder = null,
        [Description("Only folder files whose relative path contains this, e.g. \"Mob\".")] string? fileFilter = null,
        [Description("Property levels to search inside each .img (default 3).")] int depth = 3,
        [Description("Most hits per file (default 500).")] int limit = 500) =>
        Run(() =>
        {
            depth = Math.Clamp(depth, 0, 20);
            limit = Math.Clamp(limit, 1, 100000);
            if (files is not { Count: > 0 }) return wz.SearchFolder(folder, fileFilter, query, depth, limit);
            var open = wz.List().ToDictionary(f => f.Id);
            return files.Select(id =>
            {
                try
                {
                    var hits = wz.Search(id, query, depth, limit);
                    return new FileSearchResult(open.TryGetValue(id, out var f) ? f.Name : id, id, hits, hits.Count >= limit, null);
                }
                catch (Exception ex) { return new FileSearchResult(id, id, [], false, ex.Message); }
            }).ToList();
        });

    // ---------------------------------------------------------------- editing

    [McpServerTool(Name = "wz_batch", Destructive = true)]
    [Description(
        "Applies many edits across one or more open files in one call, ALL OR NOTHING: if any op fails, the earlier ones are undone and the " +
        "result names the failing op. Edits stay in memory (the web app shows them as unsaved) until wz_save. Ops:\n" +
        "- set: {op, file, path, value[, name]} sets a property's value (and optionally renames it).\n" +
        "- rename: {op, file, path, name}.\n" +
        "- create: {op, file, path (the image or property to add to), name, type, value}. Types: int, short, long, float, double, string, vector, uol, sub, null (sub and null take no value).\n" +
        "- delete: {op, file, path}.\n" +
        "- copy / move: {op, file, path (source), targetFile (defaults to file), targetPath (container; \"\" = file root)}. A name clash gets a _copy suffix.\n" +
        "Values: numbers in invariant form (range-checked for the property's type), vectors as \"x, y\", uol as the link path. " +
        "Only properties have values or can be renamed; directories and .img images can be copied, moved and deleted. " + PathHelp)]
    public BatchResult Batch(
        [Description("The operations, applied in order (max 5000).")] List<BatchOp> ops,
        [Description("Apply and check every op, report, then undo everything.")] bool dryRun = false,
        [Description("Return each op's resulting path and node (default: only a failure is reported).")] bool report = false) =>
        Run(() => wz.Batch(ops, dryRun, report));

    // ---------------------------------------------------------------- views

    [McpServerTool(Name = "wz_quests", ReadOnly = true)]
    [Description("Lists the quests (id and name) in an open quest archive (Quest.wz or a modular QuestData file).")]
    public List<QuestSummary> Quests([Description("File id.")] string file) => Run(() => wz.Quests(file));

    [McpServerTool(Name = "wz_quest", ReadOnly = true)]
    [Description("One quest's QuestInfo, Check, Say and Act trees, with the raw paths of each (for wz_batch).")]
    public QuestDetail Quest([Description("File id.")] string file, [Description("Quest id.")] int questId) =>
        Run(() => wz.Quest(file, questId));

    [McpServerTool(Name = "wz_commodity", ReadOnly = true)]
    [Description("The Cash Shop table of an open Etc.wz (Commodity.img): columns with types, and one row per entry.")]
    public CommodityTable Commodity([Description("File id.")] string file) => Run(() => wz.Commodity(file));

    [McpServerTool(Name = "wz_set_commodity")]
    [Description("Sets many Commodity.img values at once: each {entry, property, type, value}. A property an entry lacks is added with that type.")]
    public CommodityRowsResult SetCommodity([Description("File id.")] string file, List<CommoditySetRequest> sets) =>
        Run(() => wz.SetCommodity(file, sets));

    /// <summary>Hands the reason for a failure back to the model; other exception messages would be hidden.</summary>
    private static T Run<T>(Func<T> action)
    {
        try { return action(); }
        catch (McpException) { throw; }
        catch (Exception ex) { throw new McpException(ex.Message, ex); }
    }
}
