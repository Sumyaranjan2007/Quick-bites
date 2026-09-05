import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal
} from 'react-native';
import { tokens } from '@quick-bites/design-system';
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
}

interface Dish {
  id: string;
  name: string;
  description: string;
  price: number;
  isVeg: boolean;
  hasCustomizations: boolean;
}

const SAMPLE_DISHES: Dish[] = [
  {
    id: 'dish_ck_biryani',
    name: 'Special Chicken Dum Biryani',
    description: 'Fragrant basmati rice layered with slow-cooked spiced chicken and caramelized onions.',
    price: 320.00,
    isVeg: false,
    hasCustomizations: true
  },
  {
    id: 'dish_pbm',
    name: 'Paneer Butter Masala',
    description: 'Fresh cottage cheese cooked in creamy tomato gravy with rich butter.',
    price: 260.00,
    isVeg: true,
    hasCustomizations: false
  },
  {
    id: 'dish_garlic_naan',
    name: 'Butter Garlic Naan',
    description: 'Crispy tandoori naan infused with roasted garlic flakes and clarified butter.',
    price: 65.00,
    isVeg: true,
    hasCustomizations: false
  }
];

interface Props {
  restaurant: RestaurantItem;
  cart: CartItem[];
  onAddToCart: (item: CartItem) => void;
  onBack: () => void;
  onViewCart: () => void;
}

export const RestaurantDetailScreen: React.FC<Props> = ({
  restaurant,
  cart,
  onAddToCart,
  onBack,
  onViewCart
}) => {
  const [selectedDishForCustomization, setSelectedDishForCustomization] = useState<Dish | null>(null);
  const [selectedPortion, setSelectedPortion] = useState<'Regular' | 'Large'>('Regular');

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleAddDish = (dish: Dish) => {
    if (dish.hasCustomizations) {
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
    const priceDelta = selectedPortion === 'Large' ? 150 : 0;
    onAddToCart({
      id: `cart_${selectedDishForCustomization.id}_${selectedPortion}`,
      dishId: selectedDishForCustomization.id,
      name: `${selectedDishForCustomization.name} (${selectedPortion})`,
      price: selectedDishForCustomization.price + priceDelta,
      quantity: 1,
      isVeg: selectedDishForCustomization.isVeg,
      variant: selectedPortion
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
        <Text style={styles.menuSectionHeader}>Recommended Dishes</Text>

        <View style={styles.dishList}>
          {SAMPLE_DISHES.map(dish => {
            const countInCart = cart
              .filter(c => c.dishId === dish.id)
              .reduce((s, c) => s + c.quantity, 0);

            return (
              <View key={dish.id} style={styles.dishCard}>
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
              <Text style={styles.modalSubtitle}>Choose Portion Size</Text>

              <TouchableOpacity
                style={[styles.modalOption, selectedPortion === 'Regular' && styles.modalOptionSelected]}
                onPress={() => setSelectedPortion('Regular')}
              >
                <Text style={styles.optionName}>Regular (Serves 1)</Text>
                <Text style={styles.optionPrice}>Rs {selectedDishForCustomization.price.toFixed(2)}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalOption, selectedPortion === 'Large' && styles.modalOptionSelected]}
                onPress={() => setSelectedPortion('Large')}
              >
                <Text style={styles.optionName}>Large (Serves 2-3)</Text>
                <Text style={styles.optionPrice}>Rs {(selectedDishForCustomization.price + 150).toFixed(2)}</Text>
              </TouchableOpacity>

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
