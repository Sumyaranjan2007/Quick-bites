/**
 * The geometry behind fitting two points into a map, with no React, no Mapbox
 * and no Expo in it.
 *
 * -------------------------------------------------------------------------
 * WHY IT IS ITS OWN FILE
 * -------------------------------------------------------------------------
 * It used to live inside `nativeMap.ts` and `LiveRiderMap.tsx`, both of which
 * import React and a native module. Neither can be loaded by a test runner, so
 * the arithmetic that decided whether a customer could see their rider was the
 * one piece of this app nothing could check — and it was wrong for two years in
 * a way that only showed up at distance.
 *
 * Pure functions, no imports. The gate can load this file directly.
 *
 * -------------------------------------------------------------------------
 * WHAT WAS WRONG, MEASURED RATHER THAN ASSERTED
 * -------------------------------------------------------------------------
 * The native map picked a centre and a span in metres, and `zoomForSpan` turned
 * that into a zoom with `log2(40075016.686 / span)`. That number is the earth's
 * equatorial circumference, so the result is the zoom at which the span fills
 * one 256-pixel tile.
 *
 * TWO THINGS ARE TRUE ABOUT IT, and the first is the one to hold on to:
 *
 *   1. IT IS VIEWPORT-BLIND. It takes one argument. It returns the same zoom for
 *      a 320x190 box and a 190x320 box, which cannot both be right. A fitting
 *      function that never sees the thing it is fitting into is wrong by
 *      construction, whatever number it happens to produce.
 *
 *   2. AND WHAT IT PRODUCES LEAVES 12.9 PIXELS. Because the span is 1.6x the
 *      distance and the zoom is a log of that span, the two scale together and
 *      the pixel separation comes out CONSTANT — 164px, at every distance from
 *      500m to 30km. In a 190px-tall box that leaves 12.9px above and below.
 *      The marker is a 14px dot inside a 2.5px ring, so it clips.
 *
 * The first version of this comment repeated a four-part explanation in which
 * every error grew with distance. That is not what the arithmetic does, and it
 * was worth an hour to find out: the errors do not compound with distance at
 * all. What varies is the `max(400, ...)` FLOOR — under about 250 metres the
 * floor takes over and the margin opens up to 29px, which is why a short trip
 * looks fine and everything else does not. That is the shape the owner actually
 * described: "when its too far it shows outside".
 *
 * NOT ASSERTED HERE: whether Mapbox's own tile size doubles the error again.
 * Its vector styles use 512px tiles, which would put the separation at ~328px in
 * a 190px box and overflow outright — but that cannot be verified from this
 * repository without the native module, so it is written down as a question
 * rather than a cause.
 *
 * The DRAWN FALLBACK map had always done this correctly, because its `fitZoom`
 * takes a width and a height. So the fallback fitted and the real map did not,
 * which is how this survived: anybody testing on a machine without the native
 * module saw correct behaviour.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Web-mercator world pixel coordinates at a given zoom, 256px tiles. */
