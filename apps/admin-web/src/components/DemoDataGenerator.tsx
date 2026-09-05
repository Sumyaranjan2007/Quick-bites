import React, { useState } from 'react';
import { Card, Badge, Button, StateView, ComponentState } from '@quick-bites/design-system';
import { Sparkles, Store, Check, RefreshCw } from 'lucide-react';

interface GeneratedRestaurant {
  id: string;
  name: string;
  cuisine: string;
  location: string;
  fssaiNumber: string;
  gstin: string;
  dishesCount: number;
  generatedAt: string;
}

const SAMPLE_NAMES = [
  { name: 'Kolkata Kathi Roll Corner', cuisine: 'Street Food, Bengali', area: 'HSR Layout Sector 1' },
  { name: 'Punjab Da Dhaba', cuisine: 'North Indian, Tandoori', area: 'Whitefield Main Road' },
  { name: 'Chettinad Spices Kitchen', cuisine: 'South Indian, Chettinad', area: 'Malleshwaram 8th Cross' },
  { name: 'Dilli Chaat Bhandar', cuisine: 'Street Food, Chaat, Snacks', area: 'BTM Layout 2nd Stage' }
];

export const DemoDataGenerator: React.FC = () => {
  const [generatedList, setGeneratedList] = useState<GeneratedRestaurant[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uiState, setUiState] = useState<ComponentState>('success');

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const template = SAMPLE_NAMES[generatedList.length % SAMPLE_NAMES.length];
      const randomId = `rst_demo_${Date.now().toString().slice(-4)}`;
      const newRestaurant: GeneratedRestaurant = {
        id: randomId,
        name: `${template.name} (${randomId})`,
        cuisine: template.cuisine,
        location: template.area,
        fssaiNumber: `1122334455${Math.floor(1000 + Math.random() * 9000)}`,
        gstin: `29AABC${Math.floor(1000 + Math.random() * 9000)}F1Z5`,
        dishesCount: 4,
        generatedAt: new Date().toLocaleTimeString()
      };

      setGeneratedList(prev => [newRestaurant, ...prev]);
      setIsGenerating(false);
    }, 500);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)' }}>
            Demo Data & Catalog Generator
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            One-click creation of simulated Indian restaurants with PostGIS coordinates and Meilisearch sync.
          </p>
        </div>
        <Button variant="primary" onClick={handleGenerate} isLoading={isGenerating} leftIcon={<Sparkles size={16} />}>
          Generate Test Restaurant
        </Button>
      </div>

      <StateView
        state={generatedList.length === 0 ? 'empty' : uiState}
        emptyTitle="No Dynamic Demo Restaurants Generated"
        emptyDescription="Click 'Generate Test Restaurant' to populate simulated restaurants and verify search indexing."
        emptyActionLabel="Generate First Demo Restaurant"
        onEmptyAction={handleGenerate}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
          {generatedList.map(item => (
            <Card key={item.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Store size={18} color="var(--color-primary-500)" />
                  <h3 style={{ fontSize: 'var(--font-size-md)', fontWeight: 'var(--font-weight-bold)' }}>
                    {item.name}
                  </h3>
                </div>
                <Badge variant="status-active" label="INDEXED" />
              </div>

              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
                {item.cuisine} • {item.location}
              </div>

              <div style={{ backgroundColor: 'var(--bg-app)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div>FSSAI: <span style={{ fontFamily: 'var(--font-family-mono)' }}>{item.fssaiNumber}</span></div>
                <div>GSTIN: <span style={{ fontFamily: 'var(--font-family-mono)' }}>{item.gstin}</span></div>
                <div style={{ color: 'var(--color-veg)' }}>Dishes generated: {item.dishesCount} (with option groups)</div>
              </div>

              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: 'var(--space-3)', textAlign: 'right' }}>
                Generated at {item.generatedAt}
              </div>
            </Card>
          ))}
        </div>
      </StateView>
    </div>
  );
};
