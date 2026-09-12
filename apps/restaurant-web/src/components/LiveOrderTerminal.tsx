import React, { useState, useEffect, useRef } from 'react';
import {
  Button,
  Badge,
  Card,
  StateView,
  ComponentState
} from '@quick-bites/design-system';
import { Bell, Clock, CheckCircle2, PackageCheck, Bike, RefreshCw } from 'lucide-react';
import { fetchRestaurantOrders, updateOrderStatus, getPartnerToken, socketOrigin } from '../api';
import { io, Socket } from 'socket.io-client';

/** The signed-in partner's restaurant. */
const RESTAURANT_ID = 'rst_bbh_01';

interface TerminalOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  items: Array<{ name: string; quantity: number; isVeg: boolean; variant?: string }>;
  totalAmount: number;
  status: 'ORDER_PLACED' | 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'OUT_FOR_DELIVERY';
  prepTimeMinutes?: number;
  placedAt: string;
}

function mapApiOrder(o: any): TerminalOrder {
  return {
    id: o.id,
    orderNumber: o.orderNumber || o.id.slice(-6).toUpperCase(),
    customerName: o.customerName || 'Customer',
    items: Array.isArray(o.items)
      ? o.items.map((it: any) => ({
          name: it.name,
          quantity: it.quantity,
          isVeg: Boolean(it.isVeg),
          variant: it.selectedOptions?.[0]?.optionName
        }))
      : [],
    totalAmount: typeof o.bill?.totalAmount === 'number' ? o.bill.totalAmount : 0,
    status: o.status === 'ACCEPTED' ? 'PREPARING' : (o.status || 'ORDER_PLACED'),
    prepTimeMinutes: o.preparationMinutes || 20,
    placedAt: o.createdAt
      ? new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Recently'
  };
}

