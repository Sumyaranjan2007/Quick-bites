import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { Mic, X, Check } from 'lucide-react-native';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent
} from 'expo-speech-recognition';
import { tokens } from '../theme/tokens';
import { useTranslation } from '../lib/i18n';

const c = tokens.colors;

interface Props {
  visible: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}

/** Interface language decides the recogniser's language, so Kannada speech is
 *  transcribed as Kannada rather than being forced through an English model. */
const LOCALE: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN' };

/**
 * Voice search.
 *
 * The microphone in the search bar used to be an icon with no handler attached.
 * This drives the device's own speech recogniser: partial results stream in as
 * the person speaks, and the final transcript is handed back to the search box.
 *
 * Everything can refuse - permission denied, no recogniser on the device, no
 * network for the online model - so every failure ends in a sentence saying what
 * happened, rather than a spinner that never resolves.
 */
export const VoiceSearchSheet: React.FC<Props> = ({ visible, onClose, onResult }) => {
  const { language } = useTranslation();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const finalRef = useRef('');

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
    setStarting(false);
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setStarting(false);
  });

  useSpeechRecognitionEvent('result', event => {
    const text = event.results?.[0]?.transcript ?? '';
    setTranscript(text);
    if (event.isFinal) finalRef.current = text;
  });

  useSpeechRecognitionEvent('error', event => {
    setListening(false);
    setStarting(false);
    const code = String(event.error ?? '');
    if (code.includes('no-speech')) setError("Didn't catch that. Try again a little closer to the phone.");
    else if (code.includes('network')) setError('Voice search needs a connection. Check your network.');
    else if (code.includes('not-allowed') || code.includes('permission'))
      setError('Microphone access is needed for voice search.');
    else setError('Voice search is not available on this device right now.');
  });

  const start = async () => {
    setError(null);
    setTranscript('');
    finalRef.current = '';
    setStarting(true);
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setStarting(false);
        setError('Microphone access is needed for voice search. Allow it in Settings to use the mic.');
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: LOCALE[language] ?? 'en-IN',
        interimResults: true,
        continuous: false
      });
    } catch {
      setStarting(false);
      setError('Voice search could not start on this device.');
    }
  };

  const stop = () => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      /* Already stopped. */
    }
  };

  // Listening begins with the sheet, and always ends with it - a recogniser left
  // running holds the microphone open after the user has walked away.
  useEffect(() => {
    if (visible) start();
    else stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const accept = () => {
    const text = (finalRef.current || transcript).trim();
    stop();
    if (text) onResult(text);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => {
              stop();
              onClose();
            }}
            activeOpacity={0.8}
          >
            <X size={19} color={c.text.secondary} />
          </TouchableOpacity>

          <View style={[styles.micRing, listening && styles.micRingLive]}>
            {starting ? <ActivityIndicator color={c.primary[500]} /> : <Mic size={34} color={listening ? '#FFFFFF' : c.primary[500]} />}
          </View>

          <Text style={styles.status}>
            {error ? 'Voice search' : listening ? 'Listening…' : starting ? 'Starting…' : 'Tap the mic to speak'}
          </Text>

          {!!transcript && <Text style={styles.transcript}>“{transcript}”</Text>}
          {!!error && <Text style={styles.error}>{error}</Text>}

          {!listening && !starting && (
            <TouchableOpacity style={styles.retry} onPress={start} activeOpacity={0.85}>
              <Mic size={16} color={c.primary[500]} />
              <Text style={styles.retryText}>{error ? 'Try again' : 'Start listening'}</Text>
            </TouchableOpacity>
          )}

          {!!transcript && (
            <TouchableOpacity style={styles.useBtn} onPress={accept} activeOpacity={0.88}>
              <Check size={17} color="#FFFFFF" />
              <Text style={styles.useBtnText}>Search for this</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.hint}>Try “biryani”, “pure veg” or a restaurant name.</Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,16,20,0.55)', alignItems: 'center', justifyContent: 'center', padding: 26 },
  sheet: {
    width: '100%',
    backgroundColor: c.surface.app,
    borderRadius: 22,
    padding: 24,
    alignItems: 'center'
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface.sunken
  },
  micRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: c.primary[300],
    backgroundColor: c.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8
  },
  micRingLive: { backgroundColor: c.primary[500], borderColor: c.primary[500] },
  status: { marginTop: 16, fontSize: 15.5, fontWeight: '800', color: c.text.primary },
  transcript: {
    marginTop: 10,
    fontSize: 17,
    color: c.text.primary,
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '600'
  },
  error: { marginTop: 10, fontSize: 13, color: c.semantic.error, textAlign: 'center', lineHeight: 19 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    borderWidth: 1,
    borderColor: c.primary[500],
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18
  },
  retryText: { color: c.primary[500], fontSize: 14, fontWeight: '800' },
  useBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    backgroundColor: c.primary[500],
    borderRadius: 13,
    paddingVertical: 13,
    paddingHorizontal: 22,
    alignSelf: 'stretch'
  },
  useBtnText: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '800' },
  hint: { marginTop: 14, fontSize: 11.5, color: c.text.muted, textAlign: 'center' }
});
