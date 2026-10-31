// The pixel formats a canvas can be stored in, as the API names them (WzNode.format, and setPng's `quality`).
// WzBrowser.Api/WzService.CanvasUpload.cs has the full table: WZ format numbers, pixel layouts and measured error.
//
//   bgra8888  exact; largest; every client                       (WZ format 2, the default)
//   keep      whatever the canvas uses now
//   argb4444  16 levels per channel (±8 of 255); every client    (WZ format 1, the usual pre-Big Bang sprite format)
//   argb1555  32 levels per colour (±4), on/off transparency      (WZ format 257)
//   rgb565    32/64 levels (±4), no transparency; backgrounds     (WZ format 513)
//   dxt3      4×4 block compression, sharp alpha; Big Bang+ only  (WZ format 1026; size padded to a multiple of 4)
//   dxt5      4×4 block compression, smooth alpha; Big Bang+ only (WZ format 2050; size padded to a multiple of 4)

/** One choice in the upload quality dropdown. `value` is sent as setPng's `quality`; `hint` is shown under it. */
export interface ImageQuality { value: string; label: string; hint: string }

/** What an uploaded image can be stored as. The first is the default. */
export const IMAGE_QUALITIES: ImageQuality[] = [
  { value: "bgra8888", label: "Lossless (BGRA8888)", hint: "32-bit, exact colours and transparency. Largest; every client reads it." },
  { value: "keep", label: "Same as current", hint: "The format the canvas has now, so it matches the file's other sprites." },
  { value: "argb4444", label: "ARGB4444", hint: "16-bit, 16 levels per channel. The classic sprite format; half the size." },
  { value: "argb1555", label: "ARGB1555", hint: "16-bit, 32 levels per colour, and pixels are either fully see-through or solid." },
  { value: "rgb565", label: "RGB565 (no transparency)", hint: "16-bit, opaque. For backgrounds; transparency is lost." },
  { value: "dxt3", label: "DXT3 (Big Bang+)", hint: "Block compressed, sharp transparency. Pre-Big Bang clients can't read it. Pads the size to a multiple of 4." },
  { value: "dxt5", label: "DXT5 (Big Bang+)", hint: "Block compressed, smooth transparency. Pre-Big Bang clients can't read it. Pads the size to a multiple of 4." },
];

const FORMAT_NAMES: Record<string, string> = {
  bgra8888: "BGRA8888", argb4444: "ARGB4444", argb1555: "ARGB1555", rgb565: "RGB565", "rgb565-block": "RGB565 (16×16 blocks)",
  dxt3: "DXT3", "dxt3-gray": "DXT3 (greyscale)", dxt5: "DXT5", bc7: "BC7",
};

/** A canvas' current format for display, e.g. "ARGB4444". */
export const formatName = (format: string | null | undefined) => (format ? FORMAT_NAMES[format] ?? `Format ${format}` : null);

const STORAGE_KEY = "wzbrowser.imageQuality";

export function loadImageQuality(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && IMAGE_QUALITIES.some((q) => q.value === v)) return v;
  } catch { /* storage unavailable */ }
  return IMAGE_QUALITIES[0].value;
}

export function saveImageQuality(value: string) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable: just won't persist */ }
}
