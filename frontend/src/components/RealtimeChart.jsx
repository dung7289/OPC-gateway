import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import useStore from '../store/useStore';
import { formatTimestamp, getQualityColor } from '../utils/helpers';

export default function RealtimeChart({ tagId, tagName, maxPoints = 50 }) {
  const tagValue = useStore((s) => s.tagValues[tagId]);
  const [history, setHistory] = useState(() => {
    const initVal = useStore.getState().tagValues[tagId];
    const num = initVal ? parseFloat(initVal.value) : NaN;
    if (!initVal || isNaN(num)) return [];
    return [{ time: new Date(initVal.timestamp).toLocaleTimeString(), value: num }];
  });
  const lastTsRef = useRef(tagValue?.timestamp || null);

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state) => {
      const tv = state.tagValues[tagId];
      if (!tv || tv.timestamp === lastTsRef.current) return;
      const numVal = parseFloat(tv.value);
      if (isNaN(numVal)) return;
      lastTsRef.current = tv.timestamp;
      setHistory((prev) => {
        const newPoint = {
          time: new Date(tv.timestamp).toLocaleTimeString(),
          value: numVal,
        };
        const updated = [...prev, newPoint];
        return updated.length > maxPoints ? updated.slice(-maxPoints) : updated;
      });
    });
    return unsubscribe;
  }, [tagId, maxPoints]);

  const qualityColor = tagValue ? getQualityColor(tagValue.quality) : 'text-slate-400';

  return (
    <div className="glass-panel rounded-xl p-4 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-heading font-semibold text-slate-100 text-sm">{tagName}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            {tagValue ? (
              <>
                <span className="font-heading text-2xl font-bold text-emerald-400 tabular-nums">
                  {typeof tagValue.value === 'boolean'
                    ? tagValue.value ? 'TRUE' : 'FALSE'
                    : tagValue.value !== null && tagValue.value !== undefined
                    ? parseFloat(tagValue.value).toFixed(2)
                    : '—'}
                </span>
                <span className={`text-xs font-medium ${qualityColor}`}>
                  {tagValue.quality || 'Unknown'}
                </span>
              </>
            ) : (
              <span className="text-slate-400 text-sm">No data</span>
            )}
          </div>
        </div>
        {tagValue && (
          <div className="text-right">
            <p className="text-[11px] text-slate-400">Last update</p>
            <p className="text-xs font-mono text-slate-300">{formatTimestamp(tagValue.timestamp)}</p>
          </div>
        )}
      </div>

      {/* Chart */}
      {history.length > 1 ? (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: '#94A3B8' }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94A3B8' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: '#0F172A',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#F8FAFC',
                fontSize: '12px',
              }}
              itemStyle={{ color: '#22C55E' }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#22C55E"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[160px] flex items-center justify-center text-slate-400 text-xs font-mono">
          Waiting for telemetry points...
        </div>
      )}
    </div>
  );
}
