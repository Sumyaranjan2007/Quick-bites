import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'veg' | 'nonveg' | 'gold' | 'rating' | 'status-active' | 'status-pending' | 'status-error' | 'default';
  label?: string;
  ratingValue?: number;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  label,
  ratingValue,
  className = '',
  ...props
}) => {
  if (variant === 'veg') {
    return (
      <span className={`qb-badge qb-badge-veg ${className}`} {...props}>
        <span className="qb-dietary-icon qb-dietary-icon-veg" aria-hidden="true" />
        <span>{label || children || 'VEG'}</span>
      </span>
    );
  }

  if (variant === 'nonveg') {
    return (
      <span className={`qb-badge qb-badge-nonveg ${className}`} {...props}>
        <span className="qb-dietary-icon qb-dietary-icon-nonveg" aria-hidden="true" />
        <span>{label || children || 'NON-VEG'}</span>
      </span>
    );
  }

  if (variant === 'gold') {
    return (
      <span className={`qb-badge qb-badge-gold ${className}`} {...props}>
        <span>{label || children || 'QUICK BITE GOLD'}</span>
      </span>
    );
  }

  if (variant === 'rating') {
    return (
      <span className={`qb-badge qb-badge-rating ${className}`} {...props}>
        <span>{ratingValue !== undefined ? ratingValue.toFixed(1) : children}</span>
        <span style={{ fontSize: '10px', marginLeft: '2px' }}>★</span>
      </span>
    );
  }

  return (
    <span className={`qb-badge qb-badge-${variant} ${className}`} {...props}>
      {label || children}
    </span>
  );
};
