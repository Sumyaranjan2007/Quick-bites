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
import * as Location from 'expo-location';
import { MapPin, X, Crosshair, Check } from 'lucide-react-native';
import { c } from '../theme';
import { Maps, canRenderNativeMap } from '../lib/nativeMap';

export interface KitchenPoint {
  latitude: number;
  longitude: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (point: KitchenPoint) => void;
  initial?: KitchenPoint | null;
}

/** Bengaluru. The same default the server falls back to when no pin is sent. */
const FALLBACK_CENTRE = { latitude: 12.9716, longitude: 77.5946 };
const SPAN = 0.008;

/**
 * Where the kitchen actually is, placed on a map by the person who runs it.
 *
 * The server has accepted `latitude` and `longitude` at partner registration
 * all along — and no app has ever sent them. Every restaurant that has ever
 * signed up therefore sits at the centre of Bengaluru, which is the fallback
 * the registration route uses when no pin arrives.
 *
 * That is not a cosmetic fault. Distance, delivery time, the delivery fee and
 * whether a restaurant is offered to a customer at all are computed from this
 * one pair of numbers. A kitchen in Harohalli listed at Cubbon Park is ~30 km
 * from where it really is: invisible to its actual neighbours, and offered to
 * people it could never deliver to.
 *
 * REVERSE GEOCODING IS DONE ON THE DEVICE, not through our server. Registration
 * happens before there is an account, and the `/places` endpoints require one —
 * they are a paid Google proxy and an open one is a free Google proxy for
 * anyone who finds the URL. `expo-location` asks the platform's own geocoder,
 * which needs no key and no session. It is only used to show a recognisable
 * name under the pin; the coordinates are the thing being captured.
 */
