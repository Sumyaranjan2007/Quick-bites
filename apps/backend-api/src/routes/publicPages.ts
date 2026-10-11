/**
 * Public web pages the Play Store requires (owner, 2 Oct 2026):
 *
 *   /privacy         — the privacy policy (legal/PRIVACY_POLICY.md)
 *   /terms           — the terms of service (legal/TERMS_OF_SERVICE.md)
 *   /delete-account  — how to delete an account, for each app, from outside
 *                      the app (Google asks for a link that works without it)
 *
 * The documents are rendered from the same Markdown files kept in the
 * repository, so there is one copy of each policy. The renderer is small on
 * purpose: headings, paragraphs, lists, tables, bold, links and code — what
 * those files use — with everything escaped first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { businessIdentity } from '../modules/platform/businessIdentity.ts';

export const publicPages = Router();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text: string): string {
  return escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Markdown to HTML for the policy files. Everything is escaped before formatting. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) rows.push(cells);
        i++;
      }
      out.push(
        '<table>' + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>'
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
        i++;
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s|^---+\s*$|^\s*\||^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — Quick Bites</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;line-height:1.6;color:#1f1a17;background:#fffaf2}
h1{font-size:26px}h2{font-size:20px;margin-top:28px}h3{font-size:17px}
table{border-collapse:collapse;width:100%;margin:12px 0}td{border:1px solid #e5d9c8;padding:6px 8px;vertical-align:top}
code{background:#f3eadc;padding:1px 4px;border-radius:4px}a{color:#7a1f3d}hr{border:0;border-top:1px solid #e5d9c8;margin:24px 0}
</style></head><body>${body}</body></html>`;
}

function servePolicy(file: string, title: string) {
  return (_req: any, res: any) => {
    try {
      const md = fs.readFileSync(path.join(ROOT, 'legal', file), 'utf8');
      res.type('html').send(page(title, renderMarkdown(md)));
    } catch {
      res.status(503).type('html').send(page(title, `<h1>${escape(title)}</h1><p>This page is not available right now.</p>`));
    }
  };
}

/**
 * The business's home page (owner, 11 Oct 2026: the domain points here). A
 * browser gets the page; anything asking for JSON gets the API status answer
 * (moved here from app.ts), so nothing that probes "/" changes.
 */
publicPages.get('/logo.png', (_req, res) => {
  // A copy inside apps/backend-api: the server's Docker image has no customer-mobile folder.
  res.sendFile(path.join(ROOT, 'apps', 'backend-api', 'assets', 'logo.png'), { maxAge: '1d' });
});

/** The public website's address, for search engines (owner's domain, 11 Oct 2026). */
const SITE = 'https://www.quickbitesresturants.in';

// Google Search Console ownership file. Google says to keep it after verifying.
publicPages.get('/google644d46e6db0e1cb0.html', (_req, res) => {
  res.type('html').send('google-site-verification: google644d46e6db0e1cb0.html');
});

// Search engines may read the public pages; the admin console and the API are not for indexing.
publicPages.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
});

publicPages.get('/sitemap.xml', (_req, res) => {
  const urls = ['/', '/partner', '/privacy', '/terms', '/delete-account'];
  res.type('application/xml').send(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u => `  <url><loc>${SITE}${u}</loc></url>`).join('\n') +
      '\n</urlset>\n'
  );
});

publicPages.get('/', (req, res) => {
  if (req.accepts(['json', 'html']) !== 'html') {
    res.json({
      success: true,
      name: 'Quick Bites Platform API',
      version: '2.0.0',
      status: 'ONLINE',
      endpoints: {
        health: '/health',
        restaurants: '/api/v1/restaurants',
        search: '/api/v1/search',
        auth: '/api/v1/auth',
        orders: '/api/v1/orders'
      },
      meta: { timestamp: new Date().toISOString(), correlationId: (req as any).correlationId }
    });
    return;
  }
  const id = businessIdentity() as any;
  const email = escape(String(id?.contactEmail || 'officalquickbites@gmail.com'));
  const phone = escape(String(id?.contactPhone || ''));
  const address = escape(
    [id?.addressLine, id?.street, id?.city, id?.district, id?.state, id?.pincode].filter(Boolean).join(', ')
  );
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quick Bites — Food Delivery in Harohalli, Kanakapura Road &amp; Ramanagara</title>
<meta name="description" content="Order food online from local restaurants in Harohalli, Kanakapura Road and Ramanagara. See the full bill before you pay, pay online or cash on delivery, and track your order live.">
<link rel="canonical" href="${SITE}/">
<link rel="icon" href="/logo.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Quick Bites">
<meta property="og:title" content="Quick Bites — Food Delivery in Harohalli">
<meta property="og:description" content="Order food from local restaurants in Harohalli and Ramanagara and track your delivery live.">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/logo.png">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Quick Bites',
    legalName: 'QUICK BITES',
    url: `${SITE}/`,
    logo: `${SITE}/logo.png`,
    email: id?.contactEmail || 'officalquickbites@gmail.com',
    ...(id?.contactPhone ? { telephone: `+91${String(id.contactPhone).replace(/\D/g, '').slice(-10)}` } : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: [id?.addressLine, id?.street].filter(Boolean).join(', '),
      addressLocality: id?.city || 'Harohalli',
      addressRegion: id?.state || 'Karnataka',
      postalCode: id?.pincode || '562112',
      addressCountry: 'IN'
    },
    areaServed: ['Harohalli', 'Kanakapura Road', 'Ramanagara']
  }).replace(/</g, '\\u003c')}</script>
