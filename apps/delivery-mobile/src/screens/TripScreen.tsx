import React, { useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import {
  Bike,
  CheckCircle2,
  IndianRupee,
  MapPin,
  Navigation,
  Phone,
  Store,
  TriangleAlert,
  MessageCircle
} from 'lucide-react-native';
import { t } from '../theme';
import { Button, Card, EmptyState, Pill, Row, SectionTitle } from '../components/ui';
import { clockTime, distance, rupees } from '../lib/format';
import { callNumber, openDirections } from '../lib/maps';
import { TripMap } from '../components/TripMap';
import type { Trip, TripStage } from '../lib/api';

/**
 * Where the rider actually works.
 *
 * With a trip in hand the screen is a single column of one decision at a time:
 * where to go, how to get there, and the one code that unlocks the next step.
 * Both stops carry their own navigate and call buttons — the restaurant's
 * address and coordinates used not to reach this screen at all, so an accepted
 * trip gave the rider a restaurant name and nothing to steer by.
 */

const STAGE_ORDER: TripStage[] = ['HEADING_TO_RESTAURANT', 'AT_RESTAURANT', 'OUT_FOR_DELIVERY', 'AT_DOORSTEP'];
const STAGE_LABEL: Record<TripStage, string> = {
  HEADING_TO_RESTAURANT: 'To restaurant',
  AT_RESTAURANT: 'At restaurant',
  OUT_FOR_DELIVERY: 'To customer',
  AT_DOORSTEP: 'At doorstep'
};

export const TripScreen: React.FC<{
  trip: Trip | null;
  offers: Trip[];
  isOnline: boolean;
  profileComplete: boolean;
  refreshing: boolean;
  busy: boolean;
  locationDenied: boolean;
  telemetryCount: number;
  onRefresh: () => void;
  onAdvanceStage: (stage: TripStage) => void;
  onVerifyPickup: (code: string) => Promise<boolean>;
  onCompleteDelivery: (otp: string) => Promise<boolean>;
  onCancelTrip: (reason: string) => void;
  onAcceptOffer: (trip: Trip) => void;
  onDeclineOffer: (trip: Trip) => void;
  onGoOnline: () => void;
  onCompleteProfile: () => void;
  onSos: () => void;
  /** Opens the conversation with this order's customer. */
  onOpenChat: () => void;
  /** Unread messages from the customer, badged on the chat control. */
  unreadMessages?: number;
  /** The rider's own position, from the watcher that already feeds telemetry. */
  riderPosition?: { latitude: number; longitude: number } | null;
}> = ({
  trip,
  offers,
  isOnline,
  profileComplete,
  refreshing,
  busy,
  locationDenied,
  telemetryCount,
  onRefresh,
  onAdvanceStage,
  onVerifyPickup,
  onCompleteDelivery,
  onCancelTrip,
  onAcceptOffer,
  onDeclineOffer,
  onOpenChat,
  unreadMessages = 0,
  riderPosition,
  onGoOnline,
  onCompleteProfile,
  onSos
}) => {
  const [pickupCode, setPickupCode] = useState('');
  const [otp, setOtp] = useState('');

  const confirmCancel = () => {
    Alert.alert(
      'Release this trip?',
      'It goes back to dispatch for another rider. Only do this if you genuinely cannot complete it.',
      [
        { text: 'Keep trip', style: 'cancel' },
        { text: 'Vehicle breakdown', onPress: () => onCancelTrip('Vehicle breakdown') },
        { text: 'Cannot reach address', onPress: () => onCancelTrip('Cannot reach the address') }
      ]
    );
  };

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color.go} />
  );

  if (!trip) {
    return (
      <ScrollView contentContainerStyle={s.content} refreshControl={refreshControl}>
        {!profileComplete ? (
          <EmptyState
            icon={<TriangleAlert size={34} color={t.color.money} />}
            title="Finish your profile first"
            message="Your name, photo, partner ID and approved documents are required before trips can be offered to you."
            action={<Button label="Complete profile" onPress={onCompleteProfile} size="lg" />}
          />
        ) : !isOnline ? (
          <EmptyState
            icon={<Bike size={34} color={t.color.textMuted} />}
            title="You are off shift"
            message="Go online to start receiving delivery offers. Your phone will ring and vibrate the moment one arrives."
            action={<Button label="Go online" onPress={onGoOnline} size="lg" />}
          />
        ) : offers.length === 0 ? (
          <EmptyState
            icon={<Bike size={34} color={t.color.go} />}
            title="Waiting for your next trip"
            message="You are on shift and first in line. Keep the app open — offers arrive with a sound and a full-screen alert."
            action={<Button label="Check for offers" variant="secondary" onPress={onRefresh} />}
          />
        ) : (
          <>
            <SectionTitle>Available offers</SectionTitle>
            {offers.map(offer => (
              <Card key={offer.id} style={{ marginBottom: t.space[3] }}>
                <View style={s.offerHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.offerRestaurant} numberOfLines={1}>
                      {offer.restaurantName}
                    </Text>
                    <Text style={s.offerAddress} numberOfLines={1}>
                      {offer.pickupAddress}
                    </Text>
                  </View>
                  <Text style={s.offerPay}>{rupees(offer.estimatedEarnings, 0)}</Text>
                </View>
                <View style={s.offerMeta}>
                  <Pill label={distance(offer.distanceKm)} />
                  <Pill
                    label={offer.paymentMode === 'COD' ? `COD ${rupees(offer.cashToCollect, 0)}` : 'Prepaid'}
                    tone={offer.paymentMode === 'COD' ? 'money' : 'go'}
                    style={{ marginLeft: t.space[2] }}
                  />
                  <Pill label={`${offer.itemCount} items`} style={{ marginLeft: t.space[2] }} />
                </View>
                <View style={s.offerActions}>
                  <Button
                    label="Pass"
                    variant="ghost"
                    onPress={() => onDeclineOffer(offer)}
                    style={{ flex: 1, marginRight: t.space[3] }}
                  />
                  <Button label="Accept" onPress={() => onAcceptOffer(offer)} style={{ flex: 2 }} />
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    );
  }

  const stageIndex = STAGE_ORDER.indexOf(trip.stage);
  const headingToRestaurant = trip.stage === 'HEADING_TO_RESTAURANT';
  const atRestaurant = trip.stage === 'AT_RESTAURANT';
  const outForDelivery = trip.stage === 'OUT_FOR_DELIVERY';
  const atDoorstep = trip.stage === 'AT_DOORSTEP';

  return (
    <ScrollView contentContainerStyle={s.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      {/* Progress */}
      <View style={s.stageBar}>
        {STAGE_ORDER.map((stage, index) => (
          <View key={stage} style={s.stageItem}>
            <View
              style={[
                s.stageDot,
                index <= stageIndex && { backgroundColor: t.color.go, borderColor: t.color.go }
              ]}
            />
            <Text style={[s.stageLabel, index <= stageIndex && { color: t.color.goText }]} numberOfLines={1}>
              {STAGE_LABEL[stage]}
            </Text>
            {index < STAGE_ORDER.length - 1 ? (
              <View style={[s.stageLine, index < stageIndex && { backgroundColor: t.color.go }]} />
            ) : null}
          </View>
        ))}
      </View>

      <Card style={{ marginTop: t.space[4] }}>
        {/* The leg in progress. Which stop that is follows the same flags the
            two Navigate buttons already use, so the map can never be pointing
            at a stop the controls below consider finished. */}
        <TripMap
          rider={riderPosition ?? null}
          destination={
            outForDelivery || atDoorstep
              ? trip.dropCoordinates ?? null
              : trip.pickupCoordinates ?? null
          }
          destinationLabel={
            outForDelivery || atDoorstep ? trip.customerName || 'Customer' : trip.restaurantName
          }
          carryingFood={outForDelivery || atDoorstep}
        />

        <View style={s.tripHead}>
          <View>
            <Text style={s.tripOrder}>Order #{trip.orderNumber}</Text>
            <Text style={s.tripPlaced}>Placed {clockTime(trip.placedAt)}</Text>
          </View>
          <Text style={s.tripEarn}>{rupees(trip.estimatedEarnings)}</Text>
        </View>

        {/* Pickup */}
        <View style={[s.stop, (headingToRestaurant || atRestaurant) && s.stopActive]}>
          <View style={s.stopHead}>
            <View style={[s.stopIcon, { backgroundColor: t.color.moneySoft }]}>
              <Store size={16} color={t.color.money} />
            </View>
            <View style={{ flex: 1, marginLeft: t.space[3] }}>
              <Text style={s.stopLabel}>Pick up from</Text>
              <Text style={s.stopName}>{trip.restaurantName}</Text>
            </View>
          </View>
          <Text style={s.stopAddress}>{trip.pickupAddress}</Text>
          {trip.pickupCoordinates ? (
            <Text style={s.stopCoords}>
              {trip.pickupCoordinates.latitude.toFixed(5)}, {trip.pickupCoordinates.longitude.toFixed(5)}
            </Text>
          ) : null}
          <View style={s.stopActions}>
            <Button
              label="Navigate"
              variant={headingToRestaurant ? 'primary' : 'secondary'}
              icon={<Navigation size={16} color={headingToRestaurant ? '#04231A' : t.color.text} />}
              onPress={() => openDirections(
                trip.pickupCoordinates ? { ...trip.pickupCoordinates, label: trip.restaurantName } : undefined,
                trip.pickupAddress
              )}
              style={{ flex: 1 }}
            />
            <TouchableOpacity style={s.callBtn} onPress={() => callNumber(trip.pickupPhone)} activeOpacity={0.85}>
              <Phone size={18} color={t.color.text} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.stopConnector} />

        {/* Drop */}
        <View style={[s.stop, (outForDelivery || atDoorstep) && s.stopActive]}>
          <View style={s.stopHead}>
            <View style={[s.stopIcon, { backgroundColor: t.color.goSoft }]}>
              <MapPin size={16} color={t.color.go} />
            </View>
            <View style={{ flex: 1, marginLeft: t.space[3] }}>
              <Text style={s.stopLabel}>Deliver to</Text>
              <Text style={s.stopName}>{trip.customerName || 'Customer'}</Text>
            </View>
          </View>
          <Text style={s.stopAddress}>{trip.dropAddress}</Text>
          <View style={s.stopActions}>
            <Button
              label="Navigate"
              variant={outForDelivery || atDoorstep ? 'primary' : 'secondary'}
              icon={<Navigation size={16} color={outForDelivery || atDoorstep ? '#04231A' : t.color.text} />}
              onPress={() => openDirections(
                trip.dropCoordinates ? { ...trip.dropCoordinates, label: 'Customer' } : undefined,
                trip.dropAddress
              )}
              style={{ flex: 1 }}
            />
            <TouchableOpacity style={s.callBtn} onPress={() => callNumber(trip.customerPhone)} activeOpacity={0.85}>
              <Phone size={18} color={t.color.text} />
            </TouchableOpacity>
            {/* The customer app has always been able to message its rider. Until
                this control existed those messages arrived nowhere. */}
            <TouchableOpacity style={s.callBtn} onPress={onOpenChat} activeOpacity={0.85}>
              <MessageCircle size={18} color={t.color.text} />
              {unreadMessages > 0 ? (
                <View style={s.chatBadge}>
                  <Text style={s.chatBadgeText}>{unreadMessages > 9 ? '9+' : unreadMessages}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.metaGrid}>
          <Row label="Distance" value={distance(trip.distanceKm)} />
          <Row label="Items" value={`${trip.itemCount}`} />
          <Row
            label="Payment"
            value={trip.paymentMode === 'COD' ? `Collect ${rupees(trip.cashToCollect)}` : 'Paid online'}
            valueStyle={trip.paymentMode === 'COD' ? { color: t.color.money } : undefined}
          />
        </View>
      </Card>

      {/* Live location status, while carrying the order */}
      {outForDelivery || atDoorstep ? (
        <Card style={{ marginTop: t.space[3] }} tone="raised">
          {locationDenied ? (
            <Text style={s.telemetryWarn}>
              Location permission is off — the customer cannot see you approaching. Turn on location access for
              Quick Bites Rider in Settings.
            </Text>
          ) : (
            <Text style={s.telemetryOk}>
              Sharing your live location with the customer · {telemetryCount} update
              {telemetryCount === 1 ? '' : 's'} sent
            </Text>
          )}
        </Card>
      ) : null}

      {/* The one next action */}
      {headingToRestaurant ? (
        <Button
          label="I have arrived at the restaurant"
          size="lg"
          onPress={() => onAdvanceStage('AT_RESTAURANT')}
          style={{ marginTop: t.space[4] }}
        />
      ) : null}

      {atRestaurant ? (
        <Card style={{ marginTop: t.space[4] }} tone="raised">
          <Text style={s.actionTitle}>Pickup verification</Text>
          <Text style={s.actionBody}>
            Ask the kitchen for the four-digit pickup code shown on their screen for this order.
          </Text>
          <TextInput
            style={s.codeInput}
            value={pickupCode}
            onChangeText={setPickupCode}
            placeholder="0000"
            placeholderTextColor={t.color.textMuted}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Button
            label="Confirm pickup"
            size="lg"
            loading={busy}
            disabled={pickupCode.trim().length !== 4}
            onPress={async () => {
              const ok = await onVerifyPickup(pickupCode.trim());
              if (ok) setPickupCode('');
            }}
          />
        </Card>
      ) : null}

      {outForDelivery ? (
        <Button
          label="I have arrived at the customer"
          size="lg"
          onPress={() => onAdvanceStage('AT_DOORSTEP')}
          style={{ marginTop: t.space[4] }}
        />
      ) : null}

      {atDoorstep ? (
        <Card style={{ marginTop: t.space[4] }} tone="raised">
          <Text style={s.actionTitle}>Complete the delivery</Text>
          <Text style={s.actionBody}>
            Hand the order over, then ask the customer for the four-digit code on their app.
          </Text>

          {trip.paymentMode === 'COD' ? (
            <View style={s.codBox}>
              <IndianRupee size={18} color={t.color.money} />
              <Text style={s.codText}>Collect {rupees(trip.cashToCollect)} in cash before entering the code.</Text>
            </View>
          ) : null}

          <TextInput
            style={s.codeInput}
            value={otp}
            onChangeText={setOtp}
            placeholder="0000"
            placeholderTextColor={t.color.textMuted}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Button
            label="Verify and complete"
            size="lg"
            loading={busy}
            disabled={otp.trim().length !== 4}
            icon={<CheckCircle2 size={18} color="#04231A" />}
            onPress={async () => {
              const ok = await onCompleteDelivery(otp.trim());
              if (ok) setOtp('');
            }}
          />
        </Card>
      ) : null}

      <View style={s.escapeRow}>
        <TouchableOpacity onPress={confirmCancel} style={s.escapeBtn}>
          <Text style={s.escapeText}>Cannot complete this trip</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSos} style={[s.escapeBtn, s.sosBtn]}>
          <TriangleAlert size={15} color={t.color.danger} />
          <Text style={[s.escapeText, { color: t.color.danger, marginLeft: 6 }]}>SOS</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  chatBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: t.color.danger,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chatBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  content: { padding: t.space[4], paddingBottom: t.space[10] },
  stageBar: { flexDirection: 'row', alignItems: 'flex-start' },
  stageItem: { flex: 1, alignItems: 'center' },
  stageDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surface
  },
  stageLine: {
    position: 'absolute',
    top: 6,
    left: '50%',
    right: -50,
    height: 2,
    backgroundColor: t.color.border,
    zIndex: -1
  },
  stageLabel: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 6, fontWeight: t.font.weight.semibold },
  tripHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: t.space[4]
  },
  tripOrder: { color: t.color.text, fontSize: t.font.size.md, fontWeight: t.font.weight.bold },
  tripPlaced: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 2 },
  tripEarn: { color: t.color.money, fontSize: t.font.size.lg, fontWeight: t.font.weight.extrabold },
  stop: {
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    padding: t.space[3],
    backgroundColor: t.color.surfaceSunken
  },
  stopActive: { borderColor: t.color.borderStrong, backgroundColor: t.color.surfaceRaised },
  stopHead: { flexDirection: 'row', alignItems: 'center' },
  stopIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stopLabel: { color: t.color.textMuted, fontSize: t.font.size.xs, fontWeight: t.font.weight.semibold },
  stopName: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.bold, marginTop: 1 },
  stopAddress: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginTop: t.space[3], lineHeight: 19 },
  stopCoords: { color: t.color.textMuted, fontSize: t.font.size.xs, marginTop: 4 },
  stopActions: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[3] },
  callBtn: {
    width: 50,
    height: 50,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    backgroundColor: t.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: t.space[3]
  },
  stopConnector: { width: 2, height: 20, backgroundColor: t.color.borderStrong, marginLeft: 20, marginVertical: 2 },
  metaGrid: { marginTop: t.space[3], borderTopWidth: 1, borderTopColor: t.color.border },
  telemetryOk: { color: t.color.goText, fontSize: t.font.size.sm, lineHeight: 19 },
  telemetryWarn: { color: t.color.money, fontSize: t.font.size.sm, lineHeight: 19 },
  actionTitle: { color: t.color.text, fontSize: t.font.size.md, fontWeight: t.font.weight.bold },
  actionBody: { color: t.color.textSecondary, fontSize: t.font.size.sm, marginTop: t.space[2], lineHeight: 19 },
  codeInput: {
    backgroundColor: t.color.surfaceSunken,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.borderStrong,
    height: 66,
    marginVertical: t.space[4],
    color: t.color.text,
    fontSize: 30,
    fontWeight: t.font.weight.extrabold,
    letterSpacing: 14,
    textAlign: 'center'
  },
  codBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.moneySoft,
    borderRadius: t.radius.sm,
    padding: t.space[3],
    marginTop: t.space[3]
  },
  codText: { color: t.color.money, fontSize: t.font.size.sm, marginLeft: t.space[2], flex: 1, fontWeight: t.font.weight.semibold },
  offerHead: { flexDirection: 'row', alignItems: 'flex-start' },
  offerRestaurant: { color: t.color.text, fontSize: t.font.size.base, fontWeight: t.font.weight.bold },
  offerAddress: { color: t.color.textMuted, fontSize: t.font.size.sm, marginTop: 2 },
  offerPay: { color: t.color.money, fontSize: t.font.size.lg, fontWeight: t.font.weight.extrabold, marginLeft: t.space[3] },
  offerMeta: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[3], flexWrap: 'wrap' },
  offerActions: { flexDirection: 'row', marginTop: t.space[4] },
  escapeRow: { flexDirection: 'row', alignItems: 'center', marginTop: t.space[6] },
  escapeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.space[3],
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border
  },
  sosBtn: { marginLeft: t.space[3], borderColor: t.color.danger, backgroundColor: t.color.dangerSoft, flex: 0.7 },
  escapeText: { color: t.color.textMuted, fontSize: t.font.size.sm, fontWeight: t.font.weight.semibold }
});
