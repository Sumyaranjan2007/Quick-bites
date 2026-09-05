import React from 'react';

export interface SkeletonProps {
  variant?: 'text' | 'card' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
  count?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'text',
  width,
  height,
  count = 1,
  className = '',
  style = {}
}) => {
  const getDefaultDimensions = () => {
    switch (variant) {
      case 'circle':
        return { width: width || 48, height: height || 48, borderRadius: 'var(--radius-full)' };
      case 'card':
        return { width: width || '100%', height: height || 200, borderRadius: 'var(--radius-lg)' };
      case 'rect':
        return { width: width || '100%', height: height || 120, borderRadius: 'var(--radius-md)' };
      case 'text':
      default:
        return { width: width || '100%', height: height || 16, borderRadius: 'var(--radius-sm)' };
    }
  };

  const defaultDims = getDefaultDimensions();

  const items = Array.from({ length: count });

  return (
    <>
      {items.map((_, i) => (
        <div
          key={i}
          className={`qb-skeleton ${className}`}
          style={{
            ...defaultDims,
            marginBottom: count > 1 && i < count - 1 ? '8px' : 0,
            ...style
          }}
          aria-hidden="true"
        />
      ))}
    </>
  );
};