<style>
:root{--ink:#241a1c;--muted:#6b5d60;--brand:#6e0f1e;--gold:#f5a623;--bg:#fffaf3;--card:#fff;--line:#eddfd2}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.6}
.wrap{max-width:880px;margin:0 auto;padding-inline:20px}
header{padding-block:48px 28px;text-align:center}
header img{width:96px;height:96px}
h1{font-size:clamp(34px,7vw,52px);line-height:1.05;margin:14px 0 10px;color:var(--brand);letter-spacing:-.02em}
.lede{font-size:19px;color:var(--muted);max-width:34em;margin:0 auto}
.badge{display:inline-block;margin-top:20px;padding:10px 18px;border-radius:999px;background:var(--brand);color:#fff;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;padding-block:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 18px 16px}
.card h2{font-size:18px;margin:0 0 6px}.card p{margin:0 0 10px;color:var(--muted)}
a{color:var(--brand);font-weight:600}
footer{border-top:1px solid var(--line);margin-top:24px;padding-block:22px 40px;color:var(--muted);font-size:14px}
footer nav{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:10px}
</style></head><body><div class="wrap">
<header>
<img src="/logo.png" alt="Quick Bites logo">
<h1>Quick Bites</h1>
<p class="lede">Food from the restaurants around you, delivered to your door in Harohalli, along Kanakapura Road and across Ramanagara. See the whole bill before you pay, and track your order live.</p>
<span class="badge">Coming soon on Google Play</span>
</header>
<section class="grid">
<div class="card"><h2>Order food</h2><p>Browse local restaurants, pick sizes and extras, pay online or with cash where the restaurant accepts it.</p></div>
<div class="card"><h2>For restaurants</h2><p>Take orders, build your menu and see every rupee you earn.</p><a href="/partner">Partner sign-in</a></div>
<div class="card"><h2>For delivery riders</h2><p>See your pay before you accept each trip. Get the Quick Bites Rider app to register.</p></div>
</section>
<footer>
<nav><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="/delete-account">Delete your account</a></nav>
<div>QUICK BITES${id?.udyamNumber ? ` · Udyam ${escape(String(id.udyamNumber))}` : ''}</div>
${address ? `<div>${address}</div>` : ''}
<div>${email}${phone ? ` · ${phone}` : ''}</div>
</footer>
</div></body></html>`);
});

publicPages.get('/privacy', servePolicy('PRIVACY_POLICY.md', 'Privacy Policy'));
publicPages.get('/terms', servePolicy('TERMS_OF_SERVICE.md', 'Terms of Service'));

publicPages.get('/delete-account', (_req, res) => {
  const id = businessIdentity() as any;
  const email = escape(String(id?.contactEmail || id?.email || 'officalquickbites@gmail.com'));
  const phone = escape(String(id?.contactPhone || id?.phone || ''));
  res.type('html').send(
    page(
      'Delete your account',
      `<h1>Delete your Quick Bites account</h1>
<p>You can delete your account from inside the app, or ask us to do it.</p>
<h2>Customers (Quick Bites)</h2>
<ol><li>Open the app and go to <strong>Profile</strong>.</li><li>Tap <strong>Delete account</strong> and confirm.</li></ol>
<p>Your account, saved addresses and personal details are deleted at once. An order still on its way must be delivered or cancelled first.</p>
<h2>Restaurant partners (Quick Bites Partner) and riders (Quick Bites Rider)</h2>
<ol><li>Open the app and go to <strong>Profile</strong> (Partner: <strong>More</strong>).</li><li>Tap <strong>Delete account</strong> and confirm.</li></ol>
<p>Your account is closed straight away: you can no longer sign in, and you stop receiving orders. We then pay out anything we still owe you (or collect cash a rider still holds) and delete the account. This usually takes up to 7 days.</p>
<h2>Without the app</h2>
<p>Email <a href="mailto:${email}">${email}</a>${phone ? ` or call ${phone}` : ''} from the phone number or email on your account, with the words "Delete my account". We confirm by reply.</p>
<h2>What we keep</h2>
<p>Records of completed orders and payments are kept as long as Indian tax and accounting law requires, without your contact details. Everything else is deleted. See our <a href="/privacy">Privacy Policy</a>.</p>`
    )
  );
});
