using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;

namespace WzBrowser.Api;

/// <param name="Label">What it did: "Set exp", "Delete 0100100.img", ...</param>
/// <param name="Files">The names of the files it changed.</param>
public record HistoryStepDto(long Id, string Label, List<string> Files);

/// <param name="Steps">Edits to any file, oldest first, with the undone ones last.</param>
/// <param name="Done">How many of them are in place.</param>
public record HistoryDto(List<HistoryStepDto> Steps, int Done);

/// <param name="Files">The files that changed, as they are now.</param>
public record HistoryMoveResult(HistoryDto History, List<OpenedFileDto> Files);

/// <summary>
/// One timeline of every edit to every open file, to undo and redo. An edit watches what it's about to change
/// (<see cref="EditScope"/>); whatever is different afterwards is kept, as the nodes themselves rather than copies, so a
/// step costs only as much memory as it changed. Saving, reverting or closing a file forgets its part of the timeline,
/// since the nodes are then replaced by ones read from disk.
/// </summary>
public sealed partial class WzService
{
    private const int MaxHistory = 200;

    /// <summary>Taken after any file's lock, never before one.</summary>
    private readonly object _historyLock = new();
    private readonly List<HistoryStep> _history = [];
    /// <summary>How many of the steps are in place; the rest are undone.</summary>
    private int _historyDone;
    private long _historyIds;

    private sealed record HistoryStep(long Id, string Label, List<FileEdit> Edits);

    /// <param name="WasDirty">Whether the file had unsaved changes before.</param>
    private sealed record FileEdit(Entry Entry, bool WasDirty, List<NodeChange> Changes);

    private sealed record NodeChange(WzObject Node, NodeState Before, NodeState After);

    /// <summary>What a node is, apart from what its children are. Pictures are the canvas' own, not copies.</summary>
    private sealed record NodeState(string Name, string? Value, WzPngProperty? Picture, WzObject[] Children)
    {
        public bool IsSame(NodeState other) =>
            Name == other.Name
            && Value == other.Value
            && ReferenceEquals(Picture, other.Picture)
            && SameChildren(other.Children);

        private bool SameChildren(WzObject[] others)
        {
            if (Children.Length != others.Length) return false;
            for (var i = 0; i < others.Length; i++)
                if (!ReferenceEquals(Children[i], others[i]))
                    return false;
            return true;
        }
    }

    /// <summary>
    /// An edit to a file, made while holding its lock. One inside another (a batch's steps) is part of the outer one.
    /// </summary>
    private sealed class EditScope : IDisposable
    {
        private readonly Entry _entry;
        private readonly EditScope? _outer;
        private readonly bool _wasDirty;
        private readonly Dictionary<WzObject, NodeState> _before = new(ReferenceEqualityComparer.Instance);
        private readonly HashSet<WzObject> _watched = new(ReferenceEqualityComparer.Instance);

        public EditScope(Entry entry)
        {
            _entry = entry;
            _outer = entry.Edit;
            _wasDirty = entry.Dirty;
            if (_outer == null) entry.Edit = this;
        }

        /// <summary>
        /// Call before changing it: for a property or an image, anything in its image; for a directory, which images
        /// and directories it holds.
        /// </summary>
        public EditScope Watch(object? node)
        {
            if (_outer != null)
            {
                _outer.Watch(node);
                return this;
            }
            switch (node)
            {
                case WzFile file: Watch(file.WzDirectory); break;
                case WzDirectory directory when _watched.Add(directory): Keep(directory); break;
                case WzImage image when _watched.Add(image):
                    if (!image.Parsed) image.ParseImage();
                    Walk(image, Keep);
                    break;
                case WzImageProperty property when property.ParentImage is { } image: Watch(image); break;
            }
            return this;
        }

        /// <summary>What changed, or null when nothing did or the edit is part of another.</summary>
        public FileEdit? Finish()
        {
            if (_outer != null) return null;
            var changes = new List<NodeChange>();
            foreach (var (node, before) in _before)
                if (StateOf(node) is var after && !before.IsSame(after))
                    changes.Add(new NodeChange(node, before, after));
            return changes.Count == 0 ? null : new FileEdit(_entry, _wasDirty, changes);
        }

        /// <summary>Puts everything watched back as it was.</summary>
        public void Rollback()
        {
            if (Finish() is not { } edit) return;
            Restore(edit.Changes, before: true);
            _entry.Dirty = _wasDirty;
        }

        public void Dispose()
        {
            if (_outer == null) _entry.Edit = null;
        }

        private void Keep(WzObject node) => _before.TryAdd(node, StateOf(node));

        private static void Walk(WzObject node, Action<WzObject> visit)
        {
            visit(node);
            foreach (var child in OwnChildren(node)) Walk(child, visit);
        }
    }

    /// <summary>A node's children; a link's are its target's, so they aren't its own.</summary>
    private static IEnumerable<WzObject> OwnChildren(WzObject node) => node switch
    {
        WzDirectory directory => directory.WzDirectories.Cast<WzObject>().Concat(directory.WzImages),
        WzImage image => image.WzProperties,
        WzUOLProperty => [],
        WzImageProperty { WzProperties: { } children } => children,
        _ => [],
    };

    private static NodeState StateOf(WzObject node)
    {
        var value = node switch
        {
            WzIntProperty or WzShortProperty or WzLongProperty or WzFloatProperty or WzDoubleProperty
                or WzStringProperty or WzVectorProperty or WzUOLProperty => Describe(node).Value,
            _ => null,
        };
        var picture = node is WzCanvasProperty canvas ? canvas.PngProperty : null;
        return new NodeState(node.Name, value, picture, OwnChildren(node).ToArray());
    }

