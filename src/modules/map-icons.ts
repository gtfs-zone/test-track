/* @vendored-from coloring-book:src/modules/map-icons.ts
   @sha cef96c7
   @status verbatim */
import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Pathway mode glyphs, drawn on a canvas at load time rather than shipped as
 * assets so the map needs no image pipeline and no network fetch.
 *
 * MapLibre drops every registered image on setStyle (basemap switch), so
 * ensureMapIcons must be re-run whenever pathway layers are rebuilt. It is
 * idempotent.
 */

const SIZE = 30;
const PIXEL_RATIO = 2.4;

type Draw = (ctx: CanvasRenderingContext2D, s: number) => void;

interface Glyph {
  draw: Draw;
  /** Draw the dark chip disc behind the glyph. */
  chip: boolean;
}

const PATHWAY_DRAWS: Record<string, Draw> = {
  'pathway-walk': (ctx, s) => {
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.32, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.41);
    ctx.lineTo(s * 0.5, s * 0.58);
    ctx.moveTo(s * 0.5, s * 0.58);
    ctx.lineTo(s * 0.39, s * 0.74);
    ctx.moveTo(s * 0.5, s * 0.58);
    ctx.lineTo(s * 0.62, s * 0.73);
    ctx.moveTo(s * 0.5, s * 0.46);
    ctx.lineTo(s * 0.64, s * 0.4);
    ctx.stroke();
  },
  'pathway-sidewalk': (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.24, s * 0.68);
    ctx.lineTo(s * 0.76, s * 0.68);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.28, s * 0.42);
    ctx.lineTo(s * 0.68, s * 0.42);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.76, s * 0.42);
    ctx.lineTo(s * 0.6, s * 0.32);
    ctx.lineTo(s * 0.6, s * 0.52);
    ctx.closePath();
    ctx.fill();
  },
  'pathway-stairs': (ctx, s) => {
    const x0 = s * 0.26;
    const y0 = s * 0.72;
    const step = s * 0.16;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    for (let i = 0; i < 3; i++) {
      ctx.lineTo(x0 + step * i, y0 - step * (i + 1));
      ctx.lineTo(x0 + step * (i + 1), y0 - step * (i + 1));
    }
    ctx.stroke();
  },
  'pathway-escalator': (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.24, s * 0.72);
    ctx.lineTo(s * 0.7, s * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.76, s * 0.26);
    ctx.lineTo(s * 0.56, s * 0.3);
    ctx.lineTo(s * 0.7, s * 0.46);
    ctx.closePath();
    ctx.fill();
  },
  'pathway-elevator': (ctx, s) => {
    ctx.strokeRect(s * 0.32, s * 0.26, s * 0.36, s * 0.48);
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.33);
    ctx.lineTo(s * 0.41, s * 0.44);
    ctx.lineTo(s * 0.59, s * 0.44);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.67);
    ctx.lineTo(s * 0.41, s * 0.56);
    ctx.lineTo(s * 0.59, s * 0.56);
    ctx.closePath();
    ctx.fill();
  },
  'pathway-gate': (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.3, s * 0.24);
    ctx.lineTo(s * 0.3, s * 0.76);
    ctx.moveTo(s * 0.7, s * 0.24);
    ctx.lineTo(s * 0.7, s * 0.76);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.44, s * 0.5);
    ctx.lineTo(s * 0.58, s * 0.5);
    ctx.stroke();
  },
  'pathway-exit': (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s * 0.28, s * 0.24);
    ctx.lineTo(s * 0.28, s * 0.76);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.42, s * 0.5);
    ctx.lineTo(s * 0.64, s * 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s * 0.74, s * 0.5);
    ctx.lineTo(s * 0.58, s * 0.4);
    ctx.lineTo(s * 0.58, s * 0.6);
    ctx.closePath();
    ctx.fill();
  },
};

/** Chevron pointing +x, which MapLibre aligns with the line's travel direction. */
const drawChevron: Draw = (ctx, s) => {
  ctx.beginPath();
  ctx.moveTo(s * 0.36, s * 0.24);
  ctx.lineTo(s * 0.66, s * 0.5);
  ctx.lineTo(s * 0.36, s * 0.76);
  ctx.stroke();
};

const GLYPHS: Record<string, Glyph> = {
  ...Object.fromEntries(
    Object.entries(PATHWAY_DRAWS).map(([name, draw]) => [
      name,
      { draw, chip: true },
    ])
  ),
  'route-arrow': {
    chip: false,
    draw: (ctx, s) => {
      // Dark outline underneath so the chevron survives a light route color.
      ctx.strokeStyle = 'rgba(15,23,42,0.55)';
      ctx.lineWidth = 5;
      drawChevron(ctx, s);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      drawChevron(ctx, s);
    },
  },
};

function render(draw: Draw, chip: boolean): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return null;
  }

  // Dark chip behind the pathway glyphs so they stay legible over any basemap
  // and match the dark casing under the pathway lines.
  if (chip) {
    ctx.fillStyle = 'rgba(15,23,42,0.92)';
    ctx.beginPath();
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx, SIZE);

  return ctx.getImageData(0, 0, SIZE, SIZE);
}

export function ensureMapIcons(map: MapLibreMap): void {
  for (const [name, glyph] of Object.entries(GLYPHS)) {
    if (map.hasImage(name)) {
      continue;
    }
    const image = render(glyph.draw, glyph.chip);
    if (!image) {
      console.warn(`[map-icons] Could not render ${name}`);
      continue;
    }
    map.addImage(
      name,
      { width: image.width, height: image.height, data: image.data },
      { pixelRatio: PIXEL_RATIO }
    );
  }
}
