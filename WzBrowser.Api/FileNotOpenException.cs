namespace WzBrowser.Api;

/// <summary>A request named a file that isn't open, or was closed while the request waited for it.</summary>
public sealed class FileNotOpenException(string id) : KeyNotFoundException($"No open file with id '{id}'.");