    private static void Restore(List<NodeChange> changes, bool before)
    {
        // Every changed list is emptied before any is filled: a node moved between two must only end up in one.
        var moved = changes.Where(change => !change.Before.Children.SequenceEqual(change.After.Children)).ToList();
        foreach (var change in moved) ClearChildren(change.Node);
        foreach (var change in changes)
        {
            var state = before ? change.Before : change.After;
            if (change.Node.Name != state.Name) change.Node.Name = state.Name;
            if (state.Value != null && change.Node is WzImageProperty property) SetValue(property, state.Value);
            if (state.Picture != null && change.Node is WzCanvasProperty canvas) canvas.PngProperty = state.Picture;
            MarkChanged(change.Node);
        }
        foreach (var change in moved) FillChildren(change.Node, before ? change.Before.Children : change.After.Children);
        // Once attached, so that the images they're in know.
        foreach (var change in changes) MarkChanged(change.Node);
    }

    private static void ClearChildren(WzObject node)
    {
        switch (node)
        {
            case WzDirectory directory:
                foreach (var child in directory.WzDirectories.ToArray()) directory.RemoveDirectory(child);
                // From the end, which shifts nothing.
                for (var i = directory.WzImages.Count - 1; i >= 0; i--) directory.RemoveImage(directory.WzImages[i]);
                break;
            case WzImage image: image.WzProperties.Clear(); break;
            case WzImageProperty property: property.WzProperties!.Clear(); break;
        }
    }

    private static void FillChildren(WzObject node, WzObject[] children)
    {
        foreach (var child in children)
        {
            switch (node, child)
            {
                case (WzDirectory directory, WzDirectory subdirectory): directory.AddDirectory(subdirectory); break;
                case (WzDirectory directory, WzImage image): directory.AddImage(image); break;
                case (WzImage image, WzImageProperty property): image.WzProperties.Add(property); break;
                case (WzImageProperty parent, WzImageProperty property): parent.WzProperties!.Add(property); break;
            }
        }
    }

    /// <summary>Adds a step to the timeline, dropping the undone ones. Call while holding the files' locks.</summary>
    private void Record(string label, params IEnumerable<FileEdit?> edits)
    {
        var made = edits.OfType<FileEdit>().ToList();
        if (made.Count == 0) return;
        lock (_historyLock)
        {
            _history.RemoveRange(_historyDone, _history.Count - _historyDone);
            _history.Add(new HistoryStep(++_historyIds, label, made));
            if (_history.Count > MaxHistory) _history.RemoveAt(0);
            _historyDone = _history.Count;
        }
    }

    /// <summary>Takes a file out of the timeline.</summary>
    private void ForgetHistory(Entry entry)
    {
        lock (_historyLock)
        {
            for (var i = _history.Count - 1; i >= 0; i--)
            {
                _history[i].Edits.RemoveAll(edit => ReferenceEquals(edit.Entry, entry));
                if (_history[i].Edits.Count > 0) continue;
                _history.RemoveAt(i);
                if (i < _historyDone) _historyDone--;
            }
        }
    }

    public HistoryDto History()
    {
        lock (_historyLock)
        {
            var steps = _history.Select(DescribeStep).ToList();
            return new HistoryDto(steps, _historyDone);
        }
    }

    private static HistoryStepDto DescribeStep(HistoryStep step)
    {
        var files = step.Edits.Select(edit => System.IO.Path.GetFileName(edit.Entry.Path)).ToList();
        return new HistoryStepDto(step.Id, step.Label, files);
    }

    /// <summary>Undoes or redoes, one by one, until the step <paramref name="id"/> is the last in place (0: none is).</summary>
    public HistoryMoveResult GoToHistory(long id)
    {
        List<Entry> entries;
        lock (_historyLock)
            entries = _history
                .SelectMany(step => step.Edits)
                .Select(edit => edit.Entry)
                .Distinct()
                .OrderBy(entry => FileId(entry.Path), StringComparer.Ordinal)
                .ToList();
        // Every file's lock, in the order a batch takes them, then the timeline's.
        var taken = new List<object>();
        try
        {
            foreach (var entry in entries)
            {
                Monitor.Enter(entry.Lock);
                taken.Add(entry.Lock);
            }
            lock (_historyLock) return MoveHistory(id, entries);
        }
        finally
        {
            for (var i = taken.Count - 1; i >= 0; i--) Monitor.Exit(taken[i]);
        }
    }

    private HistoryMoveResult MoveHistory(long id, List<Entry> locked)
    {
        var target = id == 0 ? 0 : _history.FindIndex(step => step.Id == id) + 1;
        var isKnown = id == 0 || target > 0;
        var isLocked = _history.SelectMany(step => step.Edits).All(edit => locked.Contains(edit.Entry));
        if (!isKnown || !isLocked) throw new InvalidDataException("That action isn't in the history anymore.");

        var changed = new HashSet<Entry>();
        while (_historyDone > target) Apply(_history[--_historyDone], before: true);
        while (_historyDone < target) Apply(_history[_historyDone++], before: false);
        foreach (var entry in changed) entry.Revision = NextRevision();
        var files = changed.Select(entry => Describe(FileId(entry.Path), entry)).ToList();
        return new HistoryMoveResult(History(), files);

        void Apply(HistoryStep step, bool before)
        {
            foreach (var edit in step.Edits)
            {
                Restore(edit.Changes, before);
                edit.Entry.Dirty = !before || edit.WasDirty;
                changed.Add(edit.Entry);
            }
        }
    }
}
