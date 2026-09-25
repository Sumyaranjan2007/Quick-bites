import { memoryStore } from '../db/client.ts';
import { rolesOf } from '../db/repositories/userRepository.ts';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { config } from '../config/env.ts';
import type { Order, OrderStatus, RiderTripStage } from '@quick-bites/shared-types';
import {
  canJoinOrder,
  canJoinRestaurant,
  canJoinMenu,
  canJoinAdmin,
  canJoinRidersPool,
  canStreamRiderLocation,
  isPlottableCoordinate,
  type SocketIdentity,
  type SocketRole
} from './socketAuth.ts';

let ioInstance: SocketIOServer | null = null;

/**
 * What a client may put in the socket handshake.
 *
 * `userId` and `role` are accepted for backwards compatibility with older app
 * builds and are then IGNORED. Identity is read from `token` alone. Do not
 * reintroduce a read of these fields: they are attacker-controlled strings, and
 * trusting them is what let any connection claim to be an administrator.
 */
export interface SocketUserContext {
  token?: string;
  /** @deprecated Ignored by the server. Identity comes from the token. */
  userId?: string;
  /** @deprecated Ignored by the server. Role comes from the token. */
  role?: SocketRole;
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  if (ioInstance) {
    return ioInstance;
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.NODE_ENV === 'production' ? config.CORS_WHITELIST : true,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingInterval: 25000,
    pingTimeout: 20000,
    transports: ['websocket', 'polling']
  });

  // Handshake Authentication & Context Middleware
  io.use((socket: Socket, next) => {
    const auth = socket.handshake.auth as SocketUserContext;
    const query = socket.handshake.query as Record<string, string>;
    const token = auth?.token || (query?.token as string);

    // Identity comes from the signed token and from nowhere else.
    //
    // This used to fall back to `auth.userId` and `auth.role` straight off the
    // handshake, which are client-supplied strings. Anyone could therefore
    // announce themselves as an administrator and be auto-joined to the control
    // tower below. Production was protected only because it force-disables demo
    // mode; that is one edit away from not being true, and a security boundary
    // should not rest on a second, unrelated setting.
    if (!token) {
      return next(new Error('AUTH_REQUIRED: Authentication token required for real-time WebSocket connection.'));
    }

    let userId: string;
    let role: SocketRole;

    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as any;
      if (!payload?.sub) {
        return next(new Error('INVALID_SOCKET_TOKEN: Token carries no subject.'));
      }
      userId = payload.sub;

      /*
       * The ACCOUNT decides, not the token. The role used to come straight
       * from the token, and blocked or deleted accounts were never checked, so
       * a staff member removed or blocked kept the control-tower feed (every
       * rider's live position, every ops alert) until their token expired a
       * week later. The HTTP middleware already re-reads the account; this is
       * the same rule for the socket.
       */
      const stored = memoryStore.users.get(userId) as any;
      if (!stored || stored.isBlocked) {
        return next(new Error('ACCOUNT_UNAVAILABLE: This account cannot connect.'));
      }
      if ((Number(payload.tv) || 0) !== (Number(stored.tokenVersion) || 0)) {
        return next(new Error('SESSION_REVOKED: Sign in again.'));
      }
      // The token's role when the account still holds it (B's review: a
      // partner-app socket of a multi-role account must join as a partner),
      // else the account's primary role. A removed role never survives.
      const storedRoles: string[] = rolesOf(stored);
      const effective =
        payload.role && storedRoles.includes(payload.role) ? payload.role : stored.role;

      const mappedRole = String(effective || '').toUpperCase();
      if (mappedRole === 'ADMIN' || mappedRole === 'SUPER_ADMIN') {
        role = 'ADMIN';
      } else if (mappedRole === 'RESTAURANT_OWNER') {
        role = 'RESTAURANT_PARTNER';
      } else if (mappedRole === 'RIDER') {
        role = 'DELIVERY_PARTNER';
      } else {
        role = 'CUSTOMER';
      }
    } catch (err: any) {
      return next(new Error('INVALID_SOCKET_TOKEN: Authentication token is invalid or expired.'));
    }

    socket.data = {
      userId,
      role,
      connectedAt: new Date().toISOString()
    };

    next();
  });

  io.on('connection', (socket: Socket) => {
    const { userId, role } = socket.data;

    console.log(JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      event: 'SOCKET_CONNECTED',
      socketId: socket.id,
      userId,
      role
    }));

    // Auto-join user-specific room
    if (userId) {
      socket.join(`user:${userId}`);
    }

    // Role-based room assignment
    if (role === 'ADMIN') {
      socket.join('admin:control_tower');
    }

    const identity: SocketIdentity = { userId, role };

    /**
     * A subscription that was asked for and refused.
     *
     * Logged at WARN with the reason, because a refusal is either a client bug
     * or somebody probing; both are worth seeing. The client is told only that
     * it was denied — the reason distinguishes "no such order" from "not your
     * order", and handing that distinction back would answer questions the
     * caller has no right to ask.
     */
    const refuse = (requestedEvent: string, target: string, reason?: string): void => {
      console.log(JSON.stringify({
        level: 'WARN',
        timestamp: new Date().toISOString(),
        event: 'SOCKET_SUBSCRIPTION_REFUSED',
        socketId: socket.id,
        requestedEvent,
        target,
        reason,
        userId,
        role
      }));
      socket.emit('subscription:denied', { event: requestedEvent, target });
    };

    const grant = (room: string): void => {
      socket.join(room);
      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'SOCKET_ROOM_JOINED',
        socketId: socket.id,
        room,
        userId,
        role
      }));
    };

    // Handlers for room joining / leaving
    socket.on('join:order', async (data: { orderId: string }) => {
      if (!data?.orderId) return;
      const decision = await canJoinOrder(identity, data.orderId);
      if (!decision.allowed) {
        return refuse('join:order', data.orderId, decision.reason);
      }
      grant(`order:${data.orderId}`);
    });

    socket.on('leave:order', (data: { orderId: string }) => {
      if (!data?.orderId) return;
      socket.leave(`order:${data.orderId}`);
    });

    socket.on('join:restaurant', async (data: { restaurantId: string }) => {
      if (!data?.restaurantId) return;
      const decision = await canJoinRestaurant(identity, data.restaurantId);
      if (!decision.allowed) {
        return refuse('join:restaurant', data.restaurantId, decision.reason);
      }
      grant(`restaurant:${data.restaurantId}`);
    });

    socket.on('leave:restaurant', (data: { restaurantId: string }) => {
      if (!data?.restaurantId) return;
      socket.leave(`restaurant:${data.restaurantId}`);
    });

    // Customers browsing a restaurant watch its menu here.
    //
    // Deliberately not the `restaurant:` room: that one carries whole order
    // objects for every order the kitchen receives, so putting customers in it
    // to deliver a menu ping would hand them other people's orders.
    socket.on('join:menu', (data: { restaurantId: string }) => {
      if (!data?.restaurantId) return;
      const decision = canJoinMenu(identity);
      if (!decision.allowed) {
        return refuse('join:menu', data.restaurantId, decision.reason);
      }
      socket.join(`menu:${data.restaurantId}`);
    });

    socket.on('leave:menu', (data: { restaurantId: string }) => {
      if (!data?.restaurantId) return;
      socket.leave(`menu:${data.restaurantId}`);
    });

    socket.on('join:admin', () => {
      const decision = canJoinAdmin(identity);
      if (!decision.allowed) {
        return refuse('join:admin', 'admin:control_tower', decision.reason);
      }
      grant('admin:control_tower');
    });

    // Riders on shift wait here to be told about food that is ready to collect.
    // Without it the rider app only learns of work when someone taps refresh.
    socket.on('join:riders', async () => {
      const decision = await canJoinRidersPool(identity);
      if (!decision.allowed) {
        return refuse('join:riders', 'riders:available', decision.reason);
      }
      grant('riders:available');
    });

    socket.on('leave:riders', () => {
      socket.leave('riders:available');
    });

    // Rider live telemetry ping.
    //
    // Accepted only from the rider actually carrying the order, and only once
    // the order is out for delivery. Before that the map stays dark, which is
    // both the behaviour customers expect and the rider's own privacy: where
    // they are before they have collected anything is not the customer's
    // business. Restricting the publisher to the assigned rider also stops
    // fabricated coordinates being pushed into a stranger's tracking screen.
    socket.on('rider:location', async (data: { orderId: string; lat: number; lng: number; bearing?: number }) => {
      if (!data?.orderId) return;

      if (!isPlottableCoordinate(data.lat, data.lng)) {
        return refuse('rider:location', data.orderId, 'INVALID_COORDINATE');
      }

      const decision = await canStreamRiderLocation(identity, data.orderId);
      if (!decision.allowed) {
        return refuse('rider:location', data.orderId, decision.reason);
      }

      const payload = {
        orderId: data.orderId,
        lat: data.lat,
        lng: data.lng,
        bearing: Number.isFinite(data.bearing) ? data.bearing : 0,
        updatedAt: new Date().toISOString()
      };
      // Relayed to order subscribers and admin
      socket.to(`order:${data.orderId}`).emit('rider:location_update', payload);
      socket.to('admin:control_tower').emit('rider:location_update', payload);
    });

    socket.on('disconnect', (reason: string) => {
      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'SOCKET_DISCONNECTED',
        socketId: socket.id,
        userId,
        reason
      }));
    });
  });

  ioInstance = io;
  return io;
}

