import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';

interface Props {
  children: React.ReactNode;
  /** Shown above the message, e.g. "Quick Bites". */
  appName?: string;
  accent?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a single bad screen cannot blank the whole app.
 *
 * Without this, an unhandled error in React Native unmounts the tree and the
 * user is left staring at a white screen with no way back — which is how a
 * missing native module presented previously.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept on the device log for triage; never shown to the user in release.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const accent = this.props.accent || '#5B0E20';

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.emoji}>·</Text>
          <Text style={[styles.title, { color: accent }]}>Something went wrong</Text>
          <Text style={styles.body}>
            {this.props.appName || 'The app'} hit an unexpected problem on this screen. Your data is
            safe — try again, and if it keeps happening please report it.
          </Text>

          {__DEV__ && (
            <View style={styles.devBox}>
              <Text style={styles.devText}>{String(error?.message || error)}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: accent }]}
            onPress={this.handleReset}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F2ED' },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emoji: { fontSize: 1, height: 0 },
  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: -0.4 },
  body: {
    fontSize: 14,
    color: '#6B6259',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 21,
    maxWidth: 340
  },
  devBox: {
    marginTop: 18,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FDECEC',
    borderWidth: 1,
    borderColor: '#F5C9C9',
    maxWidth: 360
  },
  devText: { fontSize: 12, color: '#D64545' },
  button: {
    marginTop: 24,
    height: 48,
    paddingHorizontal: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 }
});
