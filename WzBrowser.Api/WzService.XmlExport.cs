using System.Collections.Concurrent;
using System.Globalization;
using MapleLib.WzLib;
using MapleLib.WzLib.Serializer;

namespace WzBrowser.Api;

/// <param name="Paths">The .wz files to convert.</param>
/// <param name="Output">The folder that gets one {Name}.wz folder per file.</param>
public record XmlExportRequest(List<string> Paths, string Output, string? Encryption);

/// <param name="Images">Images written so far (of <paramref name="Total"/>, known once the file is open).</param>
public record XmlExportFileDto(string Name, string Folder, int Images, int Total, string State, string? Error);

/// <param name="State">running, done, failed (some files couldn't be converted) or cancelled.</param>
public record XmlExportJobDto(string Id, string State, string Output, List<XmlExportFileDto> Files);

public sealed partial class WzService
{
    /// <summary>
    /// Converts .wz files to the classic XML layout servers read (OdinMS and its descendants): every image becomes
    /// {Output}/{Name}.wz/{dirs}/{image}.img.xml. Canvases keep their size and children but not their pixels, and sounds
    /// are left as empty markers, as servers expect. The split parts of a modular file (Mob_000.wz, Mob_001.wz, ...)
    /// share one Mob.wz folder, and its index stub (Mob.wz beside Mob_000.wz) is skipped. Existing files are overwritten.
    /// Runs in the background; poll <see cref="XmlExportStatus"/>.
    /// </summary>
    public XmlExportJobDto StartXmlExport(XmlExportRequest req)
    {
        if (req.Paths == null || req.Paths.Count == 0) throw new ArgumentException("Pick at least one .wz file.");
        if (string.IsNullOrWhiteSpace(req.Output)) throw new ArgumentException("Choose a folder to write the XML files to.");
        var output = System.IO.Path.GetFullPath(req.Output.Trim());

        var paths = new List<string>();
        foreach (var raw in req.Paths)
        {
            var full = System.IO.Path.GetFullPath(raw);
            if (!InRoot(full)) throw new UnauthorizedAccessException("Only files in this server's library folder can be converted.");
            if (!File.Exists(full)) throw new FileNotFoundException($"WZ file not found: {full}", full);
            if (IsIndexStub(full)) continue;
            if (!paths.Contains(full, StringComparer.OrdinalIgnoreCase)) paths.Add(full);
        }
        if (paths.Count == 0) throw new ArgumentException("Those are only index files; pick their _000, _001, ... parts instead.");
        Directory.CreateDirectory(output);

        var job = new XmlExportJob(Convert.ToHexString(Guid.NewGuid().ToByteArray())[..12].ToLowerInvariant(), output,
            paths.Select(p => new XmlExportFile(p, OutputFolderName(p))).ToList());
        _exports[job.Id] = job;
        foreach (var old in _exports.Values.Where(j => j.State != "running" && j.Finished < DateTime.UtcNow.AddHours(-1)).ToList())
            _exports.TryRemove(old.Id, out _);

        var thread = new Thread(() => RunXmlExport(job, req.Encryption)) { IsBackground = true, Name = "XML export " + job.Id };
        thread.Start();
        return job.Describe();
    }

    public XmlExportJobDto XmlExportStatus(string id) =>
        _exports.TryGetValue(id, out var job) ? job.Describe() : throw new KeyNotFoundException($"No conversion with id '{id}'.");

    /// <summary>Stops after the image being written now; files already written stay.</summary>
    public XmlExportJobDto CancelXmlExport(string id)
    {
        if (!_exports.TryGetValue(id, out var job)) throw new KeyNotFoundException($"No conversion with id '{id}'.");
        job.Cancel.Cancel();
        return job.Describe();
    }

    private readonly ConcurrentDictionary<string, XmlExportJob> _exports = new();

    private sealed class XmlExportJob(string id, string output, List<XmlExportFile> files)
    {
        public string Id { get; } = id;
        public string Output { get; } = output;
        public List<XmlExportFile> Files { get; } = files;
        public CancellationTokenSource Cancel { get; } = new();
        public volatile string State = "running";
        public DateTime Finished = DateTime.MaxValue;

