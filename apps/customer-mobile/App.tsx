import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar
} from 'react-native';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { tokens } from './src/theme/tokens';
import { Utensils, ShoppingBag, User } from 'lucide-react-native';
import { DiscoveryFeedScreen, RestaurantItem } from './src/screens/DiscoveryFeedScreen';
import { RestaurantDetailScreen, CartItem } from './src/screens/RestaurantDetailScreen';
import { CartAndCheckoutScreen } from './src/screens/CartAndCheckoutScreen';
import { OrderTrackingScreen } from './src/screens/OrderTrackingScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { LoginScreen } from './src/screens/LoginScreen';

function AppRoot() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentScreen, setCurrentScreen] = useState<'feed' | 'detail' | 'cart' | 'tracking' | 'profile'>('feed');
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantItem | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeOrder, setActiveOrder] = useState<{ orderNumber: string; total: number; otp: string; orderId?: string } | null>(null);
  const [apiUrl, setApiUrl] = useState<string>('https://quick-bites-production-9f45.up.railway.app/api');
  const [authToken, setAuthToken] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<any | null>(null);

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
      <SafeAreaView style={styles.safeArea}>
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
      </SafeAreaView>
    );
  }

  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={tokens.colors.surface.app} />

      {/* Primary Screen View */}
      <View style={styles.mainContent}>
        {currentScreen === 'feed' && (
          <DiscoveryFeedScreen
            onSelectRestaurant={handleSelectRestaurant}
            apiUrl={apiUrl}
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
            onHome={() => setCurrentScreen('feed')}
          />
        )}

        {currentScreen === 'profile' && (
          <ProfileScreen
            onBack={() => setCurrentScreen('feed')}
            apiUrl={apiUrl}
            token={authToken}
            onUpdateApiUrl={(newUrl) => setApiUrl(newUrl)}
            onLogout={handleLogout}
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
              Delivery
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
            <Text style={styles.navText}>Cart</Text>
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
              Profile
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
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
      <AppRoot />
    </ErrorBoundary>
  );
}
