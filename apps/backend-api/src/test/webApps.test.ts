/**
 * THE /partner AND /admin WEBSITES, as the server hands them out.
 *
 * A fake build in a temp folder stands in for scripts/build-web.mjs. What
 * matters: any page path loads the app, the page is never cached but its
 * hashed bundle is, a missing bundle is a 404 rather than the page (an HTML
 * reply to a script request fails far more confusingly), the pages get their
 * own content policy allowing the web font, and an app that was not built
 * falls through to the ordinary 404.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 5234;
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-web-'));
fs.mkdirSync(path.join(dir, 'admin', '_expo', 'static'), { recursive: true });
fs.writeFileSync(path.join(dir, 'admin', 'index.html'), '<!doctype html><title>admin app</title>');
fs.writeFileSync(path.join(dir, 'admin', '_expo', 'static', 'index-abc.js'), 'console.log(1)');
process.env.QB_WEB_DIR = dir; // read when the route module loads

const { createApp } = await import('../app.ts');
const server = createApp().listen(PORT, '127.0.0.1');
await new Promise(r => setTimeout(r, 300));

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`[PASS] ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`[FAIL] ${name}: ${err?.message}`);
  }
}

const get = async (p: string) => {
  const res = await fetch(BASE + p, { redirect: 'manual' });
  return { status: res.status, type: res.headers.get('content-type') || '', cache: res.headers.get('cache-control') || '', csp: res.headers.get('content-security-policy') || '', body: await res.text() };
};

try {
  const root = await get('/admin');
  const deep = await get('/admin/money/pay');
  const bundle = await get('/admin/_expo/static/index-abc.js');
  const missing = await get('/admin/_expo/static/index-gone.js');
  const unbuilt = await get('/partner');

  it('/admin is the app page, straight away (no redirect)', () => {
    assert.equal(root.status, 200);
    assert.match(root.body, /admin app/);
  });
  it('...never cached, so a release reaches people at once', () => assert.match(root.cache, /no-cache/));
  it('...with a policy that allows the web font and nothing third-party for scripts', () => {
    assert.match(root.csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
    assert.match(root.csp, /script-src 'self'(;|$)/);
    assert.match(root.csp, /frame-ancestors 'none'/);
  });
  it('Any page path under it loads the app too', () => {
    assert.equal(deep.status, 200);
    assert.match(deep.body, /admin app/);
  });
  it('The hashed bundle is served and kept for a year', () => {
    assert.equal(bundle.status, 200);
    assert.match(bundle.type, /javascript/);
    assert.match(bundle.cache, /immutable/);
  });
  it('A missing bundle is a 404, not the page', () => {
    assert.equal(missing.status, 404);
    assert.doesNotMatch(missing.body, /admin app/);
  });
  it('An app that was not built falls through to the ordinary 404', () => assert.equal(unbuilt.status, 404));
} finally {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nwebApps: ${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed ? 1 : 0), 100);
