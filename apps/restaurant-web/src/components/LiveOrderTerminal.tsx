import React, { useState } from 'react';
import {
  Button,
  Badge,
  Card,
  StateView,
  ComponentState
} from '@quick-bites/design-system';
import { Bell, Clock, CheckCircle2, PackageCheck, Bike } from 'lucide-react';

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

const INITIAL_ORDERS: TerminalOrder[] = [
  {
    id: 'ord_live_01',
    orderNumber: 'QB-981245',
    customerName: 'Rahul Sharma',
    items: [
      { name: 'Special Chicken Dum Biryani', quantity: 2, isVeg: false, variant: 'Regular (Serves 1)' },
      { name: 'Extra Boondi Raita', quantity: 1, isVeg: true }
    ],
    totalAmount: 670.00,
    status: 'ORDER_PLACED',
    placedAt: '2 mins ago'
  },
  {
    id: 'ord_live_02',
    orderNumber: 'QB-773120',
    customerName: 'Priya Iyer',
    items: [
      { name: 'Paneer Butter Masala', quantity: 1, isVeg: true },
      { name: 'Butter Naan', quantity: 3, isVeg: true }
    ],
    totalAmount: 410.00,
    status: 'PREPARING',
    prepTimeMinutes: 20,
    placedAt: '12 mins ago'
  }
];

export const LiveOrderTerminal: React.FC = () => {
  const [orders, setOrders] = useState<TerminalOrder[]>(INITIAL_ORDERS);
  const [uiState, setUiState] = useState<ComponentState>('success');
  const [selectedPrepTime, setSelectedPrepTime] = useState<number>(20);
  const [lastChimeTime, setLastChimeTime] = useState<string | null>(null);

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

  const handleAcceptOrder = (orderId: string) => {
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? { ...o, status: 'PREPARING', prepTimeMinutes: selectedPrepTime }
          : o
      )
    );
  };

  const handleMarkReady = (orderId: string) => {
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId ? { ...o, status: 'READY_FOR_PICKUP' } : o
      )
    );
  };

  const handleHandover = (orderId: string) => {
    setOrders(prev =>
      prev.map(o =>
        o.id === orderId ? { ...o, status: 'OUT_FOR_DELIVERY' } : o
      )
    );
  };

  const activeOrders = orders.filter(o => o.status !== 'OUT_FOR_DELIVERY');

  return (
    <div>
      {/* Action Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            Live Kitchen Terminal
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Real-time incoming customer orders and preparation queue.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Button variant="outline" size="sm" onClick={playKitchenChime} leftIcon={<Bell size={16} />}>
            Test Kitchen Chime {lastChimeTime ? `(${lastChimeTime})` : ''}
          </Button>
          <Badge variant="status-active" label="KITCHEN ACCEPTING ORDERS" />
        </div>
      </div>

      {/* 4-State UI Container */}
      <StateView
        state={activeOrders.length === 0 ? 'empty' : uiState}
        emptyTitle="No Active Orders in Kitchen Queue"
        emptyDescription="All incoming orders have been prepared and handed over to delivery partners."
        emptyActionLabel="Simulate Incoming Order"
        onEmptyAction={() => {
          setOrders(INITIAL_ORDERS);
          playKitchenChime();
        }}
        onRetry={() => setUiState('success')}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 'var(--space-4)' }}>
          {activeOrders.map(order => (
            <Card key={order.id} style={{ borderTop: order.status === 'ORDER_PLACED' ? '4px solid var(--color-primary-500)' : '4px solid var(--color-accent-500)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-md)' }}>
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
                <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px dashed var(--border-medium)', display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-bold)' }}>
                  <span>Bill Total</span>
                  <span>Rs {order.totalAmount.toFixed(2)}</span>
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
