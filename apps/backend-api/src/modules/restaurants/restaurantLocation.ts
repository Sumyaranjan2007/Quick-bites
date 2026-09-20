/**
 * Does this restaurant know where it is?
 *
 * For most of this platform's life, no app sent a restaurant's coordinates at
 * registration, and the register route stamped every one of them with the
 * centre of Bengaluru so that `coordinates` would not be empty. Every
 * restaurant onboarded before the partner app grew a map is therefore sitting
 * in Cubbon Park, whatever its actual address says.
 *
 * That was harmless while the listing was a flat list. It stops being harmless
 * the moment restaurants are filtered by the area they serve: a kitchen in
 * Harohalli recorded at Cubbon Park is thirty kilometres from itself, so its
 * real neighbours fall outside its service radius and the home screen goes
 * EMPTY for exactly the people it delivers to. A region filter applied to
 * coordinates nobody set turns a working app into a blank one.
 *
 * So a restaurant whose position was never set is not judged by distance at
 * all. It is listed, without a distance and without a delivery time, the same
 * way every restaurant is treated for a customer who has not said where they
 * are. An unknown is reported as unknown rather than answered wrongly.
 *
 * THIS IS A BRIDGE, NOT A DESIGN. It exists because there is live data with a
 * placeholder in it. It stops being needed once every restaurant has been
 * through a partner app that requires a pin — at which point deleting this file
 * and letting the distance test apply to everyone is the correct change.
 */
import type { Restaurant } from '@quick-bites/shared-types';

/**
 * What the register route stamps on a restaurant that sent no pin.
 *
 * Compared by exact equality, which is safe here in a way it usually is not:
 * these are not computed values but a literal copied from one place in the
 * source to another, so the bits are identical. A real kitchen would have to
 * sit on this point to fifteen decimal places to be mistaken for a placeholder.
 */
export const UNSET_COORDINATES = { latitude: 12.9716, longitude: 77.5946 };

/**
 * True when someone actually placed this restaurant on a map.
 *
 * False for a missing coordinate pair and false for the placeholder above —
 * both mean the same thing to a caller, which is "do not measure anything from
 * this".
 */
export function hasRealLocation(restaurant: Pick<Restaurant, 'coordinates'>): boolean {
  const point = restaurant.coordinates;
  if (!point) return false;
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return false;
  return !(
    point.latitude === UNSET_COORDINATES.latitude && point.longitude === UNSET_COORDINATES.longitude
  );
}
