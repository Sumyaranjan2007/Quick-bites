import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Image,
  RefreshControl
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Card, Chip, RatingBadge, Pill, EmptyState, Skeleton, SectionHeader } from '../components/ui';
import { Search, MapPin, ChevronDown, Bell, Mic, Heart, Timer } from 'lucide-react-native';

const c = tokens.colors;

export interface RestaurantItem {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  ratingCount?: number;
  deliveryTimeMins: number;
  distanceKm: number;
  isPureVeg: boolean;
  priceForTwo: number;
  packagingFee?: number;
  bannerUrl?: string;
  highlightTag?: string;
  locality?: string;
}

interface Props {
  onSelectRestaurant: (restaurant: RestaurantItem) => void;
  apiUrl?: string;
}

const CATEGORIES = [
  { label: 'Biryani', img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=200&auto=format&fit=crop&q=70' },
  { label: 'Pizza', img: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=200&auto=format&fit=crop&q=70' },
  { label: 'Dosa', img: 'https://images.unsplash.com/photo-1630383249896-424e482df921?w=200&auto=format&fit=crop&q=70' },
  { label: 'Tandoor', img: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=200&auto=format&fit=crop&q=70' },
  { label: 'Desserts', img: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=200&auto=format&fit=crop&q=70' }
];

const FILTERS = ['All', 'Offers', 'Pure Veg', 'Fast Delivery', 'Top Rated'];

export const DiscoveryFeedScreen: React.FC<Props> = ({ onSelectRestaurant, apiUrl }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [restaurants, setRestaurants] = useState<RestaurantItem[]>([]);
  const [favourites, setFavourites] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'loading' | 'success' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/restaurants`);
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.restaurants)) {
        setRestaurants(
          data.data.restaurants.map((r: any) => ({
            id: r.id,
            name: r.name,
            cuisine: Array.isArray(r.cuisineTags) ? r.cuisineTags.join(', ') : 'Indian',
            rating: r.ratingAverage ?? 4.5,
            ratingCount: r.ratingCount,
            deliveryTimeMins: r.estimatedDeliveryMinutes ?? 25,
            distanceKm: r.distanceKm ?? 2.2,
            isPureVeg: !!r.isPureVeg,
            priceForTwo: r.costForTwo ?? 400,
            packagingFee: r.packagingFee,
            bannerUrl: r.bannerUrl,
            highlightTag: r.highlightTag,
            locality: r.addressLine
          }))
        );
        setState('success');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    load();
  }, [apiUrl]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleFavourite = (id: string) =>
    setFavourites(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const visible = restaurants.filter(r => {
    const q = searchQuery.trim().toLowerCase();
    if (q && !r.name.toLowerCase().includes(q) && !r.cuisine.toLowerCase().includes(q)) return false;
    if (activeFilter === 'Pure Veg' && !r.isPureVeg) return false;
    if (activeFilter === 'Fast Delivery' && r.deliveryTimeMins > 25) return false;
    if (activeFilter === 'Top Rated' && r.rating < 4.5) return false;
    return true;
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
          <View style={styles.locationRow}>
            <MapPin size={16} color={c.primary[500]} />
            <Text style={styles.locationName}>Indiranagar</Text>
            <ChevronDown size={15} color={c.text.primary} />
          </View>
          <Text style={styles.locationSub}>Delivering to you</Text>
        </View>
        <TouchableOpacity style={styles.bellButton} activeOpacity={0.8}>
          <Bell size={18} color={c.text.primary} />
          <View style={styles.bellDot} />
        </TouchableOpacity>
      </View>

      {/* Hero */}
      <Text style={styles.heroTitle}>WHAT'S YOUR{'\n'}CRAVING?</Text>
      <Text style={styles.heroSub}>We've got it.</Text>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Search size={18} color={c.text.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for 'Biryani'"
            placeholderTextColor={c.text.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <Mic size={18} color={c.primary[500]} />
        </View>
        <TouchableOpacity
          style={[styles.vegToggle, activeFilter === 'Pure Veg' && styles.vegToggleOn]}
          onPress={() => setActiveFilter(activeFilter === 'Pure Veg' ? 'All' : 'Pure Veg')}
          activeOpacity={0.85}
        >
          <Text style={[styles.vegToggleText, activeFilter === 'Pure Veg' && { color: '#FFFFFF' }]}>VEG</Text>
          <View style={[styles.vegDot, activeFilter === 'Pure Veg' && { backgroundColor: '#FFFFFF' }]} />
        </TouchableOpacity>
      </View>

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

      {/* Offer banner */}
      <View style={styles.banner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerKicker}>HOT DEALS</Text>
          <Text style={styles.bannerTitle}>UP TO{'\n'}50% OFF</Text>
          <Text style={styles.bannerSub}>On your first three orders</Text>
          <View style={styles.bannerCta}>
            <Text style={styles.bannerCtaText}>Use WELCOME50 →</Text>
          </View>
        </View>
        <Image
          source={{ uri: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400&auto=format&fit=crop&q=75' }}
          style={styles.bannerImage}
        />
      </View>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map(f => (
          <Chip key={f} label={f} active={activeFilter === f} onPress={() => setActiveFilter(f)} />
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
        <EmptyState
          title="Nothing matches that"
          subtitle="Try a different dish, cuisine or filter."
          action="Clear filters"
          onAction={() => {
            setSearchQuery('');
            setActiveFilter('All');
          }}
        />
      )}

      {state === 'success' &&
        visible.map(r => (
          <TouchableOpacity key={r.id} activeOpacity={0.92} onPress={() => onSelectRestaurant(r)}>
            <Card style={styles.restaurantCard} padded={false}>
              <View>
                {r.bannerUrl ? (
                  <Image source={{ uri: r.bannerUrl }} style={styles.banner1} />
                ) : (
                  <View style={[styles.banner1, { backgroundColor: c.surface.sunken }]} />
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

                <View style={styles.offerBadge}>
                  <Text style={styles.offerBadgeText}>50% OFF</Text>
                </View>

                <View style={styles.etaBadge}>
                  <View style={styles.etaRow}>
                    <Timer size={11} color={c.text.primary} />
                    <Text style={styles.etaText}>{r.deliveryTimeMins} MINS</Text>
                  </View>
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
              </View>
            </Card>
          </TouchableOpacity>
        ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
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
