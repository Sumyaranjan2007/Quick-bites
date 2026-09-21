import React, { useCallback, useEffect, useState } from 'react';
import { DEFAULT_API_URL } from './src/config';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert
} from 'react-native';
import { SafeScreen } from './src/components/SafeScreen';
import { useHardwareBackWithExitConfirm } from './src/lib/useHardwareBack';
import { loadStoredSession, saveStoredSession, clearStoredSession } from './src/lib/storedSession';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { tokens } from './src/theme/tokens';
import { Utensils, ShoppingBag, User } from 'lucide-react-native';
import { DiscoveryFeedScreen, RestaurantItem } from './src/screens/DiscoveryFeedScreen';
import { RestaurantDetailScreen, CartItem } from './src/screens/RestaurantDetailScreen';
import { CartAndCheckoutScreen } from './src/screens/CartAndCheckoutScreen';
import { OrderTrackingScreen } from './src/screens/OrderTrackingScreen';
import { MembershipScreen } from './src/screens/MembershipScreen';
import { ActiveOrderBar } from './src/components/ActiveOrderBar';
import { useActiveOrders, type ActiveOrder } from './src/lib/useActiveOrders';
import { AddressBookScreen } from './src/screens/AddressBookScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrderHistoryScreen } from './src/screens/OrderHistoryScreen';
import { SupportScreen } from './src/screens/SupportScreen';
import { I18nProvider, useTranslation, Language } from './src/lib/i18n';
import { NotificationsProvider, useNotifications, STATUS_NOTIFICATION } from './src/lib/useNotifications';
import { NotificationBell } from './src/components/NotificationBell';
import { useOrderSocket } from './src/lib/useOrderSocket';
import { apiFetch, setSessionEndedHandler } from './src/lib/apiFetch';
import { SafeAreaProvider } from 'react-native-safe-area-context';

