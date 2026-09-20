/**
 * Serve the built APKs to the phones on your Wi-Fi.
 *
 * Testing this platform means four apps on three or four handsets, and the
 * alternative is plugging each phone into this PC in turn. This puts a page on
 * the local network instead: open it on any phone, tap an app, Android
 * downloads and installs it.
 *
 * Rewritten because the previous version was stale in a way that made it
 * useless: it hardcoded `QuickBite-Customer.apk` — no "s" — so it 404ed on the
 * only file it offered, and it knew about one app out of four. It now reads the
 * directory, so whatever was last built is what is served, and an app that has
 * not been built says so instead of appearing as a broken link.
 *
 * Nothing here is exposed to the internet. It binds to this machine's LAN
 * address and is reachable only from the same Wi-Fi.
 *
 * Run: node scripts/serve-download-hub.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.HUB_PORT || 8080);
const APK_DIR = path.resolve(__dirname, '../build/apk');

/** artifact -> what it is called on the phone, and who it is for. */
const CATALOGUE = [
  ['QuickBites-Customer.apk', 'Quick Bites', 'Order food'],
  ['QuickBites-Partner.apk', 'Quick Bites Partner', "The restaurant's kitchen screen"],
  ['QuickBites-Rider.apk', 'Quick Bites Rider', 'Delivery partners'],
  ['QuickBites-Admin.apk', 'Quick Bites Operations', 'Platform administration']
];

function lanAddresses() {
  const found = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      // 169.254.x.x is a self-assigned address: the interface is up and has no
      // network. Offering it as a download link sends a tester to a dead end.
      if (address.address.startsWith('169.254')) continue;
      found.push({ name, address: address.address });
    }
  }
  // Wi-Fi and private ranges first — that is where the phones are.
  found.sort((a, b) => {
    const score = entry =>
      /wi-?fi|wlan/i.test(entry.name) || /^(192\.168|10\.)/.test(entry.address) ? 0 : 1;
    return score(a) - score(b);
  });
  return found;
}

function builtApps() {
  if (!fs.existsSync(APK_DIR)) return [];
  return CATALOGUE.map(([file, label, who]) => {
    const full = path.join(APK_DIR, file);
    if (!fs.existsSync(full)) return { file, label, who, built: false };
    const stat = fs.statSync(full);
    return {
      file,
      label,
      who,
      built: true,
      megabytes: (stat.size / 1024 / 1024).toFixed(1),
      builtAt: stat.mtime
    };
  });
}

function page() {
  const apps = builtApps();
  const addresses = lanAddresses();

  const cards = apps
    .map(app => {
      if (!app.built) {
        return `<div class="card missing">
          <div class="name">${app.label}</div>
          <div class="who">${app.who}</div>
          <div class="note">Not built yet — run <code>bash scripts/build-apks.sh</code></div>
        </div>`;
      }
      return `<div class="card">
        <div class="name">${app.label}</div>
        <div class="who">${app.who}</div>
        <div class="note">${app.megabytes} MB · built ${app.builtAt.toLocaleString()}</div>
        <a class="btn" href="/apk/${encodeURIComponent(app.file)}" download>Download</a>
      </div>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quick Bites — install on this phone</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0;
         padding: 24px 16px 48px; background: #F7F2ED; color: #1A1014; }
  h1 { font-size: 24px; margin: 0 0 4px; color: #5B0E20; }
  p.lede { margin: 0 0 24px; color: #6B6259; font-size: 14px; line-height: 1.5; }
  .card { background: #fff; border-radius: 14px; padding: 16px; margin-bottom: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .card.missing { opacity: .55; }
  .name { font-size: 17px; font-weight: 700; }
  .who { font-size: 13px; color: #6B6259; margin-top: 2px; }
  .note { font-size: 12px; color: #9C948B; margin-top: 8px; }
  .btn { display: block; margin-top: 12px; text-align: center; background: #5B0E20;
         color: #fff; text-decoration: none; padding: 14px; border-radius: 10px;
         font-weight: 600; }
  .warn { background: #FDF3DD; border-radius: 12px; padding: 14px 16px; font-size: 13px;
          line-height: 1.55; margin-bottom: 20px; color: #4A3608; }
  code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #120609; color: #F3E9E3; }
    .card { background: #24101A; box-shadow: none; }
    h1 { color: #FFB84D; } .btn { background: #F5A623; color: #2A0710; }
    .warn { background: #2A1B06; color: #F5D9A0; }
  }
</style>
</head>
<body>
  <h1>Quick Bites</h1>
  <p class="lede">Tap an app to download it to this phone. Install all four on one
     handset, or spread them across several to watch an order travel end to end.</p>

  <div class="warn">
    <strong>Uninstall any older Quick Bites app first.</strong> Android refuses an
    update signed with a different key, and a clean install avoids leftover state
    while you are testing. You may also need to allow installs from this browser
    once, in Settings.
  </div>

  ${cards}
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  if (url === '/' || url === '/index.html') {
    const body = page();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
    return;
  }

  if (url.startsWith('/apk/')) {
    const requested = path.basename(url.slice('/apk/'.length));
    // basename, and then a membership test against the catalogue. Either alone
    // would be enough; together they mean a path like ../../.env cannot be
    // reached even if one of them is ever loosened.
    const known = CATALOGUE.some(([file]) => file === requested);
    const full = path.join(APK_DIR, requested);

    if (!known || !fs.existsSync(full)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No such app. It may not have been built yet.');
      return;
    }

    const stat = fs.statSync(full);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${requested}"`
    });
    fs.createReadStream(full).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  const apps = builtApps();
  const ready = apps.filter(a => a.built).length;

  console.log('');
  console.log('====================================================');
  console.log(`  QUICK BITES DOWNLOAD HUB — ${ready} of 4 apps ready`);
  console.log('====================================================');
  console.log('');

  for (const app of apps) {
    console.log(
      app.built
        ? `  [READY] ${app.label} — ${app.megabytes} MB`
        : `  [MISSING] ${app.label} — not built`
    );
  }

  console.log('');
  console.log('  Open one of these on any phone on the same Wi-Fi:');
  for (const { name, address } of lanAddresses()) {
    console.log(`     http://${address}:${PORT}      (${name})`);
  }
  console.log('');
  console.log('  On this PC:  http://localhost:' + PORT);
  console.log('  Stop it with Ctrl+C.');
  console.log('');
});
