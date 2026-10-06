/**
 * The Partner app in a web browser, at /partner: the Glass Kitchen frame and the
 * browser stand-in for Alert.alert (see packages/design-system/src/web/glassShell.ts).
 *
 * Imported first in index.ts, so the colour changes below land before any
 * screen builds its StyleSheet. Screens sit straight on the frosted panel and
 * cards become milk glass; raised surfaces stay nearly solid so text stays sharp.
 */
import { Alert } from 'react-native';
import { installGlassShell } from '@quick-bites/design-system/src/web/glassShell';
import { c } from './theme';

installGlassShell(Alert, 'Quick Bites Partner');

Object.assign(c as any, {
  bg: 'transparent',
  surface: 'rgba(255,255,255,0.74)',
  surfaceRaised: 'rgba(255,253,249,0.96)',
  border: 'rgba(100,28,50,0.12)',
  // A shade darker than on the phone: the glass behind it is busier than plain white.
  textMuted: '#6F6257'
});
