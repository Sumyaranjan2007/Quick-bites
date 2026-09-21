import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeScreen } from './src/components/SafeScreen';
import { TripChat } from './src/components/TripChat';
import { SettlementScreen } from './src/screens/SettlementScreen';
import { PayoutAccountScreen } from './src/screens/PayoutAccountScreen';
import { CashScreen } from './src/screens/CashScreen';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Platform,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import * as Location from 'expo-location';
import {
  ChevronLeft,
  CircleUser,
  IndianRupee,
  LayoutDashboard,
  Navigation as NavigationIcon,
  ShieldAlert
} from 'lucide-react-native';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { t } from './src/theme';
import { Avatar } from './src/components/ui';
import { NewOrderModal } from './src/components/NewOrderModal';
import { LoginScreen } from './src/screens/LoginScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { TripScreen } from './src/screens/TripScreen';
import { EarningsScreen } from './src/screens/EarningsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { DocumentsScreen } from './src/screens/DocumentsScreen';
import { RatingsScreen } from './src/screens/RatingsScreen';
import { IncentivesScreen } from './src/screens/IncentivesScreen';
import { WeeklyTripsScreen } from './src/screens/WeeklyTripsScreen';
import { SafetyScreen } from './src/screens/SafetyScreen';
import { PoliciesScreen } from './src/screens/PoliciesScreen';
import {
  api,
  ApiError,
  setSessionEndedHandler,
  type ApiContext,
  type DashboardResponse,
  type Trip,
  type TripStage
} from './src/lib/api';
import { clearSession, loadSession, saveSession } from './src/lib/session';
import {
  notifyNewOrder,
  prepareOrderAlerts,
  releaseOrderAlerts,
  startOrderAlert,
  stopOrderAlert
} from './src/lib/orderAlert';
import { startShiftService, stopShiftService } from './src/lib/shiftService';
import { useHardwareBackWithExitConfirm } from './src/lib/useHardwareBack';

import { DEFAULT_API_URL } from './src/config';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Tab = 'home' | 'trips' | 'earnings' | 'profile';
type SubScreen =
  | 'documents'
  | 'ratings'
  | 'incentives'
  | 'weekly'
  | 'safety'
  | 'policies'
  | 'settlement'
  | 'payoutAccount'
  | 'cash';

const SUB_SCREEN_TITLE: Record<SubScreen, string> = {
  documents: 'Documents & verification',
  ratings: 'Ratings & reviews',
  incentives: 'Incentives & bonuses',
  weekly: 'Trips',
  safety: 'Safety & SOS',
  policies: 'App policies',
  settlement: 'Settlement & payments',
  // A sub-screen off Earnings rather than a fifth tab: a rider opens this
  // once, when they join, and then only when their bank changes. A permanent
  // tab for it would sit next to Home and Trips forever, competing with the
  // three things they use on every shift.
  payoutAccount: 'Bank account',
  cash: 'Cash in your bag'
};

/** How often the app asks for work when websockets are not getting through. */
const BROADCAST_POLL_MS = 20000;

