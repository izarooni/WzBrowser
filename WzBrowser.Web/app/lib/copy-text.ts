/**
 * Puts text on the system clipboard. `navigator.clipboard` only exists on secure origins (https or localhost), so when
 * the app is reached over plain http (another computer, a LAN address) fall back to a hidden textarea + execCommand.
 * Must be called from a user gesture (a click). Rejects if neither way works.
 */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* fall through to the legacy path */ }
  }
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    if (!document.execCommand("copy")) throw new Error("The clipboard is blocked.");
  } finally {
    area.remove();
    active?.focus?.();
  }
}
