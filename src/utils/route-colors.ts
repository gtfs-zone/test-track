/* @vendored-from coloring-book:src/utils/route-colors.ts
   @sha a4b5ee1
   @status modified
   @changes
   - `routeTextColor` (plus `luminance` and `TEXT_LUMINANCE_PIVOT`) kept: knip
     dropped it upstream in `f456bbb` as unused there, but `gtfs-static.ts`
     still needs it for route badge text. */
/**
 * Colors for a route on the map and in the UI.
 *
 * A GTFS feed is free to omit `route_color`, and plenty do. Those routes still
 * have to be told apart on the map, so the fallback hashes `route_id` into a
 * stable hue, the same route gets the same color on every reload, and no
 * feed-supplied color is ever overridden.
 *
 * The hue is realized through OKLCH at a fixed lightness and chroma rather than
 * HSL. In HSL a constant lightness is a lie: `hsl(76, 70%, 50%)` is a glaring
 * yellow-green and `hsl(240, 70%, 50%)` is nearly black, so a hash-assigned
 * palette comes out visually chaotic. OKLCH is perceptually uniform, so every
 * hashed route lands at the same apparent weight and the set reads as one
 * family, calm enough to sit under a raster basemap and legible on both light
 * and dark themes.
 *
 * Everything is converted to `#rrggbb` before it leaves this module. MapLibre
 * paint properties consume these values directly and its color parser is not
 * something to bet CSS Color 4 syntax on; hex also keeps `casingColor` down to
 * a single branch.
 */

/** Perceptual lightness of a hashed route color, 0–1. Higher is paler. */
const HASH_LIGHTNESS = 0.62;

/**
 * Perceptual chroma of a hashed route color. This is the "flashiness" dial:
 * ~0.04 is nearly grey, ~0.2 is as saturated as sRGB will hold at this
 * lightness. Values past roughly 0.15 start clipping the sRGB gamut unevenly
 * across hues, which reintroduces exactly the unevenness OKLCH is here to fix.
 */
const HASH_CHROMA = 0.11;

/**
 * Hue step between consecutive hash values, in degrees. The golden angle
 * spreads sequential ids as far apart as possible instead of clustering them:
 * with a plain `hash % 360`, route ids as different as `L` and `N` land two
 * degrees apart and render as the same color.
 */
const HUE_STEP = 137.508;

/** How far the casing under a route line is darkened from the line itself. */
const CASING_FACTOR = 0.55;

/** Casing for a color this module can't parse. */
const CASING_FALLBACK = '#333333';

/** djb2-ish string hash. Stable across reloads; sign-stripped by the caller. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/** Clamp a linear-light channel to sRGB and format it as two hex digits. */
function channelToHex(value: number): string {
  const gamma =
    value <= 0.0031308
      ? 12.92 * value
      : 1.055 * Math.pow(Math.max(value, 0), 1 / 2.4) - 0.055;
  const byte = Math.round(Math.min(1, Math.max(0, gamma)) * 255);
  return byte.toString(16).padStart(2, '0');
}

/**
 * OKLCH to `#rrggbb`, via OKLab and linear sRGB. Out-of-gamut results are
 * clamped per channel, which shifts hue slightly at high chroma, acceptable
 * here because `HASH_CHROMA` is kept well inside the gamut.
 */
function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return `#${channelToHex(red)}${channelToHex(green)}${channelToHex(blue)}`;
}

/** True for the 6-hex-digit, no-`#` form that `routes.txt` specifies. */
function isGtfsColor(value: string | undefined): value is string {
  return (
    value !== undefined && value.length === 6 && /^[0-9A-Fa-f]+$/.test(value)
  );
}

/**
 * The fill color for a route: the feed's `route_color` when it supplies a
 * usable one, otherwise a hue hashed from `route_id`.
 */
export function routeColor(route_id: string, gtfsRouteColor?: string): string {
  if (isGtfsColor(gtfsRouteColor)) {
    return `#${gtfsRouteColor}`;
  }
  const hue = (hashString(route_id) * HUE_STEP) % 360;
  return oklchToHex(HASH_LIGHTNESS, HASH_CHROMA, hue);
}

/**
 * The casing drawn underneath a route line: a darker shade of the line color,
 * so routes read as crisp ribbons over the basemap.
 */
export function casingColor(color: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    console.warn(`[route-colors] Unrecognized route color format: ${color}`);
    return CASING_FALLBACK;
  }
  const n = parseInt(color.slice(1), 16);
  const darken = (v: number) => Math.round(v * CASING_FACTOR);
  return (
    '#' +
    [darken((n >> 16) & 255), darken((n >> 8) & 255), darken(n & 255)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Relative luminance above which black text beats white on a given fill.
 * Deliberately above the 0.179 WCAG crossover: route badges are small, bold,
 * and sit on saturated fills, where dark-on-mid reads better than the contrast
 * math alone suggests.
 */
const TEXT_LUMINANCE_PIVOT = 0.45;

/** Relative luminance (WCAG) of a `#rrggbb` color. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Legible text over `fill`. Honors the feed's `route_text_color` when present,
 * an agency's own pairing is authoritative even when it's a poor one, and
 * otherwise picks black or white by luminance. Blindly defaulting to white is
 * what makes a badge on a pale feed color unreadable.
 */
export function routeTextColor(fill: string, gtfsTextColor?: string): string {
  if (isGtfsColor(gtfsTextColor)) {
    return `#${gtfsTextColor}`;
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(fill)) {
    return '#ffffff';
  }
  return luminance(fill) > TEXT_LUMINANCE_PIVOT ? '#000000' : '#ffffff';
}
