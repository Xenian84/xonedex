import { FC, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: FC<CardProps> = ({ children, className = '', padding = 'md' }) => {
  const paddings = {
    none: '',
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  };

  return (
    <div className={`bg-[#1a1b23] rounded-xl border border-[#2c2d3a] ${paddings[padding]} ${className}`}>
      {children}
    </div>
  );
};

