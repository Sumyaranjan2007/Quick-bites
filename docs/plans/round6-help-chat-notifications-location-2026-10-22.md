# Round 6 — live help chat, notifications that always arrive, first-time location guide, map zoom, bugs and security (22 Oct 2026)

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md). Project overview, money rules and
> working rules: [`CLAUDE.md`](../../CLAUDE.md). This file stands alone: any session (AI or developer) can build it from here.

**Status:** BUILT 22 Oct 2026 (owner said "build"); see the Tracker. Planned at `bf86b17` (build 46).

**Built differently from the text below (on purpose):** Operations' push for a new message uses the notifier's existing
10-minute-per-chat dedupe instead of a new 2-minute throttle (one mechanism, already tested). `/kyc/submit` (F2/G4) needed
no change: it carries no document number, so a banned number cannot enter there. K1d keeps deleting the unreviewed upload
but writes an audit line with its type and number first (fewer readers touched than a new SUPERSEDED status). The
permissions card has no Photos row (Android 13+ picks photos without a permission) and no microphone row (voice search asks
when used). The Rider's Home card is unchanged; Profile has the new card. "Open profile" in an Operations chat shows the
person's record inline (the console has no deep link to a People record). The guide box is at least a third of the
screen (`minHeight`), so its buttons never clip on small phones.

---

## For the owner, in one screen