function AppRoot() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentScreen, setCurrentScreen] = useState<
    | 'feed'
    | 'detail'
    | 'cart'
    | 'tracking'
    | 'profile'
    | 'orders'
    | 'support'
    | 'membership'
    | 'addresses'
  >('feed');
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantItem | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeOrder, setActiveOrder] = useState<{ orderNumber: string; total: number; otp: string; orderId?: string } | null>(null);

  const [apiUrl, setApiUrl] = useState<string>(DEFAULT_API_URL);

  /**
   * The saved address the customer is currently ordering to.
   *
   * Lifted here because two screens have to agree on it. The home screen's
   * location chip decides which area the listing is built for, and checkout
   * decides where the food is sent — and until this existed those were two
   * separate answers. A customer could move the chip to another part of the
   * city, browse kitchens there, and have the order delivered to the address
   * checkout had defaulted to on its own, priced for a journey nobody made.
   *
   * Null means "no explicit choice yet", and checkout falls back to the
   * customer's default address exactly as it did before.
   */
  const [deliveryAddressId, setDeliveryAddressId] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string>('');

  /**
   * Every order in flight, not just the last one placed.
   *
   * `activeOrder` above is which order the TRACKING SCREEN is currently showing.
   * These are all of them, read from the server, and they are what the bar at
   * the bottom of the home screen offers. Before this, placing a second order
   * replaced the first in memory and the first became unreachable except
   * through order history — while it was still being cooked.
   */
  const { orders: liveOrders, refresh: refreshLiveOrders } = useActiveOrders(apiUrl, authToken);

  // Re-read the set whenever the customer lands back on the home screen.
  // An order can finish, be cancelled by the kitchen, or reach the door while
  // they are somewhere else in the app, and a bar still offering to track a
  // delivered order is worse than no bar.
  useEffect(() => {
    if (currentScreen === 'feed') refreshLiveOrders();
  }, [currentScreen, refreshLiveOrders]);

  const openLiveOrder = useCallback((order: ActiveOrder) => {
    setActiveOrder({
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      total: order.total,
      otp: order.otp
    });
    setCurrentScreen('tracking');
  }, []);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  // Null while the stored session is being read. Rendering the login screen
  // during that moment would flash it at someone who is already signed in.
  const [restoringSession, setRestoringSession] = useState(true);
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

  /**
   * Adds a dish, and refuses to mix two kitchens in one basket.
   *
   * A cart is only meaningful against one restaurant: the bill is priced from
   * that restaurant's menu and packaging fee, the commission and settlement are
   * per kitchen, and one rider collects from one door. Nothing enforced that —
   * a dish added from a second restaurant simply joined the list, and checkout
   * then posted the whole basket against whichever restaurant was on screen,
   * so the items and the kitchen they were charged to could be different.
   *
   * Asked rather than refused, and asked with the kitchen named. "You already
   * have items" with no name is a dead end for somebody who has forgotten what
   * is in their basket.
   */
  const handleAddToCart = (item: CartItem) => {
    const clash = cart.find(i => i.restaurantId && i.restaurantId !== item.restaurantId);
    if (clash) {
      Alert.alert(
        'Start a new order?',
        `Your basket has food from ${clash.restaurantName || 'another restaurant'}. ` +
          `Quick Bites delivers from one kitchen at a time, so adding this will empty it.`,
        [
          { text: 'Keep my basket', style: 'cancel' },
          {
            text: 'Start new order',
            style: 'destructive',
            onPress: () => setCart([item])
          }
        ]
      );
      return;
    }

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
    // The new order joins the others rather than displacing them, which is the
    // whole point of being able to have two.
    refreshLiveOrders();
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
        restaurantId: basket.restaurantId,
        restaurantName: basket.restaurantName || '',
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
            distanceKm: r.distanceKm,
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

  // Restores the previous sign-in before the first paint, so reopening the app
  // returns the customer to where they were rather than to a password prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadStoredSession();
      if (!cancelled && stored) {
        setAuthToken(stored.token);
        setCurrentUser(stored.user);
        setApiUrl(stored.apiUrl);
        setIsAuthenticated(true);
      }
      if (!cancelled) setRestoringSession(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = () => {
    // Cleared first: a sign-out that leaves the token on the device is not a
    // sign-out, and this runs even if the network call behind it fails.
    void clearStoredSession();
    setIsAuthenticated(false);
    setAuthToken('');
    setCurrentUser(null);
    setCurrentScreen('feed');
    setCart([]);
  };

  /*
   * An account blocked, or deleted, while the app is open.
   *
   * The refusal arrives on whatever request comes next rather than at a next
   * sign-in, so the session ends here and the server's own words — which carry
   * the reason an administrator recorded — are shown once. Without this the
   * customer sits on a feed that will not load and a basket that will not
   * price, with a different unexplained error on each screen.
   */
  useEffect(() => {
    setSessionEndedHandler(({ message }) => {
      Alert.alert('You have been signed out', message);
      handleLogout();
    });
    return () => setSessionEndedHandler(null);
    // handleLogout closes over stable setters only, so this registers once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Where the back gesture goes from each screen.
   *
   * The two tabs are the top of the stack: backing out of them leaves the app,
   * which is what closing an app should feel like. Everything else returns to
   * whatever opened it, so a customer who opens their orders from the profile
   * lands back on the profile rather than on their home screen.
   */
  const goBack = useCallback(() => {
    switch (currentScreen) {
      case 'detail':
      case 'cart':
      case 'tracking':
      case 'profile':
        setCurrentScreen('feed');
        return true;
      case 'orders':
      case 'support':
      case 'addresses':
        setCurrentScreen('profile');
        return true;
      default:
        return false;
    }
  }, [currentScreen]);

  useHardwareBackWithExitConfirm(goBack);

  // Nothing is rendered until the stored session has been consulted; the splash
  // stays up for the few milliseconds it takes.
  if (restoringSession) {
    return (
      <SafeScreen style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={tokens.colors.surface.app} />
      </SafeScreen>
    );
  }

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
            void saveStoredSession({ token, user, apiUrl: url });
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
            deliveryAddressId={deliveryAddressId}
            onChooseAddress={setDeliveryAddressId}
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
            preferredAddressId={deliveryAddressId}
            onAddressChosen={setDeliveryAddressId}
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
            onOpenMembership={() => setCurrentScreen('membership')}
            onOpenAddresses={() => setCurrentScreen('addresses')}
            apiUrl={apiUrl}
            token={authToken}
            user={currentUser}
            onUserUpdated={next => {
              setCurrentUser(next);
              // Kept in step with the stored copy, or an edited name would
              // revert to the old one on the next launch.
              void saveStoredSession({ token: authToken, user: next, apiUrl });
            }}
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

        {currentScreen === 'membership' && (
          <MembershipScreen
            onBack={() => setCurrentScreen('profile')}
            apiUrl={apiUrl}
            token={authToken}
          />
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

      {/* Orders in flight.
          Above the tab bar and below the screen, so it is reachable from the
          screen somebody lands on without covering anything they were reading.
          Only on the feed: on the tracking screen it would point at the thing
          already filling the display. */}
      {currentScreen === 'feed' && (
        <ActiveOrderBar orders={liveOrders} onOpen={openLiveOrder} />
      )}

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
    {/* Required by useSafeAreaInsets. Without it every inset reads zero and
        the bottom row slides back under Android's navigation bar. */}
    <SafeAreaProvider>
        <I18nProvider>
          <NotificationsProvider>
            <AppRoot />
          </NotificationsProvider>
        </I18nProvider>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
