import React from 'react';

export default function StatusBadge({ status, size = 'md' }) {
  const s = (status || '').toLowerCase();

  let dotColor = 'bg-amber-400';
  let textColor = 'text-amber-300';
  let bgColor = 'bg-amber-500/15 border-amber-500/30';
  let label = status || 'Unknown';

  if (s === 'connected' || s === 'good') {
    dotColor = 'bg-emerald-400';
    textColor = 'text-emerald-300';
    bgColor = 'bg-emerald-500/15 border-emerald-500/30';
  } else if (s === 'disconnected' || s === 'bad' || s === 'error') {
    dotColor = 'bg-red-400';
    textColor = 'text-red-300';
    bgColor = 'bg-red-500/15 border-red-500/30';
  }

  const textSize = size === 'sm' ? 'text-[11px]' : 'text-xs';
  const padding = size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1';
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap ${textSize} ${padding} ${bgColor} ${textColor}`}
    >
      <span className={`${dotSize} rounded-full ${dotColor} shrink-0`} aria-hidden="true" />
      {label}
    </span>
  );
}
