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
import { fetchRestaurantDetails, toggleDishStock } from '../api';

interface MenuItemDisplay {
  id: string;
  name: string;
  category: string;
  price: number;
  isVeg: boolean;
  isAvailable: boolean;
  description: string;
}

const INITIAL_MENU: MenuItemDisplay[] = [
  {
    id: 'dish_ck_biryani',
    name: 'Special Chicken Dum Biryani',
    category: 'Biryani & Rice',
    price: 320.00,
    isVeg: false,
    isAvailable: true,
    description: 'Fragrant basmati rice layered with slow-cooked spiced chicken and caramelized onions.'
  },
  {
    id: 'dish_pbm',
    name: 'Paneer Butter Masala',
    category: 'Curries & Gravies',
    price: 260.00,
    isVeg: true,
    isAvailable: true,
    description: 'Fresh cottage cheese cooked in creamy tomato gravy with rich butter.'
  },
  {
    id: 'dish_butter_naan',
    name: 'Butter Naan',
    category: 'Breads & Roti',
    price: 50.00,
    isVeg: true,
    isAvailable: false,
    description: 'Tandoor-baked leavened flatbread brushed with butter.'
  }
];

export const MenuCatalogManager: React.FC = () => {
  const [items, setItems] = useState<MenuItemDisplay[]>(INITIAL_MENU);
  const [uiState, setUiState] = useState<ComponentState>('success');
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
        if (extracted.length > 0) {
          setItems(extracted);
        }
      }
    } catch (err) {
      console.warn('[MenuCatalog] Using fallback initial menu', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMenu();
  }, []);

  const toggleStock = (dishId: string) => {
    const item = items.find(i => i.id === dishId);
    const newStatus = item ? !item.isAvailable : false;
    setItems(prev =>
      prev.map(i =>
        i.id === dishId ? { ...i, isAvailable: !i.isAvailable } : i
      )
    );
    toggleDishStock('rst_bbh_01', dishId, newStatus).catch(e => console.warn(e));
  };

  const handleAddDish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDishName || !newDishPrice) return;

    const newDish: MenuItemDisplay = {
      id: `dish_custom_${Date.now()}`,
      name: newDishName,
      category: 'Specialties',
      price: parseFloat(newDishPrice),
      isVeg: newDishIsVeg,
      isAvailable: true,
      description: 'Chef recommendation prepared with traditional spices.'
    };

    setItems(prev => [newDish, ...prev]);
    setNewDishName('');
    setNewDishPrice('');
    setShowAddModal(false);
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

      <StateView
        state={items.length === 0 ? 'empty' : uiState}
        emptyTitle="Menu is Empty"
        emptyDescription="No dishes are currently configured for this restaurant."
        emptyActionLabel="Add First Dish"
        onEmptyAction={() => setShowAddModal(true)}
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
                <Button variant="primary" type="submit">
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
