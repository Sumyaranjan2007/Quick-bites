import { useCallback, useState } from 'react';
import * as Location from 'expo-location';

/**
 * The customer's own position, used to place a delivery address on the map.
 *
 * Addresses saved from the app carried no coordinates, so an order made to one
 * had no destination - which is why the live map sat on "waiting for the
 * delivery address position" no matter how well the rider's GPS was working.
 * A typed address is a string; a delivery needs a point.
 *
 * Permission is requested at the moment the customer asks for it, not at
 * startup, so the prompt arrives with a visible reason attached.
 */
export interface DetectedPlace {
  coordinates: { latitude: number; longitude: number };
  /** Best-effort street address; absent if reverse geocoding is unavailable. */
  addressLine?: string;
  city?: string;
  pincode?: string;
}

export function useDeviceLocation() {
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async (): Promise<DetectedPlace | null> => {
    setDetecting(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location access is off. Turn it on to use your current position, or type the address instead.');
        return null;
      }

      const services = await Location.hasServicesEnabledAsync();
      if (!services) {
        setError('Location services are switched off on this phone.');
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });

      const coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      // Reverse geocoding is a convenience, not a requirement: a point with no
      // street name still delivers, a street name with no point does not.
      try {
        const [place] = await Location.reverseGeocodeAsync(coordinates);
        if (place) {
          const line = [place.name, place.street, place.district]
            .filter((part, i, all) => part && all.indexOf(part) === i)
            .join(', ');
          return {
            coordinates,
            addressLine: line || undefined,
            city: place.city || place.subregion || undefined,
            pincode: place.postalCode || undefined
          };
        }
      } catch {
        /* Fall through with coordinates only. */
      }

      return { coordinates };
    } catch {
      setError('Could not read your location. Try again, or type the address.');
      return null;
    } finally {
      setDetecting(false);
    }
  }, []);

  return { detect, detecting, error, clearError: () => setError(null) };
}
