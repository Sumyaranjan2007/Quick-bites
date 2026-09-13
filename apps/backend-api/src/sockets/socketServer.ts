import jwt from 'jsonwebtoken';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { config } from '../config/env.ts';
import type { Order, OrderStatus } from '@quick-bites/shared-types';

let ioInstance: SocketIOServer | null = null;

export interface SocketUserContext {
  userId?: string;
  role?: 'CUSTOMER' | 'RESTAURANT_PARTNER' | 'DELIVERY_PARTNER' | 'ADMIN';
  token?: string;
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

    let userId = auth?.userId || query?.userId || `anon_${socket.id.slice(0, 8)}`;
    let role = auth?.role || (query?.role as any) || 'CUSTOMER';

    if (token) {
      try {
        const payload = jwt.verify(token, config.JWT_SECRET) as any;
        userId = payload.sub || userId;
        const mappedRole = payload.role?.toUpperCase();
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
    } else if (!config.DEMO_MODE) {
      return next(new Error('AUTH_REQUIRED: Authentication token required for real-time WebSocket connection.'));
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

    // Handlers for room joining / leaving
    socket.on('join:order', (data: { orderId: string }) => {
      if (!data?.orderId) return;
      const room = `order:${data.orderId}`;
      socket.join(room);
      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'SOCKET_ROOM_JOINED',
        socketId: socket.id,
        room,
        userId
      }));
    });

    socket.on('leave:order', (data: { orderId: string }) => {
      if (!data?.orderId) return;
      socket.leave(`order:${data.orderId}`);
    });

    socket.on('join:restaurant', (data: { restaurantId: string }) => {
      if (!data?.restaurantId) return;
      const room = `restaurant:${data.restaurantId}`;
      socket.join(room);
      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'SOCKET_ROOM_JOINED',
        socketId: socket.id,
        room,
        userId
      }));
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
      socket.join(`menu:${data.restaurantId}`);
    });

    socket.on('leave:menu', (data: { restaurantId: string }) => {
      if (!data?.restaurantId) return;
      socket.leave(`menu:${data.restaurantId}`);
    });

    socket.on('join:admin', () => {
      socket.join('admin:control_tower');
    });

    // Riders on shift wait here to be told about food that is ready to collect.
    // Without it the rider app only learns of work when someone taps refresh.
    socket.on('join:riders', () => {
      socket.join('riders:available');
      console.log(JSON.stringify({
        level: 'INFO',
        timestamp: new Date().toISOString(),
        event: 'SOCKET_ROOM_JOINED',
        socketId: socket.id,
        room: 'riders:available',
        userId
      }));
    });

    socket.on('leave:riders', () => {
      socket.leave('riders:available');
    });

    // Rider live telemetry ping
    socket.on('rider:location', (data: { orderId: string; lat: number; lng: number; bearing?: number }) => {
      if (!data?.orderId) return;
      const payload = {
        orderId: data.orderId,
        lat: data.lat,
        lng: data.lng,
        bearing: data.bearing || 0,
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
