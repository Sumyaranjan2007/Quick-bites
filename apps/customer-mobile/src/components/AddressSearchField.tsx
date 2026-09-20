/**
 * Search-as-you-type for a delivery address.
 *
 * The address form is the single largest cause of a failed delivery in this
 * business: a rider standing outside the right building and the wrong gate is
 * a cancelled order, a refund, and a customer who does not come back. Typing a
 * flat number, a street, a city and a PIN by hand gets one of those four wrong
 * often enough to matter, and nothing in the form can tell that it happened.
 *
 * Picking a real place instead fixes both halves at once: the text is spelled
 * the way the map spells it, and coordinates arrive with it, so the rider is
 * navigating to a point rather than to a sentence.
 *
 * Three things this does that a naive autocomplete box does not:
 *
 * DEBOUNCED. A request per keystroke is a paid Google call per keystroke. A
 * short pause collapses "koramangala" from eleven calls to one.
 *
 * ORDER-SAFE. Responses can arrive out of order — "kor" can come back after
 * "koramangala" and overwrite the better list with a worse one. Each request
 * carries a sequence number and a stale reply is dropped.
 *
 * OPTIONAL. If the server has no Places key configured, the whole field hides
 * itself and the form below works exactly as it always has. Address entry
 * degrades to typing; it never breaks.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Search, MapPin, X } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;

export interface ResolvedPlace {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  locality?: string;
  postalCode?: string;
}

interface Suggestion {
  placeId: string;
  primary: string;
  secondary: string;
}

interface Props {
  apiUrl?: string;
  token?: string;
  /** Biases results toward where the customer is, when that is already known. */
  near?: { latitude: number; longitude: number } | null;
  onPick: (place: ResolvedPlace) => void;
}

/**
 * Groups every keystroke of one address entry into a single billed session at
 * Google. Regenerated after each selection, because reusing one would bill the
 * next address against the last one's session and return the wrong thing.
 */
function newSessionToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const AddressSearchField: React.FC<Props> = ({ apiUrl, token, near, onPick }) => {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const session = useRef(newSessionToken());
  const sequence = useRef(0);
  /** Set once the component unmounts, so a late reply cannot set state on it. */
  const alive = useRef(true);

  useEffect(() => {
    return () => {
      alive.current = false;
    };
  }, []);

  // Asked once. A server without a Places key returns available:false and this
  // field never renders, rather than showing a search box that finds nothing.
  useEffect(() => {
    if (!apiUrl || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${apiUrl}/places/status`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (!cancelled && alive.current) setAvailable(Boolean(data?.data?.available));
      } catch {
        if (!cancelled && alive.current) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, token]);

  useEffect(() => {
    if (!available || !apiUrl || !token) return;

    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const mine = ++sequence.current;

    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: trimmed, sessionToken: session.current });
        if (near) {
          params.set('lat', String(near.latitude));
          params.set('lng', String(near.longitude));
        }
        const res = await apiFetch(`${apiUrl}/places/suggest?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();

        // Dropped if another keystroke has already started a newer search.
        if (!alive.current || mine !== sequence.current) return;
        setSuggestions(Array.isArray(data?.data?.suggestions) ? data.data.suggestions : []);
        setFailed(false);
      } catch {
        if (!alive.current || mine !== sequence.current) return;
        setSuggestions([]);
        setFailed(true);
      } finally {
        if (alive.current && mine === sequence.current) setSearching(false);
      }
    }, 350);

    return () => clearTimeout(handle);
  }, [query, available, apiUrl, token, near]);

  const choose = async (suggestion: Suggestion) => {
    if (!apiUrl || !token) return;
    setResolving(suggestion.placeId);
    try {
      const params = new URLSearchParams({
        placeId: suggestion.placeId,
        sessionToken: session.current
      });
      const res = await apiFetch(`${apiUrl}/places/resolve?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      const place: ResolvedPlace | null = data?.data?.place || null;

      if (!alive.current) return;
      if (!place) {
        setFailed(true);
        return;
      }

      onPick(place);
      setQuery('');
      setSuggestions([]);
      setFailed(false);
      // A new session for the next address entered in this sitting.
      session.current = newSessionToken();
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setResolving(null);
    }
  };

  if (!available) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.field}>
        <Search size={16} color={c.text.muted} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search your street, building or area"
          placeholderTextColor={c.text.muted}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search for a delivery address"
        />
        {searching ? (
          <ActivityIndicator size="small" color={c.primary[500]} />
        ) : query.length > 0 ? (
          <TouchableOpacity
            onPress={() => setQuery('')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Clear the address search"
          >
            <X size={16} color={c.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {failed && (
        <Text style={styles.hint}>
          Address search is not responding. Type the address below instead — it works just the same.
        </Text>
      )}

      {/* The "searched and found nothing" state, which is different from having
          not searched yet and must not look like a loading spinner. */}
      {!searching && !failed && query.trim().length >= 3 && suggestions.length === 0 && (
        <Text style={styles.hint}>No matching places. Type the address below instead.</Text>
      )}

      {suggestions.map(suggestion => (
        <TouchableOpacity
          key={suggestion.placeId}
          style={styles.suggestion}
          onPress={() => choose(suggestion)}
          disabled={resolving !== null}
          activeOpacity={0.8}
        >
          <MapPin size={15} color={c.primary[500]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.primary} numberOfLines={1}>
              {suggestion.primary}
            </Text>
            {!!suggestion.secondary && (
              <Text style={styles.secondary} numberOfLines={1}>
                {suggestion.secondary}
              </Text>
            )}
          </View>
          {resolving === suggestion.placeId && <ActivityIndicator size="small" color={c.primary[500]} />}
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: c.border.medium,
    borderRadius: 12,
    paddingHorizontal: 12,
    // 46 rather than a tighter box: this is the first thing a thumb reaches for
    // in the sheet and anything under 44 is a miss on a moving bus.
    height: 46,
    backgroundColor: c.surface.card
  },
  input: { flex: 1, fontSize: 14, color: c.text.primary, padding: 0 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: c.surface.subtle
  },
  primary: { fontSize: 14, fontWeight: '600', color: c.text.primary },
  secondary: { fontSize: 12, color: c.text.secondary, marginTop: 1 },
  hint: { fontSize: 12, color: c.text.secondary, paddingHorizontal: 2 }
});
