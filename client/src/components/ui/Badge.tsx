import React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'amber' | 'green' | 'blue' | 'red' | 'purple' | 'gray';
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 text-gray-600',
    amber: 'bg-amber-100 text-amber-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700',
    purple: 'bg-purple-100 text-purple-700',
    gray: 'bg-gray-200 text-gray-600',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

export function ThoughtTypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
    summary: { label: 'Summary', variant: 'blue' },
    todo: { label: 'Todo', variant: 'amber' },
    connection: { label: 'Connection', variant: 'purple' },
    theme: { label: 'Theme', variant: 'green' },
    free: { label: 'Note', variant: 'gray' },
  };
  const c = config[type] ?? { label: type, variant: 'default' };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}
