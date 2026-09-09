import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch
} from 'react-native';
import { tokens } from '@quick-bites/design-system';
import { Search, MapPin, Star, Clock, Sparkles, RefreshCw } from 'lucide-react-native';

export interface RestaurantItem {
  id: string;
  name: string;
  cuisine: string;
  rating: number;
  deliveryTimeMins: number;
  distanceKm: number;
  isPureVeg: boolean;
  priceForTwo: number;
}

const SAMPLE_RESTAURANTS: RestaurantItem[] = [
  {
    id: 'rst_bbh_01',
    name: 'Bangalore Biryani House',
    cuisine: 'Biryani, Mughlai, North Indian',
    rating: 4.8,
    deliveryTimeMins: 25,
    distanceKm: 1.8,
    isPureVeg: false,
    priceForTwo: 500
  },
  {
    id: 'rst_skb_02',
    name: 'Udupi Sri Krishna Bhavan',
    cuisine: 'South Indian, Pure Veg, Breakfast',
    rating: 4.6,
    deliveryTimeMins: 20,
    distanceKm: 2.4,
    isPureVeg: true,
    priceForTwo: 250
  },
  {
    id: 'rst_demo_03',
    name: 'Madras Tiffin Room',
    cuisine: 'South Indian, Filter Coffee',
    rating: 4.5,
    deliveryTimeMins: 30,
    distanceKm: 3.5,
    isPureVeg: true,
    priceForTwo: 200
  }
];

interface Props {
  onSelectRestaurant: (restaurant: RestaurantItem) => void;
  apiUrl?: string;
}

