/**
 * Saves what a URL returns as a file. The API is usually on another origin, where <a download> is ignored, so the
 * bytes are fetched and saved from here. Throws with the server's message when the request fails.
 */
export async function download(url: string, fileName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    const message = await res.json().then((b: { error?: string }) => b.error, () => undefined);
    throw new Error(message ?? `The download failed (${res.status}).`);
  }
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
