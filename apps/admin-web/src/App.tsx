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
import { OperationsControlTower } from './components/OperationsControlTower';
import { RestaurantKycPipeline } from './components/RestaurantKycPipeline';
import { DisputeResolutionConsole } from './components/DisputeResolutionConsole';
import { DemoDataGenerator } from './components/DemoDataGenerator';
import { ShieldCheck, Moon, Sun, Globe, Activity, FileCheck, AlertCircle, Sparkles } from 'lucide-react';

export function AppContent() {
  const [activeTab, setActiveTab] = useState<'tower' | 'kyc' | 'disputes' | 'demo'>('tower');
  const { resolvedTheme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useTranslation();

  return (
    <div>
      {/* Admin Header */}
      <header className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--color-primary-500)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-inverse)'
          }}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 'var(--font-weight-extrabold)', fontSize: 'var(--font-size-md)', letterSpacing: '-0.02em' }}>
              Quick Bite <span style={{ color: 'var(--color-primary-500)' }}>Admin</span>
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              {t('admin.portalTitle')}
            </div>
          </div>
        </div>

        {/* Center Tabs */}
        <nav style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className={`admin-nav-tab ${activeTab === 'tower' ? 'active' : ''}`}
            onClick={() => setActiveTab('tower')}
          >
            <Activity size={16} />
            <span>{t('admin.navControlTower')}</span>
          </button>
          <button
            className={`admin-nav-tab ${activeTab === 'kyc' ? 'active' : ''}`}
            onClick={() => setActiveTab('kyc')}
          >
            <FileCheck size={16} />
            <span>{t('admin.navKycPipeline')}</span>
          </button>
          <button
            className={`admin-nav-tab ${activeTab === 'disputes' ? 'active' : ''}`}
            onClick={() => setActiveTab('disputes')}
          >
            <AlertCircle size={16} />
            <span>{t('admin.navDisputes')}</span>
          </button>
          <button
            className={`admin-nav-tab ${activeTab === 'demo' ? 'active' : ''}`}
            onClick={() => setActiveTab('demo')}
          >
            <Sparkles size={16} />
            <span>{t('admin.navDemoData')}</span>
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

      {/* Main Container */}
      <main className="admin-container">
        <ErrorBoundary fallbackTitle="Error Loading Admin Portal">
          {activeTab === 'tower' && <OperationsControlTower />}
          {activeTab === 'kyc' && <RestaurantKycPipeline />}
          {activeTab === 'disputes' && <DisputeResolutionConsole />}
          {activeTab === 'demo' && <DemoDataGenerator />}
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