export function project(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = 256 * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Great-circle distance in metres. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * THE OLD, WRONG ANSWER. Kept, exported, and used by nothing.
 *
 * It is here so the defect can be demonstrated rather than described. A check
 * feeds it an eight-kilometre north-south pair and measures the margin it leaves:
 * 12.9 pixels, less than the marker is tall. Deleting it would leave that check
 * asserting against a number typed into the test, which proves only that the test
 * agrees with itself.
 *
 * If this ever becomes unreferenced, the check that reads it has gone too.
 */
export function zoomForSpanIgnoringViewport(spanMetres: number): number {
  const safeSpan = Math.max(50, spanMetres);
  return Math.min(20, Math.max(1, Math.log2(40075016.686 / safeSpan)));
}

export interface Bounds {
  /** North-east corner. */
  ne: LatLng;
  /** South-west corner. */
  sw: LatLng;
}

/**
 * The smallest box containing every point, or null when there is no box.
 *
 * Null for fewer than two points, and null for a ZERO-AREA box — two identical
 * coordinates, which happens whenever a rider is standing at the door. Mapbox
 * given a zero-area bounds zooms to maximum and renders a blank grey square,
 * and "blank" is the one thing a tracking map must never be. The caller falls
 * back to a centre and a floor span.
 *
 * The threshold is in degrees rather than metres on purpose: it is the same
 * question the projection asks, and converting to metres and back would
 * introduce a latitude term into a check that does not need one.
 */
const DEGENERATE_DEGREES = 1e-6;

export function boundsFor(points: LatLng[]): Bounds | null {
  const usable = (points || []).filter(
    p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );
  if (usable.length < 2) return null;

  let north = usable[0].latitude;
  let south = usable[0].latitude;
  let east = usable[0].longitude;
  let west = usable[0].longitude;

  for (const p of usable) {
    if (p.latitude > north) north = p.latitude;
    if (p.latitude < south) south = p.latitude;
    if (p.longitude > east) east = p.longitude;
    if (p.longitude < west) west = p.longitude;
  }

  if (north - south < DEGENERATE_DEGREES && east - west < DEGENERATE_DEGREES) return null;

  return {
    ne: { latitude: north, longitude: east },
    sw: { latitude: south, longitude: west }
  };
}

/** The middle of a set of points. Used when there is no box to fit. */
export function centreOf(points: LatLng[]): LatLng | null {
  const usable = (points || []).filter(
    p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
  );
  if (usable.length === 0) return null;
  const box = boundsFor(usable);
  if (!box) return usable[0];
  return {
    latitude: (box.ne.latitude + box.sw.latitude) / 2,
    longitude: (box.ne.longitude + box.sw.longitude) / 2
  };
}

/**
 * Padding, in PIXELS, around a fitted box.
 *
 * Pixels rather than a percentage of the span, because the thing being cleared
 * is a drawn marker and a marker is the same size at every zoom. A pin 40px tall
 * anchored at its point still clips at the top edge when its coordinate sits
 * exactly on the boundary, and a percentage of an eight-kilometre span is
 * enormous while a percentage of a fifty-metre one is nothing.
 *
 * 48 clears the tallest marker this app draws with room for its shadow. The top
 * gets more because that is where a pin's body extends from its anchor point.
 */
export const FIT_PADDING = { top: 64, bottom: 48, left: 48, right: 48 } as const;

/**
 * Largest zoom at which every point still fits a viewport, for the DRAWN
 * fallback map which has to choose a zoom itself.
 *
 * Unlike the old native path this takes the width and the height, so a
 * north-south pair is fitted against the short side.
 */
export function fitZoom(points: LatLng[], width: number, height: number): number {
  const box = boundsFor(points);
  if (!box) return 16;

  const usableW = Math.max(1, width - FIT_PADDING.left - FIT_PADDING.right);
  const usableH = Math.max(1, height - FIT_PADDING.top - FIT_PADDING.bottom);

  for (let z = 18; z >= 1; z--) {
    const ne = project(box.ne.latitude, box.ne.longitude, z);
    const sw = project(box.sw.latitude, box.sw.longitude, z);
    if (Math.abs(ne.x - sw.x) <= usableW && Math.abs(ne.y - sw.y) <= usableH) return z;
  }
  return 1;
}

/**
 * Whether every point lands inside a viewport at this zoom, centred on them.
 *
 * Only a test calls this, and that is the point: "both markers are visible" is
 * the property the owner reported broken, and it is checkable here in pixels
 * rather than by looking at a phone.
 */
export function allPointsVisible(
  points: LatLng[],
  zoom: number,
  width: number,
  height: number
): boolean {
  const centre = centreOf(points);
  if (!centre) return false;
  const c = project(centre.latitude, centre.longitude, zoom);
  const originX = c.x - width / 2;
  const originY = c.y - height / 2;

  return points.every(p => {
    const q = project(p.latitude, p.longitude, zoom);
    const x = q.x - originX;
    const y = q.y - originY;
    return x >= 0 && x <= width && y >= 0 && y <= height;
  });
}
