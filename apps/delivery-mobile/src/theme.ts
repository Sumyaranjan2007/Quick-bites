/**
 * Quick Bites Rider — design tokens.
 *
 * A rider reads this screen one-handed, often with the phone clamped to a
 * handlebar and usually in daylight. So: very large numerals for the things
 * that matter (money, codes, distance), generous hit targets, and exactly one
 * accent colour for "go" so the eye never has to hunt for the next action.
 *
 * The canvas is the brand cream, shared now with the partner and operations
 * apps so the four surfaces read as one product. It replaces a dark scheme
 * chosen for night riding; daylight is the harder case and the one riders are
 * in most of the time, and a cream ground is far easier to read under sun.
 *
 * Signal colours are darkened from their usual values because a colour that
 * reads well on near-black is often unreadable on cream — mint green and bright
 * gold both vanish. Gold stays as a FILL behind near-black text, never as text.
 */
export const t = {
  color: {
    // Canvas and raised surfaces. Cream ground, white cards.
    bg: '#FFF7E8',
    surface: '#FFFFFF',
    surfaceRaised: '#FFFFFF',
    surfaceSunken: '#F6EBD6',
    border: '#EADCC2',
    borderStrong: '#D8C39F',

    // Text.
    text: '#171313',
    textSecondary: '#5C5048',
    textMuted: '#8A7C70',
    textInverse: '#FFF7E8',

    // Signals.
    go: '#1E7A4C',
    goSoft: '#E3F5EB',
    goText: '#14603A',
    money: '#8A5A00',
    moneySoft: '#FFF3CC',
    danger: '#C0392B',
    dangerSoft: '#FBE7E4',
    warning: '#B76E00',
    info: '#2A6FB5',
    brand: '#641C32',
    brandSoft: '#F7E7EB'
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48 },
  radius: { sm: 10, md: 14, lg: 20, xl: 26, full: 999 },
  font: {
    size: { xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, xxl: 30, display: 38 },
    weight: {
      medium: '500' as const,
      semibold: '600' as const,
      bold: '700' as const,
      extrabold: '800' as const
    }
  },
  shadow: {
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0.35,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6
    },
    lifted: {
      shadowColor: '#000000',
      shadowOpacity: 0.5,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 14
    }
  }
} as const;

export type Theme = typeof t;
