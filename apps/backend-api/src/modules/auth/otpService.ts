/**
 * One-time codes for phone sign-in.
 *
 * Customers identify themselves by phone number, as they do on every delivery
 * app in this market. There is no customer password to forget, reset, reuse
 * from another site, or leak.
 *
 * Rules this file enforces, and why each one is here rather than in a route:
 *
 * HASHED AT REST. The stored value is a SHA-256 of the code. A code in plain
 * text in the store — or in a log line, or in an API response — is a password
 * sitting in the open for its lifetime. Nothing in this module ever returns or
 * logs the code itself.
 *
 * SINGLE USE. A verified code is deleted before the token is issued, so a code
 * captured in transit cannot be replayed a second time.
 *
 * ATTEMPT CAP. A six-digit code is one in a million, which is a great deal less
 * than a million if unlimited guesses are allowed. After OTP_MAX_ATTEMPTS the
 * code is destroyed and a new one must be requested.
 *
 * NO ORACLE. Requesting a code for an unknown number behaves exactly as it does
 * for a known one. If the two differed, the endpoint would answer "does this
 * person have an account here?" for anyone with a list of phone numbers.
 *
 * FIXED CODE IS NOT A PRODUCTION FEATURE. The `fixed` driver accepts one known
 * code and delivers nothing. On a public deployment that means anyone who knows
 * six digits can sign in as any phone number, so it is refused in production
 * unless OTP_ALLOW_FIXED_IN_PRODUCTION is set deliberately, for a tester phase,
 * and removed at launch.
 */
import crypto from 'crypto';
import { memoryStore, triggerAutoSave } from '../../db/client.ts';
import { config } from '../../config/env.ts';
import { activeDriver, maskPhone } from './otpDrivers.ts';
import { normalizeIndianPhone } from '../../utils/phone.ts';

interface PendingCode {
  phone: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}

/** Codes live in the same store as everything else, so they survive a restart. */
const keyFor = (phone: string) => `otp:${normalizeIndianPhone(phone)}`;