        public XmlExportJobDto Describe() => new(Id, State, Output,
            Files.Select(f => new XmlExportFileDto(System.IO.Path.GetFileName(f.Path), f.Folder, f.Images, f.Total, f.State, f.Error)).ToList());
    }

    private sealed class XmlExportFile(string path, string folder)
    {
        public string Path { get; } = path;
        public string Folder { get; } = folder;
        public volatile int Images;
        public volatile int Total;
        /// <summary>waiting, running, done, failed or cancelled.</summary>
        public volatile string State = "waiting";
        public volatile string? Error;
    }

    /// <summary>"Mob_001.wz" -> "Mob.wz", so a modular file's parts land in one folder.</summary>
    private static string OutputFolderName(string path) =>
        System.Text.RegularExpressions.Regex.Replace(System.IO.Path.GetFileNameWithoutExtension(path), @"_\d{3}$", "") + ".wz";

    /// <summary>A modular file's index ({name}.wz beside {name}_000.wz) holds no data of its own.</summary>
    private static bool IsIndexStub(string path) =>
        File.Exists(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(path)!, System.IO.Path.GetFileNameWithoutExtension(path) + "_000.wz"));

    private void RunXmlExport(XmlExportJob job, string? encryption)
    {
        // The serializer writes doubles with the current culture; servers parse them with a '.'.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        var serializer = new WzClassicXmlSerializer(2, LineBreak.Windows, false);
        try
        {
            foreach (var f in job.Files)
            {
                if (job.Cancel.IsCancellationRequested) { f.State = "cancelled"; continue; }
                f.State = "running";
                try
                {
                    ExportFileXml(f, System.IO.Path.Combine(job.Output, f.Folder), encryption, serializer, job.Cancel.Token);
                    f.State = job.Cancel.IsCancellationRequested ? "cancelled" : "done";
                }
                catch (Exception ex)
                {
                    f.State = "failed";
                    f.Error = (ex.InnerException ?? ex).Message;
                }
            }
            job.State = job.Cancel.IsCancellationRequested ? "cancelled" : job.Files.Any(f => f.State == "failed") ? "failed" : "done";
        }
        finally
        {
            job.Finished = DateTime.UtcNow;
        }
    }

    private void ExportFileXml(XmlExportFile f, string folder, string? encryption, WzClassicXmlSerializer serializer, CancellationToken cancel)
    {
        // A file the user already has open is converted as it is in memory, unsaved edits included, and stays open.
        var existed = _files.ContainsKey(FileId(f.Path));
        var dto = Open(f.Path, encryption, hidden: true);
        var entry = Get(dto.Id);
        try
        {
            var images = new List<(WzImage Image, string Path)>();
            void Dir(WzDirectory d, string dir)
            {
                foreach (var sub in d.WzDirectories) Dir(sub, System.IO.Path.Combine(dir, SafeFileName(sub.Name)));
                foreach (var img in d.WzImages) images.Add((img, System.IO.Path.Combine(dir, SafeFileName(img.Name) + ".xml")));
            }
            lock (entry.Lock) Dir(entry.File.WzDirectory, folder);
            f.Total = images.Count;
            Directory.CreateDirectory(folder);

            foreach (var (img, path) in images)
            {
                if (cancel.IsCancellationRequested) return;
                // One image at a time, so the file stays usable in the browser while it converts.
                lock (entry.Lock) serializer.SerializeImage(img, path);
                f.Images++;
            }
        }
        finally
        {
            // Close it again unless it was already open, or someone opened it while it converted.
            if (!existed && _files.TryGetValue(dto.Id, out var e) && e.Hidden) Close(dto.Id);
        }
    }

    private static readonly char[] BadFileChars = [.. System.IO.Path.GetInvalidFileNameChars(), ':'];
    private static string SafeFileName(string name) =>
        name.IndexOfAny(BadFileChars) < 0 ? name : string.Concat(name.Select(c => BadFileChars.Contains(c) ? '_' : c));
}
