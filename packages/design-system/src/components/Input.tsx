import React, { useEffect, useState } from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  persistKey?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  persistKey,
  value,
  onChange,
  className = '',
  id,
  ...props
}) => {
  const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
  const [internalValue, setInternalValue] = useState<string>(() => {
    if (persistKey && typeof window !== 'undefined' && window.sessionStorage) {
      const saved = window.sessionStorage.getItem(`qb_form_${persistKey}`);
      if (saved !== null) return saved;
    }
    return String(value !== undefined ? value : '');
  });

  useEffect(() => {
    if (value !== undefined) {
      setInternalValue(String(value));
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInternalValue(e.target.value);
    if (persistKey && typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(`qb_form_${persistKey}`, e.target.value);
    }
    if (onChange) {
      onChange(e);
    }
  };

  return (
    <div className={`qb-input-wrapper ${className}`}>
      {label && (
        <label htmlFor={inputId} className="qb-input-label">
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {leftIcon && (
          <div style={{ position: 'absolute', left: '12px', pointerEvents: 'none', color: 'var(--text-muted)', display: 'flex' }}>
            {leftIcon}
          </div>
        )}
        <input
          id={inputId}
          className={`qb-input-field ${error ? 'error' : ''}`}
          style={{
            paddingLeft: leftIcon ? '38px' : '12px',
            paddingRight: rightIcon ? '38px' : '12px'
          }}
          value={value !== undefined ? value : internalValue}
          onChange={handleChange}
          {...props}
        />
        {rightIcon && (
          <div style={{ position: 'absolute', right: '12px', color: 'var(--text-muted)', display: 'flex' }}>
            {rightIcon}
          </div>
        )}
      </div>
      {error && <span className="qb-input-error-msg">{error}</span>}
      {!error && helperText && (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {helperText}
        </span>
      )}
    </div>
  );
};
