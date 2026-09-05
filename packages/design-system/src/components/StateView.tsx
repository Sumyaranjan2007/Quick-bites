import React from 'react';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { AlertTriangle, Inbox } from 'lucide-react';

export type ComponentState = 'loading' | 'success' | 'error' | 'empty';

export interface StateViewProps {
  state: ComponentState;
  children: React.ReactNode;
  
  // Loading options
  loadingFallback?: React.ReactNode;
  
  // Error options
  errorTitle?: string;
  errorMessage?: string;
  onRetry?: () => void;
  retryLabel?: string;
  
  // Empty options
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  
  className?: string;
}

export const StateView: React.FC<StateViewProps> = ({
  state,
  children,
  loadingFallback,
  errorTitle = 'Unable to load content',
  errorMessage = 'Please check your connection or try again.',
  onRetry,
  retryLabel = 'Try Again',
  emptyTitle = 'No items found',
  emptyDescription = 'We could not find any items matching your criteria.',
  emptyActionLabel,
  onEmptyAction,
  className = ''
}) => {
  // 1. Loading State
  if (state === 'loading') {
    if (loadingFallback) return <>{loadingFallback}</>;
    return (
      <div className={`qb-state-container ${className}`}>
        <Skeleton variant="rect" height={160} style={{ width: '100%', maxWidth: '480px', marginBottom: '16px' }} />
        <Skeleton variant="text" width="60%" style={{ marginBottom: '8px' }} />
        <Skeleton variant="text" width="40%" />
      </div>
    );
  }

  // 2. Error State (With Retry CTA)
  if (state === 'error') {
    return (
      <div className={`qb-state-container ${className}`}>
        <AlertTriangle className="qb-state-icon" style={{ color: 'var(--color-error)' }} />
        <h3 className="qb-state-title">{errorTitle}</h3>
        <p className="qb-state-description">{errorMessage}</p>
        {onRetry && (
          <Button variant="primary" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </div>
    );
  }

  // 3. Empty State (With Actionable Next Step CTA)
  if (state === 'empty') {
    return (
      <div className={`qb-state-container ${className}`}>
        <Inbox className="qb-state-icon" style={{ color: 'var(--text-muted)' }} />
        <h3 className="qb-state-title">{emptyTitle}</h3>
        <p className="qb-state-description">{emptyDescription}</p>
        {onEmptyAction && emptyActionLabel && (
          <Button variant="outline" onClick={onEmptyAction}>
            {emptyActionLabel}
          </Button>
        )}
      </div>
    );
  }

  // 4. Success State (Data Rendered)
  return <>{children}</>;
};
