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
