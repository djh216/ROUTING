/** Capture the live Leaflet map DOM as a JPEG data URL (best-effort; tiles may be omitted by browser CORS). */
export async function captureLiveMapScreenshot(
  selector = ".route-map .leaflet-container"
): Promise<string | null> {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;

  try {
    const { default: html2canvas } = await import("html2canvas");
    const canvas = await html2canvas(el, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#f8fafc",
      scale: Math.min(2, window.devicePixelRatio || 1),
      logging: false,
      ignoreElements: (node) =>
        node.classList?.contains("leaflet-control-container") ?? false,
    });
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (err) {
    console.warn("Live map screenshot failed:", err);
    return null;
  }
}
