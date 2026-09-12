import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  SafeAreaView,
  StatusBar,
  Alert
} from 'react-native';
import {
  ChefHat,
  Bell,
  Clock,
  CheckCircle2,
  XCircle,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  FileText,
  ShieldCheck,
  AlertTriangle,
  Store,
  Layers,
  LogOut,
  Sparkles
} from 'lucide-react-native';

const DEFAULT_API_URL = 'https://quick-bites-production-9f45.up.railway.app/api';

export default function RestaurantApp() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [email, setEmail] = useState(__DEV__ ? 'partner@quickbite.app' : '');
  const [password, setPassword] = useState(__DEV__ ? 'pass123' : '');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [activeTab, setActiveTab] = useState<'orders' | 'menu' | 'kyc' | 'settlements'>('orders');

  // Restaurant & Kitchen state
  const [restaurant, setRestaurant] = useState<any>({
    id: 'rst_bbh_01',
    name: 'Bangalore Biryani House',
    kycStatus: 'ACTIVE',
    isOpen: true,
    ratingAverage: 4.8,
    todayGmv: 4850.00
  });

  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Selected order for action
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [prepMinutes, setPrepMinutes] = useState(20);
  const [pickupInput, setPickupInput] = useState('');

  const authHeaders = (token?: string): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const effective = token || authToken;
    if (effective) headers['Authorization'] = `Bearer ${effective}`;
    return headers;
  };

  // Load live orders + menu from the backend
  const syncRestaurantData = async (token?: string) => {
    setIsSyncing(true);
    try {
      const [ordersRes, menuRes] = await Promise.all([
        fetch(`${apiUrl}/restaurants/${restaurant.id}/orders`, { headers: authHeaders(token) }),
        fetch(`${apiUrl}/restaurants/${restaurant.id}/menu`, { headers: authHeaders(token) })
      ]);

      const ordersData = await ordersRes.json();
      if (ordersData.success && Array.isArray(ordersData.data?.orders)) {
        setActiveOrders(
          ordersData.data.orders
            .filter((o: any) => !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(o.status))
            .map((o: any) => ({
              id: o.id,
              orderNumber: o.orderNumber,
              customerName: o.customerName || 'Customer',
              items: (o.items || []).map((it: any) => ({
                name: it.name,
                quantity: it.quantity,
                variant: it.selectedOptions?.[0]?.optionName
              })),
              totalAmount: o.bill?.totalAmount ?? 0,
              status: o.status,
              prepMinutes: o.preparationMinutes,
              pickupCode: o.pickupCode
            }))
        );
      }

      const menuData = await menuRes.json();
      if (menuData.success && menuData.data?.menu?.categories) {
        const flattened: any[] = [];
        for (const cat of menuData.data.menu.categories) {
          for (const item of cat.items || []) {
            flattened.push({
              id: item.id,
              name: item.name,
              price: Number(item.price) || 0,
              isAvailable: item.isAvailable !== false,
              isVeg: Boolean(item.isVeg)
            });
          }
        }
        setMenuItems(flattened);
      }
    } catch {
      Alert.alert('Sync Failed', 'Could not reach the Quick Bites server. Pull to retry.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle Login
  const handleLogin = async () => {
    try {
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: 'restaurant_owner' })
      });
      const data = await res.json();
      if (data.success && data.data?.token) {
        setAuthToken(data.data.token);
        setIsAuthenticated(true);
        syncRestaurantData(data.data.token);
      } else {
        Alert.alert('Login Failed', data.error?.message || data.error || 'Invalid credentials');
      }
    } catch {
      Alert.alert('Error', 'Unable to reach backend server. Check network connection.');
    }
  };

  // Toggle Kitchen Status
  const toggleKitchenStatus = async () => {
    const nextState = !restaurant.isOpen;
    setRestaurant({ ...restaurant, isOpen: nextState });
    try {
      const res = await fetch(`${apiUrl}/restaurants/${restaurant.id}/kitchen-status`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ isKitchenActive: nextState })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error);
    } catch (err: any) {
      setRestaurant({ ...restaurant, isOpen: !nextState });
      Alert.alert('Update Failed', err?.message || 'Kitchen status was not saved. Please try again.');
    }
  };

  // Toggle Dish Stock
  const toggleStock = async (dishId: string, current: boolean) => {
    const previous = menuItems;
    setMenuItems(menuItems.map(m => m.id === dishId ? { ...m, isAvailable: !current } : m));
    try {
      const res = await fetch(`${apiUrl}/restaurants/${restaurant.id}/menu/toggle-stock`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ dishId, isAvailable: !current })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error);
    } catch (err: any) {
      setMenuItems(previous);
      Alert.alert('Update Failed', err?.message || 'Stock status was not saved. Please try again.');
    }
  };

  // Push an order status transition to the backend, rolling back on failure
  const pushOrderStatus = async (orderId: string, status: string, preparationMinutes?: number) => {
    const previous = activeOrders;
    setActiveOrders(prev =>
      prev.map(o => (o.id === orderId ? { ...o, status, prepMinutes: preparationMinutes ?? o.prepMinutes } : o))
    );
    try {
      const res = await fetch(`${apiUrl}/orders/${orderId}/status`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(
          preparationMinutes !== undefined ? { status, preparationMinutes } : { status }
        )
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || 'Status update rejected by server.');
      return true;
    } catch (err: any) {
      setActiveOrders(previous);
      Alert.alert('Update Failed', err?.message || 'Could not reach the server. Please try again.');
      return false;
    }
  };

  // Accept Order
  const acceptOrder = async (orderId: string, mins: number) => {
    const ok = await pushOrderStatus(orderId, 'PREPARING', mins);
    if (ok) {
      setSelectedOrder(null);
      Alert.alert('Order Accepted', `Order moved to kitchen queue with ${mins} minutes prep time.`);
    }
  };

  // Mark Ready for Pickup
  const markReady = async (orderId: string) => {
    const ok = await pushOrderStatus(orderId, 'READY_FOR_PICKUP');
    if (ok) {
      Alert.alert('Food Ready', 'Delivery partner has been notified that food is packed.');
    }
  };

  // Verify Pickup Code
  const verifyPickup = async (orderId: string) => {
    const order = activeOrders.find(o => o.id === orderId);
    if (!order) return;
    if (pickupInput.trim() !== order.pickupCode) {
      Alert.alert('Invalid Code', 'The 4-digit pickup code does not match.');
      return;
    }
    const ok = await pushOrderStatus(orderId, 'OUT_FOR_DELIVERY');
    if (ok) {
      setActiveOrders(prev => prev.filter(o => o.id !== orderId));
      setPickupInput('');
      setSelectedOrder(null);
      Alert.alert('Pickup Confirmed', 'Food handed over to delivery partner successfully.');
    }
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#17090E" />
        <View style={styles.authCard}>
          <View style={styles.authHeader}>
            <View style={styles.brandIconCircle}>
              <ChefHat size={36} color="#F5A623" />
            </View>
            <Text style={styles.authTitle}>Quick Bites Partner</Text>
            <Text style={styles.authSubtitle}>Kitchen Terminal & Store Management</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Partner Email</Text>
            <TextInput
              style={styles.textInput}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="partner@quickbite.app"
              placeholderTextColor="#8A7A72"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.textInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="pass123"
              placeholderTextColor="#8A7A72"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Server / Cloud Tunnel URL</Text>
            <TextInput
              style={styles.textInput}
              value={apiUrl}
              onChangeText={setApiUrl}
              autoCapitalize="none"
              placeholder="http://10.0.2.2:5000/api"
              placeholderTextColor="#8A7A72"
            />
          </View>

          <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
            <Text style={styles.loginBtnText}>Launch Kitchen Terminal</Text>
          </TouchableOpacity>

          {__DEV__ && (


            <View style={styles.demoPill}>
            <Sparkles size={16} color="#F5A623" />
            <Text style={styles.demoPillText}>Default Login: partner@quickbite.app / pass123</Text>


            </View>


          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.mainContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#17090E" />

      {/* Top App Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.storeName}>{restaurant.name}</Text>
          <View style={styles.storeMetaRow}>
            <View style={[styles.statusDot, { backgroundColor: restaurant.isOpen ? '#22C08A' : '#E15D5D' }]} />
            <Text style={styles.statusText}>{restaurant.isOpen ? 'Kitchen Online' : 'Kitchen Closed'}</Text>
            <Text style={styles.ratingText}>★ {restaurant.ratingAverage}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.toggleBtn} onPress={toggleKitchenStatus}>
          {restaurant.isOpen ? (
            <ToggleRight size={38} color="#22C08A" />
          ) : (
            <ToggleLeft size={38} color="#A8968E" />
          )}
        </TouchableOpacity>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabNav}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'orders' && styles.tabItemActive]}
          onPress={() => setActiveTab('orders')}
        >
          <Bell size={18} color={activeTab === 'orders' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'orders' && styles.tabLabelActive]}>
            Live Orders ({activeOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'menu' && styles.tabItemActive]}
          onPress={() => setActiveTab('menu')}
        >
          <Layers size={18} color={activeTab === 'menu' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'menu' && styles.tabLabelActive]}>Menu Stock</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'kyc' && styles.tabItemActive]}
          onPress={() => setActiveTab('kyc')}
        >
          <ShieldCheck size={18} color={activeTab === 'kyc' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'kyc' && styles.tabLabelActive]}>KYC Docs</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'settlements' && styles.tabItemActive]}
          onPress={() => setActiveTab('settlements')}
        >
          <TrendingUp size={18} color={activeTab === 'settlements' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'settlements' && styles.tabLabelActive]}>Payouts</Text>
        </TouchableOpacity>
      </View>

      {/* Main Content Area */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {activeTab === 'orders' && (
          <View>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Incoming & Active Orders</Text>
              <TouchableOpacity style={styles.soundBadge} onPress={() => syncRestaurantData()} disabled={isSyncing}>
                <Bell size={14} color="#22C08A" />
                <Text style={styles.soundBadgeText}>{isSyncing ? 'Syncing...' : 'Sync Orders'}</Text>
              </TouchableOpacity>
            </View>

            {activeOrders.length === 0 ? (
              <View style={styles.emptyCard}>
                <ChefHat size={48} color="#55303A" />
                <Text style={styles.emptyTitle}>Kitchen Queue Empty</Text>
                <Text style={styles.emptySubtitle}>New customer orders will appear here automatically.</Text>
              </View>
            ) : (
              activeOrders.map(order => (
                <View key={order.id} style={styles.orderCard}>
                  <View style={styles.orderCardTop}>
                    <View>
                      <Text style={styles.orderNumber}>Order #{order.orderNumber}</Text>
                      <Text style={styles.orderCustomer}>{order.customerName}</Text>
                    </View>
                    <View style={styles.timerBadge}>
                      <Clock size={14} color="#F5A623" />
                      <Text style={styles.timerText}>{order.timerSeconds}s</Text>
                    </View>
                  </View>

                  <View style={styles.itemsList}>
                    {order.items.map((item: any, idx: number) => (
                      <View key={idx} style={styles.itemRow}>
                        <Text style={styles.itemQty}>{item.quantity}x</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName}>{item.name}</Text>
                          {item.variant && <Text style={styles.itemVariant}>{item.variant}</Text>}
                          {item.notes && <Text style={styles.itemNotes}>Note: {item.notes}</Text>}
                        </View>
                      </View>
                    ))}
                  </View>

                  <View style={styles.orderCardFooter}>
                    <Text style={styles.orderPrice}>Bill Total: Rs {order.totalAmount.toFixed(2)}</Text>
                    <Text style={styles.pickupCodeText}>Pickup Code: {order.pickupCode}</Text>
                  </View>

                  {(order.status === 'ORDER_PLACED' || order.status === 'ACCEPTED') && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.rejectBtn}
                        onPress={() => pushOrderStatus(order.id, 'CANCELLED')}
                      >
                        <XCircle size={18} color="#E15D5D" />
                        <Text style={styles.rejectBtnText}>Reject</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.acceptBtn}
                        onPress={() => setSelectedOrder(order)}
                      >
                        <CheckCircle2 size={18} color="#FFFFFF" />
                        <Text style={styles.acceptBtnText}>Accept Order</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {order.status === 'PREPARING' && (
                    <View style={styles.prepRow}>
                      <Text style={styles.prepNotice}>Cooking ({order.prepMinutes} mins allocated)</Text>
                      <TouchableOpacity
                        style={styles.readyBtn}
                        onPress={() => markReady(order.id)}
                      >
                        <CheckCircle2 size={16} color="#FFFFFF" />
                        <Text style={styles.readyBtnText}>Food Ready</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {order.status === 'READY_FOR_PICKUP' && (
                    <View style={styles.pickupVerifyRow}>
                      <TextInput
                        style={styles.pickupInput}
                        value={pickupInput}
                        onChangeText={setPickupInput}
                        placeholder="Enter 4-Digit Pickup Code"
                        placeholderTextColor="#8A7A72"
                        keyboardType="number-pad"
                        maxLength={4}
                      />
                      <TouchableOpacity
                        style={styles.verifyPickupBtn}
                        onPress={() => verifyPickup(order.id)}
                      >
                        <Text style={styles.verifyPickupBtnText}>Hand Over</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'menu' && (
          <View>
            <Text style={styles.sectionTitle}>Real-Time Menu Stock Manager</Text>
            <Text style={styles.sectionSubtitle}>Turn dishes out of stock instantly if ingredients run out.</Text>

            {menuItems.map(item => (
              <View key={item.id} style={styles.menuItemCard}>
                <View style={{ flex: 1 }}>
                  <View style={styles.menuItemHeader}>
                    <View style={[styles.vegBadge, { borderColor: item.isVeg ? '#0F8A3C' : '#E23744' }]}>
                      <View style={[styles.vegDot, { backgroundColor: item.isVeg ? '#0F8A3C' : '#E23744' }]} />
                    </View>
                    <Text style={styles.menuItemName}>{item.name}</Text>
                  </View>
                  <Text style={styles.menuItemPrice}>Rs {item.price.toFixed(2)}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.stockToggleBtn, { backgroundColor: item.isAvailable ? '#0A3D2E' : '#5E1F1F' }]}
                  onPress={() => toggleStock(item.id, item.isAvailable)}
                >
                  <Text style={[styles.stockToggleText, { color: item.isAvailable ? '#4ADFA8' : '#EC8080' }]}>
                    {item.isAvailable ? 'In Stock' : 'Out of Stock'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'kyc' && (
          <View>
            <Text style={styles.sectionTitle}>KYC & Legal Documentation</Text>
            <View style={styles.kycStatusCard}>
              <ShieldCheck size={28} color="#22C08A" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.kycStatusTitle}>Status: VERIFIED & ACTIVE</Text>
                <Text style={styles.kycStatusDesc}>FSSAI License #11223344556677 approved by Admin.</Text>
              </View>
            </View>

            <View style={styles.docItemCard}>
              <FileText size={22} color="#A8968E" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.docName}>FSSAI Central Food Safety License</Text>
                <Text style={styles.docNumber}>11223344556677 (Valid till Dec 2028)</Text>
              </View>
              <Text style={styles.verifiedBadge}>Verified</Text>
            </View>

            <View style={styles.docItemCard}>
              <FileText size={22} color="#A8968E" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.docName}>GST Identification Number (GSTIN)</Text>
                <Text style={styles.docNumber}>29ABCDE1234F1Z5</Text>
              </View>
              <Text style={styles.verifiedBadge}>Verified</Text>
            </View>

            <View style={styles.docItemCard}>
              <Store size={22} color="#A8968E" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.docName}>Kitchen Payout Account</Text>
                <Text style={styles.docNumber}>HDFC Bank •••• 9182 (IFSC: HDFC0001234)</Text>
              </View>
              <Text style={styles.verifiedBadge}>Active</Text>
            </View>
          </View>
        )}

        {activeTab === 'settlements' && (
          <View>
            <Text style={styles.sectionTitle}>Settlement & Earnings Ledger</Text>
            <View style={styles.revenueCard}>
              <Text style={styles.revenueLabel}>Today's Net Payout Balance</Text>
              <Text style={styles.revenueAmount}>Rs 4,122.50</Text>
              <Text style={styles.revenueSub}>Gross Sales: Rs 4,850.00 (-15% Platform Commission)</Text>
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>14</Text>
                <Text style={styles.statLabel}>Orders Today</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>18m</Text>
                <Text style={styles.statLabel}>Avg Prep Time</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber}>100%</Text>
                <Text style={styles.statLabel}>Acceptance Rate</Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Prep Time Selection Modal */}
      <Modal visible={!!selectedOrder} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Declare Preparation Time</Text>
            <Text style={styles.modalSubtitle}>How long will it take to prepare this meal?</Text>

            <View style={styles.prepBtnRow}>
              {[15, 25, 40].map(mins => (
                <TouchableOpacity
                  key={mins}
                  style={[styles.prepOptionBtn, prepMinutes === mins && styles.prepOptionBtnActive]}
                  onPress={() => setPrepMinutes(mins)}
                >
                  <Clock size={20} color={prepMinutes === mins ? '#FFFFFF' : '#F5A623'} />
                  <Text style={[styles.prepOptionText, prepMinutes === mins && styles.prepOptionTextActive]}>
                    {mins} Mins
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.confirmAcceptBtn}
              onPress={() => acceptOrder(selectedOrder.id, prepMinutes)}
            >
              <Text style={styles.confirmAcceptText}>Confirm & Start Cooking</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelModalBtn} onPress={() => setSelectedOrder(null)}>
              <Text style={styles.cancelModalText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authContainer: { flex: 1, backgroundColor: '#17090E', justifyContent: 'center', padding: 24 },
  authCard: { backgroundColor: '#26111A', borderRadius: 24, padding: 28, borderWidth: 1, borderColor: '#3E1E28' },
  authHeader: { alignItems: 'center', marginBottom: 28 },
  brandIconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#3E1E28', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  authTitle: { fontSize: 24, fontWeight: '800', color: '#FBF3EE' },
  authSubtitle: { fontSize: 14, color: '#A8968E', marginTop: 4 },
  inputGroup: { marginBottom: 18 },
  inputLabel: { fontSize: 13, color: '#D8C9C0', marginBottom: 8, fontWeight: '600' },
  textInput: { backgroundColor: '#17090E', borderRadius: 14, height: 50, paddingHorizontal: 16, color: '#FBF3EE', fontSize: 15, borderWidth: 1, borderColor: '#3E1E28' },
  loginBtn: { backgroundColor: '#F5A623', borderRadius: 14, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  loginBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  demoPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#3E1E28', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, marginTop: 20, alignSelf: 'center' },
  demoPillText: { color: '#D8C9C0', fontSize: 12, marginLeft: 6 },
  mainContainer: { flex: 1, backgroundColor: '#17090E' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#26111A' },
  storeName: { fontSize: 20, fontWeight: '800', color: '#FBF3EE' },
  storeMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 13, color: '#A8968E', marginRight: 12 },
  ratingText: { fontSize: 13, color: '#E08E0B', fontWeight: '700' },
  toggleBtn: { padding: 4 },
  tabNav: { flexDirection: 'row', backgroundColor: '#26111A', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#3E1E28' },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 6 },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: '#F5A623' },
  tabLabel: { fontSize: 12, color: '#A8968E', fontWeight: '600' },
  tabLabelActive: { color: '#F5A623', fontWeight: '700' },
  scrollArea: { flex: 1 },
  scrollContent: { padding: 20 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#FBF3EE' },
  sectionSubtitle: { fontSize: 13, color: '#A8968E', marginTop: 4, marginBottom: 16 },
  soundBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A3D2E', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 4 },
  soundBadgeText: { color: '#4ADFA8', fontSize: 11, fontWeight: '700' },
  emptyCard: { backgroundColor: '#26111A', borderRadius: 20, padding: 36, alignItems: 'center', borderWidth: 1, borderColor: '#3E1E28' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#FBF3EE', marginTop: 12 },
  emptySubtitle: { fontSize: 13, color: '#A8968E', marginTop: 4, textAlign: 'center' },
  orderCard: { backgroundColor: '#26111A', borderRadius: 20, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: '#3E1E28' },
  orderCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: '#3E1E28', paddingBottom: 12 },
  orderNumber: { fontSize: 16, fontWeight: '800', color: '#FBF3EE' },
  orderCustomer: { fontSize: 13, color: '#A8968E', marginTop: 2 },
  timerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#451A03', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  timerText: { color: '#FB923C', fontSize: 12, fontWeight: '700' },
  itemsList: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#3E1E28' },
  itemRow: { flexDirection: 'row', marginBottom: 8 },
  itemQty: { fontSize: 14, fontWeight: '700', color: '#F5A623', width: 28 },
  itemName: { fontSize: 14, fontWeight: '600', color: '#FBF3EE' },
  itemVariant: { fontSize: 12, color: '#A8968E' },
  itemNotes: { fontSize: 12, color: '#E08E0B', fontStyle: 'italic' },
  orderCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  orderPrice: { fontSize: 15, fontWeight: '800', color: '#FBF3EE' },
  pickupCodeText: { fontSize: 12, color: '#38BDF8', fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#450A0A', borderRadius: 12, height: 44, gap: 6 },
  rejectBtnText: { color: '#EC8080', fontWeight: '700', fontSize: 14 },
  acceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#22C08A', borderRadius: 12, height: 44, gap: 6 },
  acceptBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  prepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, backgroundColor: '#17090E', padding: 12, borderRadius: 12 },
  prepNotice: { color: '#E08E0B', fontSize: 13, fontWeight: '600' },
  readyBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0284C7', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, gap: 6 },
  readyBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  pickupVerifyRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  pickupInput: { flex: 1, backgroundColor: '#17090E', height: 44, borderRadius: 10, paddingHorizontal: 14, color: '#FFFFFF', fontSize: 14, borderWidth: 1, borderColor: '#3E1E28' },
  verifyPickupBtn: { backgroundColor: '#22C08A', paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  verifyPickupBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  menuItemCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#26111A', padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: '#3E1E28' },
  menuItemHeader: { flexDirection: 'row', alignItems: 'center' },
  vegBadge: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 3, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  menuItemName: { fontSize: 15, fontWeight: '700', color: '#FBF3EE' },
  menuItemPrice: { fontSize: 13, color: '#A8968E', marginTop: 2 },
  stockToggleBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  stockToggleText: { fontSize: 12, fontWeight: '700' },
  kycStatusCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A3D2E', padding: 16, borderRadius: 16, marginBottom: 16 },
  kycStatusTitle: { fontSize: 15, fontWeight: '800', color: '#4ADFA8' },
  kycStatusDesc: { fontSize: 12, color: '#A7F3D0', marginTop: 2 },
  docItemCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#26111A', padding: 16, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: '#3E1E28' },
  docName: { fontSize: 14, fontWeight: '700', color: '#FBF3EE' },
  docNumber: { fontSize: 12, color: '#A8968E', marginTop: 2 },
  verifiedBadge: { backgroundColor: '#0A3D2E', color: '#4ADFA8', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  revenueCard: { backgroundColor: '#26111A', borderRadius: 20, padding: 22, marginBottom: 16, borderWidth: 1, borderColor: '#3E1E28' },
  revenueLabel: { fontSize: 13, color: '#A8968E', fontWeight: '600' },
  revenueAmount: { fontSize: 32, fontWeight: '800', color: '#22C08A', marginVertical: 6 },
  revenueSub: { fontSize: 12, color: '#8A7A72' },
  statsGrid: { flexDirection: 'row', gap: 12 },
  statBox: { flex: 1, backgroundColor: '#26111A', padding: 16, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3E1E28' },
  statNumber: { fontSize: 20, fontWeight: '800', color: '#FBF3EE' },
  statLabel: { fontSize: 11, color: '#A8968E', marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#26111A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#FBF3EE' },
  modalSubtitle: { fontSize: 13, color: '#A8968E', marginTop: 4, marginBottom: 20 },
  prepBtnRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  prepOptionBtn: { flex: 1, backgroundColor: '#17090E', paddingVertical: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: '#3E1E28', gap: 6 },
  prepOptionBtnActive: { backgroundColor: '#F5A623', borderColor: '#F5A623' },
  prepOptionText: { fontSize: 14, fontWeight: '700', color: '#F5A623' },
  prepOptionTextActive: { color: '#FFFFFF' },
  confirmAcceptBtn: { backgroundColor: '#22C08A', height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  confirmAcceptText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  cancelModalBtn: { height: 44, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  cancelModalText: { color: '#A8968E', fontSize: 14 }
});
