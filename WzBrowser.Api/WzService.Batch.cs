using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <summary>One step of a <see cref="WzService.Batch"/>.</summary>
/// <param name="Op">
/// "set": give the property at <paramref name="Path"/> a new <paramref name="Value"/> (and optionally a new <paramref name="Name"/>).
/// "rename": give it a new <paramref name="Name"/>.
/// "create": add a property called <paramref name="Name"/> of <paramref name="Type"/> (with <paramref name="Value"/>) to the image or property at <paramref name="Path"/>.
/// "delete": remove the node at <paramref name="Path"/>.
/// "copy" / "move": copy (or move) the node at <paramref name="Path"/> into the container at <paramref name="TargetPath"/> of
/// <paramref name="TargetFile"/> (this file when null; "" is the file root).
/// </param>
public record BatchOp(string Op, string File, string Path, string? Name = null, string? Value = null, string? Type = null,
    string? TargetFile = null, string? TargetPath = null);

/// <param name="Path">Where the node is after the op (a copy may get a "_copy" suffix, a rename changes the last segment).</param>
public record BatchOpResult(int Index, string Op, string? Path, NodeDto? Node, string? Error);

/// <param name="Applied">False when an op failed (nothing was changed) or this was a dry run.</param>
/// <param name="Results">Every op's outcome when asked for, otherwise only the one that failed.</param>
public record BatchResult(bool Applied, bool DryRun, int Count, List<BatchOpResult> Results, List<OpenedFileDto> Files);

public sealed partial class WzService
{
    public const int MaxBatchOps = 5000;