function DeliveryApp() {
  const [booting, setBooting] = useState(true);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<Tab>('home');
  const [subScreen, setSubScreen] = useState<SubScreen | null>(null);

  /**
   * Android's back gesture. A sub-screen closes back to the tab that opened it;
   * any tab but Home returns to Home; Home itself leaves the app. Without this
   * the gesture closed the whole app, which for a rider mid-shift meant losing
   * the trip screen entirely.
   */
  useHardwareBackWithExitConfirm(
    useCallback(() => {
      if (subScreen) {
        setSubScreen(null);
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    }, [subScreen, tab])
  );

  const [offers, setOffers] = useState<Trip[]>([]);
  const [pendingOffer, setPendingOffer] = useState<Trip | null>(null);
  const [shiftSaving, setShiftSaving] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [telemetryCount, setTelemetryCount] = useState(0);
  const [locationDenied, setLocationDenied] = useState(false);
  const [riderPosition, setRiderPosition] = useState<{ latitude: number; longitude: number } | null>(null);

  const ctx: ApiContext = { apiUrl, token: token || undefined };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const activeTrip = dashboard?.activeOrder || null;
  const rider = dashboard?.rider || null;
  const isOnline = Boolean(rider?.isOnline);
  const profileComplete = Boolean(dashboard?.profile.complete);

  /** Offers already put in front of the rider, so one is not announced twice. */
  const announcedOffers = useRef<Set<string>>(new Set());
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      appState.current = next;
    });
    return () => subscription.remove();
  }, []);

  /* ----------------------------- Session ---------------------------------- */

  useEffect(() => {
    (async () => {
      const session = await loadSession();
      if (session) {
        setApiUrl(session.apiUrl);
        setToken(session.token);
        setUserId(session.userId);
      }
      setBooting(false);
    })();
  }, []);

  const handleLogin = async (email: string, password: string) => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const result = await api.login(apiUrl, email.trim(), password);
      setToken(result.token);
      setUserId(result.user.id);
      await saveSession({ token: result.token, userId: result.user.id, email: result.user.email, apiUrl });
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleChangePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      await api.changePassword(ctxRef.current, currentPassword, newPassword);
      Alert.alert('Password changed', 'Use the new password the next time you sign in.');
      return true;
    } catch (err: any) {
      Alert.alert('Could not change your password', err?.message || 'Your password is unchanged.');
      return false;
    }
  }, []);

  const handleLogout = useCallback(async () => {
    // Tell the server first: a rider who closes the app must not stay on the
    // dispatch list as though they were still out there waiting for work.
    try {
      await api.logout(ctxRef.current);
    } catch {
      /* signing out locally still matters if the call fails */
    }
    await releaseOrderAlerts();
    await stopShiftService();
    await clearSession();
    setToken(null);
    setUserId(null);
    setDashboard(null);
    setOffers([]);
    setPendingOffer(null);
    setTab('home');
    setSubScreen(null);
    announcedOffers.current.clear();
  }, []);

  /*
   * An account blocked, or deleted, while the app is open.
   *
   * A block applies to the session the rider already holds rather than to a
   * next sign-in they are never going to make, so the refusal arrives on
   * whatever call comes next. The session ends and the server's own words —
   * which carry the reason an administrator recorded — are put on the login
   * screen, where they are still readable after the sign-out.
   */
  useEffect(() => {
    setSessionEndedHandler(({ message }) => {
      setLoginError(message);
      void handleLogout();
    });
    return () => setSessionEndedHandler(null);
  }, [handleLogout]);

  /**
   * A token that has expired or been revoked should return the rider to the
   * login screen rather than leaving every screen quietly empty.
   */
  const handleApiError = useCallback((err: unknown): boolean => {
    if (err instanceof ApiError && (err.status === 401 || err.code === 'INVALID_TOKEN')) {
      clearSession();
      setToken(null);
      setDashboard(null);
      setLoginError('Your session expired. Please sign in again.');
      return true;
    }
    return false;
  }, []);

  /* ---------------------------- Dashboard --------------------------------- */

  const loadDashboard = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!ctxRef.current.token) return null;
    if (!options.silent) setLoadingDashboard(true);
    try {
      const data = await api.dashboard(ctxRef.current);
      setDashboard(data);
      return data;
    } catch (err) {
      if (!handleApiError(err)) {
        if (!options.silent) {
          Alert.alert('Could not refresh', (err as Error).message);
        }
      }
      return null;
    } finally {
      setLoadingDashboard(false);
    }
  }, [handleApiError]);

  useEffect(() => {
    if (token) {
      loadDashboard();
      prepareOrderAlerts();
    }
  }, [token, loadDashboard]);

  // A rider who was on shift when the app last closed is still on shift as far
  // as dispatch is concerned, so the service that keeps them reachable has to
  // come back with them.
  useEffect(() => {
    if (!token) return;
    if (isOnline) startShiftService();
    else stopShiftService();
    // No alert here: this is the quiet path that restores the service for a
    // rider who was already on shift when the app was last closed. The toggle
    // is where a rider is told their phone cannot be reached in the background.
  }, [token, isOnline]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await loadDashboard({ silent: true });
    await syncOffers({ announce: false });
    setRefreshing(false);
  }, [loadDashboard]);

  /* ------------------------------ Offers ---------------------------------- */

  /**
   * Pulls the offers waiting for this rider.
   *
   * `announce` is what turns a quiet list refresh into an alert: the modal,
   * the chime and the shade notification only fire for an offer this device
   * has not already shown.
   */
  const syncOffers = useCallback(async (options: { announce: boolean }) => {
    if (!ctxRef.current.token) return;
    try {
      const result = await api.broadcasts(ctxRef.current);
      const list = result.broadcasts || [];
      setOffers(list);

      if (!options.announce || list.length === 0) return;

      const fresh = list.find(offer => !announcedOffers.current.has(offer.id));
      if (!fresh) return;

      announcedOffers.current.add(fresh.id);
      setPendingOffer(current => current || fresh);
      startOrderAlert();
      if (appState.current !== 'active') {
        notifyNewOrder({
          restaurantName: fresh.restaurantName,
          payout: fresh.estimatedEarnings,
          distanceKm: fresh.distanceKm
        });
      }
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError]);

  // Live push from the backend the moment a kitchen packs an order, with a
  // slow poll behind it because websockets do not survive every mobile network.
  useEffect(() => {
    if (!token || !isOnline || activeTrip) return;
    syncOffers({ announce: false });
    const timer = setInterval(() => syncOffers({ announce: true }), BROADCAST_POLL_MS);
    return () => clearInterval(timer);
  }, [token, isOnline, activeTrip?.id, syncOffers]);

  /**
   * Reports where the rider is while they are on shift and free.
   *
   * Offers are ordered by how far the rider has to ride to COLLECT, and that
   * needs a position. The only position the server had came from /telemetry,
   * which runs during a delivery — so an idle rider had none, and the offer
   * list fell back to newest-first. That is how a rider standing outside one
   * kitchen gets offered a pickup across town.
   *
   * On shift and between trips only. Off shift nothing is sent, and while
   * carrying an order /telemetry is already reporting. Foreground only: there
   * is no background location here and nothing that needs Play's background
   * location review.
   */
  useEffect(() => {
    if (!token || !isOnline || activeTrip) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled || status !== 'granted') return;
      subscription = await Location.watchPositionAsync(
        // Coarser and slower than the delivery watcher. This only has to place
        // a rider well enough to sort a list of kitchens by distance, and a
        // high-accuracy fix every five seconds while nobody is riding anywhere
        // is somebody's battery.
        { accuracy: Location.Accuracy.Balanced, timeInterval: 60_000, distanceInterval: 200 },
        location => {
          api
            .shiftLocation(ctxRef.current, {
              lat: location.coords.latitude,
              lng: location.coords.longitude
            })
            .catch(() => {});
        }
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [token, isOnline, activeTrip?.id]);

  const { connected: liveConnected } = useLiveOffers(
    token && isOnline && !activeTrip ? apiUrl : null,
    token,
    () => syncOffers({ announce: true })
  );

  const dismissOffer = useCallback(() => {
    setPendingOffer(null);
    stopOrderAlert();
  }, []);

  const acceptOffer = async (trip: Trip) => {
    setBusy(true);
    try {
      await api.claim(ctxRef.current, trip.id);
      dismissOffer();
      setOffers([]);
      // Straight to the trip screen: the rider's next question is "where do I
      // go", and the answer should already be on screen.
      const data = await loadDashboard({ silent: true });
      setTab('trips');
      if (!data?.activeOrder) await loadDashboard({ silent: true });
    } catch (err: any) {
      if (!handleApiError(err)) Alert.alert('Could not accept', err.message);
      dismissOffer();
      syncOffers({ announce: false });
    } finally {
      setBusy(false);
    }
  };

  const declineOffer = async (trip: Trip) => {
    dismissOffer();
    try {
      await api.decline(ctxRef.current, trip.id);
    } catch (err) {
      handleApiError(err);
    }
    syncOffers({ announce: false });
  };

  /* ------------------------------- Shift ---------------------------------- */

  const setShift = async (next: boolean) => {
    if (shiftSaving) return;
    setShiftSaving(true);
    try {
      // The server decides, and the screen shows what it decided. Flipping the
      // switch locally first is what used to leave a rider reading "Online"
      // while dispatch still had them at home.
      const result = await api.setShift(ctxRef.current, next);
      setDashboard(current => (current ? { ...current, rider: result.rider } : current));
      if (result.isOnline) {
        announcedOffers.current.clear();
        syncOffers({ announce: false });
        // Without this the process is frozen the moment the rider pockets the
        // phone, and the offer they were waiting for arrives in silence.
        const held = await startShiftService();
        if (!held) {
          Alert.alert(
            'Location is off',
            'You are online, but Quick Bites can only alert you to new offers while the app is open. Allow location access to be told about work with the phone in your pocket.'
          );
        }
      } else {
        setOffers([]);
        dismissOffer();
        await stopShiftService();
      }
      await loadDashboard({ silent: true });
    } catch (err: any) {
      if (!handleApiError(err)) {
        Alert.alert(
          next ? 'Could not go online' : 'Could not go offline',
          err.message,
          err.code === 'PROFILE_INCOMPLETE'
            ? [
                { text: 'Not now', style: 'cancel' },
                { text: 'Complete profile', onPress: () => setSubScreen('documents') }
              ]
            : undefined
        );
      }
    } finally {
      setShiftSaving(false);
    }
  };

  /* ------------------------------- Trip ----------------------------------- */

  const advanceStage = async (stage: TripStage) => {
    if (!activeTrip) return;
    setDashboard(current =>
      current && current.activeOrder ? { ...current, activeOrder: { ...current.activeOrder, stage } } : current
    );
    try {
      await api.setStage(ctxRef.current, activeTrip.id, stage);
    } catch (err: any) {
      if (!handleApiError(err)) Alert.alert('Could not update', err.message);
      await loadDashboard({ silent: true });
    }
  };

  const verifyPickup = async (code: string): Promise<boolean> => {
    if (!activeTrip) return false;
    setBusy(true);
    try {
      await api.verifyPickup(ctxRef.current, activeTrip.id, code);
      await loadDashboard({ silent: true });
      Alert.alert('Pickup confirmed', 'Head to the customer. Your live location is now being shared with them.');
      return true;
    } catch (err: any) {
      if (!handleApiError(err)) Alert.alert('Code not accepted', err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const completeDelivery = async (otp: string): Promise<boolean> => {
    if (!activeTrip) return false;
    setBusy(true);
    try {
      const result = await api.verifyDelivery(ctxRef.current, activeTrip.id, otp);
      await loadDashboard({ silent: true });
      setTab('home');

      const bonusLine = result.incentivesAwarded.length
        ? `\n\nBonus unlocked: ${result.incentivesAwarded.map(i => `${i.title} (Rs ${i.reward})`).join(', ')}`
        : '';
      const cashLine =
        result.cashCollected > 0
          ? `\nCash collected: Rs ${result.cashCollected.toFixed(2)} — this is in your bag until you deposit it.`
          : '';
      Alert.alert(
        'Delivery complete',
        `Rs ${result.payout.toFixed(2)} earned. It is paid out to your bank account, not held here.${cashLine}${bonusLine}`
      );
      return true;
    } catch (err: any) {
      if (!handleApiError(err)) Alert.alert('Code not accepted', err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancelTrip = async (reason: string) => {
    if (!activeTrip) return;
    setBusy(true);
    try {
      await api.cancelTrip(ctxRef.current, activeTrip.id, reason);
      await loadDashboard({ silent: true });
      announcedOffers.current.clear();
      syncOffers({ announce: false });
      Alert.alert('Trip released', 'It has gone back to dispatch for another rider.');
    } catch (err: any) {
      if (!handleApiError(err)) Alert.alert('Could not release the trip', err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (patch: Record<string, unknown>): Promise<boolean> => {
    try {
      await api.updateProfile(ctxRef.current, patch);
      await loadDashboard({ silent: true });
      return true;
    } catch (err: any) {
      if (!handleApiError(err)) Alert.alert('Could not save', err.message);
      return false;
    }
  };

  /* ----------------------------- Telemetry -------------------------------- */

  // The customer's map only moves while the rider is actually carrying the
  // order, so the GPS subscription lives exactly as long as that leg does.
  useEffect(() => {
    const carrying =
      activeTrip && (activeTrip.stage === 'OUT_FOR_DELIVERY' || activeTrip.stage === 'AT_DOORSTEP');
    if (!carrying || !token) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        location => {
          setTelemetryCount(count => count + 1);
          // Kept as well as sent. The watcher already had the rider's position
          // in hand and discarded it the moment it was posted, so the app knew
          // where every rider was except the one holding it.
          setRiderPosition({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude
          });
          api
            .telemetry(ctxRef.current, {
              orderId: activeTrip.id,
              lat: location.coords.latitude,
              lng: location.coords.longitude,
              bearing:
                location.coords.heading && location.coords.heading >= 0
                  ? Math.round(location.coords.heading)
                  : 0
            })
            .catch(() => {});
        }
      );
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [activeTrip?.id, activeTrip?.stage, token]);

  /* ------------------------------ Render ---------------------------------- */

  if (booting) {
    return (
      <SafeScreen style={s.boot}>
        <StatusBar barStyle="dark-content" backgroundColor={t.color.bg} />
        <ActivityIndicator color={t.color.go} size="large" />
      </SafeScreen>
    );
  }

  if (!token) {
    return (
      <LoginScreen
        apiUrl={apiUrl}
        onApiUrlChange={setApiUrl}
        onSubmit={handleLogin}
        busy={loggingIn}
        error={loginError}
      />
    );
  }

  const renderTab = () => {
    switch (tab) {
      case 'home':
        return (
          <DashboardScreen
            data={dashboard}
            loading={loadingDashboard}
            refreshing={refreshing}
            onRefresh={refreshAll}
            onOpenTrip={() => setTab('trips')}
            onOpenEarnings={() => setTab('earnings')}
            onOpenIncentives={() => setSubScreen('incentives')}
            onOpenRatings={() => setSubScreen('ratings')}
            onOpenWeekly={() => setSubScreen('weekly')}
            onCompleteProfile={() => setSubScreen('documents')}
            onGoOnline={() => setShift(true)}
          />
        );
      case 'trips':
        return (
          <TripScreen
            ctx={ctx}
            trip={activeTrip}
            offers={offers}
            isOnline={isOnline}
            profileComplete={profileComplete}
            refreshing={refreshing}
            busy={busy}
            locationDenied={locationDenied}
            telemetryCount={telemetryCount}
            riderPosition={riderPosition}
            onRefresh={refreshAll}
            onAdvanceStage={advanceStage}
            onVerifyPickup={verifyPickup}
            onCompleteDelivery={completeDelivery}
            onCancelTrip={cancelTrip}
            onAcceptOffer={acceptOffer}
            onDeclineOffer={declineOffer}
            onGoOnline={() => setShift(true)}
            onCompleteProfile={() => setSubScreen('documents')}
            onSos={() => setSubScreen('safety')}
          onOpenChat={() => setChatOpen(true)}
          />
        );
      case 'earnings':
        return (
          <EarningsScreen
            data={dashboard}
            refreshing={refreshing}
            onRefresh={refreshAll}
            onOpenWeekly={() => setSubScreen('weekly')}
            onOpenIncentives={() => setSubScreen('incentives')}
            onOpenRatings={() => setSubScreen('ratings')}
            onOpenSettlement={() => setSubScreen('settlement')}
            onOpenPayoutAccount={() => setSubScreen('payoutAccount')}
            onOpenCash={() => setSubScreen('cash')}
          />
        );
      case 'profile':
        return (
          <ProfileScreen
            data={dashboard}
            refreshing={refreshing}
            onRefresh={refreshAll}
            onSaveProfile={saveProfile}
            onOpenDocuments={() => setSubScreen('documents')}
            onOpenRatings={() => setSubScreen('ratings')}
            onOpenPolicies={() => setSubScreen('policies')}
            onOpenSafety={() => setSubScreen('safety')}
            onChangePassword={handleChangePassword}
            onLogout={handleLogout}
          />
        );
    }
  };

  const renderSubScreen = () => {
    switch (subScreen) {
      case 'documents':
        return <DocumentsScreen ctx={ctx} onChanged={() => loadDashboard({ silent: true })} />;
      case 'ratings':
        return <RatingsScreen ctx={ctx} />;
      case 'incentives':
        return <IncentivesScreen ctx={ctx} />;
      case 'weekly':
        return <WeeklyTripsScreen ctx={ctx} />;
      case 'safety':
        return <SafetyScreen ctx={ctx} activeOrderId={activeTrip?.id} />;
      case 'policies':
        return <PoliciesScreen ctx={ctx} />;
      case 'settlement':
        return <SettlementScreen ctx={ctx} />;
      case 'payoutAccount':
        return <PayoutAccountScreen ctx={ctx} />;
      case 'cash':
        return <CashScreen ctx={ctx} />;
      default:
        return null;
    }
  };

  return (
    <SafeScreen style={s.screen} edgeToEdge>
      <StatusBar barStyle="dark-content" backgroundColor={t.color.bg} />

      {subScreen ? (
        <View style={s.subHeader}>
          <TouchableOpacity
            onPress={() => setSubScreen(null)}
            style={s.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronLeft size={24} color={t.color.text} />
          </TouchableOpacity>
          <Text style={s.subHeaderTitle}>{SUB_SCREEN_TITLE[subScreen]}</Text>
          {subScreen !== 'safety' ? (
            <TouchableOpacity style={s.sosButton} onPress={() => setSubScreen('safety')} activeOpacity={0.85}>
              <ShieldAlert size={15} color="#FFFFFF" />
              <Text style={s.sosButtonText}>SOS</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={s.header}>
          <Avatar uri={rider?.profilePhotoUrl} name={rider?.fullName} size={44} ring={isOnline} />
          <View style={s.headerText}>
            <Text style={s.headerName} numberOfLines={1}>
              {rider?.fullName || 'Quick Bites Rider'}
            </Text>
            <View style={s.headerMeta}>
              <View style={[s.statusDot, { backgroundColor: isOnline ? t.color.go : t.color.textMuted }]} />
              <Text style={s.headerStatus}>
                {isOnline ? (liveConnected ? 'Online · listening for offers' : 'Online') : 'Offline'}
              </Text>
            </View>
          </View>
          <View style={s.shiftControl}>
            {/* SOS lives in the header rather than floating over the content.
                As a floating button it sat on top of whatever was underneath —
                the doorstep OTP field, the sign-out button, an incentive's
                remaining-trips line — which is the last thing an emergency
                control should do. */}
            <TouchableOpacity style={s.sosButton} onPress={() => setSubScreen('safety')} activeOpacity={0.85}>
              <ShieldAlert size={15} color="#FFFFFF" />
              <Text style={s.sosButtonText}>SOS</Text>
            </TouchableOpacity>
            {shiftSaving ? (
              <ActivityIndicator color={t.color.go} style={{ marginRight: t.space[2] }} />
            ) : null}
            <Switch
              value={isOnline}
              onValueChange={setShift}
              disabled={shiftSaving}
              trackColor={{ false: t.color.border, true: t.color.goSoft }}
              thumbColor={isOnline ? t.color.go : t.color.textMuted}
              ios_backgroundColor={t.color.border}
            />
          </View>
        </View>
      )}

      <View style={{ flex: 1 }}>{subScreen ? renderSubScreen() : renderTab()}</View>

      {!subScreen ? (
        <View style={s.tabBar}>
          <TabButton
            label="Home"
            active={tab === 'home'}
            icon={<LayoutDashboard size={20} color={tab === 'home' ? t.color.go : t.color.textMuted} />}
            onPress={() => setTab('home')}
          />
          <TabButton
            label="Trips"
            active={tab === 'trips'}
            badge={activeTrip ? '1' : offers.length ? String(offers.length) : undefined}
            icon={<NavigationIcon size={20} color={tab === 'trips' ? t.color.go : t.color.textMuted} />}
            onPress={() => setTab('trips')}
          />
          <TabButton
            label="Earnings"
            active={tab === 'earnings'}
            icon={<IndianRupee size={20} color={tab === 'earnings' ? t.color.go : t.color.textMuted} />}
            onPress={() => setTab('earnings')}
          />
          <TabButton
            label="Profile"
            active={tab === 'profile'}
            icon={<CircleUser size={20} color={tab === 'profile' ? t.color.go : t.color.textMuted} />}
            onPress={() => setTab('profile')}
          />
        </View>
      ) : null}

      <TripChat
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        ctx={ctx}
        orderId={activeTrip?.id}
        customerName={activeTrip?.customerName}
        canSend={Boolean(activeTrip)}
        selfUserId={rider?.userId}
      />

      <NewOrderModal
        trip={pendingOffer}
        busy={busy}
        onAccept={acceptOffer}
        onDecline={declineOffer}
        onExpire={() => {
          // An expired offer is not a decline: another rider may simply have
          // been quicker, and the rider should not be penalised for that.
          dismissOffer();
          syncOffers({ announce: false });
        }}
      />
    </SafeScreen>
  );
}

const TabButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: string;
  onPress: () => void;
}> = ({ label, icon, active, badge, onPress }) => (
  <TouchableOpacity style={s.tabButton} onPress={onPress} activeOpacity={0.7}>
    <View>
      {icon}
      {badge ? (
        <View style={s.tabBadge}>
          <Text style={s.tabBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
    <Text style={[s.tabLabel, active && { color: t.color.go }]}>{label}</Text>
  </TouchableOpacity>
);

/**
 * The live channel that makes an offer arrive rather than be waited for.
 *
 * Kept here rather than in the shared hook because the rider app only ever
 * joins one room, and the reconnect behaviour it needs — rejoin on every
 * connect, and re-sync on reconnect in case something arrived while the
 * socket was down — is specific to dispatch.
 */
function useLiveOffers(apiUrl: string | null, token: string | null, onEvent: () => void) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!apiUrl || !token) {
      setConnected(false);
      return;
    }

    // Required lazily: pulling socket.io in at module scope delays first paint
    // on a cold start for a screen that may never need it.
    const { io } = require('socket.io-client');
    const origin = apiUrl.replace(/\/api(\/v1)?\/?$/, '');
    const socket = io(origin, {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join:riders');
      onEventRef.current();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('order:available', () => onEventRef.current());
    socket.on('order:status_update', () => onEventRef.current());

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      setConnected(false);
    };
  }, [apiUrl, token]);

  return { connected };
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: t.color.bg,
    // SafeAreaView leaves the Android status bar alone, so without this the
    // rider's name renders on top of the clock and the battery icon.
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0
  },
  boot: { flex: 1, backgroundColor: t.color.bg, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.space[4],
    paddingVertical: t.space[3],
    borderBottomWidth: 1,
    borderBottomColor: t.color.border
  },
  headerText: { flex: 1, marginLeft: t.space[3] },
  headerName: { color: t.color.text, fontSize: t.font.size.md, fontWeight: t.font.weight.bold },
  headerMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  headerStatus: { color: t.color.textMuted, fontSize: t.font.size.xs },
  shiftControl: { flexDirection: 'row', alignItems: 'center' },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.space[3],
    paddingVertical: t.space[3],
    borderBottomWidth: 1,
    borderBottomColor: t.color.border
  },
  backButton: { padding: t.space[1] },
  subHeaderTitle: {
    color: t.color.text,
    fontSize: t.font.size.md,
    fontWeight: t.font.weight.bold,
    marginLeft: t.space[2],
    flex: 1
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: t.color.border,
    backgroundColor: t.color.surfaceSunken,
    paddingTop: t.space[2],
    paddingBottom: Platform.OS === 'ios' ? t.space[5] : t.space[3]
  },
  tabButton: { flex: 1, alignItems: 'center' },
  tabLabel: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 4, fontWeight: t.font.weight.semibold },
  tabBadge: {
    position: 'absolute',
    top: -5,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: t.color.go,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4
  },
  tabBadgeText: { color: '#04231A', fontSize: 10, fontWeight: t.font.weight.extrabold },
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.danger,
    paddingHorizontal: t.space[3],
    paddingVertical: 7,
    borderRadius: t.radius.full,
    marginRight: t.space[3]
  },
  sosButtonText: { color: '#FFFFFF', fontSize: t.font.size.xs, fontWeight: t.font.weight.extrabold, marginLeft: 5 }
});

export default function App() {
  return (
    <ErrorBoundary>
    {/* Required by useSafeAreaInsets. Without it every inset reads zero and
        the bottom row slides back under Android's navigation bar. */}
    <SafeAreaProvider>
        <DeliveryApp />
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
