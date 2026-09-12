import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Image
} from 'react-native';
import { tokens } from '../theme/tokens';
import { Card, DietMark, RatingBadge, Button, EmptyState, LoadingState, Skeleton } from '../components/ui';
import { ArrowLeft, ShoppingBag, ShieldCheck, Heart, Share2, Timer, Tag } from 'lucide-react-native';
import { RestaurantItem } from './DiscoveryFeedScreen';
import { apiFetch } from '../lib/apiFetch';

const c = tokens.colors;

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
  imageUrl?: string;
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

const OFFERS = [
  { title: '50% OFF', sub: 'Use WELCOME50' },
  { title: 'FREE DELIVERY', sub: 'Use FREEDEL' },
  { title: 'Gold benefits', sub: 'On orders above ₹199' }
];

export const RestaurantDetailScreen: React.FC<Props> = ({
  restaurant,
  cart,
  onAddToCart,
  onBack,
  onViewCart,
  apiUrl,
  token
}) => {
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const loadMenu = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await apiFetch(`${apiUrl}/restaurants/${restaurant.id}/menu`, { headers });
      const data = await res.json();
      if (!data.success || !data.data?.menu?.categories) throw new Error('Menu unavailable for this restaurant.');

      const flat: Dish[] = [];
      for (const cat of data.data.menu.categories) {
        for (const item of cat.items || []) {
          flat.push({
            id: item.id,
            name: item.name,
            description: item.description || '',
            price: Number(item.price) || 0,
            isVeg: Boolean(item.isVeg),
            isAvailable: item.isAvailable !== false,
            hasCustomizations: Array.isArray(item.optionGroups) && item.optionGroups.length > 0,
            optionGroups: item.optionGroups,
            categoryName: cat.name,
            imageUrl: item.imageUrl
          });
        }
      }
      setDishes(flat);
      setActiveCategory(flat[0]?.categoryName ?? null);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load the menu. Check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMenu();
  }, [restaurant.id]);

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const categories = Array.from(new Set(dishes.map(d => d.categoryName).filter(Boolean))) as string[];
  const shown = activeCategory ? dishes.filter(d => d.categoryName === activeCategory) : dishes;

  const handleAddDish = (dish: Dish) => {
    if (!dish.isAvailable) return;
    if (dish.hasCustomizations) {
      setSelectedOptionId(dish.optionGroups?.[0]?.options?.[0]?.id ?? null);
      setSelectedDish(dish);
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
    if (!selectedDish) return;
    const group = selectedDish.optionGroups?.[0];
    const option = group?.options?.find(o => o.id === selectedOptionId) ?? group?.options?.[0];
    const delta = option?.priceDelta ?? 0;
    const variant = option?.name ?? 'Standard';

    onAddToCart({
      id: `cart_${selectedDish.id}_${option?.id ?? 'standard'}`,
      dishId: selectedDish.id,
      name: `${selectedDish.name} (${variant})`,
      price: selectedDish.price + delta,
      quantity: 1,
      isVeg: selectedDish.isVeg,
      variant,
      selectedOptions: group && option ? [{ groupId: group.id, optionId: option.id }] : undefined
    });
    setSelectedDish(null);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          {restaurant.bannerUrl ? (
            <Image source={{ uri: restaurant.bannerUrl }} style={styles.heroImage} />
          ) : (
            <View style={[styles.heroImage, { backgroundColor: c.surface.sunken }]} />
          )}
          <View style={styles.heroScrim} />

          <View style={styles.heroTop}>
            <TouchableOpacity style={styles.circleBtn} onPress={onBack} activeOpacity={0.85}>
              <ArrowLeft size={19} color={c.text.primary} />
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.circleBtn} activeOpacity={0.85}>
                <Heart size={18} color={c.text.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.circleBtn} activeOpacity={0.85}>
                <Share2 size={18} color={c.text.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.heroEta}>
            <Timer size={12} color={c.text.primary} />
            <Text style={styles.heroEtaText}>{restaurant.deliveryTimeMins} MIN</Text>
          </View>
        </View>

        {/* Restaurant summary */}
        <Card style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <Text style={styles.title}>{restaurant.name}</Text>
            <RatingBadge value={restaurant.rating} compact />
          </View>
          <Text style={styles.cuisine}>{restaurant.cuisine}</Text>
          <Text style={styles.costLine}>
            ₹{restaurant.priceForTwo} for two • Free delivery above ₹199
          </Text>

          <View style={styles.fssaiRow}>
            <ShieldCheck size={13} color={c.dietary.veg} />
            <Text style={styles.fssaiText}>FSSAI verified partner kitchen</Text>
          </View>
        </Card>

        {/* Offers */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.offerRow}>
          {OFFERS.map(o => (
            <View key={o.title} style={styles.offerCard}>
              <Tag size={14} color={c.accent[600]} />
              <View style={{ marginLeft: 8 }}>
                <Text style={styles.offerTitle}>{o.title}</Text>
                <Text style={styles.offerSub}>{o.sub}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        {/* Category tabs */}
        {categories.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
            {categories.map(cat => (
              <TouchableOpacity key={cat} onPress={() => setActiveCategory(cat)} activeOpacity={0.8}>
                <View style={styles.tab}>
                  <Text style={[styles.tabText, activeCategory === cat && styles.tabTextActive]}>{cat}</Text>
                  {activeCategory === cat && <View style={styles.tabUnderline} />}
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {isLoading && (
          <View style={{ gap: 14, paddingHorizontal: 16 }}>
            {[0, 1, 2].map(i => (
              <Skeleton key={i} height={104} />
            ))}
          </View>
        )}

        {!isLoading && loadError && (
          <EmptyState title="Menu unavailable" subtitle={loadError} action="Retry" onAction={loadMenu} />
        )}

        {!isLoading && !loadError && dishes.length === 0 && (
          <EmptyState title="No dishes yet" subtitle="This restaurant hasn't published its menu." />
        )}

        {/* Menu */}
        <View style={styles.menuList}>
          {shown.map(dish => {
            const inCart = cart.filter(x => x.dishId === dish.id).reduce((s, x) => s + x.quantity, 0);
            return (
              <View key={dish.id} style={[styles.dishRow, !dish.isAvailable && styles.dishRowOut]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <DietMark isVeg={dish.isVeg} />
                  <Text style={styles.dishName}>{dish.name}</Text>
                  <Text style={styles.dishPrice}>₹{dish.price.toFixed(0)}</Text>
                  {!!dish.description && (
                    <Text style={styles.dishDesc} numberOfLines={2}>
                      {dish.description}
                    </Text>
                  )}
                </View>

                <View style={styles.dishRight}>
                  {dish.imageUrl ? (
                    <Image source={{ uri: dish.imageUrl }} style={styles.dishImage} />
                  ) : (
                    <View style={[styles.dishImage, { backgroundColor: c.surface.sunken }]} />
                  )}

                  {dish.isAvailable ? (
                    <TouchableOpacity style={styles.addBtn} onPress={() => handleAddDish(dish)} activeOpacity={0.85}>
                      <Text style={styles.addBtnText}>{inCart > 0 ? `ADD ${inCart}` : 'ADD'}</Text>
                      <Text style={styles.addBtnPlus}>+</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.soldOutBtn}>
                      <Text style={styles.soldOutText}>SOLD OUT</Text>
                    </View>
                  )}
                  {dish.hasCustomizations && dish.isAvailable && (
                    <Text style={styles.customisable}>customisable</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Cart bar */}
      {totalCartCount > 0 && (
        <View style={styles.cartBar}>
          <View>
            <Text style={styles.cartBarCount}>
              {totalCartCount} item{totalCartCount > 1 ? 's' : ''} added
            </Text>
            <Text style={styles.cartBarSub}>Taxes and charges calculated next</Text>
          </View>
          <TouchableOpacity style={styles.cartBarBtn} onPress={onViewCart} activeOpacity={0.88}>
            <Text style={styles.cartBarBtnText}>View Cart</Text>
            <ShoppingBag size={16} color={c.text.onAccent} />
          </TouchableOpacity>
        </View>
      )}

      {/* Customisation sheet */}
      {selectedDish && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setSelectedDish(null)}>
          <View style={styles.sheetBackdrop}>
            <View style={styles.sheet}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetTitle}>{selectedDish.name}</Text>
              <Text style={styles.sheetSub}>{selectedDish.optionGroups?.[0]?.title || 'Choose an option'}</Text>

              {(selectedDish.optionGroups?.[0]?.options || []).map(option => {
                const active = selectedOptionId === option.id;
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[styles.optionRow, active && styles.optionRowActive]}
                    onPress={() => setSelectedOptionId(option.id)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active && <View style={styles.radioInner} />}
                    </View>
                    <Text style={styles.optionName}>{option.name}</Text>
                    <Text style={styles.optionPrice}>₹{(selectedDish.price + option.priceDelta).toFixed(0)}</Text>
                  </TouchableOpacity>
                );
              })}

              <View style={styles.sheetActions}>
                <Button label="Cancel" variant="ghost" onPress={() => setSelectedDish(null)} />
                <Button label="Add to Cart" variant="accent" onPress={handleConfirmCustomization} style={{ flex: 1 }} full />
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.surface.app },
  content: { paddingBottom: 120 },

  hero: { height: 230 },
  heroImage: { width: '100%', height: 230 },
  heroScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,16,20,0.18)' },
  heroTop: {
    position: 'absolute',
    top: 14,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  heroEta: {
    position: 'absolute',
    right: 16,
    bottom: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: tokens.radii.sm
  },
  heroEtaText: { fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.extrabold, color: c.text.primary },

  summaryCard: { marginHorizontal: 16, marginTop: -18 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: {
    flex: 1,
    fontSize: tokens.font.size.xl,
    fontWeight: tokens.font.weight.extrabold,
    color: c.text.primary,
    letterSpacing: -0.4
  },
  cuisine: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 6 },
  costLine: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 4 },
  fssaiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border.subtle
  },
  fssaiText: { fontSize: tokens.font.size.xs, color: c.dietary.veg, fontWeight: tokens.font.weight.semibold },

  offerRow: { gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  offerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.accent[50],
    borderWidth: 1,
    borderColor: c.accent[300],
    borderStyle: 'dashed',
    borderRadius: tokens.radii.md,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  offerTitle: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.extrabold, color: c.accent[600] },
  offerSub: { fontSize: tokens.font.size.xs, color: c.text.muted, marginTop: 1 },

  tabRow: { gap: 20, paddingHorizontal: 16, paddingTop: 18 },
  tab: { paddingBottom: 8 },
  tabText: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.semibold, color: c.text.muted },
  tabTextActive: { color: c.primary[500], fontWeight: tokens.font.weight.extrabold },
  tabUnderline: {
    height: 3,
    borderRadius: 2,
    backgroundColor: c.primary[500],
    marginTop: 6
  },

  menuList: { paddingHorizontal: 16, paddingTop: 8 },
  dishRow: {
    flexDirection: 'row',
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: c.border.subtle
  },
  dishRowOut: { opacity: 0.5 },
  dishName: {
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.bold,
    color: c.text.primary,
    marginTop: 8
  },
  dishPrice: {
    fontSize: tokens.font.size.base,
    fontWeight: tokens.font.weight.bold,
    color: c.text.primary,
    marginTop: 4
  },
  dishDesc: { fontSize: tokens.font.size.sm, color: c.text.muted, marginTop: 6, lineHeight: 18 },

  dishRight: { width: 112, alignItems: 'center' },
  dishImage: { width: 112, height: 96, borderRadius: tokens.radii.md },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: -16,
    backgroundColor: c.accent[500],
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: tokens.radii.sm,
    ...tokens.shadow.card
  },
  addBtnText: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.extrabold, color: c.text.onAccent },
  addBtnPlus: { fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.extrabold, color: c.text.onAccent },
  soldOutBtn: {
    marginTop: -16,
    backgroundColor: c.surface.sunken,
    borderWidth: 1,
    borderColor: c.border.medium,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: tokens.radii.sm
  },
  soldOutText: { fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.extrabold, color: c.text.muted },
  customisable: { fontSize: 10, color: c.text.muted, marginTop: 5 },

  cartBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: c.primary[600],
    borderRadius: tokens.radii.lg,
    paddingHorizontal: 16,
    paddingVertical: 13,
    ...tokens.shadow.floating
  },
  cartBarCount: { color: '#FFFFFF', fontWeight: tokens.font.weight.extrabold, fontSize: tokens.font.size.base },
  cartBarSub: { color: '#D9C4BB', fontSize: tokens.font.size.xs, marginTop: 2 },
  cartBarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: c.accent[500],
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: tokens.radii.sm
  },
  cartBarBtnText: { fontWeight: tokens.font.weight.extrabold, color: c.text.onAccent, fontSize: tokens.font.size.sm },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(26,7,16,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.card,
    borderTopLeftRadius: tokens.radii['2xl'],
    borderTopRightRadius: tokens.radii['2xl'],
    padding: 20,
    paddingBottom: 28
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border.strong,
    alignSelf: 'center',
    marginBottom: 16
  },
  sheetTitle: { fontSize: tokens.font.size.lg, fontWeight: tokens.font.weight.extrabold, color: c.text.primary },
  sheetSub: { fontSize: tokens.font.size.sm, color: c.text.secondary, marginTop: 4, marginBottom: 14 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10
  },
  optionRowActive: { borderColor: c.primary[500], backgroundColor: c.primary[50] },
  radio: {
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: c.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12
  },
  radioActive: { borderColor: c.primary[500] },
  radioInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary[500] },
  optionName: { flex: 1, fontSize: tokens.font.size.base, color: c.text.primary, fontWeight: tokens.font.weight.medium },
  optionPrice: { fontSize: tokens.font.size.base, fontWeight: tokens.font.weight.bold, color: c.text.primary },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 8 }
});
