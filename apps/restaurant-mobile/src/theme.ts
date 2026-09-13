/**
 * The partner app's palette.
 *
 * A warm dark scheme: a kitchen screen is looked at in glances, often on a
 * grease-smeared phone propped by the pass, so contrast matters more than
 * subtlety. Brand amber carries anything that needs acting on; the maroon
 * surfaces come from the Quick Bites logo.
 */
export const c = {
  bg: '#17090E',
  surface: '#26111A',
  surfaceRaised: '#2F1622',
  border: '#3E1E28',

  text: '#FBF3EE',
  textMuted: '#A8968E',
  textSoft: '#D8C9C0',

  brand: '#F5A623',
  brandDeep: '#E08E0B',

  success: '#2E9E62',
  successSoft: '#123B28',
  danger: '#D2544B',
  warning: '#E0A62B',
  info: '#4A8FD4',

  veg: '#2E9E62',
  nonVeg: '#D2544B'
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
