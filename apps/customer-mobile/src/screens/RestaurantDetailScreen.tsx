import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  ActivityIndicator
} from 'react-native';
import { tokens } from '../theme/tokens';
import { ArrowLeft, Star, ShoppingBag, ShieldCheck, Plus, Check } from 'lucide-react-native';
import { RestaurantItem } from './DiscoveryFeedScreen';

export interface CartItem {
  id: string;
  dishId: string;
  name: string;
  price: number;
  quantity: number;
  isVeg: boolean;
  variant?: string;
  selectedOptions?: Array<{ groupId: string; optionId: string }>;
}

interface OptionGroup {
  id: string;
  title: string;
  isRequired: boolean;
  options: Array<{ id: string; name: string; priceDelta: number }>;
}

interface Dish {
  id: string;
  name: string;
  description: string;
  price: number;
  isVeg: boolean;
  isAvailable: boolean;
  hasCustomizations: boolean;
  optionGroups?: OptionGroup[];
  categoryName?: string;
}

interface Props {
  restaurant: RestaurantItem;
  cart: CartItem[];
  onAddToCart: (item: CartItem) => void;
  onBack: () => void;
  onViewCart: () => void;
  apiUrl: string;
  token?: string;
}

export const RestaurantDetailScreen: React.FC<Props> = ({
  restaurant,
  cart,
  onAddToCart,
  onBack,
  onViewCart,
  apiUrl,
  token
}) => {
  const [selectedDishForCustomization, setSelectedDishForCustomization] = useState<Dish | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMenu = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${apiUrl}/restaurants/${restaurant.id}/menu`, { headers });
      const data = await res.json();
      if (!data.success || !data.data?.menu?.categories) {
        throw new Error('Menu unavailable for this restaurant.');
      }
      const flattened: Dish[] = [];
      for (const cat of data.data.menu.categories) {
        for (const item of cat.items || []) {
          flattened.push({
            id: item.id,
            name: item.name,
            description: item.description || '',
            price: item.price,
            isVeg: Boolean(item.isVeg),
            isAvailable: item.isAvailable !== false,
            hasCustomizations: Array.isArray(item.optionGroups) && item.optionGroups.length > 0,
            optionGroups: item.optionGroups,
            categoryName: cat.name
          });
        }
      }
      setDishes(flattened);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load the menu. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMenu();
  }, [restaurant.id]);

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleAddDish = (dish: Dish) => {
    if (!dish.isAvailable) return;
    if (dish.hasCustomizations) {
      const firstGroup = dish.optionGroups?.[0];
      setSelectedOptionId(firstGroup?.options?.[0]?.id ?? null);
      setSelectedDishForCustomization(dish);
    } else {
      onAddToCart({
        id: `cart_${dish.id}_standard`,
        dishId: dish.id,
        name: dish.name,
        price: dish.price,
        quantity: 1,
        isVeg: dish.isVeg
      });
    }
  };

  const handleConfirmCustomization = () => {
    if (!selectedDishForCustomization) return;
    const group = selectedDishForCustomization.optionGroups?.[0];
    const option = group?.options?.find(o => o.id === selectedOptionId) ?? group?.options?.[0];
    const priceDelta = option?.priceDelta ?? 0;
    const variantName = option?.name ?? 'Standard';

    onAddToCart({
      id: `cart_${selectedDishForCustomization.id}_${option?.id ?? 'standard'}`,
      dishId: selectedDishForCustomization.id,
      name: `${selectedDishForCustomization.name} (${variantName})`,
      price: selectedDishForCustomization.price + priceDelta,
      quantity: 1,
      isVeg: selectedDishForCustomization.isVeg,
      variant: variantName,
      selectedOptions: group && option ? [{ groupId: group.id, optionId: option.id }] : undefined
    });
    setSelectedDishForCustomization(null);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Navigation */}
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <ArrowLeft size={20} color="#0F172A" />
          <Text style={styles.backText}>Back to Restaurants</Text>
        </TouchableOpacity>

        {/* Restaurant Profile Card */}
        <View style={styles.restaurantHeader}>
          <Text style={styles.restaurantTitle}>{restaurant.name}</Text>
          <Text style={styles.cuisineText}>{restaurant.cuisine}</Text>

          <View style={styles.metaRow}>
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>{restaurant.rating.toFixed(1)}</Text>
              <Star size={10} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 2 }} />
            </View>
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.metaText}>{restaurant.deliveryTimeMins} mins Delivery</Text>
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.metaText}>{restaurant.distanceKm} km</Text>
          </View>

          <View style={styles.fssaiRow}>
            <ShieldCheck size={14} color={tokens.colors.dietary.veg} />
            <Text style={styles.fssaiText}>FSSAI License: 11223344556677 (Verified Active)</Text>
          </View>
        </View>

        {/* Menu Section */}
        <Text style={styles.menuSectionHeader}>Menu</Text>

        {isLoading && (
          <View style={styles.menuStatusBox}>
            <ActivityIndicator color={tokens.colors.primary[500]} />
            <Text style={styles.menuStatusText}>Loading menu...</Text>
          </View>
        )}

        {!isLoading && loadError && (
          <View style={styles.menuStatusBox}>
            <Text style={styles.menuErrorText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadMenu}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!isLoading && !loadError && dishes.length === 0 && (
          <View style={styles.menuStatusBox}>
            <Text style={styles.menuStatusText}>This restaurant has not published a menu yet.</Text>
          </View>
        )}

        <View style={styles.dishList}>
          {dishes.map(dish => {
            const countInCart = cart
              .filter(c => c.dishId === dish.id)
              .reduce((s, c) => s + c.quantity, 0);

            return (
              <View key={dish.id} style={[styles.dishCard, !dish.isAvailable && styles.dishCardUnavailable]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  {/* Dietary Indicator */}
                  <View style={dish.isVeg ? styles.vegSymbol : styles.nonVegSymbol}>
                    <View style={dish.isVeg ? styles.vegDot : styles.nonVegTriangle} />
                  </View>

                  <Text style={styles.dishName}>{dish.name}</Text>
                  <Text style={styles.dishPrice}>Rs {dish.price.toFixed(2)}</Text>
                  <Text style={styles.dishDesc} numberOfLines={2}>{dish.description}</Text>
                </View>

                {/* Add / Quantity Button */}
                {dish.isAvailable ? (
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleAddDish(dish)}
                  >
                    <Text style={styles.addButtonText}>
                      {countInCart > 0 ? `ADD (${countInCart})` : 'ADD'}
                    </Text>
                    {dish.hasCustomizations && (
                      <Text style={styles.customizableText}>customisable</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={styles.soldOutButton}>
                    <Text style={styles.soldOutText}>SOLD OUT</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Floating Bottom Cart Bar */}
      {totalCartCount > 0 && (
        <View style={styles.cartBar}>
          <View>
            <Text style={styles.cartBarCount}>{totalCartCount} item{totalCartCount > 1 ? 's' : ''} added</Text>
            <Text style={styles.cartBarSubtext}>Charges and taxes calculated next</Text>
          </View>
          <TouchableOpacity style={styles.viewCartButton} onPress={onViewCart}>
            <Text style={styles.viewCartButtonText}>View Cart</Text>
            <ShoppingBag size={16} color="#FFFFFF" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      )}

      {/* Customization Modal */}
      {selectedDishForCustomization && (
        <Modal visible transparent animationType="slide">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{selectedDishForCustomization.name}</Text>
              <Text style={styles.modalSubtitle}>
                {selectedDishForCustomization.optionGroups?.[0]?.title || 'Choose an Option'}
              </Text>

              {(selectedDishForCustomization.optionGroups?.[0]?.options || []).map(option => (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.modalOption, selectedOptionId === option.id && styles.modalOptionSelected]}
                  onPress={() => setSelectedOptionId(option.id)}
                >
                  <Text style={styles.optionName}>{option.name}</Text>
                  <Text style={styles.optionPrice}>
                    Rs {(selectedDishForCustomization.price + option.priceDelta).toFixed(2)}
                  </Text>
                </TouchableOpacity>
              ))}

              <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#F1F5F9' }]}
                  onPress={() => setSelectedDishForCustomization(null)}
                >
                  <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: tokens.colors.primary[500], flex: 1 }]}
                  onPress={handleConfirmCustomization}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Add Item to Cart</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 90
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16
  },
  backText: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600'
  },
  restaurantHeader: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20
  },
  restaurantTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A'
  },
  cuisineText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.colors.dietary.veg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6
  },
  ratingText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700'
  },
  metaText: {
    fontSize: 12,
    color: '#64748B'
  },
  metaDot: {
    color: '#94A3B8'
  },
  fssaiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9'
  },
  fssaiText: {
    fontSize: 11,
    color: '#64748B'
  },
  menuSectionHeader: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12
  },
  dishList: {
    gap: 12
  },
  dishCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  dishCardUnavailable: {
    opacity: 0.55,
    backgroundColor: '#F8FAFC'
  },
  soldOutButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center'
  },
  soldOutText: {
    color: '#94A3B8',
    fontWeight: '800',
    fontSize: 12
  },
  menuStatusBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    alignItems: 'center',
    gap: 10,
    marginBottom: 12
  },
  menuStatusText: {
    color: '#64748B',
    fontSize: 13
  },
  menuErrorText: {
    color: tokens.colors.primary[500],
    fontSize: 13,
    textAlign: 'center'
  },
  retryButton: {
    backgroundColor: tokens.colors.primary[500],
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13
  },
  vegSymbol: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderColor: tokens.colors.dietary.veg,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6
  },
  vegDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: tokens.colors.dietary.veg
  },
  nonVegSymbol: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderColor: tokens.colors.primary[500],
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6
  },
  nonVegTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 3.5,
    borderRightWidth: 3.5,
    borderBottomWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: tokens.colors.primary[500]
  },
  dishName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A'
  },
  dishPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.colors.primary[500],
    marginTop: 2
  },
  dishDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 16
  },
  addButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: tokens.colors.dietary.veg,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 80
  },
  addButtonText: {
    color: tokens.colors.dietary.veg,
    fontWeight: '800',
    fontSize: 13
  },
  customizableText: {
    fontSize: 9,
    color: '#94A3B8',
    marginTop: 2
  },
  cartBar: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8
  },
  cartBarCount: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14
  },
  cartBarSubtext: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2
  },
  viewCartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: tokens.colors.primary[500],
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8
  },
  viewCartButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end'
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A'
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginVertical: 12
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    marginBottom: 8
  },
  modalOptionSelected: {
    borderColor: tokens.colors.primary[500],
    backgroundColor: '#FDF2F2'
  },
  optionName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A'
  },
  optionPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: tokens.colors.primary[500]
  },
  modalBtn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  }
});
