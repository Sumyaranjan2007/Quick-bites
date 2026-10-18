/**
 * The Partner WEBSITE's map seam (/partner): react-native-maps is native-only,
 * so the browser build gets no native map and every map screen uses its drawn
 * fallback, as it would in a build without a key. Same exports as nativeMap.ts.
 */
import type React from 'react';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export const mapsKeyPresent = false;
export const canRenderNativeMap = false;

export const MapCanvas: React.FC<any> = () => null;
export const MapPin: React.FC<any> = () => null;
export const MapMovingPin: React.FC<any> = () => null;
export const MapRoute: React.FC<any> = () => null;
