/* @vendored-from coloring-book:src/modules/basemap-styles.ts
   @sha f9c718c
   @status verbatim */
/**
 * Basemap style configurations for MapLibre GL
 */

export interface BasemapStyle {
  id: string;
  name: string;
  icon: string;
  style: Record<string, unknown>; // MapLibre style spec
}

export const basemapStyles: BasemapStyle[] = [
  {
    id: 'standard',
    name: 'Standard',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
    </svg>`,
    style: {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm',
          type: 'raster',
          source: 'osm',
        },
      ],
    },
  },
  {
    id: 'satellite',
    name: 'Satellite',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 3 7 10h3.5L6 17h5v4h2v-4h5l-4.5-7H17L12 3z" />
    </svg>`,
    style: {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution: '© Esri',
        },
      },
      layers: [
        {
          id: 'satellite',
          type: 'raster',
          source: 'satellite',
        },
      ],
    },
  },
  {
    id: 'stamen-light',
    name: 'Light',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>`,
    style: {
      version: 8,
      sources: {
        stamen: {
          type: 'raster',
          tiles: [
            'https://tiles.stadiamaps.com/tiles/stamen_toner_lite/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          maxzoom: 21,
          attribution: '© Stadia Maps © Stamen Design © OpenMapTiles',
        },
      },
      layers: [
        {
          id: 'stamen-light',
          type: 'raster',
          source: 'stamen',
        },
      ],
    },
  },
  {
    id: 'stamen-dark',
    name: 'Dark',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
    </svg>`,
    style: {
      version: 8,
      sources: {
        stamen: {
          type: 'raster',
          tiles: [
            'https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          maxzoom: 21,
          attribution: '© Stadia Maps © Stamen Design © OpenMapTiles',
        },
      },
      layers: [
        {
          id: 'stamen-dark',
          type: 'raster',
          source: 'stamen',
        },
      ],
    },
  },
  {
    id: 'stamen-watercolor',
    name: 'Watercolor',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
    </svg>`,
    style: {
      version: 8,
      sources: {
        watercolor: {
          type: 'raster',
          tiles: [
            'https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg',
          ],
          tileSize: 256,
          maxzoom: 16,
          attribution: '© Stadia Maps © Stamen Design © OpenMapTiles',
        },
      },
      layers: [
        {
          id: 'watercolor',
          type: 'raster',
          source: 'watercolor',
        },
      ],
    },
  },
  {
    id: 'topo',
    name: 'Topographic',
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5l-1.5-.5M6.75 7.364V3h-3v18m3-13.636l10.5-3.819" />
    </svg>`,
    style: {
      version: 8,
      sources: {
        topo: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© Esri',
        },
      },
      layers: [
        {
          id: 'topo',
          type: 'raster',
          source: 'topo',
        },
      ],
    },
  },
];

export function getBasemapStyle(id: string): BasemapStyle | undefined {
  return basemapStyles.find((style) => style.id === id);
}
