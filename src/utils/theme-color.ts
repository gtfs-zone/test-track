/* @vendored-from coloring-book:src/utils/theme-color.ts
   @sha a4b5ee1
   @status verbatim */
/**
 * Resolve a DaisyUI theme token to an sRGB hex string MapLibre can parse.
 *
 * DaisyUI v5 emits its palette as oklch(), which MapLibre's color parser
 * rejects, and getComputedStyle serializes non-sRGB colors back in their own
 * color space rather than as rgb(). Painting the value into a 1x1 canvas and
 * reading the pixel back is the only route that always lands in sRGB.
 */

const cache = new Map<string, string>();

function readComputedColor(cssVar: string): string | null {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
  probe.style.color = `var(${cssVar})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed || null;
}

function toHex(cssColor: string): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function resolveThemeColor(cssVar: string, fallback: string): string {
  const cached = cache.get(cssVar);
  if (cached) {
    return cached;
  }
  const computed = readComputedColor(cssVar);
  const hex = computed ? toHex(computed) : null;
  if (!hex) {
    console.warn(
      `[theme-color] Could not resolve ${cssVar}, falling back to ${fallback}`
    );
    return fallback;
  }
  cache.set(cssVar, hex);
  return hex;
}

/** Call whenever the active theme changes; resolved values are theme-specific. */
export function clearThemeColorCache(): void {
  cache.clear();
}