export const DiscoveryFeedScreen: React.FC<Props> = ({ onSelectRestaurant, apiUrl }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isPureVegOnly, setIsPureVegOnly] = useState(false);
  const [restaurants, setRestaurants] = useState<RestaurantItem[]>(SAMPLE_RESTAURANTS);
  const [state, setState] = useState<'loading' | 'success' | 'error'>('success');

  React.useEffect(() => {
    if (!apiUrl) return;
    fetch(`${apiUrl}/restaurants`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.data?.restaurants) && data.data.restaurants.length > 0) {
          const mapped: RestaurantItem[] = data.data.restaurants.map((r: any) => ({
            id: r.id,
            name: r.name,
            cuisine: Array.isArray(r.cuisineTags) ? r.cuisineTags.join(', ') : 'Indian & Mughlai',
            rating: r.ratingAverage || 4.7,
            deliveryTimeMins: r.estimatedDeliveryMinutes || 25,
            distanceKm: r.distanceKm || 2.2,
            isPureVeg: !!r.isPureVeg,
            priceForTwo: 450
          }));
          setRestaurants(mapped);
        }
      })
      .catch(() => {
        // Fallback to sample restaurants
      });
  }, [apiUrl]);

  const filteredRestaurants = restaurants.filter(r => {
    if (isPureVegOnly && !r.isPureVeg) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Location Header */}
      <View style={styles.locationBar}>
        <MapPin size={18} color={tokens.colors.primary[500]} />
        <View style={styles.locationTextContainer}>
          <Text style={styles.locationTitle}>Indiranagar</Text>
          <Text style={styles.locationSubtitle}>100 Feet Road, Bengaluru, Karnataka</Text>
        </View>
      </View>

      {/* Search and Veg Switch Controls */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Search size={18} color="#94A3B8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search 'biryani', 'dosa' or cuisines..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#94A3B8"
          />
        </View>

        {/* Veg-Only Mode Toggle */}
        <View style={styles.vegToggleContainer}>
          <Text style={styles.vegToggleLabel}>VEG</Text>
          <Switch
            value={isPureVegOnly}
            onValueChange={setIsPureVegOnly}
            trackColor={{ false: '#CBD5E1', true: tokens.colors.dietary.veg }}
            thumbColor="#FFFFFF"
          />
        </View>
      </View>

      {/* Quick Bite Gold Banner */}
      <View style={styles.goldBanner}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Sparkles size={18} color="#D97706" />
          <Text style={styles.goldTitle}>QUICK BITE GOLD</Text>
        </View>
        <Text style={styles.goldSubtitle}>
          Enjoy Unlimited Free Delivery on all orders above Rs 199.
        </Text>
      </View>

      {/* 4-State Handling */}
      {state === 'loading' && (
        <View style={styles.stateCenter}>
          <Text style={styles.stateTitle}>Finding nearby restaurants...</Text>
        </View>
      )}

      {state === 'error' && (
        <View style={styles.stateCenter}>
          <Text style={styles.stateTitle}>Unable to load restaurants</Text>
          <Text style={styles.stateSubtitle}>Please verify your connection and try again.</Text>
          <TouchableOpacity style={styles.ctaButton} onPress={() => setState('success')}>
            <Text style={styles.ctaButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'success' && filteredRestaurants.length === 0 && (
        <View style={styles.stateCenter}>
          <Text style={styles.stateTitle}>No restaurants found</Text>
          <Text style={styles.stateSubtitle}>No nearby kitchens match your active filters.</Text>
          <TouchableOpacity style={styles.ctaButton} onPress={() => { setIsPureVegOnly(false); setSearchQuery(''); }}>
            <Text style={styles.ctaButtonText}>Clear Filters</Text>
          </TouchableOpacity>
        </View>
      )}

      {state === 'success' && filteredRestaurants.length > 0 && (
        <View style={styles.feedList}>
          <Text style={styles.sectionTitle}>
            {filteredRestaurants.length} Restaurants Delivering to You
          </Text>

          {filteredRestaurants.map(restaurant => (
            <TouchableOpacity
              key={restaurant.id}
              style={styles.restaurantCard}
              onPress={() => onSelectRestaurant(restaurant)}
              activeOpacity={0.85}
            >
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.restaurantName}>{restaurant.name}</Text>
                  <Text style={styles.cuisineText}>{restaurant.cuisine}</Text>
                </View>

                {/* Rating Badge */}
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingText}>{restaurant.rating.toFixed(1)}</Text>
                  <Star size={10} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 2 }} />
                </View>
              </View>

              <View style={styles.cardFooter}>
                <View style={styles.metaRow}>
                  <Clock size={14} color="#64748B" />
                  <Text style={styles.metaText}>{restaurant.deliveryTimeMins} mins</Text>
                  <Text style={styles.metaDot}>•</Text>
                  <Text style={styles.metaText}>{restaurant.distanceKm} km</Text>
                  <Text style={styles.metaDot}>•</Text>
                  <Text style={styles.metaText}>Rs {restaurant.priceForTwo} for two</Text>
                </View>

                {restaurant.isPureVeg && (
                  <View style={styles.vegBadge}>
                    <View style={styles.vegDot} />
                    <Text style={styles.vegBadgeText}>PURE VEG</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  contentContainer: {
    padding: 16
  },
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10
  },
  locationTextContainer: {
    flex: 1
  },
  locationTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A'
  },
  locationSubtitle: {
    fontSize: 12,
    color: '#64748B'
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    height: 44,
    gap: 8
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A'
  },
  vegToggleContainer: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  vegToggleLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: tokens.colors.dietary.veg,
    marginBottom: 2
  },
  goldBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20
  },
  goldTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#D97706',
    letterSpacing: 0.5
  },
  goldSubtitle: {
    fontSize: 12,
    color: '#92400E',
    marginTop: 4
  },
  feedList: {
    gap: 14
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  restaurantCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0'
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10
  },
  restaurantName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A'
  },
  cuisineText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.colors.dietary.veg,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6
  },
  ratingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700'
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  metaText: {
    fontSize: 12,
    color: '#64748B'
  },
  metaDot: {
    color: '#94A3B8',
    marginHorizontal: 2
  },
  vegBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: tokens.colors.dietary.veg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4
  },
  vegDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.colors.dietary.veg
  },
  vegBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: tokens.colors.dietary.veg
  },
  stateCenter: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4
  },
  stateSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
    textAlign: 'center'
  },
  ctaButton: {
    backgroundColor: tokens.colors.primary[500],
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8
  },
  ctaButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13
  }
});
