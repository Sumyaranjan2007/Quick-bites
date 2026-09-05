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

    const userId = auth?.userId || query?.userId || `anon_${socket.id.slice(0, 8)}`;
    const role = auth?.role || (query?.role as any) || 'CUSTOMER';

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

    socket.on('join:admin', () => {
      socket.join('admin:control_tower');
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
  }
): void {
  if (!ioInstance) return;

  const payload = {
    ...data,
    updatedAt: data.updatedAt || new Date().toISOString()
  };

  ioInstance.to(`order:${orderId}`).emit('order:status_update', payload);
  ioInstance.to('admin:control_tower').emit('order:status_update', payload);

  console.log(JSON.stringify({
    level: 'INFO',
    timestamp: payload.updatedAt,
    event: 'SOCKET_EMIT_STATUS_UPDATE',
    orderId,
    status: data.status,
    prepMinutes: data.prepMinutes
  }));
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
