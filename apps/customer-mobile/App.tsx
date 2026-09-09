import React, { useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar
} from 'react-native';
import { tokens } from './src/theme/tokens';
import { Utensils, ShoppingBag, User } from 'lucide-react-native';
import { DiscoveryFeedScreen, RestaurantItem } from './src/screens/DiscoveryFeedScreen';
import { RestaurantDetailScreen, CartItem } from './src/screens/RestaurantDetailScreen';
import { CartAndCheckoutScreen } from './src/screens/CartAndCheckoutScreen';
import { OrderTrackingScreen } from './src/screens/OrderTrackingScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { LoginScreen } from './src/screens/LoginScreen';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [currentScreen, setCurrentScreen] = useState<'feed' | 'detail' | 'cart' | 'tracking' | 'profile'>('feed');
  const [selectedRestaurant, setSelectedRestaurant] = useState<RestaurantItem | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeOrder, setActiveOrder] = useState<{ orderNumber: string; total: number; otp: string } | null>(null);
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

  const handleOrderPlaced = (orderData: { orderNumber: string; total: number; otp: string }) => {
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

  // If unauthenticated, present the Quick Bite Customer Login Screen
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
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
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

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
          />
        )}

        {currentScreen === 'tracking' && activeOrder && (
          <OrderTrackingScreen
            orderNumber={activeOrder.orderNumber}
            total={activeOrder.total}
            otp={activeOrder.otp}
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
              color={currentScreen === 'feed' ? tokens.colors.primary[500] : '#64748B'}
            />
            <Text
              style={[
                styles.navText,
                currentScreen === 'feed' && { color: tokens.colors.primary[500], fontWeight: '700' }
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
              <ShoppingBag size={20} color="#64748B" />
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
              color={currentScreen === 'profile' ? tokens.colors.primary[500] : '#64748B'}
            />
            <Text
              style={[
                styles.navText,
                currentScreen === 'profile' && { color: tokens.colors.primary[500], fontWeight: '700' }
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
    backgroundColor: '#FFFFFF'
  },
  mainContent: {
    flex: 1
  },
  bottomNav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingBottom: 16,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4
  },
  navText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 3
  },
  navBadge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: tokens.colors.primary[500],
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4
  },
  navBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800'
  }
});
