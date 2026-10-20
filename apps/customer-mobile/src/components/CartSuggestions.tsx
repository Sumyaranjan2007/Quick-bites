import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';
import { FoodImage } from './FoodImage';
import { DietMark } from './ui';
import type { CartItem } from '../screens/RestaurantDetailScreen';

const c = tokens.colors;

type Suggestion = { id: string; name: string; price: number; isVeg: boolean; imageUrl?: string; tag?: 'Your usual' | 'Most ordered' };

/**
 * "Complete your meal" in the cart (owner, 20 Oct 2026, item 5): this kitchen's dishes the
 * customer has not added, the ones they order here most first ("Your usual"), then the
 * kitchen's most ordered ("Most ordered"), then the menu. One tap adds, then − / + like any
 * dish. Dishes with choices to make are left out: they need the dish sheet on the menu.
 */
export const CartSuggestions: React.FC<{
  restaurantId?: string;
  restaurantName: string;
  cart: CartItem[];
  apiUrl?: string;
  token?: string;
  onAdd: (item: CartItem) => void;
  onUpdateQuantity: (cartItemId: string, delta: number) => void;
}> = ({ restaurantId, restaurantName, cart, apiUrl, token, onAdd, onUpdateQuantity }) => {
  const [ranked, setRanked] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (!apiUrl || !restaurantId) return;
    let stale = false;
    (async () => {
      try {
        const json = async (path: string, auth = false) =>
          (await apiFetch(`${apiUrl}${path}`, auth && token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)).json();
        const [menu, popular, mine] = await Promise.all([
          json(`/restaurants/${restaurantId}/menu`),
          json(`/restaurants/${restaurantId}/popular`).catch(() => null),
          token ? json('/orders', true).catch(() => null) : Promise.resolve(null)
        ]);
        const usual = new Map<string, number>();
        for (const o of mine?.data?.orders || []) {
          if (o.restaurantId !== restaurantId) continue;
          for (const i of o.items || []) usual.set(i.dishId, (usual.get(i.dishId) || 0) + (Number(i.quantity) || 1));
        }
        const hot: string[] = popular?.data?.dishIds || [];
        const dishes: Suggestion[] = [];
        for (const cat of menu?.data?.menu?.categories || []) {
          if (cat.isAvailable === false) continue;
          for (const d of cat.items || []) {
            if (d.isAvailable === false || (Array.isArray(d.optionGroups) && d.optionGroups.length)) continue;
            dishes.push({ id: d.id, name: d.name, price: Number(d.price) || 0, isVeg: Boolean(d.isVeg), imageUrl: d.imageUrl });
          }
        }
        const rank = (d: Suggestion) => (usual.has(d.id) ? -1e6 - usual.get(d.id)! : hot.includes(d.id) ? hot.indexOf(d.id) : 1e3);
        const sorted = dishes
          .map((d, i) => ({ d, i }))
          .sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)
          .map(({ d }) => ({ ...d, tag: usual.has(d.id) ? ('Your usual' as const) : hot.includes(d.id) ? ('Most ordered' as const) : undefined }));
        if (!stale) setRanked(sorted);
      } catch {
        // No suggestions is not an error: the cart works without them.
      }
    })();
    return () => {
      stale = true;
    };
  }, [apiUrl, restaurantId, token]);

  // Dishes already in the cart in some other way (with options) are not suggested again.
  const inCart = new Set(cart.filter(i => i.id !== `cart_${i.dishId}_standard`).map(i => i.dishId));
  const added = new Map(cart.filter(i => i.id === `cart_${i.dishId}_standard`).map(i => [i.dishId, i.quantity]));
  const shown = ranked.filter(d => !inCart.has(d.id) && (!cart.some(i => i.dishId === d.id) || added.has(d.id))).slice(0, 10);
  if (!shown.length || !restaurantId) return null;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Complete your meal</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {shown.map(d => {
          const qty = added.get(d.id) || 0;
          const cartId = `cart_${d.id}_standard`;
          return (
            <View key={d.id} style={s.card}>
              <FoodImage uri={d.imageUrl} isVeg={d.isVeg} style={s.photo} />
              {d.tag ? <Text style={s.tag}>{d.tag}</Text> : null}
              <View style={s.nameRow}>
                <DietMark isVeg={d.isVeg} size={12} />
                <Text style={s.name} numberOfLines={2}>
                  {d.name}
                </Text>
              </View>
              <View style={s.footer}>
                <Text style={s.price}>₹{Math.round(d.price)}</Text>
                {qty === 0 ? (
                  <TouchableOpacity
                    style={s.add}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${d.name}`}
                    onPress={() =>
                      onAdd({ id: cartId, dishId: d.id, restaurantId, restaurantName, name: d.name, price: d.price, quantity: 1, isVeg: d.isVeg } as CartItem)
                    }
                  >
                    <Text style={s.addText}>ADD</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={s.stepper}>
                    <TouchableOpacity onPress={() => onUpdateQuantity(cartId, -1)} hitSlop={8} accessibilityLabel="One less">
                      <Text style={s.step}>−</Text>
                    </TouchableOpacity>
                    <Text style={s.qty}>{qty}</Text>
                    <TouchableOpacity onPress={() => onUpdateQuantity(cartId, 1)} hitSlop={8} accessibilityLabel="One more">
                      <Text style={s.step}>+</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const s = StyleSheet.create({
  wrap: { marginBottom: 16 },
  title: { fontFamily: tokens.font.family, fontSize: tokens.font.size.md, fontWeight: '800', color: c.text.primary, marginBottom: 10 },
  row: { gap: 12, paddingRight: 8 },
  card: { width: 148, backgroundColor: c.surface.card, borderRadius: tokens.radii.lg, padding: 8, borderWidth: 1, borderColor: c.border.subtle },
  photo: { width: 132, height: 96, borderRadius: tokens.radii.md },
  tag: { fontFamily: tokens.font.family, fontSize: 10, fontWeight: '800', color: c.primary[600], marginTop: 6, textTransform: 'uppercase' },
  nameRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 4, minHeight: 36 },
  name: { flex: 1, fontFamily: tokens.font.family, fontSize: 13, fontWeight: '600', color: c.text.primary },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  price: { fontFamily: tokens.font.family, fontSize: 14, fontWeight: '800', color: c.text.primary },
  add: { borderWidth: 1, borderColor: c.primary[600], borderRadius: 8, paddingHorizontal: 14, minHeight: 32, justifyContent: 'center', backgroundColor: c.surface.card },
  addText: { fontFamily: tokens.font.family, fontSize: 13, fontWeight: '800', color: c.primary[600] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.primary[600], borderRadius: 8, paddingHorizontal: 10, minHeight: 32 },
  step: { fontFamily: tokens.font.family, fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  qty: { fontFamily: tokens.font.family, fontSize: 13, fontWeight: '800', color: '#FFFFFF' }
});
