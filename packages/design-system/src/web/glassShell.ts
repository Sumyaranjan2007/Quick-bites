/**
 * The "Glass Kitchen" frame for the Partner and Admin apps when they run in a
 * web browser (served at /partner and /admin).
 *
 * The apps' own screens are unchanged; this only dresses the page around them
 * — a maroon-to-amber backdrop, the app in one frosted panel, the brand font,
 * hover and keyboard focus — and supplies the one thing React Native for Web
 * leaves out: `Alert.alert`, which is a silent no-op there. Every "Are you
 * sure?" in both apps (well over a hundred) would otherwise do nothing in a
 * browser, so it is replaced by an accessible dialog with any number of buttons.
 *
 * Called once, before the app renders, from each app's src/webSetup.web.ts.
 */

type AlertButton = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };
type AlertOptions = { cancelable?: boolean; onDismiss?: () => void };

const CSS = `
:root { --qb-maroon:#641C32; --qb-maroon-deep:#3A0D1B; --qb-amber:#FFC928; --qb-ink:#171313; }
html, body { height:100%; margin:0; }
body {
  background:
    radial-gradient(60vmax 60vmax at 8% 12%, rgba(255,201,40,.55), transparent 60%),
    radial-gradient(55vmax 55vmax at 92% 88%, rgba(255,140,60,.45), transparent 60%),
    linear-gradient(135deg, var(--qb-maroon-deep) 0%, var(--qb-maroon) 45%, #A8452E 75%, #E79A2C 100%);
  background-attachment: fixed;
  background-size: 140% 140%;
  animation: qb-drift 28s ease-in-out infinite alternate;
}
@keyframes qb-drift { from { background-position: 0% 0%; } to { background-position: 100% 100%; } }
body::before, body::after {
  content:''; position:fixed; z-index:-1; border-radius:50%; filter: blur(70px); pointer-events:none;
}
body::before { width:46vmax; height:46vmax; left:-12vmax; bottom:-16vmax; background: rgba(255,201,40,.55); animation: qb-float 22s ease-in-out infinite alternate; }
body::after { width:38vmax; height:38vmax; right:-10vmax; top:-12vmax; background: rgba(214,69,107,.5); animation: qb-float 26s ease-in-out infinite alternate-reverse; }
@keyframes qb-float { from { transform: translate(0,0) scale(1); } to { transform: translate(8vmax,-6vmax) scale(1.15); } }
#root, #root div, #root span, #root input, #root textarea, .qb-dialog, .qb-dialog * {
  font-family: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
#root {
  display:flex; flex-direction:column;
  height:100vh; box-sizing:border-box;
  background: rgba(255,250,244,.78);
  -webkit-backdrop-filter: blur(28px) saturate(1.4);
  backdrop-filter: blur(28px) saturate(1.4);
}
@media (min-width: 900px) {
  #root {
    max-width:1180px; height:calc(100vh - 48px); margin:24px auto;
    border-radius:28px; overflow:hidden;
    border:1px solid rgba(255,255,255,.65);
    box-shadow: 0 30px 80px rgba(42,7,16,.45), inset 0 1px 0 rgba(255,255,255,.7);
  }
}
#root [role="button"], #root [role="tab"], #root [role="switch"], #root [tabindex="0"] { transition: filter .15s ease, transform .15s ease; }
#root [role="button"]:hover, #root [role="tab"]:hover, #root [tabindex="0"]:hover { filter: brightness(1.06) saturate(1.05); }
#root [role="button"]:active, #root [tabindex="0"]:active { transform: scale(.985); }
:focus-visible { outline: 3px solid var(--qb-amber) !important; outline-offset: 2px; border-radius: 10px; }
::-webkit-scrollbar { width:10px; height:10px; }
::-webkit-scrollbar-thumb { background: rgba(100,28,50,.28); border-radius:10px; border:2px solid transparent; background-clip:padding-box; }
::-webkit-scrollbar-track { background: transparent; }

.qb-dialog-backdrop {
  position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; padding:16px;
  background: rgba(42,7,16,.45); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  animation: qb-fade .16s ease-out;
}
.qb-dialog {
  width:min(440px,100%); box-sizing:border-box; padding:24px; border-radius:24px; color:var(--qb-ink);
  background: rgba(255,252,247,.92); border:1px solid rgba(255,255,255,.8);
  box-shadow: 0 24px 60px rgba(42,7,16,.4);
  animation: qb-rise .2s cubic-bezier(.2,.8,.2,1);
}
.qb-dialog h2 { margin:0 0 8px; font-size:19px; font-weight:800; letter-spacing:-.01em; }
.qb-dialog p { margin:0; font-size:15px; line-height:1.55; color:#4A403A; white-space:pre-wrap; }
.qb-dialog-actions { display:flex; flex-wrap:wrap; gap:10px; justify-content:flex-end; margin-top:22px; }
.qb-dialog button {
  min-height:44px; padding:0 18px; border-radius:14px; border:1px solid rgba(100,28,50,.18);
  background:#fff; color:var(--qb-ink); font-size:15px; font-weight:700; cursor:pointer;
}
.qb-dialog button:hover { filter:brightness(.97); }
.qb-dialog button.qb-primary { background:var(--qb-maroon); border-color:var(--qb-maroon); color:#fff; }
.qb-dialog button.qb-destructive { background:#C0392B; border-color:#C0392B; color:#fff; }
@keyframes qb-fade { from { opacity:0; } }
@keyframes qb-rise { from { opacity:0; transform: translateY(12px) scale(.98); } }
@media (prefers-reduced-motion: reduce) {
  body, body::before, body::after, .qb-dialog, .qb-dialog-backdrop { animation:none !important; }
  #root [role="button"], #root [tabindex="0"] { transition:none; }
}
`;

