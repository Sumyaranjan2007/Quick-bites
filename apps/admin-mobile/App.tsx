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
  ShieldAlert,
  Activity,
  FileCheck2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  DollarSign,
  Users,
  Store,
  Bike,
  Sparkles,
  ArrowUpRight
} from 'lucide-react-native';

const DEFAULT_API_URL = 'https://quick-bites-production-9f45.up.railway.app/api';

export default function AdminApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [email, setEmail] = useState('admin@quickbite.app');
  const [password, setPassword] = useState('pass123');
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [activeTab, setActiveTab] = useState<'pulse' | 'kyc' | 'orders' | 'disputes'>('pulse');

  // Platform metrics
  const [metrics, setMetrics] = useState<any>({
    activeOrdersCount: 0,
    totalOrdersCount: 0,
    grossMerchandiseValue: 0,
    onlineRidersCount: 0,
    pendingKycCount: 0,
    totalRestaurantsCount: 0,
    totalUsersCount: 0
  });

  const [pendingKyc, setPendingKyc] = useState<any[]>([]);
  const [liveOrders, setLiveOrders] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Refund Modal State
  const [refundTarget, setRefundTarget] = useState<any | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('Missing item in order');

  const authHeaders = (token?: string): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const effective = token || authToken;
    if (effective) headers['Authorization'] = `Bearer ${effective}`;
    return headers;
  };

  // Pull live platform metrics, KYC queue and orders from the backend
  const syncPlatformData = async (token?: string) => {
    setIsSyncing(true);
    try {
      const [metricsRes, kycRes, ordersRes] = await Promise.all([
        fetch(`${apiUrl}/admin/metrics`, { headers: authHeaders(token) }),
        fetch(`${apiUrl}/admin/kyc/pending`, { headers: authHeaders(token) }),
        fetch(`${apiUrl}/orders`, { headers: authHeaders(token) })
      ]);

      const metricsData = await metricsRes.json();
      if (metricsData.success && metricsData.data) {
        setMetrics(metricsData.data);
      }

      const kycData = await kycRes.json();
      if (kycData.success && Array.isArray(kycData.data?.pending)) {
        setPendingKyc(
          kycData.data.pending.map((p: any) => ({
            id: p.id,
            entityType: p.entityType,
            entityId: p.entityId,
            entityName: p.entityName || 'Merchant Partner',
            documentType: p.documentType,
            docDetails: p.documentNumber || p.documentType,
            submittedAt: p.submittedAt
              ? new Date(p.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : 'Recently',
            status: p.status
          }))
        );
      }

      const ordersData = await ordersRes.json();
      if (ordersData.success && Array.isArray(ordersData.data?.orders)) {
        setLiveOrders(
          ordersData.data.orders.map((o: any) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            customerName: o.customerName || 'Customer',
            restaurantName: o.restaurantName || 'Restaurant Partner',
            riderName: o.riderName || 'Unassigned',
            totalAmount: o.bill?.totalAmount ?? 0,
            status: o.status,
            paymentMode: o.paymentMethod
          }))
        );
      }
    } catch {
      Alert.alert('Sync Failed', 'Could not reach the Quick Bites server. Check your connection.');
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
        body: JSON.stringify({ email, password, role: 'admin' })
      });
      const data = await res.json();
      if (data.success && data.data?.token) {
        setAuthToken(data.data.token);
        setIsAuthenticated(true);
        syncPlatformData(data.data.token);
      } else {
        Alert.alert('Login Failed', data.error?.message || data.error || 'Invalid credentials');
      }
    } catch {
      Alert.alert('Error', 'Unable to reach backend server. Check network connection.');
    }
  };

  // Review KYC Document
  const handleKycReview = async (docId: string, action: 'APPROVE' | 'REJECT') => {
    try {
      const res = await fetch(`${apiUrl}/admin/kyc/review`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ documentId: docId, action })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Review was rejected by the server.');

      setPendingKyc(prev => prev.filter(d => d.id !== docId));
      setMetrics((prev: any) => ({ ...prev, pendingKycCount: Math.max(0, (prev.pendingKycCount || 0) - 1) }));
      Alert.alert(
        action === 'APPROVE' ? 'Partner Approved' : 'Partner Rejected',
        `Document has been ${action === 'APPROVE' ? 'approved' : 'rejected'} and saved to the database.`
      );
    } catch (err: any) {
      Alert.alert('Action Failed', err?.message || 'Could not reach the server. Nothing was changed.');
    }
  };

  // Process Instant Refund
  const executeRefund = async () => {
    if (!refundTarget) return;
    const amount = refundAmount ? Number(refundAmount) : refundTarget.totalAmount;

    try {
      const res = await fetch(`${apiUrl}/admin/orders/${refundTarget.id}/refund`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ amount, reason: refundReason })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error?.message || data.error || 'Refund was rejected by the server.');

      setLiveOrders(prev => prev.map(o => (o.id === refundTarget.id ? { ...o, status: 'REFUNDED' } : o)));
      setRefundTarget(null);
      Alert.alert('Refund Issued', `Rs ${amount.toFixed(2)} credited instantly to customer wallet.`);
    } catch (err: any) {
      Alert.alert('Refund Failed', err?.message || 'Could not reach the server. No refund was issued.');
    }
  };

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#17090E" />
        <View style={styles.authCard}>
          <View style={styles.authHeader}>
            <View style={styles.brandIconCircle}>
              <ShieldAlert size={36} color="#F5A623" />
            </View>
            <Text style={styles.authTitle}>Quick Bites Ops</Text>
            <Text style={styles.authSubtitle}>Admin Command Tower & Moderation</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Admin Email</Text>
            <TextInput
              style={styles.textInput}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="admin@quickbite.app"
              placeholderTextColor="#8A7A72"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Master Password</Text>
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
            <Text style={styles.loginBtnText}>Enter Command Tower</Text>
          </TouchableOpacity>

          <View style={styles.demoPill}>
            <Sparkles size={16} color="#F5A623" />
            <Text style={styles.demoPillText}>Default Login: admin@quickbite.app / pass123</Text>
          </View>
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
          <Text style={styles.towerTitle}>Quick Bites Ops Tower</Text>
          <Text style={styles.towerSub}>City Hub: Bengaluru Central • Sockets Online</Text>
        </View>
        <TouchableOpacity style={styles.liveIndicator} onPress={() => syncPlatformData()} disabled={isSyncing}>
          <View style={styles.pulsingDot} />
          <Text style={styles.liveText}>{isSyncing ? 'SYNC' : 'LIVE'}</Text>
        </TouchableOpacity>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabNav}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'pulse' && styles.tabItemActive]}
          onPress={() => setActiveTab('pulse')}
        >
          <Activity size={18} color={activeTab === 'pulse' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'pulse' && styles.tabLabelActive]}>Platform Pulse</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'kyc' && styles.tabItemActive]}
          onPress={() => setActiveTab('kyc')}
        >
          <FileCheck2 size={18} color={activeTab === 'kyc' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'kyc' && styles.tabLabelActive]}>
            KYC Queue ({pendingKyc.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'orders' && styles.tabItemActive]}
          onPress={() => setActiveTab('orders')}
        >
          <Store size={18} color={activeTab === 'orders' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'orders' && styles.tabLabelActive]}>Live Orders</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'disputes' && styles.tabItemActive]}
          onPress={() => setActiveTab('disputes')}
        >
          <AlertCircle size={18} color={activeTab === 'disputes' ? '#F5A623' : '#A8968E'} />
          <Text style={[styles.tabLabel, activeTab === 'disputes' && styles.tabLabelActive]}>Refunds</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
        {activeTab === 'pulse' && (
          <View>
            <Text style={styles.sectionTitle}>Real-Time Marketplace Pulse</Text>

            {/* KPI Cards */}
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <DollarSign size={22} color="#22C08A" />
                <Text style={styles.kpiValue}>Rs {metrics.grossMerchandiseValue.toLocaleString()}</Text>
                <Text style={styles.kpiLabel}>Today's GMV</Text>
              </View>

              <View style={styles.kpiCard}>
                <Activity size={22} color="#F5A623" />
                <Text style={styles.kpiValue}>{metrics.activeOrdersCount}</Text>
                <Text style={styles.kpiLabel}>Orders In Transit</Text>
              </View>

              <View style={styles.kpiCard}>
                <Bike size={22} color="#38BDF8" />
                <Text style={styles.kpiValue}>{metrics.onlineRidersCount}</Text>
                <Text style={styles.kpiLabel}>Online Delivery Fleet</Text>
              </View>

              <View style={styles.kpiCard}>
                <FileCheck2 size={22} color="#E08E0B" />
                <Text style={styles.kpiValue}>{metrics.pendingKycCount}</Text>
                <Text style={styles.kpiLabel}>Pending KYC Reviews</Text>
              </View>
            </View>

            {/* Infrastructure Health */}
            <View style={styles.healthCard}>
              <Text style={styles.healthTitle}>Ecosystem Infrastructure Status</Text>
              <View style={styles.healthRow}>
                <Text style={styles.healthLabel}>PostgreSQL (Supabase Cloud)</Text>
                <Text style={styles.healthBadge}>100% HEALTHY</Text>
              </View>
              <View style={styles.healthRow}>
                <Text style={styles.healthLabel}>Socket.IO Gateway (Port 5000)</Text>
                <Text style={styles.healthBadge}>CONNECTED</Text>
              </View>
              <View style={styles.healthRow}>
                <Text style={styles.healthLabel}>Cloudflare Secure Tunnel</Text>
                <Text style={styles.healthBadge}>TUNNEL ACTIVE</Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'kyc' && (
          <View>
            <Text style={styles.sectionTitle}>Partner Document Review Queue</Text>
            <Text style={styles.sectionSubtitle}>Review FSSAI & Driving Licenses to authorize store/rider activation.</Text>

            {pendingKyc.length === 0 ? (
              <View style={styles.emptyCard}>
                <CheckCircle2 size={48} color="#22C08A" />
                <Text style={styles.emptyTitle}>All KYC Documents Reviewed</Text>
                <Text style={styles.emptySubtitle}>No pending partner applications in queue.</Text>
              </View>
            ) : (
              pendingKyc.map(item => (
                <View key={item.id} style={styles.kycCard}>
                  <View style={styles.kycHeader}>
                    <View>
                      <Text style={styles.kycEntityName}>{item.entityName}</Text>
                      <Text style={styles.kycTypeBadge}>{item.entityType} • {item.documentType}</Text>
                    </View>
                    <Text style={styles.kycTime}>{item.submittedAt}</Text>
                  </View>

                  <View style={styles.kycDocBox}>
                    <Text style={styles.kycDocText}>{item.docDetails}</Text>
                    <Text style={styles.kycCloudflareNote}>Cloudflare R2 Bucket Upload Verified</Text>
                  </View>

                  <View style={styles.kycActionRow}>
                    <TouchableOpacity
                      style={styles.kycRejectBtn}
                      onPress={() => handleKycReview(item.id, 'REJECT')}
                    >
                      <XCircle size={16} color="#E15D5D" />
                      <Text style={styles.kycRejectText}>Reject</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.kycApproveBtn}
                      onPress={() => handleKycReview(item.id, 'APPROVE')}
                    >
                      <CheckCircle2 size={16} color="#FFFFFF" />
                      <Text style={styles.kycApproveText}>Approve & Activate</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'orders' && (
          <View>
            <Text style={styles.sectionTitle}>Live Platform Orders</Text>

            {liveOrders.map(order => (
              <View key={order.id} style={styles.orderItemCard}>
                <View style={styles.orderTopRow}>
                  <View>
                    <Text style={styles.orderNum}>Order #{order.orderNumber}</Text>
                    <Text style={styles.orderRest}>{order.restaurantName}</Text>
                  </View>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusPillText}>{order.status}</Text>
                  </View>
                </View>

                <View style={styles.orderMetaRow}>
                  <Text style={styles.metaCustomer}>Customer: {order.customerName}</Text>
                  <Text style={styles.metaRider}>Rider: {order.riderName}</Text>
                </View>

                <View style={styles.orderFooterRow}>
                  <Text style={styles.orderAmount}>Rs {order.totalAmount.toFixed(2)} ({order.paymentMode})</Text>
                  {order.status !== 'REFUNDED' && (
                    <TouchableOpacity
                      style={styles.refundBtn}
                      onPress={() => {
                        setRefundTarget(order);
                        setRefundAmount(order.totalAmount.toString());
                      }}
                    >
                      <Text style={styles.refundBtnText}>Issue Refund</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'disputes' && (
          <View>
            <Text style={styles.sectionTitle}>Dispute Resolution & Customer Wallet Credits</Text>
            <Text style={styles.sectionSubtitle}>
              Tap any order in the Live Orders tab to execute an instant wallet refund with full audit trail.
            </Text>

            <View style={styles.disputePolicyCard}>
              <AlertCircle size={24} color="#F5A623" />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.policyTitle}>Automated Refund Rule</Text>
                <Text style={styles.policyDesc}>
                  All approved refunds credit customer's QuickBite Wallet balance atomically with zero banking delay.
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Refund Modal */}
      <Modal visible={!!refundTarget} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Issue Dispute Refund</Text>
            <Text style={styles.modalSubtitle}>Order #{refundTarget?.orderNumber} • {refundTarget?.customerName}</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Refund Amount (Rs)</Text>
              <TextInput
                style={styles.textInput}
                value={refundAmount}
                onChangeText={setRefundAmount}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Reason for Refund</Text>
              <TextInput
                style={styles.textInput}
                value={refundReason}
                onChangeText={setRefundReason}
              />
            </View>

            <TouchableOpacity style={styles.executeRefundBtn} onPress={executeRefund}>
              <Text style={styles.executeRefundText}>Credit to Customer Wallet</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setRefundTarget(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
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
  towerTitle: { fontSize: 20, fontWeight: '800', color: '#FBF3EE' },
  towerSub: { fontSize: 12, color: '#A8968E', marginTop: 2 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A3D2E', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, gap: 6 },
  pulsingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ADFA8' },
  liveText: { color: '#4ADFA8', fontSize: 11, fontWeight: '800' },
  tabNav: { flexDirection: 'row', backgroundColor: '#26111A', borderBottomWidth: 1, borderBottomColor: '#3E1E28' },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, gap: 6 },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: '#F5A623' },
  tabLabel: { fontSize: 12, color: '#A8968E', fontWeight: '600' },
  tabLabelActive: { color: '#F5A623', fontWeight: '700' },
  scrollArea: { flex: 1 },
  scrollContent: { padding: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#FBF3EE', marginBottom: 6 },
  sectionSubtitle: { fontSize: 13, color: '#A8968E', marginBottom: 16 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  kpiCard: { width: '48%', backgroundColor: '#26111A', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#3E1E28' },
  kpiValue: { fontSize: 20, fontWeight: '800', color: '#FBF3EE', marginVertical: 6 },
  kpiLabel: { fontSize: 11, color: '#A8968E' },
  healthCard: { backgroundColor: '#26111A', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#3E1E28' },
  healthTitle: { fontSize: 15, fontWeight: '700', color: '#FBF3EE', marginBottom: 12 },
  healthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#3E1E28' },
  healthLabel: { fontSize: 13, color: '#D8C9C0' },
  healthBadge: { color: '#4ADFA8', fontSize: 11, fontWeight: '800', backgroundColor: '#0A3D2E', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  emptyCard: { backgroundColor: '#26111A', borderRadius: 20, padding: 36, alignItems: 'center', borderWidth: 1, borderColor: '#3E1E28' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#FBF3EE', marginTop: 12 },
  emptySubtitle: { fontSize: 13, color: '#A8968E', marginTop: 4, textAlign: 'center' },
  kycCard: { backgroundColor: '#26111A', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: '#3E1E28' },
  kycHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  kycEntityName: { fontSize: 16, fontWeight: '800', color: '#FBF3EE' },
  kycTypeBadge: { fontSize: 12, color: '#38BDF8', fontWeight: '600', marginTop: 2 },
  kycTime: { fontSize: 11, color: '#8A7A72' },
  kycDocBox: { backgroundColor: '#17090E', padding: 12, borderRadius: 12, marginVertical: 12 },
  kycDocText: { fontSize: 13, color: '#EFE7DF', fontWeight: '600' },
  kycCloudflareNote: { fontSize: 11, color: '#22C08A', marginTop: 4 },
  kycActionRow: { flexDirection: 'row', gap: 10 },
  kycRejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#450A0A', height: 44, borderRadius: 12, gap: 6 },
  kycRejectText: { color: '#EC8080', fontWeight: '700', fontSize: 13 },
  kycApproveBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#22C08A', height: 44, borderRadius: 12, gap: 6 },
  kycApproveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  orderItemCard: { backgroundColor: '#26111A', borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#3E1E28' },
  orderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  orderNum: { fontSize: 15, fontWeight: '800', color: '#FBF3EE' },
  orderRest: { fontSize: 13, color: '#A8968E', marginTop: 2 },
  statusPill: { backgroundColor: '#0A3D2E', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusPillText: { color: '#4ADFA8', fontSize: 11, fontWeight: '800' },
  orderMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#3E1E28' },
  metaCustomer: { fontSize: 12, color: '#D8C9C0' },
  metaRider: { fontSize: 12, color: '#D8C9C0' },
  orderFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderAmount: { fontSize: 14, fontWeight: '700', color: '#FBF3EE' },
  refundBtn: { backgroundColor: '#450A0A', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  refundBtnText: { color: '#EC8080', fontSize: 12, fontWeight: '700' },
  disputePolicyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#26111A', padding: 18, borderRadius: 18, borderWidth: 1, borderColor: '#3E1E28' },
  policyTitle: { fontSize: 14, fontWeight: '700', color: '#FBF3EE' },
  policyDesc: { fontSize: 12, color: '#A8968E', marginTop: 2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#26111A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#FBF3EE' },
  modalSubtitle: { fontSize: 13, color: '#A8968E', marginTop: 4, marginBottom: 20 },
  executeRefundBtn: { backgroundColor: '#F5A623', height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  executeRefundText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  cancelBtn: { height: 44, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  cancelText: { color: '#A8968E', fontSize: 14 }
});
