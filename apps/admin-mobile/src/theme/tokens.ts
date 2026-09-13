/**
 * Quick Bites Operations — design tokens.
 *
 * The console is the one Quick Bites surface that is read for hours at a time in
 * a back office, so it keeps the brand's maroon and amber but sits them on a
 * near-black ground: a cream canvas at this density is glare, and the figures
 * are what the screen is for.
 *
 * Numbers, not strings: React Native rejects "px".
 */
export const tokens = {
  colors: {
    /** Page ground, cards, and the layers between them. */
    bg: {
      base: '#120609',
      raised: '#1C0B11',
      card: '#24101A',
      sunken: '#0D0407',
      overlay: 'rgba(6, 2, 4, 0.82)'
    },
    border: {
      subtle: '#33161F',
      medium: '#45202C',
      strong: '#5E2C3A'
    },
    text: {
      primary: '#FCF5F0',
      secondary: '#C4AFA6',
      muted: '#907C76',
      inverse: '#1A0A10'
    },
    brand: {
      maroon: '#5B0E20',
      maroonSoft: '#3A0A15',
      amber: '#F5A623',
      amberSoft: '#3A2708',
      amberText: '#FFC766'
    },
    /** Status colours, each with the tinted ground its badge sits on. */
    state: {
      success: '#31C48D',
      successBg: '#0C3326',
      warning: '#F5A623',
      warningBg: '#3A2708',
      danger: '#F26D6D',
      dangerBg: '#3D1416',
      info: '#5AB0F5',
      infoBg: '#0F2A40',
      neutral: '#A28B83',
      neutralBg: '#2A1119'
    },
    chart: {
      line: '#F5A623',
      fill: 'rgba(245, 166, 35, 0.16)',
      grid: '#33161F',
      secondary: '#5AB0F5'
    }
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 40 },
  radius: { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },
  font: {
    size: { xxs: 10, xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 25, xxl: 32 },
    weight: {
      regular: '400' as const,
      medium: '500' as const,
      semibold: '600' as const,
      bold: '700' as const,
      heavy: '800' as const
    }
  },
  shadow: {
    card: {
      shadowColor: '#000000',
      shadowOpacity: 0.35,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6
    }
  }
} as const;

/** Maps a domain status onto a badge tone, so one status never has two looks. */
export function toneForStatus(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const value = String(status || '').toUpperCase();
  if (['DELIVERED', 'ACTIVE', 'PAID', 'APPROVED', 'REFUNDED', 'RESOLVED', 'LIVE', 'ONLINE'].includes(value)) {
    return 'success';
  }
  if (['CANCELLED', 'REJECTED', 'FAILED', 'SUSPENDED', 'BLOCKED', 'EXPIRED', 'OPEN'].includes(value)) {
    return 'danger';
  }
  if (['PENDING', 'PENDING_APPROVAL', 'REQUESTED', 'PROCESSING', 'IN_PROGRESS', 'PAYMENT_PENDING', 'SCHEDULED'].includes(value)) {
    return 'warning';
  }
  if (
    ['ORDER_PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'OUT_FOR_DELIVERY'].includes(value)
  ) {
    return 'info';
  }
  return 'neutral';
}

/** "OUT_FOR_DELIVERY" reads as "Out for delivery" on screen. */
export function humanise(value: string): string {
  if (!value) return '';
  const spaced = String(value).replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Rupees, grouped the Indian way, because the operators reading this are in India. */
export function formatMoney(value: number | undefined | null, withDecimals = false): string {
  const amount = Number(value) || 0;
  const rounded = withDecimals ? amount.toFixed(2) : Math.round(amount).toString();
  const [whole, decimals] = rounded.split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `₹${grouped}${decimals ? `.${decimals}` : ''}`;
}

/** Compact figures for stat tiles: 1.2L, 45.3K. */
export function formatCompactMoney(value: number | undefined | null): string {
  const amount = Number(value) || 0;
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
  return formatMoney(amount);
}

/** "4 min ago", "2 h ago" — relative time is what an operator actually reads. */
export function timeAgo(iso: string | undefined | null): string {
  if (!iso) return '—';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(seconds)) return '—';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}
