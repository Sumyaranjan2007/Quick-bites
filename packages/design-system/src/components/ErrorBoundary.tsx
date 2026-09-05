import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught unhandled error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="qb-state-container" style={{ minHeight: '300px' }}>
          <AlertTriangle className="qb-state-icon" style={{ color: 'var(--color-error)' }} />
          <h3 className="qb-state-title">
            {this.props.fallbackTitle || 'An unexpected rendering error occurred'}
          </h3>
          <p className="qb-state-description">
            {this.state.error?.message || 'The application encountered an unexpected issue.'}
          </p>
          <Button variant="primary" onClick={this.handleReset}>
            Reload Component
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
