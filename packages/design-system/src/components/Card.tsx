import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  isInteractive?: boolean;
  elevation?: 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  children,
  isInteractive = false,
  elevation = 'sm',
  className = '',
  ...props
}) => {
  const classes = [
    'qb-card',
    isInteractive ? 'qb-card-interactive' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} {...props}>
      {children}
    </div>
  );
};