export function getSocketServer(): SocketIOServer | null {
  return ioInstance;
}

/**
 * Puts a rider into, or takes them out of, the pool that receives delivery
 * offers — driven by the shift toggle rather than by the client.
 *
 * The rider app emits `join:riders` once, when its socket connects. Membership
 * is now conditional on being on shift, so a rider who opened the app before
 * starting work would ask, be refused, and then never ask again: they would sit
 * on the dashboard having gone online and be offered nothing until they killed
 * and reopened the app. Rather than weaken the rule — offers carry a customer's
 * address and the trip's payout, and someone who has gone home should not
 * receive them — the server moves them in and out itself, which is also the
 * only version that survives a rider ending their shift mid-session.
 *
 * Every socket is auto-joined to `user:<id>` on connection, so that room is a
 * usable handle on "every device this person has open".
 */
export function setRiderOfferPoolMembership(userId: string, onShift: boolean): void {
  if (!ioInstance) return;

  const room = ioInstance.in(`user:${userId}`);
  if (onShift) {
    room.socketsJoin('riders:available');
  } else {
    room.socketsLeave('riders:available');
  }

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: new Date().toISOString(),
    event: onShift ? 'RIDER_JOINED_OFFER_POOL' : 'RIDER_LEFT_OFFER_POOL',
    userId
  }));
}

