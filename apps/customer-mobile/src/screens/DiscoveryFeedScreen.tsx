import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  RefreshControl,
  Modal
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Card, Chip, RatingBadge, Pill, EmptyState, Skeleton, SectionHeader } from '../components/ui';
import { Search, MapPin, ChevronDown, Mic, Heart, Timer, X, Map as MapIcon } from 'lucide-react-native';
import { NotificationBell } from '../components/NotificationBell';
import { RestaurantPhoto } from '../components/RestaurantPhoto';
import { useTranslation } from '../lib/i18n';
import { VoiceSearchSheet } from '../components/VoiceSearchSheet';
import { MapAddressPicker, type PickedLocation } from '../components/MapAddressPicker';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;

export interface RestaurantItem {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  ratingCount?: number;
  /** Absent until the customer's position is known. See `distanceKm` below. */
  deliveryTimeMins?: number;
  /**
   * Absent until the customer's position is known. Optional rather than
   * defaulted: a made-up distance travels to checkout and becomes a made-up
   * delivery fee, and the server can measure the real one.
   */
  distanceKm?: number;
  isPureVeg: boolean;
  priceForTwo: number;
  packagingFee?: number;
  bannerUrl?: string;
  /** Cover, gallery, then photographs of this kitchen's own food. */
  photos?: string[];
  placeholder?: { initials: string; colour: string };
  /** A real live coupon, or absent. Never a string typed into this app. */
  offer?: { label: string; code: string; description: string } | null;
  /**
   * Whether this kitchen is taking orders RIGHT NOW.
   *
   * Not the same as the partner's Online switch: declared opening hours close
   * a kitchen whose partner forgot to, and a partner who taps Online outside
   * their hours overrides that. The server resolves all three; the app is
   * told the answer rather than working it out from `isOpen`.
   */
  isServing?: boolean;
  /** "HH:MM" when they open again, when that can be said. */
  opensAt?: string | null;
  highlightTag?: string;
  locality?: string;
}

interface Props {
  onSelectRestaurant: (restaurant: RestaurantItem) => void;
  apiUrl?: string;
  token?: string;
  /** The address this order is going to, shared with checkout. */
  deliveryAddressId?: string | null;
  /** Announces a change, so checkout sends the food where the customer browsed. */
  onChooseAddress?: (id: string) => void;
}

