/**
 * Quick Bites Rider — design tokens.
 *
 * A rider reads this screen in daylight, one-handed, often with the phone
 * clamped to a handlebar. So: a dark canvas that does not glare at night, very
 * large numerals for the things that matter (money, codes, distance), generous
 * hit targets, and exactly one accent colour for "go" so the eye never has to
 * hunt for the next action.
 *
 * The maroon and amber come from the Quick Bites brand shared with the customer
 * and partner apps; the mint green is the rider app's own signal colour for
 * being on shift.
 */
export const t = {
  color: {
    // Canvas and raised surfaces.
    bg: '#140A0E',
    surface: '#211219',
    surfaceRaised: '#2C1922',
    surfaceSunken: '#0E0609',
    border: '#3A2029',
    borderStrong: '#4E2C38',

    // Text.
    text: '#FBF3EE',
    textSecondary: '#CBB6AF',
    textMuted: '#94807B',
    textInverse: '#1A0A10',

    // Signals.
    go: '#24C88E',
    goSoft: '#0E4534',
    goText: '#5BE5B4',
    money: '#FFC24D',
    moneySoft: '#3E2C10',
    danger: '#F0555B',
    dangerSoft: '#3E1218',
    warning: '#F5A623',
    info: '#5B9BFF',
    brand: '#8E1F3C',
    brandSoft: '#3A0E1D'
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
