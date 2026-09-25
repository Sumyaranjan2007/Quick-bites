/**
 * Keeping the app awake while the rider is on shift.
 *
 * Android freezes a backgrounded app's process. Verified on an Android 15
 * emulator: with the app in the background, an offer that the server pushed
 * over the socket produced nothing at all — no alert, no notification — and
 * then fired the instant the app was brought back to the foreground. A rider
 * with the phone in a pocket would simply not be told about work.
 *
 * The fix is the same one every delivery app uses: while on shift, run a
 * foreground service. Android does not freeze a process that owns one, so the
 * socket stays connected and the offer alert — chime, vibration, and the
 * notification that carries the same sound — still reaches the rider. The
 * service here is a location service, which is honest about what it does: the
 * position it collects is the one the customer's tracker needs anyway.
 *
 * The persistent notification is not a nuisance to be minimised. It is the
 * rider's proof that they are still on shift and still reachable by dispatch.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const SHIFT_LOCATION_TASK = 'quickbites-rider-shift-location';

// Must be registered at module scope: the task can be invoked before any React
// component has mounted, when Android restarts the service on its own.
/*
 * Defined, and deliberately empty.
 *
 * The task has to be registered: it IS the foreground service that keeps the
 * process alive, and `startLocationUpdatesAsync` refuses a task name nobody has
 * defined. What it does with each fix is nothing. It used to keep the latest one
 * for "screens that want it", and no screen ever asked — the tracking customers
 * see comes from the trip screen's own watcher, which reports while an order is
 * being carried.
 */
TaskManager.defineTask(SHIFT_LOCATION_TASK, async () => {});

/**
 * Starts the shift service. Returns false when it could not be held open — the
 * rider declined location, or Android refused the service — which the caller
 * should surface, because offers will then only reach them while the app is
 * open.
 */
export async function startShiftService(): Promise<boolean> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return false;

    const alreadyRunning = await TaskManager.isTaskRegisteredAsync(SHIFT_LOCATION_TASK);
    if (alreadyRunning) return true;

    // Android refuses to start a foreground service from an app it does not
    // consider foregrounded, and it does not consider one foregrounded while a
    // permission dialog is on top of it. Asking for location and starting the
    // service in the same breath therefore fails on the very first shift, which
    // is the one that matters. Retry briefly while the dialog finishes closing.
    return await startWithRetry();
  } catch {
    return false;
  }
}

async function startWithRetry(attempt = 0): Promise<boolean> {
  try {
    await Location.startLocationUpdatesAsync(SHIFT_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // Loose intervals: this exists to hold the process open, not to trace the
      // rider. The tight, per-second tracking runs only while an order is being
      // carried, from the trip screen.
      timeInterval: 30000,
      distanceInterval: 50,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'Quick Bites Rider — on shift',
        notificationBody: 'You are online and will be alerted when a delivery is offered.',
        notificationColor: '#24C88E'
      }
    });
    return true;
  } catch (err) {
    if (attempt >= 3) return false;
    await new Promise(resolve => setTimeout(resolve, 800));
    return startWithRetry(attempt + 1);
  }
}

/** Stops it. Called when the rider goes off shift or signs out. */
export async function stopShiftService(): Promise<void> {
  try {
    const running = await TaskManager.isTaskRegisteredAsync(SHIFT_LOCATION_TASK);
    if (running) await Location.stopLocationUpdatesAsync(SHIFT_LOCATION_TASK);
  } catch {
    // Nothing to stop, or the task was already torn down with the process.
  }
}
