/**
 * Framing a trip on the map (owner, 1 Oct 2026): the centre and zoom that show
 * the rider and where they are going, for a map of a measured size.
 *
 * No imports, so the backend gate can load this file and check the numbers.
 * The customer app and the rider app carry identical copies; a check in
 * mapCamera.test.ts fails if they drift.
 */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * A point that is really somewhere a delivery can be. A missing location is
 * often stored as 0,0 (the Atlantic), and one such point in a "fit both" box
 * stretched the map across half the world, which is the "whole map of India"
 * the owner saw. India only, because Quick Bites delivers nowhere else.
 */
export function isPlottable(p: LatLng | null | undefined): p is LatLng {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    p.latitude > 5 &&
    p.latitude < 38 &&
    p.longitude > 67 &&
    p.longitude < 99
  );
}

const TILE = 512; // Mapbox GL's zoom 0 is one 512-dp tile across.
const toWorld = (p: LatLng) => {
  const sin = Math.sin((p.latitude * Math.PI) / 180);
  return {
    x: ((p.longitude + 180) / 360) * TILE,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE
  };
};
const fromWorld = (x: number, y: number): LatLng => ({
  longitude: (x / TILE) * 360 - 180,
  latitude: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / TILE))) * 180) / Math.PI
});

/**
 * The centre and zoom that show every point with a margin, for a map of this
 * measured size. Computed here rather than handed to Mapbox as a box, because
 * on Android a box set before the map has loaded is dropped and the map stays
 * at its default, zoomed-out view.
 */
export function fitCamera(
  points: LatLng[],
  width: number,
  height: number
): { centre: LatLng; zoom: number } | null {
  const usable = points.filter(isPlottable);
  if (usable.length === 0 || width <= 0 || height <= 0) return null;
  const world = usable.map(toWorld);
  const minX = Math.min(...world.map(w => w.x));
  const maxX = Math.max(...world.map(w => w.x));
  const minY = Math.min(...world.map(w => w.y));
  const maxY = Math.max(...world.map(w => w.y));
  const centre = fromWorld((minX + maxX) / 2, (minY + maxY) / 2);
  // Room for the pins and the label in the corner: a fifth of each side.
  const usableW = width * 0.6;
  const usableH = height * 0.6;
  const dx = maxX - minX;
  const dy = maxY - minY;
  if (dx < 1e-9 && dy < 1e-9) return { centre, zoom: 16 };
  const zoom = Math.log2(Math.min(dx > 0 ? usableW / dx : Infinity, dy > 0 ? usableH / dy : Infinity));
  // Never closer than a street, never further than a city region.
  return { centre, zoom: Math.min(17, Math.max(8, zoom)) };
}