const CATEGORIES = [
  { label: 'Biryani', img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=200&auto=format&fit=crop&q=70' },
  { label: 'Pizza', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=200&auto=format&fit=crop&q=70' },
  { label: 'Dosa', img: 'https://images.unsplash.com/photo-1630383249896-424e482df921?w=200&auto=format&fit=crop&q=70' },
  { label: 'Tandoor', img: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=200&auto=format&fit=crop&q=70' },
  { label: 'Desserts', img: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=200&auto=format&fit=crop&q=70' }
];

/**
 * The filters the feed offers, and what each one asks the server for.
 *
 * They are sent to the API rather than applied to the list after it arrives.
 * Filtering on the phone means downloading every kitchen in the city over
 * mobile data and throwing most of them away, and it means this screen and the
 * search screen quietly disagreeing about what "fast" means.
 *
 * They are also independent rather than mutually exclusive. The old row was a
 * single choice, so asking for somewhere veg AND quick was impossible — picking
 * the second silently dropped the first.
 */
interface SavedAddress {
  id: string;
  label: string;
  addressLine: string;
  city: string;
  isDefault?: boolean;
  coordinates?: { latitude: number; longitude: number };
}

const FILTERS: Array<{
  key: string;
  label: string;
  query: Record<string, string>;
  /**
   * True for filters that cannot mean anything until we know where the customer
   * is. A delivery-time ceiling is computed from the distance between them and
   * each kitchen; with no position there is no distance, so the chip would be a
   * control that visibly does nothing. It is hidden rather than shown inert.
   */
  needsPosition?: boolean;
}> = [
  { key: 'pureVeg', label: 'Pure Veg', query: { isPureVeg: 'true' } },
  { key: 'fastDelivery', label: 'Under 30 min', query: { maxDeliveryMinutes: '30' }, needsPosition: true },
  { key: 'topRated', label: 'Rated 4.0+', query: { minRating: '4' } },
  { key: 'openNow', label: 'Open now', query: { openNow: 'true' } },
  { key: 'budget', label: 'Under ₹400 for two', query: { maxCostForTwo: '400' } }
];

const SORTS: Array<{ key: string; label: string }> = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'rating', label: 'Rating' },
  { key: 'deliveryTime', label: 'Delivery time' },
  { key: 'costLowToHigh', label: 'Cost: low to high' },
  { key: 'costHighToLow', label: 'Cost: high to low' }
];

export const DiscoveryFeedScreen: React.FC<Props> = ({
  onSelectRestaurant,
  apiUrl,
  token,
  deliveryAddressId,
  onChooseAddress
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  // Type-ahead suggestions under the search box (U4): dishes, restaurants, cuisines.
  const [suggestions, setSuggestions] = useState<Array<{ type: string; text: string; subtext?: string }>>([]);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState('relevance');
  const [restaurants, setRestaurants] = useState<RestaurantItem[]>([]);
  /*
   * The home-screen promotion, or null.
   *
   * Null is the ordinary case on a platform running no campaign, and the
   * banner is removed entirely for it. What was here before was three lines of
   * text - "HOT DEALS / UP TO 50% OFF / Use WELCOME50" - shown to every
   * customer on every launch, whether or not WELCOME50 existed, had expired,
   * or had ever been created.
   */
  const [promotion, setPromotion] = useState<{
    kicker: string;
    title: string;
    subtitle: string;
    code: string;
  } | null>(null);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const { t } = useTranslation();
  // Shown in the header. Read from the customer's saved default address rather
  // than hardcoded, so it follows wherever they actually are.
  const [locality, setLocality] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);

  /**
   * Restaurants that serve a dish matching what was typed, and which dish.
   *
   * The search here only ever looked at restaurant names and cuisine tags, so
   * typing "biryani" found a kitchen called Biryani House and missed every
   * other kitchen in the city that actually cooks one. What somebody searching
   * for a dish wants is the list of places that have it — which is a question
   * about menus, and menus are indexed separately.
   */
  const [dishMatches, setDishMatches] = useState<Map<string, string>>(new Map());
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);

  /**
   * Where the listing is being browsed from.
   *
   * Held in a ref as well as in state because `load()` is called from several
   * effects and from pull-to-refresh, and reading the position from state there
   * would capture whichever value the closure was created with — the classic
   * stale-closure fetch, which shows up as "the list is one location behind".
   * The ref is always current; the state exists only to re-render the header.
   */
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number } | null>(null);
  const originRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const setBrowsingFrom = (point: { latitude: number; longitude: number } | null) => {
    originRef.current = point;
    setOrigin(point);
  };

  const loadLocality = async () => {
    if (!apiUrl || !token) return;
    try {
      const res = await apiFetch(`${apiUrl}/addresses`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.addresses) && data.data.addresses.length) {
        const list: SavedAddress[] = data.data.addresses;
        setSavedAddresses(list);
        // Whatever the customer last chose, then their default, then the first
        // one they have. A choice made on the checkout screen has to survive
        // coming back here, or the chip and the order disagree again.
        const chosen =
          (deliveryAddressId ? list.find(a => a.id === deliveryAddressId) : null) ??
          list.find(a => a.isDefault) ??
          list[0];
        applyAddress(chosen, { announce: false });
      }
    } catch {
      // Header falls back to the city label below.
    }
  };

  /** "No. 24, Shivanandha Layout, Harohalli" -> "Harohalli" */
  const localityOf = (address: SavedAddress): string => {
    const parts = String(address.addressLine || '').split(',').map(x => x.trim()).filter(Boolean);
    return parts[parts.length - 1] || address.city || address.label;
  };

  /**
   * Point the whole screen at one saved address.
   *
   * `announce` is false while restoring what was already chosen, so opening the
   * home screen does not report a "change" back up and overwrite a selection
   * made at checkout with the one it just read from it.
   */
  const applyAddress = (address: SavedAddress | undefined, opts: { announce: boolean }) => {
    if (!address) return;
    setLocality(localityOf(address));
    // The address also supplies the position the listing is built from. Without
    // it the server has no origin, and every restaurant comes back with no
    // distance and no delivery time.
    if (address.coordinates) setBrowsingFrom(address.coordinates);
    if (opts.announce) onChooseAddress?.(address.id);
  };

  /**
   * Turns the chosen chips into one query string.
   *
   * Built from the FILTERS table rather than written out again here, so adding
   * a chip is one line in one place and cannot drift from what it sends.
   */
  const buildQuery = () => {
    const params = new URLSearchParams();
    for (const filter of FILTERS) {
      if (!activeFilters.has(filter.key)) continue;
      // Hiding the chip is not enough on its own: a filter switched on while a
      // position was known stays in `activeFilters` afterwards, and would go on
      // being sent by a control the customer can no longer see to switch off.
      if (filter.needsPosition && !originRef.current) continue;
      for (const [key, value] of Object.entries(filter.query)) params.set(key, value);
    }
    if (sort !== 'relevance') params.set('sort', sort);
    // Position last, and only when it is real. The server returns no distance
    // and no delivery time without it, which is the correct answer to "how far
    // is this from someone whose location we do not know".
    const here = originRef.current;
    if (here) {
      params.set('lat', String(here.latitude));
      params.set('lng', String(here.longitude));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const load = async () => {
    if (!apiUrl) return;
    try {
      const res = await apiFetch(`${apiUrl}/restaurants${buildQuery()}`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.restaurants)) {
        setRestaurants(
          data.data.restaurants.map((r: any) => ({
            id: r.id,
            name: r.name,
            cuisine: Array.isArray(r.cuisineTags) ? r.cuisineTags.join(', ') : 'Indian',
            rating: r.ratingAverage ?? 4.5,
            ratingCount: r.ratingCount,
            deliveryTimeMins: r.estimatedDeliveryMinutes,
            distanceKm: r.distanceKm,
            isPureVeg: !!r.isPureVeg,
            priceForTwo: r.costForTwo ?? 400,
            packagingFee: r.packagingFee,
            bannerUrl: r.bannerUrl,
            photos: Array.isArray(r.photos) ? r.photos : undefined,
            placeholder: r.placeholder,
            offer: r.offer ?? null,
            isServing: r.isServing,
            opensAt: r.opensAt ?? null,
            highlightTag: r.highlightTag,
            locality: r.addressLine
          }))
        );
        setPromotion(data.data?.promotion ?? null);
        setState('success');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    // The address is fetched BEFORE the listing, not alongside it. Run in
    // parallel, the listing would go out with no position, come back with no
    // distances, and have to be fetched a second time the moment the address
    // arrived — two full restaurant lists over mobile data to render one screen.
    (async () => {
      await loadLocality();
      load();
    })();
    loadFavourites();
  }, [apiUrl, token]);

  // Re-fetch when a filter or the sort CHANGES. Deliberately not merged with the
  // effect above: that one also reloads favourites and the delivery locality,
  // neither of which has anything to do with a filter chip.
  //
  // The first run is skipped. Both effects fire on mount, so without this the
  // home screen made the same request twice every time the app opened — two
  // full restaurant lists over mobile data for one screen.
  const filtersMounted = useRef(false);
  useEffect(() => {
    if (!filtersMounted.current) {
      filtersMounted.current = true;
      return;
    }
    setState('loading');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.from(activeFilters).sort().join(','), sort]);

  /**
   * Browse from somewhere else.
   *
   * This moves where the LISTING is computed from; it does not save an address.
   * A saved address needs a flat or house number, which no map can supply, so
   * that belongs in the address book and at checkout. Picking here answers a
   * different and much more common question — "what can I get delivered where I
   * am standing right now" — and it lasts for the session rather than being
   * written over the customer's home address behind their back.
   */
  const pickSavedAddress = (address: SavedAddress) => {
    applyAddress(address, { announce: true });
    setLocationSheetOpen(false);
    setState('loading');
    load();
  };

  const browseFrom = (picked: PickedLocation) => {
    setBrowsingFrom(picked.coordinates);
    if (picked.addressLine) {
      const parts = picked.addressLine.split(',').map(x => x.trim()).filter(Boolean);
      setLocality(parts[parts.length - 3] || parts[0] || picked.city || null);
    } else if (picked.city) {
      setLocality(picked.city);
    }
    setMapOpen(false);
    setLocationSheetOpen(false);
    setState('loading');
    load();
  };

  /**
   * Looks up which restaurants serve what was typed.
   *
   * Debounced, and skipped under three characters: "b" matches most menus in
   * the country and costs a request to say so. The restaurant-name match above
   * stays instant and local, so the list never waits on this — dish results
   * arrive and widen it a moment later.
   */
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || !apiUrl) {
      setSuggestions([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`${apiUrl}/search/suggestions?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (stale) return;
        const list = Array.isArray(data?.data?.suggestions) ? data.data.suggestions : [];
        // Nothing to suggest once the box already holds exactly one of them.
        setSuggestions(list.some((s: any) => String(s.text).toLowerCase() === q.toLowerCase()) ? [] : list.slice(0, 6));
      } catch {
        if (!stale) setSuggestions([]);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [searchQuery, apiUrl]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 3 || !apiUrl) {
      setDishMatches(new Map());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, type: 'dishes', limit: '40' });
        const here = originRef.current;
        if (here) {
          params.set('lat', String(here.latitude));
          params.set('lng', String(here.longitude));
        }
        const res = await apiFetch(`${apiUrl}/search?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        const found = new Map<string, string>();
        for (const dish of data?.data?.dishes || []) {
          // First match per restaurant wins; the card has room for one dish
          // name and the point is which kitchens have it, not how many.
          if (dish.restaurantId && !found.has(dish.restaurantId)) {
            found.set(dish.restaurantId, dish.name);
          }
        }
        setDishMatches(found);
      } catch {
        // The name-based results stand on their own.
        if (!cancelled) setDishMatches(new Map());
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, apiUrl]);

  const toggleFilter = (key: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), loadFavourites()]);
    setRefreshing(false);
  };

  /**
   * Favourites live on the account, not in this screen.
   *
   * They used to be a `Set` in local state: the heart filled in, and the choice
   * was gone as soon as the screen unmounted — let alone on another device. The
   * UI still updates immediately, because a heart that waits for a round trip
   * feels broken, but the write is what decides, and a failed write puts the
   * heart back rather than leaving a lie on screen.
   */
  const loadFavourites = async () => {
    if (!apiUrl || !token) return;
    try {
      const res = await apiFetch(`${apiUrl}/customers/favourites`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data?.success && Array.isArray(data.data?.restaurantIds)) {
        setFavourites(new Set<string>(data.data.restaurantIds));
      }
    } catch {
      /* Favourites are not worth blocking the feed for. */
    }
  };

  const toggleFavourite = async (id: string) => {
    if (!apiUrl || !token) return;
    const wasFavourite = favourites.has(id);

    setFavourites(prev => {
      const next = new Set(prev);
      wasFavourite ? next.delete(id) : next.add(id);
      return next;
    });

    try {
      const res = wasFavourite
        ? await apiFetch(`${apiUrl}/customers/favourites/${id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
          })
        : await apiFetch(`${apiUrl}/customers/favourites`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ restaurantId: id })
          });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error('rejected');
      if (Array.isArray(data.data?.restaurantIds)) {
        setFavourites(new Set<string>(data.data.restaurantIds));
      }
    } catch {
      setFavourites(prev => {
        const next = new Set(prev);
        wasFavourite ? next.add(id) : next.delete(id);
        return next;
      });
    }
  };

  // Only the typed query is matched here. Every other filter was applied by the
  // server; searching as you type locally keeps the results instant instead of
  // firing a request per keystroke.
  const visible = restaurants.filter(r => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    if (r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q)) return true;
    // Or it serves a dish by that name, which is what somebody typing the name
    // of a food is actually asking.
    return dishMatches.has(r.id);
  });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary[500]} />}
    >
      {/* Location header */}
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          {/* This row has always had a chevron on it and has never been
              pressable, which is its own small lie: the one affordance on the
              screen that says "tap me to change where you are" did nothing. */}
          <TouchableOpacity
            style={styles.locationRow}
            onPress={() => setLocationSheetOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Change delivery location"
          >
            <MapPin size={16} color={c.primary[500]} />
            <Text style={styles.locationName}>{locality ?? 'Set your location'}</Text>
            <ChevronDown size={15} color={c.text.primary} />
          </TouchableOpacity>
          <Text style={styles.locationSub}>{t('feed.deliveringTo')}</Text>
        </View>
        <NotificationBell />
      </View>

      {/* Hero */}
      <Text style={styles.heroTitle}>
        {t('feed.heroLine1')}{'\n'}{t('feed.heroLine2')}
      </Text>
      <Text style={styles.heroSub}>{t('feed.heroSub')}</Text>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Search size={18} color={c.text.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('feed.searchPlaceholder')}
            placeholderTextColor={c.text.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7} accessibilityLabel="Clear search">
              <X size={16} color={c.text.muted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setVoiceOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="Search by voice"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Mic size={18} color={c.primary[500]} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.vegToggle, activeFilters.has('pureVeg') && styles.vegToggleOn]}
          onPress={() => toggleFilter('pureVeg')}
          activeOpacity={0.85}
        >
          <Text style={[styles.vegToggleText, activeFilters.has('pureVeg') && { color: '#FFFFFF' }]}>VEG</Text>
          <View style={[styles.vegDot, activeFilters.has('pureVeg') && { backgroundColor: '#FFFFFF' }]} />
        </TouchableOpacity>
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestBox}>
          {suggestions.map(sug => (
            <TouchableOpacity
              key={`${sug.type}:${sug.text}`}
              style={styles.suggestRow}
              onPress={() => {
                setSearchQuery(sug.text);
                setSuggestions([]);
              }}
              activeOpacity={0.75}
            >
              <Search size={14} color={c.text.muted} />
              <Text style={styles.suggestText} numberOfLines={1}>
                {sug.text}
                {sug.subtext ? <Text style={styles.suggestSub}>{`  ${sug.subtext}`}</Text> : null}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Categories */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}
      >
        {CATEGORIES.map(cat => (
          <TouchableOpacity
            key={cat.label}
            style={styles.category}
            activeOpacity={0.8}
            onPress={() => setSearchQuery(cat.label)}
          >
            <Image source={{ uri: cat.img }} style={styles.categoryImage} />
            <Text style={styles.categoryLabel}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/*
        The promotion, when there is one.

        Every line here used to be typed into this file: "HOT DEALS", "UP TO 50%
        OFF", "Use WELCOME50", and a stock photograph of somebody else's food
        from an image host. It was shown on every launch to every customer,
        regardless of whether that coupon existed or had expired - a price claim
        the checkout would then refuse.

        It now comes from the best live platform-wide coupon, and when there is
        none the banner is not rendered at all. A hero that is sometimes absent
        is correct; one that always promises 50% is not.
      */}
      {!!promotion && (
        <View style={styles.banner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerKicker}>{promotion.kicker}</Text>
            <Text style={styles.bannerTitle}>{promotion.title}</Text>
            <Text style={styles.bannerSub}>{promotion.subtitle}</Text>
            <View style={styles.bannerCta}>
              <Text style={styles.bannerCtaText}>Use {promotion.code} →</Text>
            </View>
          </View>
        </View>
      )}

      {/* Filters — independent, and applied by the server. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.filter(f => !f.needsPosition || origin).map(f => (
          <Chip
            key={f.key}
            label={f.label}
            active={activeFilters.has(f.key)}
            onPress={() => toggleFilter(f.key)}
          />
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {SORTS.map(s => (
          <Chip key={s.key} label={s.label} active={sort === s.key} onPress={() => setSort(s.key)} />
        ))}
      </ScrollView>

      <SectionHeader title={searchQuery ? `Results for "${searchQuery}"` : 'Popular Restaurants'} />

      {state === 'loading' && (
        <View style={{ gap: 16 }}>
          {[0, 1].map(i => (
            <View key={i} style={{ gap: 10 }}>
              <Skeleton height={170} radius={tokens.radii.xl} />
              <Skeleton height={16} style={{ width: '55%' }} />
              <Skeleton height={12} style={{ width: '35%' }} />
            </View>
          ))}
        </View>
      )}

      {state === 'error' && (
        <EmptyState
          title="Couldn't load restaurants"
          subtitle="Check your connection and pull down to try again."
          action="Retry"
          onAction={load}
        />
      )}

      {state === 'success' && visible.length === 0 && (
        /* Two different empty lists, and they need different advice.
           Restaurants are now filtered by whether they deliver to where the
           customer is, so an empty list is usually about the LOCATION rather
           than the filters — and "try a different dish or filter" sends
           somebody to fiddle with chips that cannot help. Seen on a device:
           a pin dropped in the city centre, every kitchen thirty kilometres
           away, and a screen advising a different cuisine. */
        restaurants.length === 0 && origin ? (
          <EmptyState
            title="Nothing delivers here yet"
            subtitle="No kitchen covers this address. Try a location closer to where you are, or check back as more restaurants join."
            action="Change location"
            onAction={() => setLocationSheetOpen(true)}
          />
        ) : (
          <EmptyState
            title="Nothing matches that"
            subtitle="Try a different dish, cuisine or filter."
            action="Clear filters"
            onAction={() => {
              setSearchQuery('');
              setActiveFilters(new Set());
              setSort('relevance');
            }}
          />
        )
      )}

      {state === 'success' &&
        visible.map(r => (
          <TouchableOpacity key={r.id} activeOpacity={0.92} onPress={() => onSelectRestaurant(r)}>
            <Card style={styles.restaurantCard} padded={false}>
              <View>
                {/*
                  This was a grey rectangle on almost every card. `bannerUrl`
                  was display-only and no screen in the partner app could set
                  one, so the else branch was what a customer normally saw.

                  Now: the partner's own photographs, then photographs of their
                  own food from their own menu, then their initials on a colour
                  the server derives from their id - so one restaurant looks the
                  same on every phone and on every screen.
                */}
                <RestaurantPhoto
                  photos={r.photos}
                  placeholder={r.placeholder}
                  bannerUrl={r.bannerUrl}
                  name={r.name}
                  style={styles.banner1}
                />

                {/*
                  A kitchen that cannot take an order says so on the card, not
                  at checkout. Nothing here said it at all: a closed restaurant
                  looked identical to an open one until the order was refused,
                  which is the worst possible moment to find out.

                  `isServing === false` rather than `!r.isServing`, because an
                  older server that does not send the field must not paint
                  every restaurant as unavailable.
                */}
                {r.isServing === false && (
                  <View style={styles.closedVeil}>
                    <View style={styles.closedPill}>
                      <Text style={styles.closedPillText}>Unavailable</Text>
                    </View>
                    {!!r.opensAt && <Text style={styles.closedWhen}>Opens at {r.opensAt}</Text>}
                  </View>
                )}

                <TouchableOpacity
                  style={styles.heartButton}
                  onPress={() => toggleFavourite(r.id)}
                  activeOpacity={0.8}
                >
                  <Heart
                    size={17}
                    color={favourites.has(r.id) ? c.dietary.nonveg : c.text.primary}
                    fill={favourites.has(r.id) ? c.dietary.nonveg : 'transparent'}
                  />
                </TouchableOpacity>

                {/*
                  Omitted rather than guessed, the rule the delivery estimate
                  below already follows. This read "50% OFF" on every card, on
                  every phone, whether or not any such coupon existed - and a
                  discount advertised here and refused at checkout is a false
                  price claim, which is worse than a wrong estimate because the
                  customer chose this restaurant because of it.
                */}
                {!!r.offer && (
                  <View style={styles.offerBadge}>
                    <Text style={styles.offerBadgeText}>{r.offer.label}</Text>
                  </View>
                )}

                <View style={styles.etaBadge}>
                  {/* Omitted rather than guessed. Every card used to read
                      "25 MINS" because the server had no position to compute
                      from and filled one in. */}
                  {r.deliveryTimeMins !== undefined && (
                    <View style={styles.etaRow}>
                      <Timer size={11} color={c.text.primary} />
                      <Text style={styles.etaText}>{r.deliveryTimeMins} MINS</Text>
                    </View>
                  )}
                  <Text style={styles.etaFree}>FREE DELIVERY</Text>
                </View>
              </View>

              <View style={styles.cardBody}>
                <View style={styles.tagRow}>
                  {r.highlightTag ? <Pill label={r.highlightTag.toUpperCase()} tone="gold" /> : null}
                  <Pill label={r.isPureVeg ? 'Pure Veg' : 'Non-Veg'} tone={r.isPureVeg ? 'veg' : 'nonveg'} />
                </View>

                <Text style={styles.restaurantName}>{r.name}</Text>

                <View style={styles.metaRow}>
                  <RatingBadge value={r.rating} count={r.ratingCount} />
                  {r.locality ? (
                    <>
                      <Text style={styles.dot}>•</Text>
                      <Text style={styles.metaText} numberOfLines={1}>
                        {r.locality}
                      </Text>
                    </>
                  ) : null}
                </View>

                <Text style={styles.cuisineText} numberOfLines={1}>
                  {r.cuisine} • ₹{r.priceForTwo} for two
                </Text>
                {dishMatches.get(r.id) && (
                  /* Why this restaurant is in a list somebody searched for a
                     dish in. Without it, a kitchen whose name has nothing to do
                     with the query looks like a mistake in the results. */
                  <Text style={styles.dishMatch} numberOfLines={1}>
                    Serves {dishMatches.get(r.id)}
                  </Text>
                )}
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      <VoiceSearchSheet
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onResult={text => setSearchQuery(text)}
      />

      {/* Saved addresses first, a map second.
          Most orders go somewhere the customer has already saved, and making
          them re-place a pin on their own front door every time would be a map
          for the sake of having one. The map is for the case the list cannot
          answer: somewhere new. */}
      <Modal
        visible={locationSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationSheetOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.locationSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Deliver to</Text>
              <TouchableOpacity
                onPress={() => setLocationSheetOpen(false)}
                accessibilityLabel="Close"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={20} color={c.text.primary} />
              </TouchableOpacity>
            </View>

            {savedAddresses.length === 0 ? (
              <Text style={styles.sheetEmpty}>
                No saved addresses yet. Choose a point on the map to see what delivers near you.
              </Text>
            ) : (
              savedAddresses.map(a => {
                const active = a.id === deliveryAddressId || localityOf(a) === locality;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.addressRow, active && styles.addressRowActive]}
                    onPress={() => pickSavedAddress(a)}
                    activeOpacity={0.8}
                  >
                    <MapPin size={16} color={active ? c.primary[500] : c.text.muted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.addressLabel}>{a.label}</Text>
                      <Text style={styles.addressLine} numberOfLines={1}>
                        {[a.addressLine, a.city].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                    {/* An address with no pin cannot place the customer, so the
                        listing falls back to showing everything. Said plainly
                        rather than left to look like a slow screen. */}
                    {!a.coordinates && <Text style={styles.addressNoPin}>no pin</Text>}
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              style={styles.chooseOnMap}
              onPress={() => {
                setLocationSheetOpen(false);
                setMapOpen(true);
              }}
              activeOpacity={0.85}
            >
              <MapIcon size={16} color={c.text.inverse} />
              <Text style={styles.chooseOnMapText}>Choose on map</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <MapAddressPicker
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        onConfirm={browseFrom}
        initial={origin}
        apiUrl={apiUrl}
        token={token}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  suggestBox: {
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 8,
    borderRadius: 12,
    backgroundColor: c.surface.card,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  suggestText: { flex: 1, fontSize: 14, color: c.text.primary },
  suggestSub: { fontSize: 12, color: c.text.muted },
  dishMatch: {
    fontSize: tokens.font.size.xs,
    color: c.dietary.veg,
    fontWeight: '700',
    marginTop: 2
  },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  locationSheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: tokens.radii.xl,
    borderTopRightRadius: tokens.radii.xl,
    padding: tokens.spacing[5],
    gap: tokens.spacing[3]
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: tokens.font.size.md, fontWeight: '700', color: c.text.primary },
  sheetEmpty: { fontSize: tokens.font.size.sm, color: c.text.secondary, lineHeight: 19 },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing[3],
    paddingVertical: tokens.spacing[3],
    paddingHorizontal: tokens.spacing[3],
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: c.border.subtle
  },
  addressRowActive: { borderColor: c.primary[500], backgroundColor: c.primary[50] },
  addressLabel: { fontSize: tokens.font.size.sm, fontWeight: '700', color: c.text.primary },
  addressLine: { fontSize: tokens.font.size.xs, color: c.text.secondary },
  addressNoPin: { fontSize: tokens.font.size.xs, color: c.text.muted, fontStyle: 'italic' },
  chooseOnMap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacing[2],
    backgroundColor: c.primary[500],
    borderRadius: tokens.radii.md,
    paddingVertical: tokens.spacing[4],
    marginTop: tokens.spacing[1]
  },
  chooseOnMapText: { color: c.text.inverse, fontSize: tokens.font.size.sm, fontWeight: '700' },
  screen: { flex: 1, backgroundColor: c.surface.app },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 28 },

  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  locationName: {
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary
  },
  locationSub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 1, marginLeft: 21 },
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.surface.card,
    borderWidth: 1,
    borderColor: c.border.subtle,
    alignItems: 'center',
    justifyContent: 'center'
  },
  bellDot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.dietary.nonveg,
    borderWidth: 1.5,
    borderColor: c.surface.card
  },

  heroTitle: {
    fontSize: tokens.font.size['2xl'],
    lineHeight: 34,
    fontWeight: tokens.font.weight.extrabold,
    color: c.primary[500],
    letterSpacing: -0.6
  },
  heroSub: {
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.bold,
    color: c.accent[600],
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 16
  },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: tokens.radii.full,
    backgroundColor: c.surface.card,
    borderWidth: 1,
    borderColor: c.border.subtle,
    paddingHorizontal: 16,
    ...tokens.shadow.card
  },
  searchInput: { flex: 1, fontSize: tokens.font.size.base, color: c.text.primary, padding: 0 },
  vegToggle: {
    height: 48,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.md,
    borderWidth: 1.5,
    borderColor: c.dietary.veg,
    backgroundColor: c.surface.card,
    alignItems: 'center',
    justifyContent: 'center'
  },
  vegToggleOn: { backgroundColor: c.dietary.veg },
  vegToggleText: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.extrabold,
    color: c.dietary.veg,
    letterSpacing: 0.5
  },
  vegDot: { width: 14, height: 3, borderRadius: 2, backgroundColor: c.dietary.veg, marginTop: 3 },

  categoryRow: { gap: 16, paddingBottom: 4, marginBottom: 18 },
  category: { alignItems: 'center', width: 66 },
  categoryImage: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: c.surface.sunken,
    borderWidth: 2,
    borderColor: c.surface.card
  },
  categoryLabel: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.semibold,
    color: c.text.primary,
    marginTop: 6
  },

  banner: {
    flexDirection: 'row',
    backgroundColor: c.primary[600],
    borderRadius: tokens.radii.xl,
    padding: 18,
    marginBottom: 18,
    overflow: 'hidden'
  },
  bannerKicker: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.extrabold,
    color: c.accent[400],
    letterSpacing: 1
  },
  bannerTitle: {
    fontSize: tokens.font.size.xl,
    lineHeight: 28,
    fontWeight: tokens.font.weight.extrabold,
    color: c.accent[500],
    marginTop: 6
  },
  bannerSub: { fontSize: tokens.font.size.sm, color: '#E8D9CE', marginTop: 6 },
  bannerCta: {
    backgroundColor: c.accent[500],
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: tokens.radii.full,
    marginTop: 14
  },
  bannerCtaText: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.onAccent
  },
  bannerImage: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignSelf: 'center',
    marginLeft: 10,
    borderWidth: 3,
    borderColor: 'rgba(245,166,35,0.35)'
  },

  filterRow: { gap: 8, paddingBottom: 4, marginBottom: 20 },

  restaurantCard: { marginBottom: 18, overflow: 'hidden' },
  banner1: { width: '100%', height: 172, backgroundColor: c.surface.sunken },
  closedVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 172,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    // Dimmed rather than hidden: the customer can still see whose kitchen it
    // is and come back later, which a removed card cannot offer.
    backgroundColor: 'rgba(12,10,9,0.55)'
  },
  closedPill: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: tokens.radii.full
  },
  closedPillText: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    letterSpacing: 0.4
  },
  closedWhen: { color: '#FFFFFF', fontSize: tokens.font.size.xs, fontWeight: '700' },
  heartButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  offerBadge: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    backgroundColor: c.accent[500],
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: tokens.radii.sm
  },
  offerBadgeText: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.onAccent
  },
  etaBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: tokens.radii.sm,
    alignItems: 'center'
  },
  etaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  etaText: {
    fontSize: tokens.font.size.xs,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary
  },
  etaFree: {
    fontSize: 9,
    fontWeight: tokens.font.weight.extrabold,
    color: c.accent[600],
    letterSpacing: 0.3
  },

  cardBody: { padding: 14 },
  tagRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  restaurantName: {
    fontSize: tokens.font.size.lg,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    letterSpacing: -0.3
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 7 },
  dot: { color: c.text.muted, marginHorizontal: 7 },
  metaText: { fontSize: tokens.font.size.sm, color: c.text.secondary, flexShrink: 1 },
  cuisineText: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 6 }
});