export const KitchenLocationPicker: React.FC<Props> = ({ visible, onClose, onConfirm, initial }) => {
  const [centre, setCentre] = useState<KitchenPoint>(initial || FALLBACK_CENTRE);
  const [label, setLabel] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const mapRef = useRef<any>(null);

  /**
   * The map is not mounted until its container has a real size, and the camera
   * is not touched until the map says it is ready.
   *
   * Both are needed, and this crashed a release build without them:
   *
   *   com.google.maps.api.android.lib6.common.apiexception.c: Error using
   *   newLatLngBounds(LatLngBounds, int): Map size can't be 0.
   *
   * `initialRegion` makes react-native-maps stash a pending bounds move when
   * the view has no height yet, and its own recovery path then calls
   * `newLatLngBounds(bounds, 0)` — the overload that requires a non-zero map
   * size — so a map laid out at zero size takes the process down. Inside a
   * Modal with a slide animation, zero size during the first frames is the
   * normal case, not the edge case.
   */
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [mapReady, setMapReady] = useState(false);
  const canDriveCamera = mapReady && mapSize.width > 0 && mapSize.height > 0;
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const describe = useCallback(async (point: KitchenPoint) => {
    const mine = ++seq.current;
    try {
      const [place] = await Location.reverseGeocodeAsync(point);
      if (mine !== seq.current) return; // the pin moved on while we waited
      setLabel(
        [place?.name, place?.street, place?.district, place?.city]
          .filter(Boolean)
          .filter((part, i, all) => all.indexOf(part) === i)
          .join(', ') || null
      );
    } catch {
      if (mine === seq.current) setLabel(null);
    }
  }, []);

  // Reset when the sheet closes, so reopening waits for a fresh layout rather
  // than trusting a size measured for the previous presentation.
  useEffect(() => {
    if (!visible) {
      setMapReady(false);
      setMapSize({ width: 0, height: 0 });
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const start = initial || FALLBACK_CENTRE;
    setCentre(start);
    describe(start);
    // Only once the map exists and has been measured. Calling this earlier is
    // what the crash above was.
    if (canDriveCamera) {
      mapRef.current?.animateToRegion?.(
        { ...start, latitudeDelta: SPAN, longitudeDelta: SPAN },
        0
      );
    }
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [visible, initial, describe, canDriveCamera]);

  const onRegionChange = useCallback(
    (region: KitchenPoint) => {
      const point = { latitude: region.latitude, longitude: region.longitude };
      setCentre(point);
      setLabel(null);
      if (debounce.current) clearTimeout(debounce.current);
      // Settled, not per frame: the platform geocoder is rate limited and a pan
      // across a city would exhaust it and start returning nothing.
      debounce.current = setTimeout(() => describe(point), 450);
    },
    [describe]
  );

  const useMyLocation = useCallback(async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setCentre(point);
      if (canDriveCamera) {
        mapRef.current?.animateToRegion?.(
          { ...point, latitudeDelta: SPAN, longitudeDelta: SPAN },
          450
        );
      }
      describe(point);
    } catch {
      /* The pin stays where it is; the owner can still place it by hand. */
    } finally {
      setLocating(false);
    }
  }, [describe, canDriveCamera]);

  const MapView = Maps?.default;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.root}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.headerBtn} accessibilityLabel="Close map">
            <X size={20} color={c.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Place your kitchen</Text>
          <View style={s.headerBtn} />
        </View>

        <View
          style={s.mapArea}
          onLayout={e => {
            const { width, height } = e.nativeEvent.layout;
            setMapSize({ width, height });
          }}
        >
          {canRenderNativeMap && MapView && mapSize.width > 0 && mapSize.height > 0 ? (
            <>
              <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                onMapReady={() => setMapReady(true)}
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
              {/* Fixed over the centre, and transparent to touches so it never
                  swallows a pan. The spacer beneath lifts the icon by half its
                  height, so the POINT of the pin marks the spot rather than its
                  middle — an 18px error at this zoom is most of a building. */}
              <View pointerEvents="none" style={s.pinLayer}>
                <MapPin size={36} color={c.brand} fill={c.brand} strokeWidth={1.5} />
                <View style={{ height: 36 }} />
              </View>
            </>
          ) : (
            <View style={s.noMap}>
              <MapPin size={32} color={c.textMuted} />
              <Text style={s.noMapTitle}>Map not available in this build</Text>
              <Text style={s.noMapBody}>
                Use “My location” from inside the kitchen instead. You can correct the pin later from
                your profile.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={s.locateFab}
            onPress={useMyLocation}
            disabled={locating}
            accessibilityLabel="Use my current location"
          >
            {locating ? (
              <ActivityIndicator size="small" color={c.brand} />
            ) : (
              <Crosshair size={18} color={c.brand} />
            )}
          </TouchableOpacity>
        </View>

        <View style={s.sheet}>
          <Text style={s.sheetLabel}>KITCHEN LOCATION</Text>
          <Text style={s.address} numberOfLines={2}>
            {label || `${centre.latitude.toFixed(5)}, ${centre.longitude.toFixed(5)}`}
          </Text>
          <Text style={s.hint}>
            Put the pin on the door your riders collect from. Customers are shown restaurants near
            this point, so it decides who can order from you.
          </Text>
          <TouchableOpacity style={s.confirm} onPress={() => onConfirm(centre)}>
            <Check size={18} color={c.bg} />
            <Text style={s.confirmText}>Use this location</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: c.text },

  mapArea: { flex: 1, backgroundColor: c.bg },
  pinLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  noMap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  noMapTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  noMapBody: { fontSize: 13, color: c.textSoft, textAlign: 'center', lineHeight: 19 },

  locateFab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    borderWidth: 1,
    borderColor: c.border
  },

  sheet: {
    padding: 16,
    gap: 8,
    backgroundColor: c.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border
  },
  sheetLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: c.textMuted },
  address: { fontSize: 15, fontWeight: '700', color: c.text, lineHeight: 21 },
  hint: { fontSize: 12, color: c.textMuted, lineHeight: 17 },
  confirm: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: c.brand,
    borderRadius: 12,
    paddingVertical: 14
  },
  confirmText: { color: c.bg, fontSize: 15, fontWeight: '700' }
});
