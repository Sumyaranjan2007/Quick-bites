/**
 * The frame for the Partner and Admin apps when they run in a web browser
 * (served at /partner and /admin).
 *
 * The apps' own screens are unchanged; this only dresses the page around them
 * — cream and white, full screen, the brand font, hover and keyboard focus —
 * and supplies the one thing React Native for Web
 * leaves out: `Alert.alert`, which is a silent no-op there. Every "Are you
 * sure?" in both apps (well over a hundred) would otherwise do nothing in a
 * browser, so it is replaced by an accessible dialog with any number of buttons.
 *
 * Called once, before the app renders, from each app's src/webSetup.web.ts.
 */

type AlertButton = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };
type AlertOptions = { cancelable?: boolean; onDismiss?: () => void };

const CSS = `
/*
 * Cream and white, full screen (owner, 11 Oct 2026). The earlier frame drew
 * moving, blurred colour blobs behind a blurred panel; phones spent every
 * frame repainting them, taps lagged and pages seemed not to switch. Now:
 * flat colours, no animation, the app filling the whole window.
 */
:root { --qb-maroon:#641C32; --qb-amber:#F5A623; --qb-ink:#1F1A17; --qb-cream:#FFF8EE; --qb-line:#EFE3D3; }
html, body { height:100%; margin:0; background:var(--qb-cream); -webkit-text-size-adjust:100%; }
body { overscroll-behavior:none; }
#root, #root div, #root span, #root input, #root textarea, .qb-dialog, .qb-dialog * {
  font-family: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
}
/*
 * The visible window, not 100vh: on a phone 100vh includes the space behind
 * the browser's own address and tool bars, which hid the app's bottom tabs.
 */
#root {
  display:flex; flex-direction:column; box-sizing:border-box;
  width:100%; height:100vh; height:100dvh;
  background: linear-gradient(180deg, #FFFFFF 0%, var(--qb-cream) 100%);
}
/* No double-tap zoom wait: a tap answers at once. */
#root, #root * { touch-action: manipulation; -webkit-tap-highlight-color: rgba(100,28,50,.08); }
@media (hover: hover) {
  #root [role="button"], #root [role="tab"], #root [tabindex="0"] { transition: filter .12s ease; }
  #root [role="button"]:hover, #root [role="tab"]:hover, #root [tabindex="0"]:hover { filter: brightness(.97); cursor:pointer; }
}
:focus-visible { outline: 3px solid var(--qb-amber) !important; outline-offset: 2px; border-radius: 10px; }
::-webkit-scrollbar { width:10px; height:10px; }
::-webkit-scrollbar-thumb { background: rgba(100,28,50,.22); border-radius:10px; border:2px solid transparent; background-clip:padding-box; }
::-webkit-scrollbar-track { background: transparent; }

.qb-dialog-backdrop {
  position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; padding:16px;
  background: rgba(31,26,23,.45);
  animation: qb-fade .16s ease-out;
}
.qb-dialog {
  width:min(440px,100%); box-sizing:border-box; padding:24px; border-radius:24px; color:var(--qb-ink);
  background: #FFFFFF; border:1px solid var(--qb-line);
  box-shadow: 0 24px 60px rgba(31,26,23,.25);
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
  .qb-dialog, .qb-dialog-backdrop { animation:none !important; }
  #root [role="button"], #root [role="tab"], #root [tabindex="0"] { transition:none; }
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
