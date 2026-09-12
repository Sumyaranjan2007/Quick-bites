import React, { useState } from 'react';
import {
  ThemeProvider,
  useTheme,
  I18nProvider,
  useTranslation,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
  ErrorBoundary
} from '@quick-bites/design-system';
import { LiveOrderTerminal } from './components/LiveOrderTerminal';
import { MenuCatalogManager } from './components/MenuCatalogManager';
import { PayoutLedger } from './components/PayoutLedger';
import { UtensilsCrossed, Moon, Sun, Globe, ChefHat, BookOpen, DollarSign } from 'lucide-react';

export function AppContent() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'menu' | 'payout'>('terminal');
  const { resolvedTheme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useTranslation();

  return (
    <div>
      {/* Partner Header */}
      <header className="portal-header">
        <div className="portal-brand">
          <img src="/favicon.png" alt="Quick Bites" className="portal-brand-logo" />
          <div style={{ minWidth: 0 }}>
            <div className="portal-brand-name">
              Quick Bites <span style={{ color: 'var(--color-primary-500)' }}>Partner</span>
            </div>
            <div className="portal-brand-sub">Bangalore Biryani House • Indiranagar</div>
          </div>
        </div>

        {/* Center Tabs */}
        <nav className="portal-nav">
          <button
            className={`portal-nav-tab ${activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => setActiveTab('terminal')}
          >
            <ChefHat size={16} />
            <span>Kitchen Queue</span>
          </button>
          <button
            className={`portal-nav-tab ${activeTab === 'menu' ? 'active' : ''}`}
            onClick={() => setActiveTab('menu')}
          >
            <BookOpen size={16} />
            <span>Menu & Stock</span>
          </button>
          <button
            className={`portal-nav-tab ${activeTab === 'payout' ? 'active' : ''}`}
            onClick={() => setActiveTab('payout')}
          >
            <DollarSign size={16} />
            <span>Payouts (15%)</span>
          </button>
        </nav>

        {/* Right Tools (Language & Theme) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* Language Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Globe size={16} color="var(--text-secondary)" />
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as SupportedLanguage)}
              style={{
                backgroundColor: 'transparent',
                border: '1px solid var(--border-medium)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--text-primary)',
                cursor: 'pointer'
              }}
            >
              {SUPPORTED_LANGUAGES.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.nativeLabel}
                </option>
              ))}
            </select>
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-medium)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px',
              cursor: 'pointer',
              display: 'flex',
              color: 'var(--text-primary)'
            }}
            aria-label="Toggle Theme"
          >
            {resolvedTheme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>

      {/* Main Content inside Error Boundary */}
      <main className="portal-container">
        <ErrorBoundary fallbackTitle="Error Loading Partner Portal">
          {activeTab === 'terminal' && <LiveOrderTerminal />}
          {activeTab === 'menu' && <MenuCatalogManager />}
          {activeTab === 'payout' && <PayoutLedger />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <I18nProvider defaultLanguage="en">
        <AppContent />
      </I18nProvider>
    </ThemeProvider>
  );
}

export default App;
