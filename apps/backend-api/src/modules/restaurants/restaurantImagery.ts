import type { MenuCategory, Restaurant, RestaurantMenu } from '@quick-bites/shared-types';

/**
 * What a customer should be shown of a restaurant, in order of preference.
 *
 * Until now the answer was one field, `bannerUrl`, and it was display-only —
 * no screen in the partner app could set it, so almost every restaurant had
 * none, and almost every card in the customer feed was a grey rectangle. A feed
 * of grey rectangles is not a feed; it is a list, and it looks broken next to
 * every other food app on the phone.
 *
 * The fix is not "find a stock photo". A stock photo of somebody else's biryani
 * on a kitchen that does not serve it is a small lie told at the moment a
 * customer is deciding where to spend money. What a restaurant actually has is
 * its own food, photographed by the partner for the menu — so the order is:
 *
 *   1. the cover photograph, if the partner set one
 *   2. their other photographs of the place
 *   3. photographs of their own food, from their own menu
 *   4. nothing — and the app draws a placeholder from the restaurant's own
 *      name and colours, which is honest about being a placeholder
 *
 * The app decides what to DO with the list (one image, a slideshow, a
 * placeholder); this decides what is in it and in what order.
 */

/** More than this on one card is a slideshow nobody watches to the end. */
export const MAX_FEED_PHOTOS = 5;

/** The same rule the upload paths enforce: a picture, or a link to one. */
function looksLikeImage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return /^data:image\/(jpeg|jpg|png);base64,/i.test(trimmed) || /^https?:\/\//i.test(trimmed);
}

/**
 * Dish photographs, best first.
 *
 * "Best" means available to order and near the top of the menu, because that is
 * the order the partner arranged their own food in — the first category is
 * what they want to be known for. A photograph of a dish that is out of stock
 * is the one thing worse than no photograph: the customer taps the card for
 * the dish in the picture and it is the one thing they cannot have.
 */
export function dishPhotos(menu: RestaurantMenu | null | undefined, limit: number): string[] {
  if (!menu) return [];
  const photos: string[] = [];
  const seen = new Set<string>();

  for (const category of (menu.categories || []) as MenuCategory[]) {
    for (const item of category.items || []) {
      if (photos.length >= limit) return photos;
      if (item.isAvailable === false) continue;
      if (!looksLikeImage(item.imageUrl)) continue;
      const uri = item.imageUrl!.trim();
      if (seen.has(uri)) continue;
      seen.add(uri);
      photos.push(uri);
    }
  }
  return photos;
}

export interface RestaurantImagery {
  /** In order of preference. May be empty, which is a normal answer. */
  photos: string[];
  /**
   * Where they came from, so the app can say "Food from this kitchen" over a
   * dish slideshow rather than implying it is a picture of the premises.
   */
  source: 'COVER' | 'GALLERY' | 'DISHES' | 'NONE';
}

export function buildImagery(
  restaurant: Restaurant & { galleryUrls?: string[] },
  menu: RestaurantMenu | null | undefined,
  limit = MAX_FEED_PHOTOS
): RestaurantImagery {
  const photos: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown) => {
    if (photos.length >= limit) return;
    if (!looksLikeImage(value)) return;
    const uri = value.trim();
    if (seen.has(uri)) return;
    seen.add(uri);
    photos.push(uri);
  };

  const hasCover = looksLikeImage(restaurant.bannerUrl);
  push(restaurant.bannerUrl);
  for (const uri of restaurant.galleryUrls || []) push(uri);
  const hadOwnPhotos = photos.length > 0;

  // Dish photographs fill the rest, so a kitchen with a cover and one gallery
  // shot still gets a slideshow rather than two images and a gap.
  for (const uri of dishPhotos(menu, limit)) push(uri);

  const source: RestaurantImagery['source'] = hasCover
    ? 'COVER'
    : hadOwnPhotos
      ? 'GALLERY'
      : photos.length > 0
        ? 'DISHES'
        : 'NONE';

  return { photos, source };
}

/**
 * A deterministic colour for a restaurant with no photographs at all.
 *
 * Computed from the id rather than chosen at random, so the same kitchen is the
 * same colour on every phone, on every launch, and in the feed and on its own
 * page. A placeholder that changes between screens reads as a loading bug.
 *
 * Sent from the server for the same reason the limits are: the apps must not
 * each invent their own palette and disagree about what one restaurant looks
 * like.
 */
const PLACEHOLDER_COLOURS = [
  '#7A2E3F',
  '#2E5A7A',
  '#3F7A2E',
  '#7A5A2E',
  '#5A2E7A',
  '#2E7A6A',
  '#7A3F2E',
  '#3F2E7A'
] as const;

export function placeholderColour(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PLACEHOLDER_COLOURS[hash % PLACEHOLDER_COLOURS.length]!;
}

/**
 * Up to two letters drawn from the trading name.
 *
 * Two words give their initials; one word gives its first two letters, which
 * reads better than a single enormous letter. Non-letters are skipped, so
 * "7 Spice" is "SP" rather than "7S".
 */
export function placeholderInitials(name: string): string {
  const words = String(name || '')
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean);

  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
