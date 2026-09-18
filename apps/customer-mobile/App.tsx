import React, { useEffect, useState } from 'react';
import { DEFAULT_API_URL } from './src/config';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar
} from 'react-native';
import { SafeScreen } from './src/components/SafeScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { tokens } from './src/theme/tokens';
import { Utensils, ShoppingBag, User } from 'lucide-react-native';
import { DiscoveryFeedScreen, RestaurantItem } from './src/screens/DiscoveryFeedScreen';
import { RestaurantDetailScreen, CartItem } from './src/screens/RestaurantDetailScreen';
import { CartAndCheckoutScreen } from './src/screens/CartAndCheckoutScreen';
import { OrderTrackingScreen } from './src/screens/OrderTrackingScreen';
import { WalletScreen } from './src/screens/WalletScreen';
import { AddressBookScreen } from './src/screens/AddressBookScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrderHistoryScreen } from './src/screens/OrderHistoryScreen';
import { SupportScreen } from './src/screens/SupportScreen';
import { I18nProvider, useTranslation, Language } from './src/lib/i18n';
import { NotificationsProvider, useNotifications, STATUS_NOTIFICATION } from './src/lib/useNotifications';
import { NotificationBell } from './src/components/NotificationBell';
import { useOrderSocket } from './src/lib/useOrderSocket';
import { apiFetch } from './src/lib/apiFetch';

