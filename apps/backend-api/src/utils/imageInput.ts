/**
 * What may be stored as a picture (security L5, L6).
 *
 * Documents (licences, PAN, bank proof) must be a PHOTO sent from the app:
 * JPEG, PNG or WebP as a data URI. Never a link (opening it made an admin's
 * phone fetch a stranger's server) and never SVG (a document format that can
 * carry script). Dish and catalogue images may also be an https link.
 */
// Line breaks allowed: some phones wrap their base64.
const PHOTO_DATA = /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/\r\n]+={0,2}\s*$/;

export const isPhotoData = (value: string): boolean => PHOTO_DATA.test(value);

export const isImageRef = (value: string): boolean => isPhotoData(value) || /^https:\/\/\S+$/i.test(value);