    /// <summary>
    /// Applies many edits across one or more open files, all or nothing: if any op fails, the ones before it are undone
    /// and the files are left as they were. Each op goes through the same method (and checks) as its single-edit API.
    /// </summary>
    /// <param name="dryRun">Apply and report every op, then undo them all.</param>
    /// <param name="report">Return every op's result, not only a failure.</param>
    public BatchResult Batch(List<BatchOp> ops, bool dryRun = false, bool report = false)
    {
        if (ops.Count == 0) throw new ArgumentException("No operations given.");
        if (ops.Count > MaxBatchOps) throw new ArgumentException($"At most {MaxBatchOps} operations per batch ({ops.Count} given).");
        if (ops.FindIndex(o => string.IsNullOrWhiteSpace(o.File)) is var missing and >= 0)
            throw new ArgumentException($"Operation {missing} has no file id.");

        // Hold every file the batch touches for its whole length, locked in a fixed order like Paste does. The
        // single-edit methods take the same locks again, which Monitor allows.
        var ids = ops.SelectMany(o => new[] { o.File, o.TargetFile })
            .Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id!)
            .Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
        var entries = ids.ToDictionary(id => id, Get, StringComparer.Ordinal);
        var taken = new List<object>();
        try
        {
            foreach (var id in ids) { Monitor.Enter(entries[id].Lock); taken.Add(entries[id].Lock); }
            return BatchLocked(ops, entries, dryRun, report);
        }
        finally
        {
            for (var i = taken.Count - 1; i >= 0; i--) Monitor.Exit(taken[i]);
        }
    }

    private BatchResult BatchLocked(List<BatchOp> ops, Dictionary<string, Entry> entries, bool dryRun, bool report)
    {
        var fileState = entries.ToDictionary(kv => kv.Key, kv => (kv.Value.Dirty, kv.Value.Revision));
        var imageChanged = new Dictionary<WzImage, bool>(ReferenceEqualityComparer.Instance);
        var undo = new Stack<Action>();
        var results = new List<BatchOpResult>();

        void Remember(object? node)
        {
            var img = node switch { WzImage i => i, WzImageProperty p => p.ParentImage, _ => null };
            if (img != null) imageChanged.TryAdd(img, img.Changed);
        }

        BatchOpResult? failure = null;
        for (var i = 0; i < ops.Count; i++)
        {
            var op = ops[i];
            var kind = (op.Op ?? "").Trim().ToLowerInvariant();
            try
            {
                var (path, node) = Apply(op, kind, entries, Remember, undo);
                if (report) results.Add(new BatchOpResult(i, kind, path, node, null));
            }
            catch (Exception ex)
            {
                failure = new BatchOpResult(i, kind, op.Path, null, ex.Message);
                break;
            }
        }

        if (failure != null || dryRun)
        {
            Rollback(undo, entries, fileState, imageChanged);
            if (failure != null) results = [failure];
        }

        var files = entries.Select(kv => Describe(kv.Key, kv.Value)).ToList();
        return new BatchResult(failure == null && !dryRun, dryRun, ops.Count, results, files);
    }

    /// <summary>Runs one op through the matching single-edit method, first pushing what undoes it.</summary>
    private (string Path, NodeDto Node) Apply(BatchOp op, string kind, Dictionary<string, Entry> entries,
        Action<object?> remember, Stack<Action> undo)
    {
        var entry = entries[op.File];
        switch (kind)
        {
            case "set" or "rename":
            {
                if (kind == "set" && op.Value == null) throw new ArgumentException("\"set\" needs a value.");
                if (kind == "rename" && string.IsNullOrWhiteSpace(op.Name)) throw new ArgumentException("\"rename\" needs a name.");
                if (Resolve(entry.File, Normalize(op.Path)) is not WzImageProperty prop)
                    throw new InvalidDataException("Only properties can be edited; directories and images can't.");
                var (oldName, oldValue) = (prop.Name, Describe(prop).Value);
                remember(prop);
                var r = EditNode(op.File, new NodeEditRequest(op.Path, op.Name, kind == "set" ? op.Value : null));
                undo.Push(() =>
                {
                    if (kind == "set" && oldValue != null) SetValue(prop, oldValue);
                    prop.Name = oldName;
                });
                return (r.Path, r.Node);
            }
            case "create":
            {
                var container = Resolve(entry.File, Normalize(op.Path));
                remember(container);
                var r = CreateNode(op.File, new NodeCreateRequest(op.Path, op.Name ?? "", op.Type ?? "", op.Value));
                var added = (WzObject)Resolve(entry.File, r.Path);
                undo.Push(added.Remove);
                return (r.Path, r.Node);
            }
            case "delete":
            {
                var node = Resolve(entry.File, Normalize(op.Path));
                var parent = (node as WzObject)?.Parent;
                remember(node);
                Delete(op.File, op.Path);
                undo.Push(() => Reattach(node, parent));
                return (Normalize(op.Path), Describe(node));
            }
            case "copy" or "move":
            {
                var targetId = string.IsNullOrWhiteSpace(op.TargetFile) ? op.File : op.TargetFile;
                var target = entries[targetId];
                var node = Resolve(entry.File, Normalize(op.Path));
                var parent = (node as WzObject)?.Parent;
                remember(Resolve(target.File, Normalize(op.TargetPath)));
                if (kind == "move") remember(node);
                var r = Paste(targetId, new PasteRequest(op.File, op.Path, op.TargetPath, kind == "move"));
                var added = (WzObject)Resolve(target.File, r.Path);
                undo.Push(() =>
                {
                    added.Remove();
                    if (kind == "move") Reattach(node, parent);
                });
                return (r.Path, r.Node);
            }
            default:
                throw new ArgumentException($"Unknown op '{op.Op}'; use set, rename, create, delete, copy or move.");
        }
    }

    /// <summary>Puts a removed node back under its old parent (its position among siblings may change).</summary>
    private static void Reattach(object node, WzObject? parent)
    {
        switch (node)
        {
            case WzImageProperty p when parent is IPropertyContainer pc: pc.AddProperty(p); break;
            case WzImage img when parent is WzDirectory d: d.AddImage(img); break;
            case WzDirectory dir when parent is WzDirectory d: d.AddDirectory(dir); break;
            default: throw new InvalidOperationException($"Can't put '{(node as WzObject)?.Name}' back.");
        }
    }

    private static void Rollback(Stack<Action> undo, Dictionary<string, Entry> entries,
        Dictionary<string, (bool Dirty, long Revision)> fileState, Dictionary<WzImage, bool> imageChanged)
    {
        var errors = new List<string>();
        while (undo.Count > 0)
        {
            try { undo.Pop()(); }
            catch (Exception ex) { errors.Add(ex.Message); }
        }
        if (errors.Count > 0)
        {
            // Leave the files marked as changed so nobody mistakes them for clean; Revert restores them from disk.
            foreach (var e in entries.Values) Touch(e);
            throw new InvalidOperationException(
                $"The batch failed and couldn't be fully undone ({string.Join("; ", errors)}). Revert the files to discard its changes.");
        }
        foreach (var (img, changed) in imageChanged) img.Changed = changed;
        foreach (var (id, state) in fileState) (entries[id].Dirty, entries[id].Revision) = state;
    }

    // ------------------------------------------------------------ searching many files

    /// <summary>
    /// Runs <see cref="Search"/> over every .wz file in <paramref name="folder"/> (the library folder when null).
    /// Files that weren't open are opened unlisted (as link lookups do); those with no hits are closed again, those with
    /// hits stay open so their <see cref="FileSearchResult.Id"/> can be used straight away.
    /// </summary>
    /// <param name="nameFilter">Only files whose relative path contains this (e.g. "Mob" or "String/").</param>
    public List<FileSearchResult> SearchFolder(string? folder, string? nameFilter, string query, int depth, int limitPerFile)
    {
        var dir = folder == null ? Root ?? throw new InvalidDataException("This server isn't pinned to a library folder; give a folder or file ids.")
            : System.IO.Path.TrimEndingDirectorySeparator(System.IO.Path.GetFullPath(folder));
        if (!Directory.Exists(dir)) throw new DirectoryNotFoundException($"Folder not found: {dir}");
        if (dir != Root && !InRoot(dir)) throw new UnauthorizedAccessException("Only this server's library folder can be searched.");

        var results = new List<FileSearchResult>();
        foreach (var f in WzFilesIn(dir).Where(f => nameFilter == null || f.Name.Contains(nameFilter, StringComparison.OrdinalIgnoreCase))
                     .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase))
        {
            var wasOpen = _files.ContainsKey(FileId(System.IO.Path.GetFullPath(f.Path)));
            try
            {
                var file = Open(f.Path, null, hidden: true);
                var hits = Search(file.Id, query, depth, limitPerFile);
                if (hits.Count == 0 && !wasOpen) Close(file.Id);
                else if (hits.Count > 0) results.Add(new FileSearchResult(f.Name, file.Id, hits, hits.Count >= limitPerFile, null));
            }
            catch (Exception ex)
            {
                results.Add(new FileSearchResult(f.Name, null, [], false, ex.Message));
            }
        }
        return results;
    }
}

/// <param name="Id">The open file's id, for the other tools (null when it couldn't be opened).</param>
/// <param name="Truncated">The per-file limit was reached, so there may be more.</param>
public record FileSearchResult(string File, string? Id, List<string> Paths, bool Truncated, string? Error);
