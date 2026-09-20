import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform
} from 'react-native';
import { MapPin, X, Crosshair, Check } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';
import { useDeviceLocation } from '../lib/useDeviceLocation';
import { Maps, canRenderNativeMap } from '../lib/nativeMap';

const c = tokens.colors;

export interface PickedLocation {
  coordinates: { latitude: number; longitude: number };
  addressLine: string;
  city?: string;
  pincode?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (picked: PickedLocation) => void;
  /** Where to open. The address being edited, else the customer's last position. */
  initial?: { latitude: number; longitude: number } | null;
  apiUrl?: string;
  token?: string;
}

/** Bengaluru. Only ever used when there is no position of any kind to open on. */
const FALLBACK_CENTRE = { latitude: 12.9716, longitude: 77.5946 };

/**
 * ~1.1 km across. Close enough to see individual buildings and pick a gate,
 * wide enough that a GPS fix a street off is still on screen and can be dragged
 * to rather than hunted for.
 */
const SPAN = 0.01;

/**
 * Pick a delivery point on a real map.
 *
 * Typing an address is how a delivery goes to the wrong building. Indian
 * addresses are not a grid — "3rd Cross, 5th Main" exists a dozen times in one
 * city, apartment complexes are addressed by name rather than number, and the
 * gate a rider needs is often round the back from the street the address names.
 * The pin is the only part of an address that cannot be ambiguous.
 *
 * THE PIN DOES NOT MOVE; THE MAP DOES. The marker is a fixed view pinned to the
 * centre of the screen and the map slides underneath it. A draggable marker is
 * the obvious alternative and is worse on a phone: the thumb covers the exact
 * point being placed, and a long-press that starts a drag is indistinguishable
 * from a press that starts a pan. Every serious mapping app resolved this the
 * same way.
 *
 * REVERSE GEOCODING IS DEBOUNCED AND FIRES ON SETTLE, not on every frame of the
 * pan. Google bills per call; a map dragged across a city would otherwise cost
 * a call per frame, and the address text would flicker through every street it
 * crossed on the way.
 *
 * WITHOUT A NATIVE MAP this renders a plain confirmation of the coordinates it
 * already has instead of a map — see `lib/nativeMap.ts` for the two ways that
 * happens. The customer can still save an address; they just do it by search
 * and by "use my current location", which is what they did before this screen
 * existed.
 */
