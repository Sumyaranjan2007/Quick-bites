/**
 * One rider fix during a trip (master plan B11), whichever way it arrives:
 * the socket (`rider:location`) or the REST fallback (`POST /riders/telemetry`).
 * Both used to differ: REST kept the fix, the socket relayed it and dropped it,
 * so a customer opening the app mid-trip saw a position minutes old.
 *
 * Callers check first that this rider carries this order (socketAuth /
 * riderRouter); this only records.
 *
 * Review D1: no Snap to Roads (billed per call, about $0.60 an order). When B2 brings
 * the route polyline, project the fix onto it HERE, so every reader gets the
 * on-road position and heading for free.
 */
import type { Order } from '@quick-bites/shared-types';
import { calculateDistanceKm } from '../../db/client.ts';
import { orderRepository } from '../../db/repositories/orderRepository.ts';
import { riderRepository } from '../../db/repositories/riderRepository.ts';

/** Older than this, tracking says "updating…" rather than showing the dot as live. */
export const STALE_AFTER_MS = 30_000;
/** 100 m/s is 360 km/h: anything above is a broken reading, not a bike. */
export const MAX_SPEED_MPS = 100;

export const isStale = (updatedAt?: string | null, now = Date.now()) =>
  !updatedAt || now - new Date(updatedAt).getTime() > STALE_AFTER_MS;

export async function recordRiderFix(
  order: Order,
  fix: { lat: number; lng: number; bearing?: number; speed?: number }
): Promise<{ lat: number; lng: number; bearing: number; speed: number | null; updatedAt: string }> {
  const updatedAt = new Date().toISOString();
  const coords = { latitude: fix.lat, longitude: fix.lng };
  const bearing = Number.isFinite(fix.bearing) ? Number(fix.bearing) : 0;

  // The phone's GPS speed when it sends one; otherwise distance over time since the last fix.
  let speed: number | null = Number.isFinite(fix.speed) ? Number(fix.speed) : null;
  const prev = order.riderCoordinates;
  const seconds = order.riderLocationUpdatedAt ? (Date.parse(updatedAt) - Date.parse(order.riderLocationUpdatedAt)) / 1000 : 0;
  if (speed === null && prev && seconds > 0 && seconds <= 120) {
    speed = (calculateDistanceKm(prev.latitude, prev.longitude, fix.lat, fix.lng) * 1000) / seconds;
    if (speed > MAX_SPEED_MPS) speed = null;
  }
  if (speed !== null) speed = Math.round(speed * 10) / 10;

  if (order.riderId) await riderRepository.updateLocation(order.riderId, coords);
  await orderRepository.updateRiderLocation(order.id, coords, bearing, updatedAt, speed);
  return { lat: fix.lat, lng: fix.lng, bearing, speed, updatedAt };
}
