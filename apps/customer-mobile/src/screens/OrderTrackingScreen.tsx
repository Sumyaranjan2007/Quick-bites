import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import { tokens } from '../theme/tokens';
import { CheckCircle2, Clock, Bike, ShieldCheck, Phone, ArrowLeft } from 'lucide-react-native';

interface Props {
  orderNumber: string;
  total: number;
  otp: string;
  onHome: () => void;
}

export const OrderTrackingScreen: React.FC<Props> = ({
  orderNumber,
  total,
  otp,
  onHome
}) => {
  const [currentStep, setCurrentStep] = useState<number>(2); // 0: Placed, 1: Accepted, 2: Preparing, 3: Out for Delivery, 4: Delivered

  const steps = [
    { title: 'Order Confirmed', time: '12:45 PM', desc: 'Received by Bangalore Biryani House' },
    { title: 'Kitchen Accepted', time: '12:46 PM', desc: 'Chef started food preparation' },
    { title: 'Cooking in Progress', time: '12:50 PM', desc: 'Your authentic biryani is simmering' },
    { title: 'Out for Delivery', time: 'Est. 1:05 PM', desc: 'Rider assigned and on the way' },
    { title: 'Delivered', time: 'Est. 1:15 PM', desc: 'Verify with 4-digit OTP upon arrival' }
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Header */}
      <TouchableOpacity style={styles.backButton} onPress={onHome}>
        <ArrowLeft size={20} color="#0F172A" />
        <Text style={styles.backText}>Return to Home</Text>
      </TouchableOpacity>

      {/* Hero Delivery Card */}
      <View style={styles.heroCard}>
        <Text style={styles.estimatedTime}>Estimated Arrival: 25 Mins</Text>
        <Text style={styles.orderMeta}>Order ID: {orderNumber} • Paid: Rs {total.toFixed(2)}</Text>

        {/* Secure 4-Digit OTP Badge */}
        <View style={styles.otpContainer}>
          <Text style={styles.otpLabel}>DELIVERY VERIFICATION OTP</Text>
          <Text style={styles.otpValue}>{otp}</Text>
          <Text style={styles.otpHelp}>
            Do NOT share this OTP until you receive the sealed package.
          </Text>
        </View>
      </View>

      {/* Live Order Journey Timeline */}
      <View style={styles.timelineCard}>
        <Text style={styles.timelineHeader}>Live Order Journey</Text>

        {steps.map((step, idx) => {
          const isDone = idx <= currentStep;
          const isCurrent = idx === currentStep;

          return (
            <View key={idx} style={styles.timelineItem}>
              <View style={styles.timelineLeft}>
                <View style={[styles.timelineDot, isDone && styles.timelineDotDone]}>
                  {isDone && <CheckCircle2 size={12} color="#FFFFFF" />}
                </View>
                {idx < steps.length - 1 && (
                  <View style={[styles.timelineLine, idx < currentStep && styles.timelineLineDone]} />
                )}
              </View>

              <View style={styles.timelineRight}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={[styles.stepTitle, isCurrent && styles.stepTitleCurrent]}>
                    {step.title}
                  </Text>
                  <Text style={styles.stepTime}>{step.time}</Text>
                </View>
                <Text style={styles.stepDesc}>{step.desc}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Delivery Partner Card */}
      <View style={styles.riderCard}>
        <View style={styles.riderAvatar}>
          <Bike size={24} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.riderName}>Ravi Kumar (Verified Partner)</Text>
          <Text style={styles.riderVehicle}>Hero Electric Splendor • KA-03-EQ-8812</Text>
        </View>
        <View style={styles.callIcon}>
          <Phone size={18} color={tokens.colors.primary[500]} />
        </View>
      </View>

      {/* Simulator Advance Button for Testing */}
      <TouchableOpacity
        style={styles.advanceButton}
        onPress={() => setCurrentStep(prev => (prev < steps.length - 1 ? prev + 1 : prev))}
      >
        <Text style={styles.advanceButtonText}>Simulate Next Order Status</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16
  },
  backText: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600'
  },
  heroCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16
  },
  estimatedTime: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF'
  },
  orderMeta: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 4,
    fontFamily: 'monospace'
  },
  otpContainer: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
    width: '100%'
  },
  otpLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 1
  },
  otpValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFA233',
    letterSpacing: 8,
    fontFamily: 'monospace',
    marginVertical: 4
  },
  otpHelp: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center'
  },
  timelineCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16
  },
  timelineHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 16
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 16
  },
  timelineLeft: {
    alignItems: 'center',
    width: 24,
    marginRight: 12
  },
  timelineDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center'
  },
  timelineDotDone: {
    backgroundColor: tokens.colors.dietary.veg
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E2E8F0',
    marginTop: 4
  },
  timelineLineDone: {
    backgroundColor: tokens.colors.dietary.veg
  },
  timelineRight: {
    flex: 1
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569'
  },
  stepTitleCurrent: {
    color: tokens.colors.primary[500],
    fontWeight: '800'
  },
  stepTime: {
    fontSize: 11,
    color: '#94A3B8'
  },
  stepDesc: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2
  },
  riderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  riderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tokens.colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center'
  },
  riderName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A'
  },
  riderVehicle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2
  },
  callIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tokens.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center'
  },
  advanceButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1'
  },
  advanceButtonText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 13
  }
});