| | |
|---|---|
| **1. Help chat** | Proven on a private test server: when Operations replies, the server keeps the chat open ("in progress"). The chat "jumping to history" is in the **apps**: three faults in the chat screen can drop or hide an open chat (it is only resumed if under 7 days old; a slow network on opening starts a blank chat instead of yours; any unreadable answer is treated as "solved"). On the Operations side the big green **"Mark resolved"** button sits exactly where the thumb lands after typing a reply. Fix: a chat stays open — through closing the app, signing out and back in, days passing — until Operations or the person marks it solved. Messages arrive by themselves like WhatsApp, with "Seen" ticks. Operations gets a real chat screen: unread dots, "waiting 12 min", search, quick replies, call button, order card, resolve/reopen behind a confirm, and a push when the person writes again. |
| **2. Notifications** | Found a real fault: the **Partner and Rider apps ask for notification permission before creating their notification channels**, so on Android 13+ a freshly installed app may never show the "Allow notifications?" popup, and the Rider app registers for pushes before that — the phone is never registered until the app is restarted. Fixed in the right order. Every app gets a **"Phone permissions"** card in its profile: each permission with its state (Allowed / Off / Blocked / Muted) and one button. **Honest limit:** Android and iPhone do not let any app show their system popup again after the person blocked it; we show our own popup that explains it and opens the exact settings page (the notification page, or the muted channel's page) with one tap. |
| **3. New customer's location** | A new customer is guided once: the top third of Home becomes a 3-step guide (1 find your location → 2 add house/flat and save → 3 see restaurants near you). It stays until an address is saved, then it closes and **never shows again** on that phone. Existing customers never see it. Also fixed: "Use my current location" did nothing visible when location permission was off. |
| **4. Android map zoom** | Root cause found: on the full-screen live tracking map, a pinch or double-tap zoom is not seen as "the customer moved the map", so the camera keeps following the rider and **snaps the zoom back on every GPS fix (every ~3 s)**. One prop fixes it on that map only; nothing else on any map changes. |
| **5. Bugs** | 9 bugs listed in Part E (above ones plus the rider profile's blank email, a fake "Notifications" switch in the customer profile that only mutes an in-app chime and turns itself back on, and more). |
| **6. Security** | Claude Security's scan **could not run** in this session (its scan engine, the Workflow tool, is not available here). A manual review found: help-chat and refund **attachments accept any text** — the Operations refund screen opens them as pictures, so a planted web link makes the admin's phone contact a stranger's server; one document route skips the banned-person check; temporary passwords never expire; replaced documents leave no trace; no limit on chat messages. All in Part F with fixes. Run the real scan once Workflows are enabled (F7). |
| **7. Old leftovers** | Checked every "open" line in the review and security logs against today's code: **11 were already fixed** (logs were stale; they get closed), **7 small ones are still open** and are in Part G; 5 are waiting on **your** decision (listed, not built). |
| **Cost** | No new paid service. No money rule changes. One new build (APK + AAB, all four apps) at the end. |
| **Risk** | Every change is fenced to the screens named; live tracking, payments, orders, pricing, maps other than the full-screen tracking map are untouched. Each part has a check that fails if it breaks. |

---

## 0. Rules for whoever builds this

1. **Load skills first** (Skill tool): `seniordev`, `cleancode`, `agent-skills:using-agent-skills`; when touching app code also
   `skills:react-native-best-practices`; before claiming done `superpowers:verification-before-completion`.
2. **Nothing working gets touched.** Only the files named in each step. Shared files that exist in several apps
   (`SupportChat.tsx`, `nativeMap.ts`, `pushRegistration.ts`, `liveSync.ts`) stay **byte-identical** across apps after the change
   (`diff` them; a check below enforces it).
3. Each step: server change + its suite (listed in `SUITES` in `scripts/run-backend-tests.mjs`) + mutation check (break the
   guard, watch the suite fail, put it back). Gate: `node scripts/run-backend-tests.mjs`, `npx turbo typecheck`,
   `node scripts/check-secrets.mjs`, `node scripts/check-i18n.mjs`, `node scripts/check-apk-secrets.mjs`.
4. Git: stage by explicit path only; never `git add -A`, stash, reset, clean. Docs (`CHANGELOG.md` top entry "For the owner"
   first, this file's Tracker, the maps in `docs/`) in the **same** commit as the code.
5. Old app versions on phones must keep working: the server only **adds** optional fields and endpoints; nothing an old
   app sends or reads changes meaning.
6. Order of work: Part E/F server items first (small, independent), then A (server → three apps → Operations), B, C, D,
   G; one gate; push `main`; then the APK + AAB build (CLAUDE.md §6, from `D:\qbx`).

---

## A. Help chat: live, persistent, WhatsApp-like; Operations can really handle it

### A0. What was proven (22 Oct, private server, seeded data)

Customer raises a ticket → status `OPEN`. Admin `POST /api/admin/support/tickets/:id/reply` → `200`, status `IN_PROGRESS`.
Customer `GET /api/support/tickets/:id` → `IN_PROGRESS`, 1 reply. Customer replies → `200`, still `IN_PROGRESS`.
**The server never moves a replied ticket to history.** The faults are client-side:

| # | Where | Fault | Effect the owner sees |
|---|---|---|---|
| A0-1 | `*/src/components/SupportChat.tsx:49,102` (3 identical copies) | `RESUME_MS = 7 days`: an open chat older than 7 days is not resumed | chat "gone"; the next message starts a second chat |
| A0-2 | same, `:97` `api.tickets().catch(() => [])` | a slow/failed list on opening = "you have no chats" | a blank chat instead of yours; the next message opens a new ticket |
| A0-3 | same, `:131` `if (!OPEN.includes(latest.status)) endChat(...)` | any reply without a readable status (proxy page, half-loaded answer, old cached build) counts as "solved" | "Quick Bites marked your request as solved", chat moved to History, though nobody resolved it |
| A0-4 | `admin-mobile/src/screens/SupportScreen.tsx:167-176,236-241` | the sheet's pinned footer is a full-width green **Mark resolved**; **Send reply** sits above it inside the card | staff resolve when they meant to send; the person's chat jumps to History |
| A0-5 | `admin-mobile/.../SupportScreen.tsx:228` | bubbles coloured `byRole !== 'customer'` | a partner's or rider's own messages look like staff messages |
| A0-6 | `restaurant-mobile/App.tsx:137` | push "support replied" opens the Help Centre front page, not the chat | partner must find the chat again |
| A0-7 | `routes/supportRouter.ts:193-210` | a person's new message in an existing chat sends Operations **no push** | staff do not know the person wrote again |
| A0-8 | `routes/admin/supportRoutes.ts:80-86` | the reply push goes to **every** app of a multi-role person (`forApp` gets no channel for partner/rider) | a partner who is also a customer hears it on both apps |
| A0-9 | `routes/supportRouter.ts:28-39` | no cap on messages per minute | one person can flood the queue |

Live delivery already exists: every successful write sends `sync` to the people it touches and to every Operations console
(`sockets/liveSync.ts`), the chat re-reads on `sync` (`useLiveSync(refresh)`), with a 15 s poll as fallback. It stays.

### A1. Server — `packages/shared-types/src/index.ts` (`SupportTicket`, ~line 1388)

Add optional fields (old tickets lack them; read-time defaults below):
```ts
lastMessageAt?: string;          // newest message (first message or any reply)
lastMessageBy?: 'USER' | 'STAFF';
staffReadAt?: string;            // Operations last opened the chat
userReadAt?: string;             // the person last saw it
```

### A2. Server — `db/repositories/supportRepository.ts`

1. `create`: set `lastMessageAt = createdAt`, `lastMessageBy = 'USER'`.
2. `reply`: after pushing the reply, `lastMessageAt = now`, `lastMessageBy = byRaiser ? 'USER' : 'STAFF'`; when staff
   writes also `staffReadAt = now` (they obviously saw it); when the person writes, `userReadAt = now`.
3. New `markRead(id, who: 'USER' | 'STAFF')`: sets `userReadAt`/`staffReadAt = now`, `triggerAutoSave()`. Returns the ticket.
4. New exported pure helper `withChatFields(t)`: returns `{ ...t, lastMessageAt: t.lastMessageAt ?? (last reply's at ?? t.createdAt), lastMessageBy: t.lastMessageBy ?? (last reply by raiser? 'USER' : last reply? 'STAFF' : 'USER'), unreadForStaff, unreadForUser }`
   where `unreadForStaff = lastMessageBy === 'USER' && (!staffReadAt || staffReadAt < lastMessageAt)` and the mirror for the user.
   Every route that returns a ticket returns `withChatFields(ticket)` (user routes and admin routes).
5. New `openFor(userId, role)`: the person's newest ticket with status `OPEN | IN_PROGRESS` **and** `raisedByRole === role`
   (a partner's Customer-app chat and Partner-app chat are separate, like their apps).

### A3. Server — `routes/supportRouter.ts`

1. `POST /tickets`: after the order checks, **before** the double-tap/5-per-hour checks:
   `const open = await supportRepository.openFor(req.user!.id, req.user!.role)`; if found, append
   `req.body.message` as a reply by the person (`supportRepository.reply`) and answer `200 { ticket: withChatFields(t), reused: true }`.
   One live chat per person per app — the WhatsApp model. (The double-tap and hourly limits stay for new chats.)
2. `POST /tickets/:id/reply`: (a) **rate limit**: count the person's replies on this ticket in the last 60 s; ≥ 20 →
   `429 TOO_MANY_MESSAGES` "You are sending messages very fast. Wait a moment." (b) refuse on a `CLOSED` ticket
   (`409 CHAT_CLOSED`, "This chat is closed. Write in Help to start a new one."); a `RESOLVED` one reopens as today.
   (c) after saving: `void notifyAdminsSupportMessage({ ticketId, raisedBy, preview: first 60 chars })` (A5),
   **throttled**: at most one push per ticket per 2 minutes (module-level `Map<ticketId, lastPushMs>`;
   `// seniordev: in-memory throttle, resets on deploy — fine, worst case one extra push`).
3. New `POST /tickets/:id/read` — own ticket only (same 404 rule as `GET /tickets/:id`), `markRead(id, 'USER')`.
4. `TicketSchema.attachments` and `RefundRequestSchema.attachments`: `z.array(z.string().max(400000).refine(isPhotoData, 'Attach a photo (JPG, PNG or WebP).')).max(4)` — import `isPhotoData` from `utils/imageInput.ts` (security F1).
5. All ticket answers wrapped in `withChatFields`.

### A4. Server — `routes/admin/supportRoutes.ts`

1. `GET /support/tickets`: accept `status=ACTIVE` (OPEN + IN_PROGRESS) besides today's values; each ticket returned as
   `withChatFields(t)` plus `preview` (last message text, 80 chars), plus for the list row `kitchens`/`riderCode` (same lookup
   as the detail route; move it to a small local function `raiserOf(userId)` used by both). Sort: `unreadForStaff` first,
   then active tickets whose `lastMessageBy === 'USER'` oldest-waiting first, then newest `lastMessageAt`. Add
   `counts.unread`, `counts.active`. Old values (`ALL`, `OPEN`, …) keep working for old Operations builds.
2. New `POST /support/tickets/:id/read` (`support.tickets.view`): `markRead(id, 'STAFF')`. Not audit-logged (noise).
3. Reply push (A0-8): add `appRole: ticket.raisedByRole` to the payload; in `fcmDispatcher.forApp(devices, channelId, appRole?)`
   use `appRole` when given (else today's channel→role map). Channel unchanged (customer `order-updates`; partner/rider
   `undefined` → `default` as today — **do not** invent a new channel: old builds do not have it).
4. Status change to `RESOLVED`/`CLOSED`: push the person "Your help chat is marked solved. Tap to read it or write again."
   (`type: 'SUPPORT_RESOLVED'`, same `appRole`, same channel rule). Reopen = status `IN_PROGRESS` (already allowed by the schema).
5. Detail route returns `raiser` as today **plus** `phone` (from the user record, staff with `support.tickets.view` already see
   `contactPhone`) and `recordPath` (`/admin/records/<kind>/<id>`, kind from role: customer/restaurant/rider) for "Open profile".

### A5. Server — `notifications/adminNotifier.ts`

`notifyAdminsSupportMessage({ ticketId, raisedBy, preview })` — copy of `notifyAdminsSupportTicketOpened` (line 402):
title `New message in a help chat`, body `${raisedBy}: ${preview}`, `ADMIN_CHANNEL.ATTENTION`, `open: 'support'`,
`subject: ticketId`, `type: 'ADMIN_SUPPORT_MESSAGE'`, `category: 'CUSTOMER_CARE'` (respects the owner's mute switches in
Settings → Notifications as the other admin pushes do). The admin app routes a tap by `data.open`
(`admin-mobile/App.tsx:408-429`), so `open: 'support'` already lands on Support; no app change needed for the tap.

### A6. The three user apps — `components/SupportChat.tsx` (identical in customer, partner, rider)

1. `const DONE = ['RESOLVED', 'CLOSED'];` Delete `RESUME_MS`. On open: `const open = list.find(t => OPEN.includes(t.status))`
   (no age limit). (A0-1)
2. Opening: `api.tickets()` is **not** caught to `[]`. On failure: show "Your chats could not be loaded." + **Retry** button
   (re-runs the opening effect) and keep the input disabled until loaded, so no second chat is created by mistake. (A0-2)
3. `refresh`: end the chat **only** when `DONE.includes(latest?.status)`; if `latest` or its status is missing, keep the chat
   as it is (log nothing to the user). (A0-3)
4. `ChatApi` gets `read(id: string): Promise<void>`. After every load/refresh, if the chat screen is visible
   (`tab === 'chat'`) and `ticket.unreadForUser`, call `api.read(ticket.id)` once (guard with a ref holding the
   `lastMessageAt` already marked, so the `sync` that the read itself causes cannot loop).
5. Ticks on my messages (only when connected): `✓` sent, `✓✓ Seen` on my **last** message when
   `ticket.staffReadAt >= that message's time`. "Sending…" stays as today.
6. A system line at the top while connected: "You are talking to the Quick Bites team. This chat stays open until it is
   solved — you can close the app and come back any time." (replace `CONNECTED`).
7. When staff resolve (`DONE` seen on refresh): keep today's `endChat` behaviour, text: "Quick Bites marked this chat as
   solved. It is in History. Write here any time to start a new chat."
8. Nothing else in the file changes (bot answers, topics, history tab, keyboard handling stay).

Wrappers, each adds `read`:
- Customer `components/HelpChat.tsx`: `read: async id => { await data(await apiFetch(`${apiUrl}/support/tickets/${id}/read`, { method: 'POST', headers })) }`.
- Partner `components/HelpChat.tsx` + `lib/partnerApi.ts`: new `markSupportTicketRead(id)` next to `fetchSupportTicket`.
- Rider `screens/HelpScreen.tsx` + `lib/api.ts`: `readSupportTicket(ctx, id)` next to `supportTicket` (line 405).
- Partner push tap (A0-6): `restaurant-mobile/App.tsx:137` → `setTab('help')` **and** a new `helpChatOpen` state passed to
  `HelpCentreScreen` as `openChat` prop; `HelpCentreScreen` opens the chat when `openChat` flips true
  (`useEffect(() => { if (openChat) setChatOpen(true) }, [openChat])`), App resets it after.
- `SUPPORT_RESOLVED` tap: same targets as `SUPPORT_REPLY` in all three apps (`customer-mobile/App.tsx:142`,
  `delivery-mobile/App.tsx:133`, `restaurant-mobile/App.tsx:137`).

### A7. Operations app + website — `admin-mobile/src/screens/SupportScreen.tsx`

Rebuild only the **Complaints** tab (SOS tab untouched):

**List** — segmented `Active` (default, `status=ACTIVE`) · `Resolved` · `All`; a search field (client-side over name, phone,
order number, subject); each row: name + role chip (Customer/Partner/Rider) + kitchen or rider code, order `#N` if any,
last message preview (2 lines), right side: time since last message, **unread dot** when `unreadForStaff`, and
"Waiting for reply · 12 min" (red after 10 min) when `lastMessageBy === 'USER'` and active. Live: already reloads on `sync`
through `useResource` — keep `silentReload`.

**Chat** (opens full height in the existing `Sheet`, or a full screen on phones if the Sheet cannot pin a composer — check
`components/ui` `Sheet` for a `footer` slot; use that slot for the composer):
- Header: name, role, status chip; buttons **Call** (`tel:` contactPhone, hidden when none), **Open profile** (People record,
  `recordPath`), **Resolve** (asks "Mark this chat solved? It moves to their History." → `status RESOLVED`); on a resolved chat
  **Reopen** (→ `IN_PROGRESS`) and **Close for good** (→ `CLOSED`).
- Collapsible "About" card (closed by default after the first open): category, raised time, app version, kitchen/rider,
  earlier requests, the order card with **Open order**, "Before they asked" (helpChat steps). All already in the detail answer.
- Thread as bubbles: the person's first message, then replies; side by `entry.byUserId === ticket.raisedByUserId`
  (**not** by role, A0-5); staff bubbles show the staff name; times; "Seen by them" under the last staff message when
  `userReadAt >= its time`.
- **Composer pinned at the bottom** (the footer slot): multiline field + **Send**; above it 5 quick-reply chips that only fill the
  field (constants in the file): "Hi, I'm looking into this now.", "Could you share your order number?",
  "Sorry about this — we've started your refund.", "Your issue is sorted. Anything else?", "We'll call you in a few minutes.".
  **Resolve is no longer in the footer** (A0-4).
- On open and whenever a new person-message arrives while open: `POST /admin/support/tickets/:id/read`
  (same ref guard as A6.4).
- Permissions as today: reply/resolve need `support.tickets.manage`; viewing needs `support.tickets.view`.
The website (`/admin`, built from this code) gets it automatically.

### A8. Checks

- New suite `helpLiveChat` (add to `SUITES`): (1) admin reply keeps `IN_PROGRESS` and the person's GET shows it;
  (2) second `POST /tickets` while one is open → same id, `reused: true`, message appended; (3) partner's Customer-app chat
  and Partner-app chat are separate; (4) `read` sets `staffReadAt`/`userReadAt`, `unreadForStaff` flips; a stranger's read → 404;
  (5) 21st message in a minute → 429; (6) reply on `CLOSED` → 409; (7) person's message → one `ADMIN_SUPPORT_MESSAGE` push,
  a second within 2 min → none; (8) resolve → `SUPPORT_RESOLVED` push to the person's device of that app only (multi-role
  account: no push to their other app); (9) `status=ACTIVE` list order (unread first); (10) attachment `https://x` → 400.
  Mutations: remove the `openFor` reuse; remove the throttle; swap `appRole` → each must fail.
- `helpChat`, `helpHistory` stay green (update only lines that asserted a second ticket while one is open).
- App-side check (in the same suite, source read with comments stripped): the three `SupportChat.tsx` copies are byte-identical,
  contain no `RESUME_MS`, and contain `DONE.includes(`.
- By hand on the emulator (QA server, `docs/TESTING.md`): customer writes → Operations sees it within 2 s without refreshing;
  staff replies → customer sees it within 2 s; customer closes the app, signs out, signs in → chat still there, continue;
  staff resolves → chat moves to History on the customer's phone; repeat for Partner and Rider apps; Operations website too.

---

## B. Notifications reach everyone; a permissions card in every app

### B0. Root causes found

| # | Where | Fault |
|---|---|---|
| B0-1 | `restaurant-mobile/src/lib/orderAlert.ts:76`, `delivery-mobile/src/lib/orderAlert.ts:62` | `requestPermissionsAsync()` **before** `setNotificationChannelAsync(...)`. On Android 13+ the system popup needs a channel to exist first (the customer app was fixed for this in R2-19; the other two were not). |
| B0-2 | `delivery-mobile/App.tsx:199,214` | `registerForPush` runs at boot/sign-in **in parallel with** `prepareOrderAlerts` (`:357`): permission not granted yet → returns early → this phone is not registered until the next app start. |
| B0-3 | all four `lib/pushRegistration.ts` | registration runs only at launch/sign-in. A person who turns notifications on in Settings later is not registered until a restart; `lastRegistered` also skips re-posting a token the server may have marked dead. |
| B0-4 | `customer-mobile/src/screens/ProfileScreen.tsx:546-558`, `lib/notifications.tsx` | the "Notifications" switch only mutes the in-app chime, is not saved (`useState(true)`), and says nothing about the phone's real permission. |
| B0-5 | (no screen) | only the Rider app has a permissions card, on Home, hidden once all are on; no app lets a person fix a blocked or muted permission from Profile. |

### B1. Right order in Partner and Rider

- `restaurant-mobile/src/lib/orderAlert.ts` and `delivery-mobile/src/lib/orderAlert.ts`, `prepareOrderAlerts()`: move the
  `requestPermissionsAsync()` call **after** both `setNotificationChannelAsync` calls, and only when
  `getPermissionsAsync()` says `!granted && canAskAgain` (as `pushRegistration` does).
- `delivery-mobile/App.tsx`: both call sites become `void prepareOrderAlerts().then(() => registerForPush(...))`
  (the admin app's pattern, `admin-mobile/App.tsx:517`). `prepareOrderAlerts` is idempotent (`configured` flag), so the later
  call at `:357` stays harmless.
- Partner already awaits `prepareOrderAlerts()` before `registerForPush` (`restaurant-mobile/App.tsx:202-205, 224-225`): no change.

### B2. Register again when it can matter

In each app's `lib/pushRegistration.ts` (keep the four files' shared part identical apart from the existing per-app lines):
`lastRegistered` becomes `{ token, at }`; skip only if the same token was posted **less than 12 hours ago**. In each `App.tsx`,
on `AppState` → `active` with a signed-in session, call `registerForPush(...)` again (cheap: it returns at once when nothing
changed; after a permission was just granted in Settings it registers immediately).

### B3. "Phone permissions" card — one component, copied per app like `SupportChat.tsx`

New `src/components/AppPermissions.tsx` in each app, generalised from `delivery-mobile/src/components/RiderPermissions.tsx`
(which it replaces in the Rider app; Home keeps showing it only while something is missing, as today). Props:
`items: Array<'notifications' | 'location' | 'camera' | 'photos' | 'microphone' | 'battery'>`, `channels?: string[]`
(notification channel ids this app relies on), `alwaysShow?: boolean` (Profile shows it even when all are fine, with green ticks).

Each row: name, one-line why, state, button. State and button:
| State | How it is read | Button does |
|---|---|---|
| Allowed | `get…PermissionsAsync().granted` (and for notifications every channel in `channels` has importance > 0) | nothing (green tick) |
| Off — can ask | `!granted && canAskAgain` | `request…PermissionsAsync()` → the **system popup** appears |
| Blocked | `!granted && !canAskAgain` | our own dialog: "Quick Bites can't show the phone's permission window again because it was turned off. Tap Open settings → Notifications → Allow." → **Open settings** |
| Muted (notifications only, Android) | permission granted but `Notifications.getNotificationChannelAsync(id)` importance is `NONE` | dialog "New-order alerts are muted for Quick Bites" → **Open settings** for that channel |

Open settings, Android (`Linking.sendIntent`, fall back to `Linking.openSettings()`):
notifications → `android.settings.APP_NOTIFICATION_SETTINGS` with extra `android.provider.extra.APP_PACKAGE` = the app's package
(`Constants.expoConfig?.android?.package` from `expo-constants`, already used by `pushRegistration.ts`; `expo-application` is
**not** installed in any app — do not add it);
muted channel → `android.settings.CHANNEL_NOTIFICATION_SETTINGS` with extras `APP_PACKAGE` + `android.provider.extra.CHANNEL_ID`;
battery → existing `IGNORE_BATTERY_OPTIMIZATION_SETTINGS`; everything else → `Linking.openSettings()`. iPhone: `Linking.openSettings()`.
Re-checks on `AppState` active (as RiderPermissions does) and then calls the app's `registerForPush` when notifications became allowed.
Hidden on the web (`Platform.OS === 'web'`).

Per app (only permissions the app really uses — grep each before adding):
| App | Where the card goes | Items | Channels |
|---|---|---|---|
| Customer | Profile → Preferences: a row **"Phone permissions"** opening a sheet (our `components/Modal`) with the card | notifications, location, camera (refund photos, `lib/photo.ts`), microphone (voice search: `ExpoSpeechRecognitionModule.getPermissionsAsync/requestPermissionsAsync`, `VoiceSearchSheet.tsx:76`) | `order-updates` |
| Partner | Help Centre → Account card (the partner's profile area), above "Edit your details" | notifications, camera, photos, location (kitchen picker), battery (Android) | `kitchen-orders`, `payments` |
| Rider | Profile screen, new section; Home keeps the existing card | location, notifications, camera, battery (as today) | `new-orders`, `payments` |
| Operations | Profile screen, phone only | notifications, camera, photos | `admin-urgent`, `admin-attention` (`lib/adminChannels.ts:58,61`) |

Customer's chime switch (B0-4): keep it, relabel "Sound in the app" / "A chime when your order moves while the app is open",
and save it (`AsyncStorage` key `qb.inAppChime.v1`, read once at start). The real notification permission is the card's job.

### B4. Server

Covered by A4.3/A4.4 (support pushes reach the right app). Nothing else on the server changes.

### B5. Checks

- Extend the existing source checks (`adminPush.test.ts` style, comments stripped): in Partner and Rider `orderAlert.ts`
  the first `setNotificationChannelAsync` comes **before** `requestPermissionsAsync`; Rider `App.tsx` never calls
  `registerForPush(` except inside `prepareOrderAlerts().then(`; every channel id the server's `CHANNEL` uses for an app is
  created in that app; every app has `AppPermissions.tsx` and the shared part is identical. Mutate: swap the order → fails.
- Emulator (Android 14 AVD `qb34`, release-like build): fresh install of Partner and Rider → the popup appears at sign-in;
  "Don't allow" twice → Profile card says Blocked → Open settings lands on the app's notification page; turn on → back in the
  app the row turns green and the device appears in `deviceTokens` on the QA server; mute the "New orders" channel → card says Muted.
- One real push per app from the QA server (order placed / offer / support reply / admin ticket).

---

## C. First-time location guide (new customers only, once per phone)

### C0. Today

`customer-mobile/src/screens/DiscoveryFeedScreen.tsx:616-630`: a block "Save your address first" (min height 1/3) shows while
`!origin && savedAddresses.length === 0`. Picking a spot without saving hides it for the session and it returns next launch;
"Use my current location" with permission off does **nothing visible** (`useDeviceLocation` sets `error`, the screen never shows
it, `:222` destructures only `detect, detecting`).

### C1. New pure rule — `customer-mobile/src/lib/locationGuide.ts` (no React Native imports, so the backend suite can import it)

```ts
export type GuideStep = 'hidden' | 'find' | 'save' | 'done';
export function locationGuideStep(s: { signedIn: boolean; addressesLoaded: boolean; savedCount: number; picked: boolean; guideDone: boolean; justSaved: boolean }): GuideStep {
  if (!s.signedIn || !s.addressesLoaded || s.guideDone) return 'hidden';
  if (s.justSaved) return 'done';
  if (s.savedCount > 0) return 'hidden';
  return s.picked ? 'save' : 'find';
}
export const GUIDE_DONE_KEY = 'qb.locationGuideDone.v1';
```

### C2. Screen — `DiscoveryFeedScreen.tsx`

1. State: `guideDone` (read `AsyncStorage.getItem(GUIDE_DONE_KEY)` once on mount; until read, treat as `true` so the guide never
   flashes for existing customers), `pickedForGuide: PickedLocation | null`, `justSaved: boolean`.
2. After `loadLocality()` succeeds with `savedAddresses.length > 0` → `AsyncStorage.setItem(GUIDE_DONE_KEY, 'yes')` (existing
   customers and anyone who saved elsewhere — address book, checkout — never see it).
3. Replace the block at `:616-630` for **signed-in** customers with the guide when `step !== 'hidden'`
   (guests keep today's block exactly as it is — condition `!token && !origin`):
   - Container: `height: Math.round(windowHeight / 3)` (exactly a third), same colours/radius as `styles.firstVisit`, at the same place.
   - Title "Welcome to Quick Bites! Let's set your delivery location", then a 3-dot step tracker with labels
     **1 Find you · 2 Save address · 3 Restaurants near you** (current step bold, done steps ticked).
   - Step `find`: primary **Use my current location** (existing `useCurrentLocation`), secondary **Pick on map**
     (`setMapOpen(true)`); under them the hook's `error` text in red; when the error is the permission one, an **Open settings**
     link (`Linking.openSettings()`).
   - Step `save` (a spot was picked but not saved): "We found you near <locality>. Add your house/flat number and save it."
     primary **Add house/flat & save** → `setToSave(pickedForGuide)` (opens the existing `SaveAddressSheet`); secondary
     **Choose a different spot** → back to `find`.
   - Step `done`: "All set! Showing restaurants that deliver to <label>." for 2 s, then `LayoutAnimation.easeInEaseOut()`,
     `guideDone = true`, write the key. The screen is then exactly today's normal Home.
4. `browseFrom` (`:400`) also sets `pickedForGuide = picked` (no other change to it). `savedAddress` (`:422`) sets `justSaved = true`.
5. Below the guide nothing changes: Quick Bites' recommended list shows as today until an address is saved, then the nearby list.
6. Do not touch the header chip, the "Deliver to" sheet, the map picker or `SaveAddressSheet`.

### C3. Checks

- New suite `locationGuide` imports `locationGuideStep`: new signed-in, loaded, no address → `find`; picked → `save`; just saved →
  `done`; existing customer (savedCount 1) → `hidden`; guest → `hidden`; `guideDone` → `hidden` even with no address; not loaded
  yet → `hidden` (no flash offline). Mutation: drop the `guideDone` test → fails.
- Emulator: fresh sign-up → guide at top third; deny location → red text + Open settings; pick on map → step 2; save → step 3 →
  normal Home with nearby restaurants; kill and reopen → never again; delete all addresses → guide stays gone, header says
  "Set your location" (today's behaviour). Existing account with addresses → never sees it.

---

## D. Android map zoom (full-screen live tracking map)

### D0. Root cause

`customer-mobile/src/components/LiveOrderMap.tsx` full-screen map follows the rider until `onDrag` fires
(`setFollowing(false)`). `onDrag` is react-native-maps' `onPanDrag`, which on Android fires only from a one-finger scroll
(`node_modules/react-native-maps/android/.../MapView.java:192-195`). **Pinch and double-tap zoom do not fire it.** So
`following` stays true, and every rider fix (≈3 s) changes `fitKey` → `MapCanvas.frame()` (`lib/nativeMap.ts:112-124`) calls
`fitToCoordinates`/`animateToRegion` → **the zoom the customer just made is undone**. Near the door (`spread < 150 m`) it snaps to
600 m on every fix.

### D1. Fix (two small edits, nothing else)

1. `lib/nativeMap.ts` (keep the three apps' copies identical): new optional prop `onUserMove?: () => void` on `MapCanvas`, wired as
   `onRegionChangeStart: onUserMove ? (e: any) => { if (e?.nativeEvent?.isGesture) onUserMove(); } : undefined`.
   (`isGesture` is Google's own "the person moved the camera" reason — `REASON_GESTURE` — covering drag, pinch, double-tap,
   two-finger tap; react-native-maps 1.20.1 sends it, `lib/MapView.d.ts:326-334`.)
2. `LiveOrderMap.tsx` full-screen `NativeOrderMap`: pass `onUserMove={() => setFollowing(false)}` next to the existing `onDrag`
   (thread the prop through `NativeOrderMap` to `MapCanvas`). The **Re-centre** button already restores following.

Not changed: the small map, the address picker (`MapAddressPicker`), the Partner kitchen picker, the Rider trip map
(its map is intentionally not zoomable because it sits inside a scrolling page — say so to the owner), markers, route, trail.

### D2. Checks

- Source check (comments stripped): `nativeMap.ts` copies identical; `LiveOrderMap.tsx` passes `onUserMove`.
- **Release** build on the emulator or the owner's phone (debug builds show grey tiles — CLAUDE.md §8): open a live order's
  full-screen map, pinch-zoom in, wait 15 s while the QA rider moves → zoom stays, **Re-centre** appears; tap it → follows again.
  Double-tap zoom → same. Small map and picker behave exactly as before.

---

## E. Bugs and logic errors found (fixed in the parts above or here)

| # | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| E1 | High | Partner/Rider `orderAlert.ts`, Rider `App.tsx` | notification popup/registration order (B0-1, B0-2) | B1 |
| E2 | High | `SupportChat.tsx` ×3 | open chats dropped or shown as solved (A0-1..3) | A6 |
| E3 | Med | Operations Support | Resolve where Send should be; wrong bubble side for partners/riders (A0-4, A0-5) | A7 |
| E4 | Med | `supportRouter.ts` | no Operations push when the person writes again (A0-7) | A3.2, A5 |
| E5 | Med | `DiscoveryFeedScreen.tsx:222,623` | "Use my current location" silent when permission is off | C2.3 |
| E6 | Med | `LiveOrderMap.tsx` | zoom snaps back on Android (D0) | D1 |
| E7 | Low | Customer Profile | fake, unsaved Notifications switch (B0-4) | B3 |
| E8 | Low | `delivery-mobile/src/screens/ProfileScreen.tsx:246` | shows `rider.email`, which the rider record never has → blank (review J-C12) | show the signed-in account's email (the session's `email`, saved by `saveSession` in `App.tsx:212`); pass it as a prop |
| E9 | Low | `admin/supportRoutes.ts` reply push | rings every app of a multi-role person (A0-8) | A4.3 |
| E10 | Low | `restaurant-mobile/App.tsx:137` | push opens Help Centre, not the chat (A0-6) | A6 |
| E11 | Low | `src/test/riderPerKm.test.ts` header | comment says "Rs 10 a road km", default is ₹12 (KNOWN_ISSUES D4) | fix the comment; remove D4 from `docs/KNOWN_ISSUES.md` |

---

## F. Security

**Claude Security scan:** asked for on 22 Oct; **not run** — its scan engine (the Workflow tool) is not available in this session.
The findings below come from a manual review of sign-in, sockets, payments, uploads, support, the live-sync channel and the kitchen
ticket page. They are **not** panel-verified; each was checked in the code at the line given.

| # | Sev | Where | Problem | Fix | Check |
|---|---|---|---|---|---|
| F1 | Med-low | `routes/supportRouter.ts:33` (tickets), `:238` (refund requests) | `attachments` accept **any string** up to 400 KB. `admin-mobile/src/screens/RefundsScreen.tsx:202` renders each as an image `uri`: a planted `https://…` makes the admin's phone/browser fetch a stranger's server (reveals IP, can serve SVG) — the same class as the fixed L5 | `.refine(isPhotoData)` on each element (A3.4) | `helpLiveChat` (10); also a refund request with a link → 400 |
| F2 | Low | `routes/kycRouter.ts:93` `POST /api/kyc/submit` | no banned-identity check (review G4); no app calls it, but `curl` can bring a banned FSSAI/PAN/licence back | `const banKind = kindForDocument(documentType); if (banKind && req.body.documentNumber) assertNotBanned({ [banKind]: req.body.documentNumber }, req.user!.id)` — copy the rider route's lines `riderRouter.ts:477-478` | `removeAndBlock` suite: banned number via `/kyc/submit` → 403 |
| F3 | Low | `routes/admin/peopleRoutes.ts` `/accounts/create` + admin reset | temporary password valid forever (review C1) | store `passwordTemporaryUntil = now + 7 days`; password sign-in after that → `401 TEMP_PASSWORD_EXPIRED` "Use Forgot password"; cleared on any password change | `contactChange` or `identity` suite: day 8 → refused; after change → fine |
| F4 | Low | `db/repositories/kycRepository.ts:51` `dropUnreviewed` | a never-reviewed upload replaced before review is **deleted**, no trace (review K1d) | keep it with `status: 'SUPERSEDED'` (excluded where `documentsByType` reads) instead of deleting | `kycReupload`-style check: upload, replace, the first is SUPERSEDED and not shown |
| F5 | Low | `supportRouter.ts` reply | message flood (A0-9) | A3.2 (429) | `helpLiveChat` (5) |
| F6 | Info (accepted) | `sockets/liveSync.ts:65-72` | ids in a request body choose who is told "reload" — any signed-in user can make a kitchen's or rider's app re-read (no data leaks: each app re-reads through its own guarded routes; debounced 600 ms) | keep; note it in `docs/SECURITY.md` as accepted | — |
| F7 | — | whole repo | the real Claude Security scan | owner: enable **Dynamic workflows** in `/config` (if the row exists), restart, then `/claude-security` → Scan codebase, whole repository, medium; its findings become round 7 | — |

Checked and **fine** (no change): socket handshake (HS256 pinned, account re-read, token version, blocked accounts refused —
`sockets/socketServer.ts:84-118`); order/restaurant/admin rooms each authorised; customer-scope tokens map to the customer role on
HTTP and socket; Razorpay webhook verified against the raw body (`routes/paymentRouter.ts:139-149`); kitchen ticket HTML escapes
every field (`modules/orders/kitchenTicket.ts:104,145,150`); document uploads photo-only (L5); password-reset quota and same-speed
answers (review P1/P2) and "password changed" email (P3) are in place.

**Owner-only security items (unchanged, still waiting — `OWNER_ACTIONS.md` Part 0):** rotate the Groq key, `ADMIN_PASSWORD` and the
MSG91 OTP-widget token; Razorpay live keys; `ALLOW_PLATFORM_RESET=false`; back up the keystore folder off this PC; move the Firebase
service-account file out of Downloads (KNOWN_ISSUES H2).

---

## G. Leftovers from old sessions

Every line marked "open" in `docs/reviews/REVIEW_LOG.md`, `docs/SECURITY.md` and `docs/KNOWN_ISSUES.md`, checked against today's code:

**Already fixed in code — close them in the logs (doc-only, same commit as G-work):**
R2 (refund requests lose the phone on deletion, `userRepository.ts:49`), R3 (confirm links pruned, `orderSweeper.ts:575`),
S1 (offer race re-checked after the await, `tripOffers.ts:161-167`), S3 (IST day, `tripOffers.ts:63-70`), P1 (per-account reset
quota, `authRouter.ts:1495`), P2 (same speed, `authRouter.ts:1535`), P3 (password-changed email, `authRouter.ts:1580`),
PH1 (rider phone change guarded, `riderRouter.ts:359`), G1 (removed identity banned, `blockedIdentifiers.ts:65-66`),
G2b (profile-edit phone ban, `restaurantRouter.ts:1396`), G3 (+tag only for Gmail, `blockedIdentifiers.ts:31-35`),
T1 (unpinned kitchen → "COD_NEEDS_PIN" only when the customer can fix it, `orderService.ts:743-744`),
B2-1 (superseded: the owner chose the motorbike route on 21 Oct, round 5).

**Still open, built in this round:**
| # | What | Fix |
|---|---|---|
| G4 | `/kyc/submit` ban check | F2 |
| C1 | temporary passwords | F3 |
| K1d | replaced documents vanish | F4 |
| K2d | an approved number change silently turns the verified badge off | in `modules/restaurants/profileEdits.ts`, when an approved edit changes `fssaiLicenseNumber`/`gstin`, append to the partner's decision note: "Upload the licence for the new number in More → Docs to keep your verified badge." |
| J-C12 | rider profile email | E8 |
| D4 | test comment | E11 |
| S2 | "N riders asked" counts offers, not riders | first re-verify: grep the alert text in `notifications/adminNotifier.ts`/`tripOffers.ts`; if it still reads `round` as riders, word it "offered N times (M riders)" using `offeredToRiderIds.length` |

**Waiting on the owner (not built; today's behaviour stays):** F-12/B1-1 rider pay shape for odd custom rates; F-3/R1 automatic
RazorpayX refund links; **F-5 Railway settings to the dashboard before 15 Nov 2026** (Railway stops reading `railway.json` on
1 Dec); F-9 one colour set for Partner/Rider/Operations; K4 payout wording ("weekly run"). Not built by owner decision: B9 masked
calls (on hold), phone change by SMS code (waits for SMS). R3-25 (empty cart button) for the owner to re-check on build 47.

---

## H. Order of work, release

1. Server: F1–F4, A1–A5, K2d, S2 → suites `helpLiveChat`, `locationGuide` (+ updates) → gate green.
2. Apps: A6 (×3 + wrappers), A7, B1–B3, C2, D1, E8, E11 → typecheck, the source checks, `node scripts/check-i18n.mjs`.
3. Docs in the same commits: `CHANGELOG.md` (top: "For the owner"), this Tracker, `docs/NOTIFICATIONS_AND_TRACKING.md`
   (support pushes, permissions card), `docs/APPS_MAP.md` (new components), `docs/BACKEND_MAP.md` + `node scripts/docs/route-inventory.mjs`
   (new routes), `docs/SECURITY.md` (F1–F6), `docs/reviews/REVIEW_LOG.md` (close G list), `docs/KNOWN_ISSUES.md` (remove D4),
   master plan START HERE (a Round 6 block pointing here).
4. Push `main` (deploys); confirm `/health` uptime reset and one live `GET /api/support/tickets` with a test account answers.
5. Emulator walk-through of A8/B5/C3/D2 on the private QA server; then **APK + AAB build 47** from `D:\qbx` (CLAUDE.md §6),
   archive `quick-bites-release-archive/v47-live-help-permissions-location-2026-10-XX/`, commit `release/version.json` + four `app.json`.

## Questions answered before building (owner, fill in)

- Which map had the zoom problem? Assumed: the **customer's full-screen live tracking map**. If it was another map, say which.
- One live chat per person per app (WhatsApp model) — a second "Talk to a person" while one is open continues the same chat. OK?
- Quick-reply texts for Operations (A7): keep the five above or give your own.
- Partner gets a battery-saver row (kitchen phones propped up all day). OK?

## Tracker

| # | Item | Part | Status |
|---|---|---|---|
| 1 | Leftovers from old sessions | G | ✅ 22 Oct (C1, K1d, K2d, J-C12, D4 fixed; G4, S2 closed as not needed) |
| 2 | Live, persistent help chat; Operations chat screen | A | ✅ 22 Oct |
| 3 | Notifications order fix; Phone permissions card in all apps | B | ✅ 22 Oct |
| 4 | First-time location guide (once, top third) | C | ✅ 22 Oct |
| 5 | Android map zoom on the live tracking map | D | ✅ 22 Oct |
| 6 | Bugs E1–E11; security F1, F3–F5 | E, F | ✅ 22 Oct; F6 accepted; F7 real scan waits for the Workflow tool |
| — | Build 47 (APK + AAB) | H | see CHANGELOG / master plan |
