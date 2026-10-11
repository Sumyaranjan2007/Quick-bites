/**
 * Anonymous access: every route, called with no sign-in.
 *
 * The owner's rule (11 Oct 2026): no open API calls. Each route in the running
 * application is called with no token; anything that answers below 400 must be
 * on the PUBLIC list below, with the reason it is public. A new route that
 * forgets its auth middleware fails this suite by name.
 */
import { createApp } from '../app.ts';
import { seedDatabase } from '../db/seed.ts';

/** Routes a stranger may call, and why. Path patterns use Express syntax. */
const WEB = 'web page: the home page, the legal pages Google requires, or a sign-in page';
const HEALTH = 'Railway health check';
const BROWSE = 'customers browse before signing in (App Store guideline 5.1.1)';
const PUBLIC: Record<string, string> = {
  'GET /': WEB,
  'GET /logo.png': WEB,
  'GET /privacy': WEB,
  'GET /terms': WEB,
  'GET /delete-account': WEB,
  'GET /partner': WEB,
  'GET /partner/*': WEB,
  'GET /admin': WEB,
  'GET /admin/*': WEB,
  'GET /health': HEALTH,
  'GET /api/health': HEALTH,
  'GET /api/v1/health': HEALTH,
  'GET /api/restaurants': BROWSE,
  'GET /api/v1/restaurants': BROWSE,
  'GET /api/search': BROWSE,
  'GET /api/v1/search': BROWSE,
  'GET /api/search/suggestions': BROWSE,
  'GET /api/v1/search/suggestions': BROWSE,
  'GET /api/membership/plans': BROWSE,
  'GET /api/v1/membership/plans': BROWSE,
  'GET /api/policies/payments': 'payment rules shown at checkout',
  'GET /api/v1/policies/payments': 'payment rules shown at checkout',
  'GET /api/policies/business': "the business's own contact details for Help screens",
  'GET /api/v1/policies/business': "the business's own contact details for Help screens",
  // Razorpay's key id is public by design (the checkout needs it); the secret never leaves the server.
  'GET /api/payments/config': 'Razorpay public key id for checkout',
  'GET /api/v1/payments/config': 'Razorpay public key id for checkout'
};

function mountPrefix(layer: any): string {
  const re = layer?.regexp;
  if (!re || re.fast_slash) return '';
  const match = String(re.source).match(/^\^\\\/((?:[\w\-.~%]|\\.)*)\\\/\?/);
  return match ? '/' + match[1].replace(/\\(.)/g, '$1') : '';
}

function collect(app: any): Array<{ method: string; path: string }> {
  const found: Array<{ method: string; path: string }> = [];
  const walk = (stack: any[], base: string): void => {
    for (const layer of stack || []) {
      if (layer.route?.path) {
        for (const method of Object.keys(layer.route.methods || {})) {
          if (method === '_all') continue;
          for (const p of [].concat(layer.route.path)) {
            found.push({ method: method.toUpperCase(), path: (base + String(p)).replace(/\/$/, '') || '/' });
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, base + mountPrefix(layer));
      }
    }
  };
  walk((app._router || app.router)?.stack, '');
  return found;
}

async function run(): Promise<void> {
  await seedDatabase();
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  const open: string[] = [];
  for (const { method, path } of collect(app)) {
    const url = base + path.replace(/:(\w+)\??/g, 'probe').replace(/\*$/, 'probe');
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' || method === 'HEAD' ? undefined : '{}'
    }).catch(() => null);
    const status = res ? res.status : 0;
    if (status && status < 400 && !PUBLIC[`${method} ${path}`]) open.push(`${method} ${path} -> ${status}`);
  }
  server.close();

  if (open.length) {
    console.log(`[FAIL] ${open.length} route(s) answer a caller with no sign-in and are not on the public list:`);
    for (const line of open) console.log('   ' + line);
    setTimeout(() => process.exit(1), 50);
  } else {
    console.log('[PASS] Every route refuses a caller with no sign-in, except the reviewed public list');
    setTimeout(() => process.exit(0), 50);
  }
}

run().catch(err => {
  console.error('[FAIL] anonymous access check crashed:', err);
  process.exit(1);
});
