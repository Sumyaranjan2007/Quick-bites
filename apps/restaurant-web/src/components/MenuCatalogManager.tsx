import React, { useState, useEffect } from 'react';
import {
  Button,
  Badge,
  Card,
  Input,
  StateView,
  ComponentState
} from '@quick-bites/design-system';
import { Plus, Check, X, Edit3, RefreshCw } from 'lucide-react';
import { fetchRestaurantDetails, toggleDishStock, addMenuItem } from '../api';

interface MenuItemDisplay {
  id: string;
  name: string;
  category: string;
  price: number;
  isVeg: boolean;
  isAvailable: boolean;
  description: string;
}

export const MenuCatalogManager: React.FC = () => {
  const [items, setItems] = useState<MenuItemDisplay[]>([]);
  const [uiState, setUiState] = useState<ComponentState>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newDishName, setNewDishName] = useState('');
  const [newDishPrice, setNewDishPrice] = useState('');
  const [newDishIsVeg, setNewDishIsVeg] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const loadMenu = async () => {
    setIsLoading(true);
    try {
      const res = await fetchRestaurantDetails('rst_bbh_01');
      if (res.success && res.data?.menu?.categories) {
        const extracted: MenuItemDisplay[] = [];
        res.data.menu.categories.forEach((cat: any) => {
          if (Array.isArray(cat.items)) {
            cat.items.forEach((it: any) => {
              extracted.push({
                id: it.id,
                name: it.name,
                category: cat.name || 'Main Course',
                price: it.price || 200,
                isVeg: Boolean(it.isVeg),
                isAvailable: it.isAvailable !== false,
                description: it.description || ''
              });
            });
          }
        });
        setItems(extracted);
        setUiState('success');
      } else {
        setUiState('error');
      }
    } catch (err) {
      console.warn('[MenuCatalog] Could not load menu', err);
      setUiState('error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMenu();
  }, []);

  const toggleStock = async (dishId: string) => {
    const item = items.find(i => i.id === dishId);
    if (!item) return;
    const newStatus = !item.isAvailable;
    const previous = items;

    setActionError(null);
    setItems(prev => prev.map(i => (i.id === dishId ? { ...i, isAvailable: newStatus } : i)));

    try {
      const res = await toggleDishStock('rst_bbh_01', dishId, newStatus);
      if (!res.success) throw new Error(res.error?.message || res.error || 'Stock update was rejected.');
    } catch (err: any) {
      setItems(previous);
      setActionError(err.message || 'Could not reach the server. Stock was not changed.');
    }
  };

  const handleAddDish = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(newDishPrice);
    if (!newDishName.trim() || !Number.isFinite(price) || price <= 0) {
      setActionError('Enter a dish name and a price greater than zero.');
      return;
    }

    setIsSaving(true);
    setActionError(null);
    try {
      const res = await addMenuItem('rst_bbh_01', {
        name: newDishName.trim(),
        price,
        isVeg: newDishIsVeg,
        category: 'Specialities'
      });
      if (!res.success) throw new Error(res.error?.message || res.error || 'Dish could not be added.');

      setNewDishName('');
      setNewDishPrice('');
      setShowAddModal(false);
      await loadMenu();
    } catch (err: any) {
      setActionError(err.message || 'Dish could not be added. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            Menu Catalog Manager
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Control instant item availability, customize prices, and update your menu.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowAddModal(true)} leftIcon={<Plus size={16} />}>
          Add New Dish
        </Button>
      </div>

      {actionError && (
        <div
          style={{
            marginBottom: 'var(--space-4)',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-nonveg-bg)',
            color: 'var(--color-nonveg)',
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-semibold)'
          }}
        >
          {actionError}
        </div>
      )}

      <StateView
        state={items.length === 0 ? 'empty' : uiState}
        emptyTitle="Menu is Empty"
        emptyDescription="No dishes are currently configured for this restaurant."
        emptyActionLabel="Add First Dish"
        onEmptyAction={() => setShowAddModal(true)}
        errorMessage="Could not load your menu. Check your connection and try again."
        onRetry={loadMenu}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
          {items.map(dish => (
            <Card key={dish.id} style={{ opacity: dish.isAvailable ? 1 : 0.7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Badge variant={dish.isVeg ? 'veg' : 'nonveg'} />
                  <span style={{ fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-md)' }}>
                    {dish.name}
                  </span>
                </div>
                <span style={{ fontFamily: 'var(--font-family-mono)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-primary-500)' }}>
                  Rs {dish.price.toFixed(2)}
                </span>
              </div>

              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)', lineHeight: 1.4 }}>
                {dish.description}
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                  Category: {dish.category}
                </span>
                <button
                  onClick={() => toggleStock(dish.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-1)',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid',
                    borderColor: dish.isAvailable ? 'var(--color-veg)' : 'var(--border-medium)',
                    backgroundColor: dish.isAvailable ? 'var(--color-veg-bg)' : 'var(--bg-app)',
                    color: dish.isAvailable ? 'var(--color-veg)' : 'var(--text-muted)',
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'var(--font-weight-semibold)',
                    cursor: 'pointer'
                  }}
                >
                  {dish.isAvailable ? <Check size={12} /> : <X size={12} />}
                  <span>{dish.isAvailable ? 'IN STOCK' : 'SOLD OUT'}</span>
                </button>
              </div>
            </Card>
          ))}
        </div>
      </StateView>

      {/* Add Dish Modal with Form Persistence */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 'var(--z-index-modal)' }}>
          <Card style={{ width: '100%', maxWidth: '480px', padding: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', marginBottom: 'var(--space-4)' }}>
              Add Dish to Catalog
            </h3>
            <form onSubmit={handleAddDish} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <Input
                label="Dish Name"
                placeholder="e.g. Malabar Parotta Combo"
                value={newDishName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDishName(e.target.value)}
                persistKey="restaurant_new_dish_name"
                required
              />
              <Input
                label="Price (INR)"
                type="number"
                placeholder="e.g. 180.00"
                value={newDishPrice}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDishPrice(e.target.value)}
                persistKey="restaurant_new_dish_price"
                required
              />
              <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}>Dietary:</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                  <input type="radio" name="diet" checked={newDishIsVeg} onChange={() => setNewDishIsVeg(true)} />
                  <Badge variant="veg" />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', cursor: 'pointer' }}>
                  <input type="radio" name="diet" checked={!newDishIsVeg} onChange={() => setNewDishIsVeg(false)} />
                  <Badge variant="nonveg" />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                <Button variant="ghost" type="button" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" isLoading={isSaving} disabled={isSaving}>
                  Save Dish
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};
