import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.ts';

/**
 * The Partner and Admin apps in a web browser, at /partner and /admin.
 *
 * They are the phone apps' own code built for the web (scripts/build-web.mjs,
 * which the Dockerfile runs), so the websites have every feature the apps have
 * and cannot drift behind them the way the old separate web consoles did.
 * Served here, by the API itself: same address, no CORS, no second service.
 *
 * Absent locally until the build has run; the routes then fall through to the
 * ordinary 404.
 */
const WEB_ROOT =
  process.env.QB_WEB_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');

/*
 * Looser than the API's policy, for these pages only: the web font, photo
 * previews the browser makes (blob:), and saving a stored document (data:).
 * Still no third-party scripts and no framing.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https: wss: data: blob:",
  "frame-ancestors 'none'",
  // As the API's own policy: no plugins, no rewritten <base>, forms post only here.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ');

export const webApps = Router();

/**
 * The admin console is never served on the public website's domain (owner,
 * 11 Oct 2026: "it will be separate and it should never be connected"). It
 * answers only on the Railway address; on quickbitesresturants.in it is a
 * plain 404, as if it did not exist.
 */
export const isPublicSiteHost = (host?: string) => /(^|\.)quickbitesresturants\.in(:\d+)?$/i.test(String(host || ''));

webApps.use('/admin', (req, res, next) => {
  if (isPublicSiteHost(req.headers.host)) return res.status(404).type('text/plain').send('Not found');
  // With a secret address set, the console's page file is not served here either: the static
  // files below would hand out /admin/index.html and undo the secret (22 Oct 2026). Bundles stay.
  if (config.ADMIN_WEB_PATH && /\.html?$/i.test(req.path)) return res.status(404).type('text/plain').send('Not found');
  next();
});

for (const name of ['admin', 'partner']) {
  const dir = path.join(WEB_ROOT, name);
  const index = path.join(dir, 'index.html');

  webApps.use(`/${name}`, (_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    next();
  });
  webApps.use(
    `/${name}`,
    express.static(dir, {
      index: false,
      redirect: false,
      // Bundles are named by their content hash, so they can be kept for a year;
      // the page itself must be re-read so a release reaches people at once.
      setHeaders: (res, file) =>
        res.setHeader(
          'Cache-Control',
          file.includes(`${path.sep}_expo${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'
        )
    })
  );
  // Any other page path under it is the app (it keeps its own screen state). A
  // missing FILE is a 404, not the page: a stale bundle answered with HTML fails
  // far more confusingly than one that is simply not found.
  webApps.get([`/${name}`, `/${name}/*`], (req, res, next) => {
    if (path.extname(req.path) || !fs.existsSync(index)) return next();
    // With a secret address set, the console page is not at /admin at all (owner, 20 Oct 2026).
    if (name === 'admin' && config.ADMIN_WEB_PATH) return next();
    res.setHeader('Cache-Control', 'no-cache');
    if (name === 'admin') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(index);
  });
}

/*
 * THE OPERATIONS WEBSITE AT A SECRET ADDRESS (owner, 20 Oct 2026): `ADMIN_WEB_PATH` on Railway, e.g.
 * a long random word; the page answers only at /<it> and never on the public website's domain. Its code
 * bundle stays at /admin/_expo/... (public code, like the apps). Sign-in still guards everything.
 */
if (config.ADMIN_WEB_PATH) {
  const index = path.join(WEB_ROOT, 'admin', 'index.html');
  webApps.get([`/${config.ADMIN_WEB_PATH}`, `/${config.ADMIN_WEB_PATH}/*`], (req, res, next) => {
    if (isPublicSiteHost(req.headers.host) || path.extname(req.path) || !fs.existsSync(index)) return next();
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(index);
  });
}
