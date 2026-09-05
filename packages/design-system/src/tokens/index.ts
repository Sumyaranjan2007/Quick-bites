export const tokens = {
  colors: {
    primary: {
      50: '#FDF2F2',
      100: '#FDE8EA',
      500: '#E23744',
      600: '#C62835',
      700: '#A51D29'
    },
    accent: {
      400: '#FFA233',
      500: '#FF8A00',
      600: '#E07A00'
    },
    dietary: {
      veg: '#0F8A3C',
      vegBg: '#E8F5E9',
      nonveg: '#E23744',
      nonvegBg: '#FDE8EA',
      gold: '#D97706',
      goldBg: '#FEF3C7'
    },
    semantic: {
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6'
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