function hash(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function read(phone: string): PendingCode | null {
  return (memoryStore.settings.get(keyFor(phone)) as PendingCode) || null;
}

function write(phone: string, pending: PendingCode): void {
  memoryStore.settings.set(keyFor(phone), pending);
  triggerAutoSave();
}

function clear(phone: string): void {
  memoryStore.settings.delete(keyFor(phone));
  triggerAutoSave();
}

/**
 * Six digits from a cryptographic source.
 *
 * `Math.random()` is seeded predictably and is not a secret generator; a code
 * an attacker can predict is not a second factor at all.
 */
function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface RequestOutcome {
  /** The request was accepted. Never reports per-number delivery — see NO ORACLE. */
  accepted: boolean;
  /** Whether this deployment can deliver an SMS at all. A property of the deployment, not the number. */
  deliveryConfigured: boolean;
  /** Seconds the caller must wait before asking again. */
  retryAfterSeconds?: number;
  /** Set when the deployment is misconfigured, e.g. a fixed code in production. */
  configurationError?: string;
}

export const otpService = {
  /**
   * Is this deployment allowed to issue codes at all?
   *
   * Checked on every request rather than at boot, so a host that flips the
   * variable cannot leave a running process issuing codes it should not.
   */
  configurationError(): string | null {
    const driver = activeDriver();

    if (driver.name === 'fixed' && config.IS_PRODUCTION && !config.OTP_ALLOW_FIXED_IN_PRODUCTION) {
      return 'Sign-in is unavailable: this deployment has no SMS provider configured.';
    }
    if (config.OTP_FIXED_CODE.length < 4 && driver.name === 'fixed') {
      return 'Sign-in is unavailable: the configured verification code is too short.';
    }
    return null;
  },

  /** True when a real provider is wired, so the apps can say something honest. */
  deliveryConfigured(): boolean {
    return activeDriver().delivers;
  },

  async request(rawPhone: string): Promise<RequestOutcome> {
    const phone = normalizeIndianPhone(rawPhone);
    const misconfigured = this.configurationError();
    if (misconfigured) {
      return { accepted: false, deliveryConfigured: false, configurationError: misconfigured };
    }

    const existing = read(phone);
    const now = Date.now();

    // Cooldown, so the endpoint cannot be used to bombard someone's handset —
    // or to run up an SMS bill, which is the same request from the other side.
    if (existing && now - existing.lastSentAt < config.OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      const retryAfterSeconds = Math.ceil(
        (config.OTP_RESEND_COOLDOWN_SECONDS * 1000 - (now - existing.lastSentAt)) / 1000
      );
      return { accepted: true, deliveryConfigured: this.deliveryConfigured(), retryAfterSeconds };
    }

    const driver = activeDriver();
    const code = driver.name === 'fixed' ? config.OTP_FIXED_CODE : generateCode();

    write(phone, {
      phone,
      codeHash: hash(code),
      expiresAt: now + config.OTP_TTL_MINUTES * 60 * 1000,
      attempts: 0,
      lastSentAt: now
    });

    const delivery = await driver.send(phone, code);

    console.log(JSON.stringify({
      level: delivery.accepted ? 'INFO' : 'ERROR',
      timestamp: new Date().toISOString(),
      event: 'OTP_REQUESTED',
      phone: maskPhone(phone),
      provider: driver.name,
      deliveryAccepted: delivery.accepted,
      // Deliberately absent: the code. Never log a credential.
      error: delivery.error
    }));

    // The caller is told the request was accepted whether or not the provider
    // took it, and whether or not the number belongs to anyone. A failure to
    // deliver is this deployment's problem to see in its logs, not a fact to
    // hand back to whoever is asking.
    return { accepted: true, deliveryConfigured: driver.delivers };
  },

  /**
   * Checks a code and consumes it.
   *
   * Returns only whether it matched. The caller decides what that means — for
   * an unknown number it means "create the account", which is Zomato's flow and
   * is why there is no separate sign-up.
   */
  async verify(rawPhone: string, submittedCode: string): Promise<{ ok: boolean; reason?: string }> {
    const phone = normalizeIndianPhone(rawPhone);
    const misconfigured = this.configurationError();
    if (misconfigured) return { ok: false, reason: misconfigured };

    const pending = read(phone);
    if (!pending) {
      return { ok: false, reason: 'That code has expired. Ask for a new one.' };
    }

    if (Date.now() > pending.expiresAt) {
      clear(phone);
      return { ok: false, reason: 'That code has expired. Ask for a new one.' };
    }

    if (pending.attempts >= config.OTP_MAX_ATTEMPTS) {
      clear(phone);
      return { ok: false, reason: 'Too many incorrect attempts. Ask for a new code.' };
    }

    const submitted = String(submittedCode || '').trim();

    // Compared as fixed-length digests through timingSafeEqual: comparing the
    // codes with === leaks how many leading characters were right through how
    // long the comparison took. The window is small over a network and the
    // defence costs nothing.
    const matches =
      submitted.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(hash(submitted), 'hex'), Buffer.from(pending.codeHash, 'hex'));

    if (!matches) {
      pending.attempts += 1;
      write(phone, pending);
      const remaining = config.OTP_MAX_ATTEMPTS - pending.attempts;

      console.log(JSON.stringify({
        level: 'WARN',
        timestamp: new Date().toISOString(),
        event: 'OTP_VERIFY_FAILED',
        phone: maskPhone(phone),
        attemptsRemaining: Math.max(0, remaining)
      }));

      return {
        ok: false,
        reason: remaining > 0
          ? 'That code is not right. Check it and try again.'
          : 'Too many incorrect attempts. Ask for a new code.'
      };
    }

    // Consumed before the caller issues anything, so a code cannot be replayed.
    clear(phone);
    return { ok: true };
  },

  /** Test seam: forget any pending code for a number. */
  forget(phone: string): void {
    clear(phone);
  }
};
