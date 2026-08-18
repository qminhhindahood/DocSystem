using DocumentRenderer.Core.Configuration;

namespace DocumentRenderer.Core.Security;

public sealed class StoragePathResolver(RendererOptions options)
{
    private readonly string _root = Path.GetFullPath(options.StorageRoot);

    public string ResolveExisting(string relativePath)
    {
        var path = Resolve(relativePath);
        if (!File.Exists(path)) throw new FileNotFoundException("Storage file not found");
        return path;
    }

    public string ResolveOutput(string relativePath)
    {
        var path = Resolve(relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        return path;
    }

    private string Resolve(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathRooted(relativePath))
            throw new InvalidOperationException("Storage path must be relative");
        var normalized = relativePath.Replace('/', Path.DirectorySeparatorChar);
        if (normalized.Split(Path.DirectorySeparatorChar).Any(p => p is ".." or "." or ""))
            throw new InvalidOperationException("Storage path contains an unsafe segment");
        var resolved = Path.GetFullPath(Path.Combine(_root, normalized));
        if (!resolved.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException("Storage path escapes its configured root");
        RejectReparsePoints(resolved);
        return resolved;
    }

    private void RejectReparsePoints(string destination)
    {
        var current = new DirectoryInfo(_root);
        var relative = Path.GetRelativePath(_root, destination);
        foreach (var segment in relative.Split(Path.DirectorySeparatorChar))
        {
            var next = Path.Combine(current.FullName, segment);
            if (File.Exists(next) || Directory.Exists(next))
            {
                var attributes = File.GetAttributes(next);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("Storage paths may not traverse links");
            }
            current = new DirectoryInfo(next);
        }
    }
}