/** Shows an accessible dialog in place of React Native's Alert.alert. */
export function showAlert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
  const list: AlertButton[] = buttons && buttons.length ? buttons : [{ text: 'OK' }];
  const cancel = list.find(b => b.style === 'cancel');
  const opener = document.activeElement as HTMLElement | null;

  const backdrop = document.createElement('div');
  backdrop.className = 'qb-dialog-backdrop';
  const box = document.createElement('div');
  box.className = 'qb-dialog';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');

  const heading = document.createElement('h2');
  heading.id = `qb-dialog-${Date.now()}`;
  heading.textContent = title;
  box.setAttribute('aria-labelledby', heading.id);
  box.appendChild(heading);
  if (message) {
    const body = document.createElement('p');
    body.textContent = message;
    box.appendChild(body);
  }

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    opener?.focus?.();
  };
  // Dismissing without choosing counts as Cancel, the way Android's back does.
  const dismiss = () => {
    if (options?.cancelable === false && !cancel) return;
    close();
    if (cancel?.onPress) cancel.onPress();
    else options?.onDismiss?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  };

  const actions = document.createElement('div');
  actions.className = 'qb-dialog-actions';
  // The choice that does something is the strong button; with one button, that one.
  const primary = list.filter(b => b.style !== 'cancel').pop();
  // Enter must never trigger a destructive choice by reflex: focus starts on Cancel then.
  const focusFirst = list.some(b => b.style === 'destructive') && cancel ? cancel : primary;
  let focusEl: HTMLElement | null = null;
  for (const b of list) {
    const el = document.createElement('button');
    if (b === focusFirst) focusEl = el;
    el.type = 'button';
    el.textContent = b.text || 'OK';
    if (b.style === 'destructive') el.className = 'qb-destructive';
    else if (b === primary) el.className = 'qb-primary';
    el.onclick = () => {
      close();
      b.onPress?.();
    };
    actions.appendChild(el);
  }
  box.appendChild(actions);

  backdrop.appendChild(box);
  backdrop.addEventListener('mousedown', e => {
    if (e.target === backdrop) dismiss();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  (focusEl || (actions.lastElementChild as HTMLElement | null))?.focus();
}

export function installGlassShell(Alert: { alert: unknown }, title: string): void {
  document.title = title;

  const font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700;9..40,800&display=swap';
  document.head.appendChild(font);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  Alert.alert = showAlert;
}