export const MapAddressPicker: React.FC<Props> = ({
  visible,
  onClose,
  onConfirm,
  initial,
  apiUrl,
  token
}) => {
  const [centre, setCentre] = useState(initial || FALLBACK_CENTRE);
  const [resolved, setResolved] = useState<PickedLocation | null>(null);
  const [looking, setLooking] = useState(false);
  const { detect, detecting } = useDeviceLocation();
  const mapRef = useRef<any>(null);

  // Guards a late reverse-geocode from overwriting the address for a position
  // the customer has since dragged away from. Without it, a slow response for
  // an abandoned point lands after a fast one for the current point and the
  // screen ends up describing somewhere the pin is not.
  const requestSeq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lookUp = useCallback(
    async (point: { latitude: number; longitude: number }) => {
      if (!apiUrl || !token) return;
      const seq = ++requestSeq.current;
      setLooking(true);
      try {
        const res = await apiFetch(
          `${apiUrl}/places/reverse?lat=${point.latitude}&lng=${point.longitude}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json().catch(() => null);
        if (seq !== requestSeq.current) return; // a newer pin won
        const place = data?.data?.place;
        setResolved({
          coordinates: point,
          addressLine: place?.formattedAddress || '',
          city: place?.locality,
          pincode: place?.postalCode
        });
      } catch {
        if (seq !== requestSeq.current) return;
        // The point is still perfectly usable without a name for it — the rider
        // navigates to coordinates, not to prose.
        setResolved({ coordinates: point, addressLine: '' });
      } finally {
        if (seq === requestSeq.current) setLooking(false);
      }
    },
    [apiUrl, token]
  );

  // Opening is the one moment the address should be fetched immediately rather
  // than after the settle delay: there is nothing on screen yet to flicker.
  useEffect(() => {
    if (!visible) return;
    const start = initial || FALLBACK_CENTRE;
    setCentre(start);
    setResolved(null);
    lookUp(start);
    // `initialRegion` is only read when the map mounts. Whether a Modal's
    // children unmount while hidden is a platform detail, so relying on it
    // would mean the picker sometimes reopening on the LAST place it was used
    // rather than the one it was asked for. Moving the camera explicitly is
    // correct either way, and is a no-op on a map that just mounted there.
    mapRef.current?.animateToRegion?.(
      { ...start, latitudeDelta: SPAN, longitudeDelta: SPAN },
      0
    );
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [visible, initial, lookUp]);

  /**
   * Called continuously while the map moves. The work is deferred until it has
   * been still for a moment, so a pan across town is one lookup rather than a
   * hundred.
   */
  const onRegionChange = useCallback(
    (region: { latitude: number; longitude: number }) => {
      const point = { latitude: region.latitude, longitude: region.longitude };
      setCentre(point);
      setResolved(null);
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => lookUp(point), 500);
    },
    [lookUp]
  );

  const goToMyLocation = useCallback(async () => {
    const place = await detect();
    if (!place) return;
    setCentre(place.coordinates);
    // animateToRegion rather than a state-driven re-render: re-mounting the map
    // at a new region loses the tiles already drawn and blinks the whole view.
    mapRef.current?.animateToRegion?.(
      { ...place.coordinates, latitudeDelta: SPAN, longitudeDelta: SPAN },
      450
    );
    lookUp(place.coordinates);
  }, [detect, lookUp]);

  const confirm = useCallback(() => {
    onConfirm(resolved || { coordinates: centre, addressLine: '' });
  }, [onConfirm, resolved, centre]);

  const MapView = Maps?.default;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerButton} accessibilityLabel="Close map">
            <X size={20} color={c.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Set delivery location</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.mapArea}>
          {canRenderNativeMap && MapView ? (
            <>
              <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                provider={Platform.OS === 'android' ? Maps?.PROVIDER_GOOGLE : undefined}
                initialRegion={{
                  ...(initial || FALLBACK_CENTRE),
                  latitudeDelta: SPAN,
                  longitudeDelta: SPAN
                }}
                onRegionChangeComplete={onRegionChange}
                showsUserLocation
                showsMyLocationButton={false}
                toolbarEnabled={false}
              />
              {/* The fixed pin. Outside the map, centred over it, and
                  pointer-events none so it never swallows a pan gesture. */}
              <View pointerEvents="none" style={styles.pinLayer}>
                <MapPin size={36} color={c.primary[500]} fill={c.primary[500]} strokeWidth={1.5} />
                {/* Offset by half the icon so the point of the pin, not its
                    centre, marks the chosen spot. */}
                <View style={styles.pinTipOffset} />
              </View>
            </>
          ) : (
            <View style={styles.noMap}>
              <MapPin size={34} color={c.text.muted} />
              <Text style={styles.noMapTitle}>Map not available in this build</Text>
              <Text style={styles.noMapBody}>
                Search for the address or use your current location instead. Your delivery will still
                arrive — riders navigate to the saved position.
              </Text>
            </View>
          )}

          {canRenderNativeMap && (
            <TouchableOpacity
              style={styles.locateFab}
              onPress={goToMyLocation}
              disabled={detecting}
              accessibilityLabel="Centre on my location"
            >
              {detecting ? (
                <ActivityIndicator size="small" color={c.primary[500]} />
              ) : (
                <Crosshair size={18} color={c.primary[500]} />
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.sheet}>
          <Text style={styles.sheetLabel}>DELIVERING TO</Text>
          {looking ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={c.primary[500]} />
              <Text style={styles.looking}>Finding this address…</Text>
            </View>
          ) : (
            <Text style={styles.address} numberOfLines={2}>
              {resolved?.addressLine ||
                `${centre.latitude.toFixed(5)}, ${centre.longitude.toFixed(5)}`}
            </Text>
          )}
          <Text style={styles.hint}>
            {canRenderNativeMap
              ? 'Move the map to place the pin at your gate. You will add the flat or house number next.'
              : 'You will add the flat or house number next.'}
          </Text>

          <TouchableOpacity
            style={[styles.confirm, looking && styles.confirmBusy]}
            onPress={confirm}
            disabled={looking}
          >
            <Check size={18} color={c.text.inverse} />
            <Text style={styles.confirmText}>Confirm location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.surface.app },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border.subtle,
    backgroundColor: c.surface.card
  },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: c.text.primary },

  mapArea: { flex: 1, backgroundColor: c.surface.sunken },
  pinLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  // Lifts the icon so its tip sits on the exact centre of the map rather than
  // its middle, which would place every address about 18px south of the pin.
  pinTipOffset: { height: 36 },

  noMap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  noMapTitle: { fontSize: 15, fontWeight: '700', color: c.text.primary },
  noMapBody: { fontSize: 13, color: c.text.secondary, textAlign: 'center', lineHeight: 19 },

  locateFab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }
  },

  sheet: {
    padding: 16,
    gap: 8,
    backgroundColor: c.surface.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border.subtle
  },
  sheetLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: c.text.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  looking: { fontSize: 14, color: c.text.secondary },
  address: { fontSize: 15, fontWeight: '600', color: c.text.primary, lineHeight: 21 },
  hint: { fontSize: 12, color: c.text.muted, lineHeight: 17 },
  confirm: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.primary[500],
    borderRadius: 12,
    paddingVertical: 14
  },
  confirmBusy: { opacity: 0.6 },
  confirmText: { color: c.text.inverse, fontSize: 15, fontWeight: '700' }
});
