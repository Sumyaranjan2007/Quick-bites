/**
 * Quick Bites design tokens (React Native).
 * Warm cream canvas, deep maroon brand, amber accent — matched to the Quickbits mark.
 * Spacing and radii are numbers because React Native styles reject "px" strings.
 */
export const tokens = {
  colors: {
    // Deep maroon carries the brand: headers, primary buttons, hero type.
    primary: {
      50: '#FBF1F3',
      100: '#F5DDE2',
      300: '#A83E58',
      500: '#5B0E20',
      600: '#4A0D1F',
      700: '#3D0A17',
      900: '#2A0710'
    },
    // Amber is the call-to-action and offer colour.
    accent: {
      50: '#FEF6E7',
      300: '#FFD07A',
      400: '#FFB84D',
      500: '#F5A623',
      600: '#E08E0B'
    },
    surface: {
      app: '#F7F2ED',
      card: '#FFFFFF',
      subtle: '#FDF9F5',
      sunken: '#F1E9E1',
      inverse: '#2A0710'
    },
    text: {
      primary: '#1A1014',
      secondary: '#6B6259',
      muted: '#9C948B',
      inverse: '#FFFFFF',
      onAccent: '#3D0A17'
    },
    border: {
      subtle: '#EFE7DF',
      medium: '#E2D7CC',
      strong: '#CDBDAE'
    },
    dietary: {
      veg: '#0F8A5F',
      vegBg: '#E7F7F0',
      nonveg: '#D64545',
      nonvegBg: '#FDECEC',
      gold: '#B4801A',
      goldBg: '#FDF3DD'
    },
    rating: {
      base: '#1BA672',
      text: '#FFFFFF'
    },
    semantic: {
      success: '#0F8A5F',
      warning: '#E08E0B',
      error: '#D64545',
      info: '#2563EB'
    }
  },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32, 10: 40, 12: 48, 16: 64 },
  radii: { sm: 8, md: 12, lg: 16, xl: 20, '2xl': 28, full: 999 },
  font: {
    size: { xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, '2xl': 30, '3xl': 34 },
    weight: {
      regular: '400' as const,
      medium: '500' as const,
      semibold: '600' as const,
      bold: '700' as const,
      extrabold: '800' as const
    }
  },
  // Soft, warm-tinted elevation — flat grey shadows look cheap on a cream canvas.
  shadow: {
    card: {
      shadowColor: '#5B3A22',
      shadowOpacity: 0.08,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3
    },
    floating: {
      shadowColor: '#2A0710',
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10
    }
  }
} as const;