export function closeSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!ioInstance) {
      resolve();
      return;
    }
    ioInstance.close(() => {
      ioInstance = null;
      resolve();
    });
  });
}

// --------------------------------------------------------------------------
// Real-time Event Broadcasters
// --------------------------------------------------------------------------

export function emitOrderCreated(restaurantId: string, order: Order): void {
  if (!ioInstance) return;

  const payload = {
    event: 'ORDER_CREATED',
    restaurantId,
    order,
    timestamp: new Date().toISOString()
  };

  ioInstance.to(`restaurant:${restaurantId}`).emit('order:created', payload);
  ioInstance.to('admin:control_tower').emit('order:created', payload);

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: payload.timestamp,
    event: 'SOCKET_EMIT_ORDER_CREATED',
    restaurantId,
    orderId: order.id,
    orderNumber: order.orderNumber
  }));
}

export function emitOrderStatusUpdate(
  orderId: string,
  data: {
    orderId: string;
    status: OrderStatus;
    /**
     * Where the RIDER is, sent alongside where the food is.
     *
     * The two move independently, and a rider accepting used to be announced
     * as a change of `status` - which is how every listening app came to
     * believe the food had moved on when only the rider had. Sending both
     * lets the customer app show the rider on its own line instead of
     * advancing the kitchen's ticks.
     *
     * Optional: most status changes are about the food alone and say nothing
     * about the rider, and an absent field must not be read as "no rider".
     */
    riderStage?: RiderTripStage;
    prepMinutes?: number;
    estimatedDeliveryTime?: string;
    updatedAt?: string;
    /** Lets the kitchen that is cooking this order see the change too. */
    restaurantId?: string;
  }
): void {
  if (!ioInstance) return;

  const payload = {
    ...data,
    updatedAt: data.updatedAt || new Date().toISOString()
  };

  ioInstance.to(`order:${orderId}`).emit('order:status_update', payload);
  ioInstance.to('admin:control_tower').emit('order:status_update', payload);
  // The restaurant only used to hear about orders being created, so a rider
  // claiming or collecting an order never reached the kitchen screen.
  if (data.restaurantId) {
    ioInstance.to(`restaurant:${data.restaurantId}`).emit('order:status_update', payload);
  }

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: payload.updatedAt,
    event: 'SOCKET_EMIT_STATUS_UPDATE',
    orderId,
    status: data.status,
    riderStage: data.riderStage,
    prepMinutes: data.prepMinutes
  }));
}

/**
 * Offers a packed order to every rider waiting for work.
 *
 * The rider app had no live channel at all: an order sat in the broadcast list
 * until the rider happened to refresh. This pushes it the moment the kitchen
 * marks it ready.
 */
export function emitOrderAvailableForPickup(order: {
  id: string;
  orderNumber?: string;
  restaurantId?: string;
  restaurantName?: string;
}): void {
  if (!ioInstance) return;

  const payload = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    restaurantId: order.restaurantId,
    restaurantName: order.restaurantName,
    updatedAt: new Date().toISOString()
  };

  ioInstance.to('riders:available').emit('order:available', payload);

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: payload.updatedAt,
    event: 'SOCKET_EMIT_ORDER_AVAILABLE',
    orderId: order.id,
    orderNumber: order.orderNumber
  }));
}

