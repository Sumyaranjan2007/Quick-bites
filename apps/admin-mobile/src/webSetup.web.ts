/**
 * The Admin app in a web browser, at /admin: the Glass Kitchen frame and the
 * browser stand-in for Alert.alert (see packages/design-system/src/web/glassShell.ts).
 *
 * Imported first in index.ts, so the colour changes below land before any
 * screen builds its StyleSheet. Screens sit straight on the frosted panel and
 * cards become milk glass; sheets stay nearly solid so their text stays sharp.
 */
import { Alert } from 'react-native';
import { installGlassShell } from '@quick-bites/design-system/src/web/glassShell';
import { tokens } from './theme/tokens';

installGlassShell(Alert, 'Quick Bites Operations');

const colors = tokens.colors as any;
Object.assign(colors.bg, {
  base: 'transparent',
  card: 'rgba(255,255,255,0.74)',
  raised: 'rgba(255,253,249,0.96)',
  sunken: 'rgba(246,235,214,0.62)'
});
Object.assign(colors.border, { subtle: 'rgba(100,28,50,0.12)' });
// A shade darker than on the phone: the glass behind it is busier than plain white.
Object.assign(colors.text, { muted: '#6F6257' });
