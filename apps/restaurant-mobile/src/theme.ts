/**
 * The partner app's palette.
 *
 * A kitchen screen is looked at in glances, often on a grease-smeared phone
 * propped by the pass, so contrast matters more than subtlety. This is the
 * brand cream ground shared with the rider and operations apps; it replaces a
 * warm dark scheme, and a kitchen is a bright room, which is the case a dark
 * palette handles worst.
 *
 * Burgundy carries structure, gold carries anything that needs acting on — as a
 * fill behind near-black text, never as text itself, because gold on cream is
 * close to invisible.
 */
export const c = {
  bg: '#FFF7E8',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  border: '#EADCC2',

  text: '#171313',
  textMuted: '#8A7C70',
  textSoft: '#5C5048',

  brand: '#641C32',
  brandDeep: '#4A1425',

  success: '#1E7A4C',
  successSoft: '#E3F5EB',
  danger: '#C0392B',
  warning: '#B76E00',
  info: '#2A6FB5',

  veg: '#1E7A4C',
  nonVeg: '#C0392B'
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28
} as const;

export const radii = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999
} as const;