/**
 * Raises a rider's emergency in the operations control room.
 *
 * Sent to the admin room rather than a support queue: an SOS is not a message
 * waiting to be picked up, and must not sit behind ordinary questions.
 */
export function emitSosAlert(alert: {
  id: string;
  riderId: string;
  riderName: string;
  category: string;
  orderId?: string;
  coordinates?: { latitude: number; longitude: number };
  raisedAt: string;
}): void {
  if (!ioInstance) return;
  ioInstance.to('admin:control_tower').emit('rider:sos', alert);
  console.log(JSON.stringify({
    level: 'ERROR',
    timestamp: alert.raisedAt,
    event: 'RIDER_SOS_RAISED',
    alertId: alert.id,
    riderId: alert.riderId,
    category: alert.category,
    orderId: alert.orderId
  }));
}

/**
 * Raises an operational problem in the control room.
 *
 * Separate from `rider:sos`, which is a person in danger and must not be
 * diluted by a queue of orders that need a rider. This channel carries the
 * things a human has to resolve but nobody is hurt by: an order nobody will
 * collect, a payment that will not settle.
 *
 * Logged as well as emitted, because an alert raised while the control room
 * has nobody logged in would otherwise leave no trace at all.
 */
export function emitOpsAlert(alert: {
  kind: string;
  orderId?: string;
  orderNumber?: string;
  restaurantId?: string;
  restaurantName?: string;
  waitingMinutes?: number;
  detail?: string;
  raisedAt: string;
}): void {
  console.log(JSON.stringify({
    level: 'WARN',
    timestamp: alert.raisedAt,
    event: `OPS_ALERT_${alert.kind}`,
    orderId: alert.orderId,
    orderNumber: alert.orderNumber,
    restaurantId: alert.restaurantId,
    waitingMinutes: alert.waitingMinutes,
    detail: alert.detail
  }));
  if (!ioInstance) return;
  ioInstance.to('admin:control_tower').emit('ops:alert', alert);
}

/** Delivers a chat message to everyone watching that order. */
export function emitOrderMessage(orderId: string, message: unknown): void {
  if (!ioInstance) return;
  ioInstance.to(`order:${orderId}`).emit('order:message', message);
}

export function emitRiderLocation(
  orderId: string,
  location: {
    orderId: string;
    lat: number;
    lng: number;
    bearing?: number;
    updatedAt?: string;
  }
): void {
  if (!ioInstance) return;

  const payload = {
    ...location,
    updatedAt: location.updatedAt || new Date().toISOString()
  };

  ioInstance.to(`order:${orderId}`).emit('rider:location_update', payload);
}

export function emitKitchenStatus(
  restaurantId: string,
  data: {
    isKitchenActive: boolean;
    updatedAt?: string;
  }
): void {
  if (!ioInstance) return;

  const payload = {
    restaurantId,
    ...data,
    updatedAt: data.updatedAt || new Date().toISOString()
  };

  ioInstance.to(`restaurant:${restaurantId}`).emit('kitchen:status_update', payload);
  ioInstance.to('admin:control_tower').emit('kitchen:status_update', payload);
}

/** Tells the kitchen, and every customer browsing it, that a menu changed. */
export function emitMenuUpdated(restaurantId: string): void {
  if (!ioInstance) return;
  const payload = {
    restaurantId,
    updatedAt: new Date().toISOString()
  };
  ioInstance.to(`restaurant:${restaurantId}`).emit('menu:updated', payload);
  ioInstance.to(`menu:${restaurantId}`).emit('menu:updated', payload);
}

/** Puts a partner's menu change in front of whoever is watching the review queue. */
export function emitMenuRequestSubmitted(request: { id: string; restaurantId: string }): void {
  if (!ioInstance) return;
  ioInstance.to('admin:control_tower').emit('menu_request:submitted', {
    requestId: request.id,
    restaurantId: request.restaurantId,
    submittedAt: new Date().toISOString()
  });
}

/** Tells the partner what an administrator decided about their menu request. */
export function emitMenuRequestReviewed(request: {
  id: string;
  restaurantId: string;
  status: string;
}): void {
  if (!ioInstance) return;
  ioInstance.to(`restaurant:${request.restaurantId}`).emit('menu_request:reviewed', {
    requestId: request.id,
    status: request.status,
    reviewedAt: new Date().toISOString()
  });
}
