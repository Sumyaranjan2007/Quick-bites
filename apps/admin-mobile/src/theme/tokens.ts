/**
 * Quick Bites Operations — design tokens.
 *
 * The console is read for hours at a time in a back office, so legibility at
 * density is what it is tuned for. It now sits on the brand cream ground shared
 * with the rider and partner apps, so the four surfaces read as one product
 * rather than three.
 *
 * The signal colours are darker than their dark-theme equivalents on purpose: a
 * mint green or a bright amber that sings against near-black is close to
 * invisible against cream, and a status badge nobody can read is worse than no
 * badge. Gold is a fill behind near-black text, never text itself.
 *
 * Numbers, not strings: React Native rejects "px".
 */
export const tokens = {
  colors: {
    /** Page ground, cards, and the layers between them. */
    bg: {
      base: '#FFF7E8',
      raised: '#FFFFFF',
      card: '#FFFFFF',
      sunken: '#F6EBD6',
      overlay: 'rgba(23, 19, 19, 0.55)'
    },
    border: {
      subtle: '#EADCC2',
      medium: '#D8C39F',
      strong: '#C2A87E'
    },
    text: {
      primary: '#171313',
      secondary: '#5C5048',
      muted: '#8A7C70',
      inverse: '#FFF7E8'
    },
    brand: {
      maroon: '#641C32',
      maroonSoft: '#F7E7EB',
      amber: '#FFC928',
      amberSoft: '#FFF3CC',
      // Gold is unreadable as text on cream, so anything named *Text is the
      // deep gold that actually passes against this ground.
      amberText: '#8A5A00'
    },
    /** Status colours, each with the tinted ground its badge sits on. */
    state: {
      success: '#1E7A4C',
      successBg: '#E3F5EB',
      warning: '#B76E00',
      warningBg: '#FFF3CC',
      danger: '#C0392B',
      dangerBg: '#FBE7E4',
      info: '#2A6FB5',
      infoBg: '#E5EFF9',
      neutral: '#6E625A',
      neutralBg: '#F1E7D6'
    },
    chart: {
      line: '#641C32',
      fill: 'rgba(100, 28, 50, 0.14)',
      grid: '#EADCC2',
      secondary: '#B76E00'
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
      shadowOpacity: 0.10,
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
