/**
 * Format a timestamp to "HH:MM:SS DD/MM/YYYY"
 */
export function formatTimestamp(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * Returns high-contrast dark-mode Tailwind badge classes for a given protocol.
 */
export function getProtocolColor(protocol) {
  if (!protocol) return 'bg-slate-700/60 text-slate-200 border border-slate-600/60';
  const p = protocol.toLowerCase();
  if (p.includes('modbus')) return 'bg-sky-500/15 text-sky-300 border border-sky-500/30';
  if (p.includes('s7') || p.includes('siemens')) return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  if (p.includes('mqtt')) return 'bg-violet-500/15 text-violet-300 border border-violet-500/30';
  if (p.includes('opc_da')) return 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30';
  if (p.includes('opc')) return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
  if (p.includes('internal')) return 'bg-teal-500/15 text-teal-300 border border-teal-500/30';
  return 'bg-slate-700/60 text-slate-200 border border-slate-600/60';
}

/**
 * Format a tag value nicely based on data type.
 */
export function formatValue(value, dataType) {
  if (value === null || value === undefined) return '—';
  const dt = (dataType || '').toLowerCase();
  if (dt === 'bool') return value ? 'TRUE' : 'FALSE';
  if (dt.includes('float')) {
    const num = parseFloat(value);
    return isNaN(num) ? String(value) : num.toFixed(3);
  }
  if (dt.includes('int')) {
    const num = parseInt(value, 10);
    return isNaN(num) ? String(value) : String(num);
  }
  return String(value);
}

/**
 * Returns Tailwind color class for quality string.
 */
export function getQualityColor(quality) {
  if (!quality) return 'text-slate-400';
  const q = quality.toLowerCase();
  if (q === 'good') return 'text-emerald-400';
  if (q === 'bad') return 'text-red-400';
  return 'text-amber-400';
}
