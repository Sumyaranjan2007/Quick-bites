/**
 * Stops calling a dependency that has stopped answering.
 *
 * The failure this prevents is not "the payment gateway is down" — that one is
 * survivable. It is what the server does about it. Node's `fetch` has no
 * default timeout, so a gateway that accepts connections and never replies
 * holds every checkout request open indefinitely: connections accumulate, the
 * event loop fills with pending promises, and an outage at one vendor becomes
 * an outage of the whole platform, including browsing and order tracking that
 * never needed the gateway at all.
 *
 * Two mechanisms, and both are needed:
 *
 *   - A deadline on every call, so one request cannot hang forever.
 *   - A breaker, so the hundredth customer does not wait out the same deadline
 *     the first ninety-nine already proved would expire.
 *
 * What counts as a failure matters more than the thresholds. A gateway that
 * answers "this card was declined" is working perfectly; tripping on that would
 * take payments offline every time a few customers in a row had insufficient
 * funds. Only a timeout, a connection error, or a 5xx counts here.
 */
import { AppError } from '../../utils/AppError.ts';

export interface BreakerOptions {
  /** Consecutive qualifying failures before the breaker opens. */
  threshold: number;
  /** How long it stays open before allowing one trial call, in milliseconds. */
  cooldownMs: number;
  /** Deadline applied to each attempt, in milliseconds. */
  timeoutMs: number;
}

type State = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  readonly name: string;
  private readonly options: BreakerOptions;
  private failures = 0;
  private openedAt = 0;
  private state: State = 'closed';
  /** Set while a half-open trial is in flight, so only one call probes. */
  private probing = false;

  constructor(name: string, options: Partial<BreakerOptions> = {}) {
    this.name = name;
    this.options = {
      threshold: options.threshold ?? 5,
      cooldownMs: options.cooldownMs ?? 30_000,
      timeoutMs: options.timeoutMs ?? 10_000
    };
  }

  /** For the operations screen and for tests, which need to see it trip. */
  snapshot(): { name: string; state: State; failures: number; openedAt: string | null } {
    this.refresh();
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null
    };
  }

  /** Moves an expired open breaker to half-open. Called before every decision. */
  private refresh(now = Date.now()): void {
    if (this.state === 'open' && now - this.openedAt >= this.options.cooldownMs) {
      this.state = 'half-open';
      this.probing = false;
    }
  }

  reset(): void {
    this.failures = 0;
    this.openedAt = 0;
    this.state = 'closed';
    this.probing = false;
  }

  private recordSuccess(): void {
    if (this.state !== 'closed') {
      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'CIRCUIT_CLOSED',
        dependency: this.name
      }));
    }
    this.reset();
  }

  private recordFailure(reason: string): void {
    this.failures++;
    // A failed trial call sends it straight back to open. Counting to the
    // threshold again would let a dead dependency be probed five times per
    // cooldown instead of once.
    if (this.state === 'half-open' || this.failures >= this.options.threshold) {
      const wasOpen = this.state === 'open';
      this.state = 'open';
      this.openedAt = Date.now();
      this.probing = false;
      if (!wasOpen) {
        console.log(JSON.stringify({
          level: 'ERROR',
          timestamp: new Date().toISOString(),
          event: 'CIRCUIT_OPENED',
          dependency: this.name,
          consecutiveFailures: this.failures,
          cooldownSeconds: Math.round(this.options.cooldownMs / 1000),
          reason
        }));
      }
    }
  }

  /**
   * Runs `fn` under the breaker and a deadline.
   *
   * `fn` receives an AbortSignal and is expected to pass it to `fetch`. Without
   * that the timeout would resolve the wrapper while the underlying socket
   * stayed open, which fixes the symptom and not the leak.
   *
   * `isFailure` decides what counts. The default treats any thrown error as a
   * failure; a caller that inspects HTTP status passes its own.
   */
  async run<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    isFailure: (result: T) => boolean = () => false
  ): Promise<T> {
    this.refresh();

    if (this.state === 'open') {
      throw new AppError(
        `${this.name} is not responding. This has been paused for a moment — please try again shortly.`,
        503,
        'DEPENDENCY_UNAVAILABLE'
      );
    }

    if (this.state === 'half-open') {
      if (this.probing) {
        throw new AppError(
          `${this.name} is being checked. Please try again in a moment.`,
          503,
          'DEPENDENCY_UNAVAILABLE'
        );
      }
      this.probing = true;
    }

    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const result = await fn(controller.signal);
      if (isFailure(result)) {
        this.recordFailure('upstream reported a server error');
      } else {
        this.recordSuccess();
      }
      return result;
    } catch (error) {
      const reason = controller.signal.aborted
        ? `no response within ${this.options.timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : String(error);
      this.recordFailure(reason);

      // Rethrown as a 503 rather than the raw abort, so the customer is told
      // something true and actionable instead of "The operation was aborted".
      if (controller.signal.aborted) {
        throw new AppError(
          `${this.name} did not respond in time. Please try again.`,
          503,
          'DEPENDENCY_TIMEOUT'
        );
      }
      throw error;
    } finally {
      clearTimeout(deadline);
      if (this.state === 'half-open') this.probing = false;
    }
  }
}

/**
 * The live breakers, one per dependency.
 *
 * Module-level because a breaker created per request has no memory and is
 * therefore not a breaker. Exported as a registry so the operations screen can
 * show what is open without every call site having to report it.
 */
export const breakers = {
  razorpay: new CircuitBreaker('The payment gateway', {
    threshold: 5,
    cooldownMs: 30_000,
    // Card networks are genuinely slow. Ten seconds is long enough for an
    // honest authorisation and far short of a hung socket.
    timeoutMs: 12_000
  })
};

export function breakerSnapshots() {
  return Object.values(breakers).map(b => b.snapshot());
}
