export const tokens = {
  colors: {
    primary: {
      50: '#FBF1F3',
      100: '#F5DDE2',
      500: '#5B0E20',
      600: '#4A0D1F',
      700: '#3D0A17'
    },
    accent: {
      400: '#FFB84D',
      500: '#F5A623',
      600: '#E08E0B'
    },
    dietary: {
      veg: '#0F8A5F',
      vegBg: '#E7F7F0',
      nonveg: '#D64545',
      nonvegBg: '#FDECEC',
      gold: '#B4801A',
      goldBg: '#FDF3DD'
    },
    semantic: {
      success: '#0F8A5F',
      warning: '#E08E0B',
      error: '#D64545',
      info: '#2563EB'
    }
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
    16: '64px'
  },
  radii: {
    xs: '2px',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    '2xl': '24px',
    full: '9999px'
  },
  typography: {
    fontFamilySans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontFamilyMono: "'JetBrains Mono', monospace"
  }
} as const;
