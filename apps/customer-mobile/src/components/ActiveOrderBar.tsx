import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Bike, ChevronRight, CookingPot, PackageCheck } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import type { ActiveOrder } from '../lib/useActiveOrders';

const c = tokens.colors;

interface Props {
  orders: ActiveOrder[];
  onOpen: (order: ActiveOrder) => void;
}

/**
 * What each status means to somebody waiting, rather than to the database.
 *
 * "READY_FOR_PICKUP" is true and useless: the customer does not care that the
 * bag is on a counter, they care that nobody has set off yet. The wording is
 * about their food, not our pipeline.
 */
function describe(status: string): { text: string; icon: 'cooking' | 'ready' | 'riding' } {
  switch (status) {
    case 'PAYMENT_PENDING':
      return { text: 'Waiting for payment', icon: 'cooking' };
    case 'ORDER_PLACED':
      return { text: 'Sent to the kitchen', icon: 'cooking' };
    case 'ACCEPTED':
    case 'PREPARING':
      return { text: 'Being cooked', icon: 'cooking' };
    case 'READY_FOR_PICKUP':
      return { text: 'Ready, waiting for a rider', icon: 'ready' };
    case 'RIDER_ASSIGNED':
      return { text: 'Rider on the way to collect', icon: 'ready' };
    case 'OUT_FOR_DELIVERY':
      return { text: 'On its way to you', icon: 'riding' };
    default:
      return { text: 'In progress', icon: 'cooking' };
  }
}

/**
 * A bar across the bottom of the home screen for every order in flight.
 *
 * Without it, the only route back to a live order was the history screen, which
 * is a list of receipts — so the app looked like it had forgotten an order that
 * was at that moment being cooked. Somebody who has just paid for food wants one
 * tap to "where is it", and they want it from the screen they land on.
 *
 * Scrolls horizontally when there is more than one, rather than stacking: two or
 * three bars would eat the bottom of a phone, and the orders are peers — none of
 * them deserves to push the others off screen.
 */
export const ActiveOrderBar: React.FC<Props> = ({ orders, onOpen }) => {
  if (orders.length === 0) return null;

  const single = orders.length === 1;

  const card = (order: ActiveOrder) => {
    const { text, icon } = describe(order.status);
    return (
      <TouchableOpacity
        key={order.orderId}
        style={[styles.card, single && styles.cardSingle]}
        onPress={() => onOpen(order)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Track order ${order.orderNumber}, ${text}`}
      >
        <View style={styles.iconWrap}>
          {icon === 'riding' ? (
            <Bike size={18} color={c.primary[500]} />
          ) : icon === 'ready' ? (
            <PackageCheck size={18} color={c.primary[500]} />
          ) : (
            <CookingPot size={18} color={c.primary[500]} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {order.restaurantName}
          </Text>
          <Text style={styles.status} numberOfLines={1}>
            {text}
          </Text>
        </View>
        <ChevronRight size={18} color={c.text.muted} />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrap}>
      {single ? (
        card(orders[0])
      ) : (
        <>
          <Text style={styles.heading}>{orders.length} orders on the way</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
          >
            {orders.map(card)}
          </ScrollView>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border.subtle,
    backgroundColor: c.surface.card,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6
  },
  heading: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: c.text.muted,
    textTransform: 'uppercase'
  },
  row: { gap: 8, paddingRight: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: tokens.radii.md,
    backgroundColor: c.primary[50],
    borderWidth: 1,
    borderColor: c.primary[100],
    // Wide enough that a restaurant name and a status both fit without
    // truncating to nothing when several orders are side by side.
    width: 260
  },
  cardSingle: { width: 'auto' },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface.card
  },
  name: { fontSize: 14, fontWeight: '700', color: c.text.primary },
  status: { fontSize: 12, color: c.text.secondary, marginTop: 1 }
});
