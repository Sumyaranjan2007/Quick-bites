import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator
} from 'react-native';
import { Star, X } from 'lucide-react-native';
import { tokens } from '../theme/tokens';
import { apiFetch } from '../lib/apiFetch';
import { parseApiError } from '../lib/apiErrors';

const c = tokens.colors;

interface Props {
  visible: boolean;
  onClose: () => void;
  onRated: (rating: number) => void;
  orderId?: string;
  apiUrl?: string;
  token?: string;
  restaurantName?: string;
  riderName?: string | null;
}

const WORDS = ['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'];

export const RatingSheet: React.FC<Props> = ({
  visible,
  onClose,
  onRated,
  orderId,
  apiUrl,
  token,
  restaurantName,
  riderName
}) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!rating || !orderId || !apiUrl || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`${apiUrl}/orders/${orderId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(parseApiError(data, 'Your rating could not be saved.').message);
        return;
      }
      onRated(rating);
      onClose();
    } catch {
      setError('Could not reach Quick Bites. Check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>How was your order?</Text>
              <Text style={styles.subtitle}>
                {restaurantName}
                {riderName ? ` · delivered by ${riderName}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.8}>
              <X size={19} color={c.text.secondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map(value => (
              <TouchableOpacity
                key={value}
                onPress={() => setRating(value)}
                activeOpacity={0.7}
                style={styles.starTap}
                accessibilityLabel={`${value} star${value > 1 ? 's' : ''}`}
              >
                <Star
                  size={38}
                  color={value <= rating ? c.accent[500] : c.border.strong}
                  fill={value <= rating ? c.accent[500] : 'transparent'}
                />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.word}>{WORDS[rating] || 'Tap a star to rate'}</Text>

          <TextInput
            style={styles.input}
            value={comment}
            onChangeText={setComment}
            placeholder="Anything you'd like to add? (optional)"
            placeholderTextColor={c.text.muted}
            multiline
            maxLength={500}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.submit, (!rating || submitting) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!rating || submitting}
            activeOpacity={0.88}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>Submit rating</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,16,20,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.surface.app,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 28
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 18 },
  title: { fontSize: 19, fontWeight: '800', color: c.text.primary },
  subtitle: { fontSize: 13, color: c.text.secondary, marginTop: 3 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface.sunken
  },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  starTap: { padding: 4 },
  word: {
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
    fontSize: 14,
    fontWeight: '700',
    color: c.text.secondary
  },
  input: {
    backgroundColor: c.surface.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border.medium,
    padding: 13,
    minHeight: 88,
    textAlignVertical: 'top',
    fontSize: 14.5,
    color: c.text.primary
  },
  error: { color: c.semantic.error, fontSize: 12.5, fontWeight: '600', marginTop: 10 },
  submit: {
    backgroundColor: c.primary[500],
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 16
  },
  submitText: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '800' }
});
