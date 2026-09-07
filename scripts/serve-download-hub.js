/**
 * Quick Bite - Mobile App Download & Testing Hub
 * Serves an interactive mobile-optimized portal on Port 8080 so users can
 * download APKs directly to their phones or launch apps via Expo Go / browser.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const APK_DIR = path.resolve(__dirname, '../build/apk');
const CUSTOMER_APK = path.join(APK_DIR, 'QuickBite-Customer.apk');

// Find all Local IPv4 addresses
function getAvailableIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254')) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  // Sort Wi-Fi and 192.168 / 10.x addresses to the front
  ips.sort((a, b) => {
    const isWifiA = a.name.toLowerCase().includes('wi-fi') || a.address.startsWith('192.168') || a.address.startsWith('10.');
    const isWifiB = b.name.toLowerCase().includes('wi-fi') || b.address.startsWith('192.168') || b.address.startsWith('10.');
    return (isWifiB ? 1 : 0) - (isWifiA ? 1 : 0);
  });
  return ips;
}

const availableIps = getAvailableIps();
const primaryIp = availableIps.length > 0 ? availableIps[0].address : '127.0.0.1';

const server = http.createServer((req, res) => {
  // 1. Serve Customer APK download
  if (req.url === '/download/customer-apk' || req.url === '/QuickBite-Customer.apk') {
    if (fs.existsSync(CUSTOMER_APK)) {
      const stat = fs.statSync(CUSTOMER_APK);
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="QuickBite-Customer.apk"'
      });
      return fs.createReadStream(CUSTOMER_APK).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('APK not found. Please compile it first.');
    }
  }

  // 2. Health check probe
  if (req.url === '/api/hub-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ONLINE',
      localIp,
      hasCustomerApk: fs.existsSync(CUSTOMER_APK),
      apkSizeMb: fs.existsSync(CUSTOMER_APK) ? (fs.statSync(CUSTOMER_APK).size / (1024 * 1024)).toFixed(1) : 0
    }));
  }

  // 3. Serve Interactive Mobile Hub HTML Page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quick Bite - Mobile App Download Hub</title>
  <style>
    :root {
      --primary: #FF4F18;
      --bg: #0F172A;
      --surface: #1E293B;
      --card: #334155;
      --text: #F8FAFC;
      --text-muted: #94A3B8;
      --success: #10B981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 20px 16px; min-height: 100vh; }
    .header { text-align: center; margin-bottom: 24px; }
    .badge { display: inline-block; background: rgba(255, 79, 24, 0.15); color: var(--primary); padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; margin-bottom: 8px; }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 6px; }
    p.sub { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    .network-pill { background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 12px; margin: 16px 0 24px 0; text-align: center; }
    .network-pill p { font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
    .network-pill code { font-size: 14px; font-weight: 700; color: #34D399; }
    .card-grid { display: flex; flex-direction: column; gap: 16px; max-width: 500px; margin: 0 auto; }
    .app-card { background: var(--surface); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 18px; }
    .app-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .app-title { font-size: 16px; font-weight: 700; color: #FFFFFF; }
    .app-role { font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 6px; }
    .role-customer { background: #FF4F18; color: #FFF; }
    .role-partner { background: #F59E0B; color: #000; }
    .role-rider { background: #10B981; color: #FFF; }
    .role-admin { background: #6366F1; color: #FFF; }
    .app-desc { font-size: 12px; color: var(--text-muted); line-height: 1.4; margin-bottom: 14px; }
    .btn { display: block; width: 100%; text-align: center; background: var(--primary); color: #FFF; text-decoration: none; padding: 12px 16px; border-radius: 10px; font-weight: 700; font-size: 13px; border: none; cursor: pointer; transition: opacity 0.2s; }
    .btn:active { opacity: 0.8; }
    .btn-secondary { background: #475569; margin-top: 8px; }
    .creds-box { background: rgba(0,0,0,0.25); border-radius: 8px; padding: 8px 12px; margin-top: 10px; font-size: 11px; color: #CBD5E1; font-family: monospace; }
    .footer { text-align: center; margin-top: 32px; font-size: 11px; color: var(--text-muted); line-height: 1.6; }
  </style>
</head>
<body>
  <div class="header">
    <div class="badge">QUICK BITE ECOSYSTEM</div>
    <h1>Mobile App Testing Hub</h1>
    <p class="sub">Download standalone APKs or run live native apps on your phone.</p>
  </div>

  <div class="network-pill">
    <p>Local Wi-Fi Network Address:</p>
    <code>http://${primaryIp}:${PORT}</code>
  </div>

  <div class="card-grid">
    <!-- App 1: Customer Mobile -->
    <div class="app-card">
      <div class="app-card-header">
        <span class="app-title">1. Customer Mobile App</span>
        <span class="app-role role-customer">Device 1</span>
      </div>
      <p class="app-desc">Food discovery, live restaurant menus, cart customization, Razorpay checkout, live order tracking, and secret 4-digit doorstep delivery OTP.</p>
      <a href="/download/customer-apk" class="btn" download="QuickBite-Customer.apk">Direct Download Release APK (55.1 MB)</a>
      <div class="creds-box">Login: customer@quickbite.app / pass123</div>
    </div>

    <!-- App 2: Restaurant Partner -->
    <div class="app-card">
      <div class="app-card-header">
        <span class="app-title">2. Restaurant Partner App</span>
        <span class="app-role role-partner">Device 2</span>
      </div>
      <p class="app-desc">Live Kitchen Terminal, audio chime alerts, 120s countdown timer, KOT item breakdown, menu stock toggle, and 4-digit pickup code handshake.</p>
      <div class="creds-box">Login: partner@quickbite.app / pass123</div>
    </div>

    <!-- App 3: Delivery Partner -->
    <div class="app-card">
      <div class="app-card-header">
        <span class="app-title">3. Delivery Partner App</span>
        <span class="app-role role-rider">Device 3</span>
      </div>
      <p class="app-desc">Shift check-in/out, 15s broadcast card, turn-by-turn routing simulator, background 3s GPS telemetry streamer, and doorstep OTP verification.</p>
      <div class="creds-box">Login: rider@quickbite.app / pass123</div>
    </div>

    <!-- App 4: Admin Control Tower -->
    <div class="app-card">
      <div class="app-card-header">
        <span class="app-title">4. Admin Operations App</span>
        <span class="app-role role-admin">Device 4</span>
      </div>
      <p class="app-desc">Real-time marketplace pulse, GMV metrics, restaurant & rider KYC approval queues, and 1-tap instant customer wallet dispute refunding.</p>
      <div class="creds-box">Login: admin@quickbite.app / pass123</div>
    </div>
  </div>

  <div class="footer">
    <p>All 4 applications communicate with the backend at port 4000.<br/>
    For testing over 4G/5G mobile data, run <code>scripts/start-tunnel.ps1</code>.</p>
  </div>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log('     QUICK BITE MOBILE DOWNLOAD & TESTING HUB       ');
  console.log('====================================================');
  console.log(`Local Access:   http://localhost:${PORT}`);
  console.log(`Phone Wi-Fi:    http://${primaryIp}:${PORT}`);
  console.log(`Direct APK:     http://${primaryIp}:${PORT}/QuickBite-Customer.apk`);
  if (availableIps.length > 1) {
    console.log('Other Available Network Interfaces:');
    availableIps.slice(1).forEach(i => console.log(`  - ${i.name}: http://${i.address}:${PORT}`));
  }
  console.log('====================================================');
  console.log('Open the Phone Wi-Fi URL in your mobile browser to');
  console.log('download the APK or test apps directly on your phone!');
});