function AppRoot() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentScreen, setCurrentScreen] = useState<
    'feed' | 'detail' | 'cart' | 'tracking' | 'profile' | 'orders' | 'support' | 'wallet' | 'addresses'
  >('feed');
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantItem | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeOrder, setActiveOrder] = useState<{ orderNumber: string; total: number; otp: string; orderId?: string } | null>(null);
  const [apiUrl, setApiUrl] = useState<string>(DEFAULT_API_URL);
  const [authToken, setAuthToken] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const { t, setLanguage } = useTranslation();
  const { notify, enabled: notificationsEnabled, setEnabled: setNotificationsEnabled } = useNotifications();

  // Order updates announce themselves wherever the customer is in the app, not
  // only on the tracking screen. Without this the phone stayed silent while the
  // kitchen accepted, cooked and dispatched the order.
  useOrderSocket(activeOrder?.orderId, apiUrl, authToken, {
    onStatus: update => {
      const copy = STATUS_NOTIFICATION[update.status];
      if (copy) notify(copy.title, copy.body);
    }
  });

  // The account's saved language wins on sign-in, so the choice follows the
  // person to a new phone rather than living only on the one that set it.
  useEffect(() => {
    const preferred = currentUser?.preferredLanguage as Language | undefined;
    if (preferred === 'en' || preferred === 'hi' || preferred === 'kn') setLanguage(preferred);
  }, [currentUser?.preferredLanguage, setLanguage]);

  const handleSelectRestaurant = (restaurant: RestaurantItem) => {
    setSelectedRestaurant(restaurant);
    setCurrentScreen('detail');
  };

  const handleAddToCart = (item: CartItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => (i.id === item.id ? { ...i, quantity: i.quantity + item.quantity } : i));
      }
      return [...prev, item];
    });
  };

  const handleUpdateQuantity = (cartItemId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(item => {
          if (item.id === cartItemId) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const handleOrderPlaced = (orderData: { orderNumber: string; total: number; otp: string; orderId?: string }) => {
    setActiveOrder(orderData);
    setCart([]);
    setCurrentScreen('tracking');
  };

  /**
   * Replaces the cart with a repeat of a past order.
   *
   * Replaces rather than appends. A cart can only hold one restaurant's food —
   * the bill, the packaging fee and the settlement are all computed per kitchen —
   * so merging a repeat into a basket from somewhere else would build an order
   * that cannot be placed.
   *
   * The restaurant is set from the basket too, because the cart screen needs it
   * to quote, and the previously selected restaurant may be a different one.
   */
  const handleReorder = async (basket: any, items: any[]) => {
    setCart(
      items.map((item: any) => ({
        id: `${item.dishId}_reorder`,
        dishId: item.dishId,
        name: item.name,
        price: Number(item.unitPrice),
        quantity: Number(item.quantity) || 1,
        isVeg: Boolean(item.isVeg),
        ...(item.selectedOptions?.length ? { selectedOptions: item.selectedOptions } : {})
      }))
    );

    // The WHOLE restaurant record, not a stub built from the basket.
    //
    // A reorder can be for a kitchen the customer has not opened this session,
    // and `{ id, name }` is not a RestaurantItem: the cart reads the packaging
    // fee and the trip distance off it, and tapping Back from the cart opens
    // the detail screen, which would have rendered "undefined MIN" and
    // "Rs undefined for two".
    if (selectedRestaurant?.id !== basket.restaurantId) {
      try {
        const res = await apiFetch(`${apiUrl}/restaurants/${basket.restaurantId}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {}
        });
        const data = await res.json();
        const r = data?.data?.restaurant ?? data?.data;
        if (res.ok && r?.id) {
          setSelectedRestaurant({
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
          } as RestaurantItem);
        } else {
          // Better to lose the detail screen than to show a broken one: with no
          // restaurant selected, Back from the cart returns to the feed.
          setSelectedRestaurant(null);
        }
      } catch {
        setSelectedRestaurant(null);
      }
    }

    setCurrentScreen('cart');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setAuthToken('');
    setCurrentUser(null);
    setCurrentScreen('feed');
    setCart([]);
  };

  // If unauthenticated, present the Quick Bites Customer Login Screen
  if (!isAuthenticated) {
    return (
      <SafeScreen style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={tokens.colors.surface.app} />
        <LoginScreen
          initialApiUrl={apiUrl}
          onLoginSuccess={(token, user, url) => {
            setAuthToken(token);
            setCurrentUser(user);
            setApiUrl(url);
            setIsAuthenticated(true);
          }}
        />
      </SafeScreen>
    );
  }

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <SafeScreen style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={tokens.colors.surface.app} />

      {/* Primary Screen View */}
      <View style={styles.mainContent}>
        {currentScreen === 'feed' && (
          <DiscoveryFeedScreen
            onSelectRestaurant={handleSelectRestaurant}
            apiUrl={apiUrl}
            token={authToken}
          />
        )}

        {currentScreen === 'detail' && selectedRestaurant && (
          <RestaurantDetailScreen
            restaurant={selectedRestaurant}
            cart={cart}
            onAddToCart={handleAddToCart}
            onBack={() => setCurrentScreen('feed')}
            onViewCart={() => setCurrentScreen('cart')}
            apiUrl={apiUrl}
            token={authToken}
          />
        )}

        {currentScreen === 'cart' && (
          <CartAndCheckoutScreen
            cart={cart}
            onUpdateQuantity={handleUpdateQuantity}
            onBack={() => setCurrentScreen(selectedRestaurant ? 'detail' : 'feed')}
            onOrderPlaced={handleOrderPlaced}
            restaurantId={selectedRestaurant?.id}
            apiUrl={apiUrl}
            token={authToken}
            packagingFee={selectedRestaurant?.packagingFee}
            distanceKm={selectedRestaurant?.distanceKm}
          />
        )}

        {currentScreen === 'tracking' && activeOrder && (
          <OrderTrackingScreen
            orderNumber={activeOrder.orderNumber}
            total={activeOrder.total}
            otp={activeOrder.otp}
            orderId={activeOrder.orderId}
            apiUrl={apiUrl}
            token={authToken}
            currentUserId={currentUser?.id}
            onHome={() => setCurrentScreen('feed')}
          />
        )}

        {currentScreen === 'profile' && (
          <ProfileScreen
            onBack={() => setCurrentScreen('feed')}
            onOpenOrders={() => setCurrentScreen('orders')}
            onOpenSupport={() => setCurrentScreen('support')}
            onOpenWallet={() => setCurrentScreen('wallet')}
            onOpenAddresses={() => setCurrentScreen('addresses')}
            apiUrl={apiUrl}
            token={authToken}
            user={currentUser}
            onUserUpdated={setCurrentUser}
            onLogout={handleLogout}
            notificationsEnabled={notificationsEnabled}
            onToggleNotifications={setNotificationsEnabled}
          />
        )}

        {currentScreen === 'orders' && (
          <OrderHistoryScreen
            onBack={() => setCurrentScreen('profile')}
            onOpenOrder={order => {
              setActiveOrder({
                orderNumber: order.orderNumber,
                total: Number(order.bill?.totalAmount ?? 0),
                // A past order's OTP is spent; the tracking screen hides it for
                // anything already closed, and live orders re-fetch their own.
                otp: order.deliveryOtp ?? '',
                orderId: order.id
              });
              setCurrentScreen('tracking');
            }}
            onReorder={handleReorder}
            apiUrl={apiUrl}
            token={authToken}
          />
        )}

        {currentScreen === 'wallet' && (
          <WalletScreen onBack={() => setCurrentScreen('profile')} apiUrl={apiUrl} token={authToken} />
        )}

        {currentScreen === 'addresses' && (
          <AddressBookScreen onBack={() => setCurrentScreen('profile')} apiUrl={apiUrl} token={authToken} />
        )}

        {currentScreen === 'support' && (
          <SupportScreen
            onBack={() => setCurrentScreen('profile')}
            customerEmail={currentUser?.email}
            apiUrl={apiUrl}
            token={authToken}
          />
        )}
      </View>

      {/* Bottom Navigation Bar (Visible on feed and profile) */}
      {(currentScreen === 'feed' || currentScreen === 'profile') && (
        <View style={styles.bottomNav}>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => setCurrentScreen('feed')}
          >
            <Utensils
              size={20}
              color={currentScreen === 'feed' ? tokens.colors.primary[500] : tokens.colors.text.muted}
            />
            <Text
              style={[
                styles.navText,
                currentScreen === 'feed' && styles.navTextActive
              ]}
            >
              {t('nav.delivery')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => setCurrentScreen('cart')}
          >
            <View>
              <ShoppingBag size={20} color={tokens.colors.text.muted} />
              {totalCartCount > 0 && (
                <View style={styles.navBadge}>
                  <Text style={styles.navBadgeText}>{totalCartCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.navText}>{t('nav.cart')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => setCurrentScreen('profile')}
          >
            <User
              size={20}
              color={currentScreen === 'profile' ? tokens.colors.primary[500] : tokens.colors.text.muted}
            />
            <Text
              style={[
                styles.navText,
                currentScreen === 'profile' && styles.navTextActive
              ]}
            >
              {t('nav.profile')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.colors.surface.app
  },
  mainContent: {
    flex: 1
  },
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: tokens.colors.border.subtle,
    backgroundColor: tokens.colors.surface.card,
    paddingVertical: 10,
    paddingBottom: 18
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4
  },
  navText: {
    fontSize: 11,
    color: tokens.colors.text.muted,
    fontWeight: '600'
  },
  navTextActive: {
    color: tokens.colors.primary[500],
    fontWeight: '800'
  },
  navBadge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: tokens.colors.accent[500],
    alignItems: 'center',
    justifyContent: 'center'
  },
  navBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: tokens.colors.text.onAccent
  }
});

export default function App() {
  return (
    <ErrorBoundary appName="Quick Bites" accent="#5B0E20">
      <I18nProvider>
        <NotificationsProvider>
          <AppRoot />
        </NotificationsProvider>
      </I18nProvider>
    </ErrorBoundary>
  );
}
