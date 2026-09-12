export const API_BASE = ((import.meta as any).env?.VITE_API_URL as string) || 'https://quick-bites-production-9f45.up.railway.app/api';

let partnerToken = '';

export async function getPartnerToken(): Promise<string> {
  if (partnerToken) return partnerToken;
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partner@quickbite.app', password: 'pass123' })
    });
    const data = await res.json();
    if (data.success && data.data?.token) {
      partnerToken = data.data.token;
      return partnerToken;
    }
  } catch (err) {
    console.warn('[PartnerAPI] Failed auto-login', err);
  }
  return '';
}

export async function fetchRestaurantOrders(restaurantId = 'rst_bbh_01') {
  const token = await getPartnerToken();
  const res = await fetch(`${API_BASE}/restaurants/${restaurantId}/orders`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return res.json();
}

export async function fetchRestaurantDetails(restaurantId = 'rst_bbh_01') {
  const res = await fetch(`${API_BASE}/restaurants/${restaurantId}`);
  return res.json();
}

export async function toggleDishStock(restaurantId: string, dishId: string, isAvailable: boolean) {
  const token = await getPartnerToken();
  const res = await fetch(`${API_BASE}/restaurants/${restaurantId}/menu/toggle-stock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ dishId, isAvailable })
  });
  return res.json();
}

export async function updateOrderStatus(orderId: string, status: string, prepTimeMinutes?: number) {
  const token = await getPartnerToken();
  const res = await fetch(`${API_BASE}/orders/${orderId}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(
      prepTimeMinutes !== undefined ? { status, preparationMinutes: prepTimeMinutes } : { status }
    )
  });
  return res.json();
}

export async function addMenuItem(
  restaurantId: string,
  item: { name: string; price: number; isVeg: boolean; description?: string; category?: string }
) {
  const token = await getPartnerToken();
  const res = await fetch(`${API_BASE}/restaurants/${restaurantId}/menu/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(item)
  });
  return res.json();
}
