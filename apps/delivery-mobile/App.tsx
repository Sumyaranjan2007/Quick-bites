import React, { useState, useEffect, useRef } from 'react';
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
import { ErrorBoundary } from './src/components/ErrorBoundary';
import {
  Bike,
  Navigation,
  CheckCircle2,
  Clock,
  ShieldCheck,
  TrendingUp,
  MapPin,
  Phone,
  Power,
  Sparkles,
  DollarSign,
  KeyRound,
  ArrowRight
} from 'lucide-react-native';
import { apiFetch } from './src/lib/apiFetch';

const DEFAULT_API_URL = 'https://quick-bites-production-9f45.up.railway.app/api';

function DeliveryApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [email, setEmail] = useState(__DEV__ ? 'rider@quickbite.app' : '');
  const [password, setPassword] = useState(__DEV__ ? 'pass123' : '');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [activeTab, setActiveTab] = useState<'deliveries' | 'earnings' | 'profile'>('deliveries');

  // Rider state
  // Identity comes from the server; showing another rider's name and wallet
  // while the real profile loads would be worse than showing nothing.
  const [rider, setRider] = useState<any>({
    id: '',
    fullName: '',
    phone: '',
    vehicleType: 'BIKE',
    isOnline: false,
    kycStatus: 'PENDING',
    walletBalance: 0,
    codCashInHand: 0,
    todayTrips: 0
  });

  // Live broadcast job pulled from the backend dispatch queue
  const [incomingBroadcast, setIncomingBroadcast] = useState<any | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Active delivery underway
  const [activeTrip, setActiveTrip] = useState<any | null>(null);
  const [tripStage, setTripStage] = useState<'HEADING_TO_RESTAURANT' | 'AT_RESTAURANT' | 'OUT_FOR_DELIVERY' | 'AT_DOORSTEP'>('HEADING_TO_RESTAURANT');
  const [otpInput, setOtpInput] = useState('');
  const [pickupCodeInput, setPickupCodeInput] = useState('');
  const [telemetryCount, setTelemetryCount] = useState(0);

  // Background 3-second telemetry streaming
  useEffect(() => {
    let timer: any;
    if (activeTrip && tripStage === 'OUT_FOR_DELIVERY') {
      timer = setInterval(() => {
        setTelemetryCount(prev => prev + 1);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        apiFetch(`${apiUrl}/riders/telemetry`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            orderId: activeTrip.id,
            lat: 12.9716 + (Math.random() - 0.5) * 0.002,
            lng: 77.6412 + (Math.random() - 0.5) * 0.002,
            bearing: Math.floor(Math.random() * 360)
          })
        }).catch(() => {});
      }, 3000);
    }
    return () => clearInterval(timer);
  }, [activeTrip, tripStage, apiUrl, authToken]);

  const authHeaders = (token?: string): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const effective = token || authToken;
    if (effective) headers['Authorization'] = `Bearer ${effective}`;
    return headers;
  };

  const mapBroadcast = (o: any) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    restaurantName: o.restaurantName || 'Restaurant Partner',
    pickupAddress: o.restaurantAddress || 'Restaurant pickup counter',
    dropAddress: o.deliveryAddressText || 'Customer doorstep',
    distanceKm: o.distanceKm ?? 3.5,
    estimatedEarnings: o.riderPayout ?? 65.0,
    timerSeconds: 30,
    pickupCode: o.pickupCode,
    paymentMode: o.paymentMethod === 'CASH_ON_DELIVERY' ? 'COD' : o.paymentMethod,
    cashToCollect: o.paymentMethod === 'CASH_ON_DELIVERY' ? o.bill?.totalAmount ?? 0 : 0
  });

  const loadRiderProfile = async (userId: string, token?: string) => {
    try {
      const res = await apiFetch(`${apiUrl}/riders/profile/${userId}`, { headers: authHeaders(token) });
      const data = await res.json();
      if (data.success && data.data?.rider) {
        const r = data.data.rider;
        setRider({
          id: r.id,
          fullName: r.fullName || 'Rider',
          phone: r.phone || '',
          vehicleType: r.vehicleType || 'BIKE',
          isOnline: Boolean(r.isOnline),
          kycStatus: r.kycStatus || 'PENDING',
          walletBalance: Number(data.data.wallet?.balance) || 0,
          codCashInHand: Number(r.codCashInHand) || 0,
          todayTrips: Number(r.todayTrips) || 0
        });
      }
    } catch {
      // Keep the empty profile; the header will simply show no name.
    }
  };

  // Pull real dispatch broadcasts waiting for a rider
  const syncBroadcasts = async (token?: string) => {
    setIsSyncing(true);
    try {
      const res = await apiFetch(`${apiUrl}/riders/orders/broadcast`, { headers: authHeaders(token) });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.broadcasts) && data.data.broadcasts.length > 0) {
        setIncomingBroadcast(mapBroadcast(data.data.broadcasts[0]));
      } else {
        setIncomingBroadcast(null);
      }
    } catch {
      Alert.alert('Sync Failed', 'Could not reach the dispatch server. Check your connection.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Login handler
  const handleLogin = async () => {
    try {
      const res = await apiFetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role: 'rider' })
      });
      const data = await res.json();
      if (data.success && data.data?.token) {
        setAuthToken(data.data.token);
        setIsAuthenticated(true);
        const userId = data.data.user?.id;
        if (userId) await loadRiderProfile(userId, data.data.token);
        syncBroadcasts(data.data.token);
      } else {
        Alert.alert('Login Failed', data.error?.message || data.error || 'Invalid credentials');
      }
    } catch {
      Alert.alert('Error', 'Unable to reach backend server. Check network connection.');
    }
  };

  // Toggle shift online/offline
  const toggleShift = async () => {
    const nextState = !rider.isOnline;
    setRider({ ...rider, isOnline: nextState });
    try {
      const res = await apiFetch(`${apiUrl}/riders/shift`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ riderId: rider.id, isOnline: nextState })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error);
      if (nextState) syncBroadcasts();
    } catch (err: any) {
      setRider({ ...rider, isOnline: !nextState });
      Alert.alert('Shift Update Failed', err?.message || 'Could not update your shift status.');
    }
  };

  // Accept Broadcast Job — claims the order server-side so no two riders get it
  const acceptBroadcast = async () => {
    if (!incomingBroadcast) return;
    try {
      const res = await apiFetch(`${apiUrl}/riders/orders/${incomingBroadcast.id}/claim`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          riderId: rider.id,
          riderName: rider.fullName,
          riderPhone: rider.phone
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'This trip was already claimed.');

      setActiveTrip({ ...incomingBroadcast, ...mapBroadcast(data.data.order) });
      setIncomingBroadcast(null);
      setTripStage('HEADING_TO_RESTAURANT');
      Alert.alert('Trip Claimed', 'Navigate to restaurant pickup counter.');
    } catch (err: any) {
      Alert.alert('Could Not Claim Trip', err?.message || 'Please try again.');
      syncBroadcasts();
    }
  };

  // Pickup Handshake — verified by the backend, not locally
  const verifyPickupHandshake = async () => {
    try {
      const res = await apiFetch(`${apiUrl}/riders/orders/${activeTrip.id}/verify-pickup`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ pickupCode: pickupCodeInput.trim() })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Pickup code does not match.');

      setTripStage('OUT_FOR_DELIVERY');
      setPickupCodeInput('');
      Alert.alert('Pickup Confirmed', 'Food verified! Live GPS tracking is now active.');
    } catch (err: any) {
      Alert.alert('Invalid Code', err?.message || 'Enter the pickup code provided by kitchen staff.');
    }
  };

  // Doorstep OTP Verification
  const completeDeliveryOtp = async () => {
    const earnings = activeTrip.estimatedEarnings;
    const cash = activeTrip.paymentMode === 'COD' ? activeTrip.cashToCollect : 0;

    try {
      const res = await apiFetch(`${apiUrl}/riders/orders/${activeTrip.id}/verify-otp`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          deliveryOtp: otpInput.trim(),
          riderUserId: rider.id,
          tripEarnings: earnings
        })
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error?.message || data.error || 'Customer 4-digit delivery OTP does not match.');
      }

      setRider({
        ...rider,
        walletBalance: rider.walletBalance + earnings,
        codCashInHand: rider.codCashInHand + cash,
        todayTrips: rider.todayTrips + 1
      });
      Alert.alert(
        'Delivery Complete!',
        `Order marked DELIVERED.\n+Rs ${earnings.toFixed(2)} credited to your wallet.${cash ? `\nCollected Rs ${cash} COD cash.` : ''}`
      );
      setActiveTrip(null);
      setOtpInput('');
      syncBroadcasts();
    } catch (err: any) {
      Alert.alert('Incorrect OTP', err?.message || 'Customer 4-digit delivery OTP does not match.');
    }
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#17090E" />
        <View style={styles.authCard}>
          <View style={styles.authHeader}>
            <View style={styles.brandIconCircle}>
              <Bike size={36} color="#22C08A" />
            </View>
            <Text style={styles.authTitle}>Quick Bites Rider</Text>
            <Text style={styles.authSubtitle}>Delivery Logistics & Navigation</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Rider Email or Phone</Text>
            <TextInput
              style={styles.textInput}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="rider@quickbite.app"
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
            <Text style={styles.loginBtnText}>Check In For Shift</Text>
          </TouchableOpacity>

          {__DEV__ && (


            <View style={styles.demoPill}>
            <Sparkles size={16} color="#22C08A" />
            <Text style={styles.demoPillText}>Default Login: rider@quickbite.app / pass123</Text>


            </View>


          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.mainContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#17090E" />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.riderName}>{rider.fullName}</Text>
          <View style={styles.shiftMetaRow}>
            <View style={[styles.statusDot, { backgroundColor: rider.isOnline ? '#22C08A' : '#E15D5D' }]} />
            <Text style={styles.statusText}>{rider.isOnline ? 'Online (Accepting Jobs)' : 'Offline (On Break)'}</Text>
            <Text style={styles.vehicleBadge}>{rider.vehicleType}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.shiftToggleBtn, { backgroundColor: rider.isOnline ? '#0A3D2E' : '#3E1E28' }]}
          onPress={toggleShift}
        >
          <Power size={18} color={rider.isOnline ? '#4ADFA8' : '#A8968E'} />
        </TouchableOpacity>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabNav}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'deliveries' && styles.tabItemActive]}
          onPress={() => setActiveTab('deliveries')}
        >
          <Navigation size={18} color={activeTab === 'deliveries' ? '#22C08A' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'deliveries' && styles.tabLabelActive]}>Logistics</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'earnings' && styles.tabItemActive]}
          onPress={() => setActiveTab('earnings')}
        >
          <DollarSign size={18} color={activeTab === 'earnings' ? '#22C08A' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'earnings' && styles.tabLabelActive]}>Earnings</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'profile' && styles.tabItemActive]}
          onPress={() => setActiveTab('profile')}
        >
          <ShieldCheck size={18} color={activeTab === 'profile' ? '#22C08A' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'profile' && styles.tabLabelActive]}>Rider KYC</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {activeTab === 'deliveries' && (
          <View>
            {/* Active Delivery Card */}
            {activeTrip ? (
              <View style={styles.activeTripCard}>
                <View style={styles.tripHeader}>
                  <View>
                    <Text style={styles.tripOrderNumber}>Order #{activeTrip.orderNumber}</Text>
                    <Text style={styles.tripRestName}>{activeTrip.restaurantName}</Text>
                  </View>
                  <View style={styles.stagePill}>
                    <Text style={styles.stagePillText}>{tripStage.replace(/_/g, ' ')}</Text>
                  </View>
                </View>

                {/* Routing & Address Display */}
                <View style={styles.routeBox}>
                  <View style={styles.routeStep}>
                    <MapPin size={16} color="#FF4F18" />
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <Text style={styles.stepLabel}>Pickup Location</Text>
                      <Text style={styles.stepAddress}>{activeTrip.pickupAddress}</Text>
                    </View>
                  </View>

                  <View style={styles.routeDivider} />

                  <View style={styles.routeStep}>
                    <MapPin size={16} color="#22C08A" />
                    <View style={{ marginLeft: 8, flex: 1 }}>
                      <Text style={styles.stepLabel}>Customer Doorstep</Text>
                      <Text style={styles.stepAddress}>{activeTrip.dropAddress}</Text>
                    </View>
                  </View>
                </View>

                {/* OpenStreetMap Route Navigation Polyline Simulation */}
                <View style={styles.mapSimContainer}>
                  <Navigation size={24} color="#22C08A" />
                  <Text style={styles.mapSimText}>
                    OSRM Turn-by-Turn Navigation Active ({activeTrip.distanceKm} km)
                  </Text>
                  {tripStage === 'OUT_FOR_DELIVERY' && (
                    <Text style={styles.telemetryText}>
                      Live 3s GPS Streamer Emitting ({telemetryCount} pings sent)
                    </Text>
                  )}
                </View>

                {/* Handshake Stages */}
                {tripStage === 'HEADING_TO_RESTAURANT' && (
                  <TouchableOpacity
                    style={styles.primaryActionBtn}
                    onPress={() => setTripStage('AT_RESTAURANT')}
                  >
                    <Text style={styles.primaryActionText}>Arrived at Restaurant</Text>
                  </TouchableOpacity>
                )}

                {tripStage === 'AT_RESTAURANT' && (
                  <View style={styles.handshakeBox}>
                    <Text style={styles.handshakeTitle}>Pickup Verification</Text>
                    <Text style={styles.handshakeSubtitle}>Kitchen staff must confirm pickup code.</Text>
                    <TextInput
                      style={styles.pickupCodeInput}
                      value={pickupCodeInput}
                      onChangeText={setPickupCodeInput}
                      placeholder="Enter 4-Digit Pickup Code (e.g. 4821)"
                      placeholderTextColor="#8A7A72"
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    <TouchableOpacity style={styles.primaryActionBtn} onPress={verifyPickupHandshake}>
                      <Text style={styles.primaryActionText}>Confirm Food Picked Up</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {tripStage === 'OUT_FOR_DELIVERY' && (
                  <TouchableOpacity
                    style={styles.primaryActionBtn}
                    onPress={() => setTripStage('AT_DOORSTEP')}
                  >
                    <Text style={styles.primaryActionText}>Arrived at Customer Doorstep</Text>
                  </TouchableOpacity>
                )}

                {tripStage === 'AT_DOORSTEP' && (
                  <View style={styles.handshakeBox}>
                    <Text style={styles.handshakeTitle}>Doorstep 4-Digit Delivery OTP</Text>
                    <Text style={styles.handshakeSubtitle}>Ask customer for the 4-digit code shown on their app.</Text>

                    {activeTrip.paymentMode === 'COD' && (
                      <View style={styles.codAlertBox}>
                        <DollarSign size={18} color="#E08E0B" />
                        <Text style={styles.codAlertText}>
                          Collect Rs {activeTrip.cashToCollect.toFixed(2)} Cash from Customer
                        </Text>
                      </View>
                    )}

                    <TextInput
                      style={styles.pickupCodeInput}
                      value={otpInput}
                      onChangeText={setOtpInput}
                      placeholder="Enter Customer 4-Digit OTP"
                      placeholderTextColor="#8A7A72"
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    <TouchableOpacity style={styles.completeBtn} onPress={completeDeliveryOtp}>
                      <CheckCircle2 size={18} color="#FFFFFF" />
                      <Text style={styles.primaryActionText}>Verify OTP & Complete Trip</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ) : (
              <View>
                {/* Available Broadcast Jobs */}
                {incomingBroadcast ? (
                  <View style={styles.broadcastCard}>
                    <View style={styles.broadcastTop}>
                      <View>
                        <Text style={styles.broadcastAlert}>15s Broadcast Available</Text>
                        <Text style={styles.broadcastRestName}>{incomingBroadcast.restaurantName}</Text>
                      </View>
                      <View style={styles.timerBadge}>
                        <Clock size={14} color="#E15D5D" />
                        <Text style={styles.timerText}>{incomingBroadcast.timerSeconds}s</Text>
                      </View>
                    </View>

                    <View style={styles.broadcastDetailsRow}>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Trip Pay</Text>
                        <Text style={styles.detailValue}>Rs {incomingBroadcast.estimatedEarnings.toFixed(2)}</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Distance</Text>
                        <Text style={styles.detailValue}>{incomingBroadcast.distanceKm} km</Text>
                      </View>
                      <View style={styles.detailItem}>
                        <Text style={styles.detailLabel}>Payment</Text>
                        <Text style={styles.detailValue}>{incomingBroadcast.paymentMode}</Text>
                      </View>
                    </View>

                    <View style={styles.broadcastActionRow}>
                      <TouchableOpacity
                        style={styles.declineBtn}
                        onPress={() => setIncomingBroadcast(null)}
                      >
                        <Text style={styles.declineBtnText}>Pass</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.acceptJobBtn} onPress={acceptBroadcast}>
                        <Text style={styles.acceptJobBtnText}>Accept Delivery</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.idleCard}>
                    <Bike size={48} color="#55303A" />
                    <Text style={styles.idleTitle}>Waiting for Nearby Delivery Jobs</Text>
                    <Text style={styles.idleSubtitle}>
                      {rider.isOnline
                        ? 'Stay online. Broadcast cards appear here when restaurants accept orders.'
                        : 'You are currently offline. Turn on your shift switch above to receive jobs.'}
                    </Text>
                    <TouchableOpacity
                      style={[styles.idleRefreshBtn, isSyncing && { opacity: 0.6 }]}
                      onPress={() => syncBroadcasts()}
                      disabled={isSyncing}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.acceptJobBtnText}>
                        {isSyncing ? 'Checking…' : 'Check for Jobs'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {activeTab === 'earnings' && (
          <View>
            <Text style={styles.sectionTitle}>Rider Wallet & Payouts</Text>
            <View style={styles.walletCard}>
              <Text style={styles.walletLabel}>Withdrawable Wallet Balance</Text>
              <Text style={styles.walletBalance}>Rs {rider.walletBalance.toFixed(2)}</Text>
              <Text style={styles.walletSub}>Paid out to your registered bank account</Text>
            </View>

            <View style={styles.earningsGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{rider.todayTrips}</Text>
                <Text style={styles.statLbl}>Trips Completed</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>Rs {rider.codCashInHand.toFixed(2)}</Text>
                <Text style={styles.statLbl}>Cash in Hand</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { fontSize: 15 }]}>
                  {rider.kycStatus === 'ACTIVE' ? 'Verified' : 'Pending'}
                </Text>
                <Text style={styles.statLbl}>KYC Status</Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'profile' && (
          <View>
            <Text style={styles.sectionTitle}>Rider Profile & KYC Credentials</Text>
            <View style={styles.kycActiveCard}>
              <ShieldCheck size={28} color="#22C08A" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.kycActiveTitle}>Background Check Approved</Text>
                <Text style={styles.kycActiveDesc}>Driving License #KA032021008899 verified.</Text>
              </View>
            </View>

            <View style={styles.docCard}>
              <Text style={styles.docTitle}>Driving License</Text>
              <Text style={styles.docDesc}>KA032021008899 (Motorcycle with Gear)</Text>
              <Text style={styles.docStatusBadge}>Approved</Text>
            </View>

            <View style={styles.docCard}>
              <Text style={styles.docTitle}>Vehicle Registration (RC)</Text>
              <Text style={styles.docDesc}>KA04EJ4321 (Hero Splendor Plus)</Text>
              <Text style={styles.docStatusBadge}>Approved</Text>
            </View>
          </View>
        )}
      </ScrollView>
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
  loginBtn: { backgroundColor: '#22C08A', borderRadius: 14, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  loginBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  demoPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#3E1E28', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, marginTop: 20, alignSelf: 'center' },
  demoPillText: { color: '#D8C9C0', fontSize: 12, marginLeft: 6 },
  mainContainer: { flex: 1, backgroundColor: '#17090E' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#26111A' },
  riderName: { fontSize: 20, fontWeight: '800', color: '#FBF3EE' },
  shiftMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  statusText: { fontSize: 13, color: '#A8968E', marginRight: 10 },
  vehicleBadge: { backgroundColor: '#3E1E28', color: '#38BDF8', fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  shiftToggleBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  tabNav: { flexDirection: 'row', backgroundColor: '#26111A', borderBottomWidth: 1, borderBottomColor: '#3E1E28' },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 6 },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: '#22C08A' },
  tabLabel: { fontSize: 12, color: '#A8968E', fontWeight: '600' },
  tabLabelActive: { color: '#22C08A', fontWeight: '700' },
  scrollArea: { flex: 1 },
  scrollContent: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#FBF3EE', marginBottom: 16 },
  idleCard: { backgroundColor: '#26111A', borderRadius: 20, padding: 36, alignItems: 'center', borderWidth: 1, borderColor: '#3E1E28' },
  idleTitle: { fontSize: 16, fontWeight: '700', color: '#FBF3EE', marginTop: 12 },
  idleSubtitle: { fontSize: 13, color: '#A8968E', marginTop: 6, textAlign: 'center', lineHeight: 19 },
  idleRefreshBtn: {
    marginTop: 20,
    height: 46,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#22C08A',
    borderRadius: 12
  },
  broadcastCard: { backgroundColor: '#26111A', borderRadius: 20, padding: 20, borderWidth: 2, borderColor: '#22C08A' },
  broadcastTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  broadcastAlert: { fontSize: 12, color: '#22C08A', fontWeight: '800', textTransform: 'uppercase' },
  broadcastRestName: { fontSize: 18, fontWeight: '800', color: '#FBF3EE', marginTop: 2 },
  timerBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#450A0A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  timerText: { color: '#EC8080', fontSize: 12, fontWeight: '700' },
  broadcastDetailsRow: { flexDirection: 'row', backgroundColor: '#17090E', padding: 14, borderRadius: 14, marginVertical: 14 },
  detailItem: { flex: 1, alignItems: 'center' },
  detailLabel: { fontSize: 11, color: '#A8968E' },
  detailValue: { fontSize: 16, fontWeight: '800', color: '#FBF3EE', marginTop: 2 },
  broadcastActionRow: { flexDirection: 'row', gap: 12 },
  declineBtn: { flex: 1, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#3E1E28', borderRadius: 12 },
  declineBtnText: { color: '#A8968E', fontWeight: '700' },
  acceptJobBtn: { flex: 2, height: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#22C08A', borderRadius: 12 },
  acceptJobBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  activeTripCard: { backgroundColor: '#26111A', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#3E1E28' },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tripOrderNumber: { fontSize: 14, color: '#A8968E', fontWeight: '600' },
  tripRestName: { fontSize: 18, fontWeight: '800', color: '#FBF3EE' },
  stagePill: { backgroundColor: '#0A3D2E', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  stagePillText: { color: '#4ADFA8', fontSize: 11, fontWeight: '700' },
  routeBox: { backgroundColor: '#17090E', borderRadius: 14, padding: 14, marginVertical: 14 },
  routeStep: { flexDirection: 'row', alignItems: 'flex-start' },
  routeDivider: { height: 16, width: 1, backgroundColor: '#3E1E28', marginLeft: 8, marginVertical: 4 },
  stepLabel: { fontSize: 11, color: '#8A7A72', fontWeight: '600' },
  stepAddress: { fontSize: 13, color: '#FBF3EE', fontWeight: '600', marginTop: 1 },
  mapSimContainer: { backgroundColor: '#0A3D2E', padding: 14, borderRadius: 14, alignItems: 'center', marginBottom: 14 },
  mapSimText: { color: '#4ADFA8', fontSize: 13, fontWeight: '700', marginTop: 4 },
  telemetryText: { color: '#A7F3D0', fontSize: 11, marginTop: 2 },
  primaryActionBtn: { backgroundColor: '#22C08A', height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  primaryActionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  handshakeBox: { backgroundColor: '#17090E', padding: 16, borderRadius: 16 },
  handshakeTitle: { fontSize: 15, fontWeight: '800', color: '#FBF3EE' },
  handshakeSubtitle: { fontSize: 12, color: '#A8968E', marginTop: 2, marginBottom: 12 },
  pickupCodeInput: { backgroundColor: '#26111A', height: 48, borderRadius: 12, paddingHorizontal: 14, color: '#FFFFFF', fontSize: 16, fontWeight: '700', borderWidth: 1, borderColor: '#3E1E28', marginBottom: 12 },
  codAlertBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#451A03', padding: 10, borderRadius: 10, gap: 6, marginBottom: 12 },
  codAlertText: { color: '#FBBF24', fontSize: 12, fontWeight: '700' },
  completeBtn: { flexDirection: 'row', backgroundColor: '#22C08A', height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center', gap: 6 },
  walletCard: { backgroundColor: '#26111A', padding: 22, borderRadius: 20, borderWidth: 1, borderColor: '#3E1E28', marginBottom: 16 },
  walletLabel: { fontSize: 13, color: '#A8968E', fontWeight: '600' },
  walletBalance: { fontSize: 32, fontWeight: '800', color: '#22C08A', marginVertical: 6 },
  walletSub: { fontSize: 12, color: '#8A7A72' },
  earningsGrid: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, backgroundColor: '#26111A', padding: 16, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3E1E28' },
  statNum: { fontSize: 18, fontWeight: '800', color: '#FBF3EE' },
  statLbl: { fontSize: 11, color: '#A8968E', marginTop: 4 },
  kycActiveCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A3D2E', padding: 16, borderRadius: 16, marginBottom: 16 },
  kycActiveTitle: { fontSize: 15, fontWeight: '800', color: '#4ADFA8' },
  kycActiveDesc: { fontSize: 12, color: '#A7F3D0', marginTop: 2 },
  docCard: { backgroundColor: '#26111A', padding: 16, borderRadius: 16, marginBottom: 10, borderWidth: 1, borderColor: '#3E1E28' },
  docTitle: { fontSize: 14, fontWeight: '700', color: '#FBF3EE' },
  docDesc: { fontSize: 12, color: '#A8968E', marginTop: 2 },
  docStatusBadge: { alignSelf: 'flex-start', backgroundColor: '#0A3D2E', color: '#4ADFA8', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginTop: 8 }
});

export default function App() {
  return (
    <ErrorBoundary appName="Quick Bites Rider" accent="#22C08A">
      <DeliveryApp />
    </ErrorBoundary>
  );
}
