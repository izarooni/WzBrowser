using System.Collections.Concurrent;
using MapleLib.WzLib;
using MapleLib.WzLib.MSFile;
using MapleLib.WzLib.Util;

namespace WzBrowser.Api;

/// <param name="Count">How many nodes sit at the file's root.</param>
/// <param name="Names">The first few of them, folders before images, in file order.</param>
public record FilePeek(int Count, List<string> Names);

public sealed partial class WzService
{
    private const int PeekNames = 12;

    /// <summary>Peeks already taken, by path; reused while the file's size and write time are unchanged.</summary>
    private readonly ConcurrentDictionary<string, (DateTime Written, long Size, FilePeek Peek)> _peeks = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>The encryption that last worked in a folder, tried first for its other files (they almost always share it).</summary>
    private readonly ConcurrentDictionary<string, WzMapleVersion> _peekVersions = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>The picker peeks a whole folder at once; a few at a time keeps the disk from thrashing.</summary>
    private readonly SemaphoreSlim _peekGate = new(4);

    /// <summary>
    /// The names at a .wz file's (or .ms pack's) root, for the file picker. Only the directory table is read: no image
    /// is parsed, and the file is closed again straight away.
    /// </summary>
    public async Task<FilePeek> Peek(string path)
    {
        var info = new FileInfo(System.IO.Path.GetFullPath(path));
        if (!info.Exists) throw new FileNotFoundException($"File not found: {info.FullName}");
        if (_peeks.TryGetValue(info.FullName, out var hit) && hit.Written == info.LastWriteTimeUtc && hit.Size == info.Length)
            return hit.Peek;

        await _peekGate.WaitAsync();
        try
        {
            var peek = await Task.Run(() => IsMsPack(info.FullName) ? PeekMsPack(info.FullName) : PeekWz(info.FullName));
            _peeks[info.FullName] = (info.LastWriteTimeUtc, info.Length, peek);
            return peek;
        }
        finally { _peekGate.Release(); }
    }

    private FilePeek PeekWz(string path)
    {
        if (WzTool.IsListFile(path)) return new FilePeek(0, []);

        var folder = System.IO.Path.GetDirectoryName(path) ?? "";
        WzFile? file = null;
        // The folder's known encryption first; a wrong guess shows up as garbled names and falls back to detection.
        if (_peekVersions.TryGetValue(folder, out var known))
        {
            try
            {
                file = new WzFile(path, known);
                if (file.ParseWzFile() != WzFileParseStatus.Success || !LooksDecrypted(file.WzDirectory)) { file.Dispose(); file = null; }
            }
            catch { file?.Dispose(); file = null; }
        }
        if (file == null)
        {
            (file, var version) = OpenWz(path, null);
            _peekVersions[folder] = version;
        }

        using (file)
        {
            var root = file.WzDirectory;
            var names = root.WzDirectories.Select(d => d.Name + "/").Concat(root.WzImages.Select(i => i.Name));
            return new FilePeek(root.WzDirectories.Count + root.WzImages.Count, names.Take(PeekNames).ToList());
        }
    }

    /// <summary>A pack's entry table names every image by its full path ("Mob/0100100.img"); the root is their first part.</summary>
    private static FilePeek PeekMsPack(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            using var ms = new WzMsFile(stream, System.IO.Path.GetFileName(path), path);
            ms.ReadEntries();
            var roots = ms.Entries
                .Select(e => e.Name.Replace('\\', '/'))
                .Select(n => n.IndexOf('/') is var slash and > 0 ? n[..(slash + 1)] : n)
                .Distinct()
                .ToList();
            return new FilePeek(roots.Count, roots.Take(PeekNames).ToList());
        }
        catch (Exception ex) when (ex is not IOException)
        {
            throw new InvalidDataException($"Could not read MS pack ({ex.Message}).");
        }
    }
}