export const LiveOrderTerminal: React.FC = () => {
  const [orders, setOrders] = useState<TerminalOrder[]>([]);
  const [uiState, setUiState] = useState<ComponentState>('loading');
  const [selectedPrepTime, setSelectedPrepTime] = useState<number>(20);
  const [lastChimeTime, setLastChimeTime] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const loadLiveOrders = async () => {
    setIsLoading(true);
    try {
      const res = await fetchRestaurantOrders(RESTAURANT_ID);
      if (res.success && Array.isArray(res.data?.orders)) {
        setOrders(
          res.data.orders
            .filter((o: any) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED' && o.status !== 'REFUNDED')
            .map(mapApiOrder)
        );
        setUiState('success');
      } else {
        setUiState('error');
      }
    } catch (err) {
      console.warn('[Terminal] Failed to load live orders', err);
      setUiState('error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLiveOrders();
  }, []);

  // The kitchen should hear about an order the moment it is placed. The backend
  // has always emitted order:created to the restaurant room; nothing listened,
  // so staff only saw new tickets when they pressed Sync.
  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    (async () => {
      const token = await getPartnerToken();
      if (cancelled) return;

      socket = io(socketOrigin(), {
        transports: ['websocket', 'polling'],
        auth: token ? { token } : undefined
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setLiveConnected(true);
        socket?.emit('join:restaurant', { restaurantId: RESTAURANT_ID });
      });
      socket.on('disconnect', () => setLiveConnected(false));
      socket.on('connect_error', () => setLiveConnected(false));

      socket.on('order:created', () => {
        playKitchenChime();
        loadLiveOrders();
      });
      socket.on('order:status_update', () => loadLiveOrders());
      socket.on('menu:updated', () => loadLiveOrders());
    })();

    return () => {
      cancelled = true;
      socket?.emit('leave:restaurant', { restaurantId: RESTAURANT_ID });
      socket?.removeAllListeners();
      socket?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Kitchen Chime Generator using standard Web Audio API
  const playKitchenChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
        setLastChimeTime(new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.warn('Audio Context unavailable in headless mode');
    }
  };

  const applyStatusUpdate = async (
    orderId: string,
    nextStatus: TerminalOrder['status'],
    prepTimeMinutes?: number
  ) => {
    setActionError(null);
    const previous = orders;
    setOrders(prev =>
      prev.map(o => (o.id === orderId ? { ...o, status: nextStatus, prepTimeMinutes: prepTimeMinutes ?? o.prepTimeMinutes } : o))
    );

    try {
      const res = await updateOrderStatus(orderId, nextStatus, prepTimeMinutes);
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to update order status.');
      }
    } catch (err: any) {
      // Roll back the optimistic update — the backend never actually confirmed the change.
      setOrders(previous);
      setActionError(err.message || 'Could not reach the server. Please try again.');
    }
  };

  const handleAcceptOrder = (orderId: string) => applyStatusUpdate(orderId, 'PREPARING', selectedPrepTime);
  const handleMarkReady = (orderId: string) => applyStatusUpdate(orderId, 'READY_FOR_PICKUP');
  const handleHandover = (orderId: string) => applyStatusUpdate(orderId, 'OUT_FOR_DELIVERY');

  const activeOrders = orders.filter(o => o.status !== 'OUT_FOR_DELIVERY');

  return (
    <div>
      {/* Action Header */}
      <div className="page-head">
        <div>
          <h2 className="page-title">Live Kitchen Terminal</h2>
          <p className="page-subtitle">
            Incoming customer orders and the preparation queue, synced with the Quick Bites kitchen.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Button variant="outline" size="sm" onClick={loadLiveOrders} leftIcon={<RefreshCw size={16} className={isLoading ? 'spin' : ''} />}>
            {isLoading ? 'Syncing...' : 'Sync Live Orders'}
          </Button>
          <Button variant="outline" size="sm" onClick={playKitchenChime} leftIcon={<Bell size={16} />}>
            Test Kitchen Chime {lastChimeTime ? `(${lastChimeTime})` : ''}
          </Button>
          <Badge
            variant={liveConnected ? 'status-active' : 'status-pending'}
            label={liveConnected ? 'LIVE — ACCEPTING ORDERS' : 'RECONNECTING…'}
          />
        </div>
      </div>

      {actionError && (
        <div
          style={{
            marginBottom: 'var(--space-4)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-danger-50, #FEF2F2)',
            color: 'var(--color-danger-600, #DC2626)',
            fontSize: 'var(--font-size-sm)'
          }}
        >
          {actionError}
        </div>
      )}

      {/* 4-State UI Container */}
      <StateView
        state={uiState === 'success' && activeOrders.length === 0 ? 'empty' : uiState}
        emptyTitle="No Active Orders in Kitchen Queue"
        emptyDescription="All incoming orders have been prepared and handed over to delivery partners."
        emptyActionLabel="Refresh Queue"
        onEmptyAction={loadLiveOrders}
        errorMessage="Could not reach the Quick Bites server. Check your connection and try again."
        onRetry={loadLiveOrders}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-5)' }}>
          {activeOrders.map(order => (
            <Card key={order.id} style={{ borderTop: order.status === 'ORDER_PLACED' ? '4px solid var(--color-primary-500)' : '4px solid var(--color-accent-500)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-extrabold)', fontSize: 'var(--font-size-xl)', letterSpacing: '-0.02em' }}>
                    {order.orderNumber}
                  </span>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    Placed {order.placedAt} • {order.customerName}
                  </div>
                </div>
                {order.status === 'ORDER_PLACED' && (
                  <Badge variant="status-pending" label="INCOMING" />
                )}
                {order.status === 'PREPARING' && (
                  <Badge variant="status-active" label={`PREP: ${order.prepTimeMinutes}m`} />
                )}
                {order.status === 'READY_FOR_PICKUP' && (
                  <Badge variant="gold" label="READY FOR PICKUP" />
                )}
              </div>

              {/* Items List */}
              <div style={{ backgroundColor: 'var(--bg-app)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                {order.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <Badge variant={item.isVeg ? 'veg' : 'nonveg'} />
                      <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                        {item.quantity}x {item.name}
                      </span>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px dashed var(--border-medium)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', fontWeight: 'var(--font-weight-bold)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Bill Total</span>
                  <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-extrabold)', fontFamily: 'var(--font-family-mono)' }}>₹{order.totalAmount.toFixed(2)}</span>
                </div>
              </div>

              {/* Kitchen Action Buttons */}
              {order.status === 'ORDER_PLACED' && (
                <div>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>Prep Time:</span>
                    {[15, 20, 30].map(mins => (
                      <button
                        key={mins}
                        onClick={() => setSelectedPrepTime(mins)}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid',
                          borderColor: selectedPrepTime === mins ? 'var(--color-primary-500)' : 'var(--border-medium)',
                          backgroundColor: selectedPrepTime === mins ? 'var(--color-primary-50)' : 'transparent',
                          color: selectedPrepTime === mins ? 'var(--color-primary-500)' : 'var(--text-secondary)',
                          fontSize: 'var(--font-size-xs)',
                          cursor: 'pointer'
                        }}
                      >
                        +{mins}m
                      </button>
                    ))}
                  </div>
                  <Button variant="primary" style={{ width: '100%' }} onClick={() => handleAcceptOrder(order.id)} leftIcon={<Clock size={16} />}>
                    Accept Order & Start Cooking
                  </Button>
                </div>
              )}

              {order.status === 'PREPARING' && (
                <Button variant="veg" style={{ width: '100%' }} onClick={() => handleMarkReady(order.id)} leftIcon={<PackageCheck size={16} />}>
                  Mark Food Ready for Pickup
                </Button>
              )}

              {order.status === 'READY_FOR_PICKUP' && (
                <Button variant="secondary" style={{ width: '100%' }} onClick={() => handleHandover(order.id)} leftIcon={<Bike size={16} />}>
                  Handover to Delivery Partner
                </Button>
              )}
            </Card>
          ))}
        </div>
      </StateView>
    </div>
  );
};
