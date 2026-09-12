import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '../tokens/index.ts';
import { translate, SUPPORTED_LANGUAGES } from '../i18n/translate.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runDesignSystemTests() {
  console.log('====================================================');
  console.log('    RUNNING CHUNK 06 DESIGN SYSTEM & I18N TESTS     ');
  console.log('====================================================\n');

  // Test 1: Design Token Constants
  console.log('Test 1: Validating Design Tokens & Strict Indian Food Colors...');
  assert.strictEqual(tokens.colors.primary[500], '#5B0E20', 'Brand maroon color mismatch');
  assert.strictEqual(tokens.colors.dietary.veg, '#0F8A5F', 'FSSAI Veg Green color mismatch');
  assert.strictEqual(tokens.colors.dietary.nonveg, '#D64545', 'FSSAI Non-Veg red color mismatch');
  assert.strictEqual(tokens.colors.dietary.gold, '#B4801A', 'Quick Bites Gold Amber color mismatch');
  assert.strictEqual(tokens.spacing[4], '16px', 'Spacing 4px grid mismatch');
  console.log('[PASS] Test 1: Design tokens match approved DESIGN_TOKENS.md specification');

  // Test 2: CSS Token Files Existence and Content Check
  console.log('\nTest 2: Verifying CSS custom property tokens file...');
  const tokensCssPath = path.resolve(__dirname, '../styles/tokens.css');
  const componentsCssPath = path.resolve(__dirname, '../styles/components.css');
  
  assert.ok(fs.existsSync(tokensCssPath), 'tokens.css must exist');
  assert.ok(fs.existsSync(componentsCssPath), 'components.css must exist');

  const tokensCss = fs.readFileSync(tokensCssPath, 'utf-8');
  assert.ok(tokensCss.includes('--color-primary-500: #5B0E20;'), 'tokens.css missing canonical brand maroon');
  assert.ok(tokensCss.includes('[data-theme="dark"]'), 'tokens.css missing dark theme overrides');
  assert.ok(tokensCss.includes('--bg-app: #17090E;'), 'tokens.css missing dark mode background');

  const componentsCss = fs.readFileSync(componentsCssPath, 'utf-8');
  assert.ok(componentsCss.includes('.qb-dietary-icon-veg'), 'components.css missing zero-emoji pure CSS veg icon');
  assert.ok(componentsCss.includes('.qb-dietary-icon-nonveg'), 'components.css missing zero-emoji pure CSS nonveg icon');
  assert.ok(componentsCss.includes('.qb-skeleton'), 'components.css missing skeleton shimmer animation');
  // The TS token module and the CSS custom properties are two copies of the same
  // palette — assert they agree so a change to one cannot silently skip the other.
  assert.ok(
    tokensCss.includes(`--color-primary-500: ${tokens.colors.primary[500]};`),
    'tokens.css primary-500 does not match the TS token module'
  );
  assert.ok(
    tokensCss.includes(`--color-veg: ${tokens.colors.dietary.veg};`),
    'tokens.css --color-veg does not match the TS token module'
  );
  console.log('[PASS] Test 2: CSS tokens verified and in sync with the TS token module');

  // Test 3: Multi-Language i18n Translation Coverage
  console.log('\nTest 3: Testing i18n translations (English, Hindi, Kannada)...');
  assert.strictEqual(SUPPORTED_LANGUAGES.length, 3, 'Must support exactly 3 languages (EN, HI, KN)');

  // 3a. English
  const enApp = translate('en', 'common.appName');
  const enDelivery = translate('en', 'customer.deliveryIn', { minutes: 25 });
  assert.strictEqual(enApp, 'Quick Bites');
  assert.strictEqual(enDelivery, 'Delivery in 25 mins');

  // 3b. Hindi
  const hiApp = translate('hi', 'common.appName');
  const hiDelivery = translate('hi', 'customer.deliveryIn', { minutes: 25 });
  const hiVeg = translate('hi', 'common.veg');
  assert.strictEqual(hiApp, 'क्विक बाइट्स');
  assert.strictEqual(hiDelivery, '25 मिनट में डिलीवरी');
  assert.strictEqual(hiVeg, 'शुद्ध शाकाहारी');

  // 3c. Kannada
  const knApp = translate('kn', 'common.appName');
  const knDelivery = translate('kn', 'customer.deliveryIn', { minutes: 25 });
  const knVeg = translate('kn', 'common.veg');
  assert.strictEqual(knApp, 'ಕ್ವಿಕ್ ಬೈಟ್ಸ್');
  assert.strictEqual(knDelivery, '25 ನಿಮಿಷಗಳಲ್ಲಿ ವಿತರಣೆ');
  assert.strictEqual(knVeg, 'ಶುದ್ಧ ಸಸ್ಯಾಹಾರಿ');

  console.log('[PASS] Test 3: Multi-language translations verified:');
  console.log(`       - English: "${enDelivery}"`);
  console.log(`       - Hindi:   "${hiDelivery}"`);
  console.log(`       - Kannada: "${knDelivery}"`);

  // Test 4: 4-State UI Components Export Verification
  console.log('\nTest 4: Verifying UI component modules...');
  const indexTsPath = path.resolve(__dirname, '../index.ts');
  const indexContent = fs.readFileSync(indexTsPath, 'utf-8');
  assert.ok(indexContent.includes('Button'), 'index.ts must export Button');
  assert.ok(indexContent.includes('Badge'), 'index.ts must export Badge');
  assert.ok(indexContent.includes('Card'), 'index.ts must export Card');
  assert.ok(indexContent.includes('Input'), 'index.ts must export Input');
  assert.ok(indexContent.includes('Skeleton'), 'index.ts must export Skeleton');
  assert.ok(indexContent.includes('StateView'), 'index.ts must export StateView (4-state UI container)');
  assert.ok(indexContent.includes('ErrorBoundary'), 'index.ts must export ErrorBoundary');
  assert.ok(indexContent.includes('ThemeProvider'), 'index.ts must export ThemeProvider');
  console.log('[PASS] Test 4: All 8 core UI primitives and 4-State containers exported');

  console.log('\n====================================================');
  console.log(' ALL CHUNK 06 DESIGN SYSTEM & I18N TESTS PASSED!    ');
  console.log('====================================================\n');
}

runDesignSystemTests().catch(err => {
  console.error('\n[FAIL] Design system test suite failed:', err);
  process.exit(1);
});
