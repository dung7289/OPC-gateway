import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2, FileText, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import client from '../api/client';
import { formatTimestamp } from '../utils/helpers';

async function fetchLogs(limit = 200) {
  const { data } = await client.get('/api/logs', { params: { limit } });
  if (Array.isArray(data)) return { items: data, total: data.length };
  const items = Array.isArray(data?.items) ? data.items : [];
  return {
    items,
    total: typeof data?.total === 'number' ? data.total : items.length,
  };
}

async function clearLogs() {
  const { data } = await client.delete('/api/logs');
  return data;
}

const LEVEL_STYLES = {
  ERROR: 'bg-red-500/15 text-red-300 border border-red-500/30',
  WARN: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  WARNING: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  INFO: 'bg-sky-500/15 text-sky-300 border border-sky-500/30',
  DEBUG: 'bg-slate-700/70 text-slate-300 border border-slate-600/60',
};

const ROW_STYLES = {
  ERROR: 'bg-red-500/5',
  WARN: 'bg-amber-500/5',
  WARNING: 'bg-amber-500/5',
};

export default function Logs() {
  const queryClient = useQueryClient();
  const [levelFilter, setLevelFilter] = useState('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(200);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['logs', limit],
    queryFn: () => fetchLogs(limit),
    refetchInterval: 5000,
  });

  const logs = data?.items ?? [];
  const totalCount = data?.total ?? logs.length;

  const clearMutation = useMutation({
    mutationFn: clearLogs,
    onSuccess: () => {
      toast.success('Đã xóa toàn bộ nhật ký');
      queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
    onError: (err) => toast.error(err.message || 'Xóa thất bại'),
  });

  const filteredLogs = logs.filter((log) => {
    const lvl = (log.level || '').toUpperCase();
    const matchLevel =
      !levelFilter ||
      (levelFilter === 'WARNING' ? lvl === 'WARN' || lvl === 'WARNING' : lvl === levelFilter);
    const matchSearch =
      !search ||
      (log.message || '').toLowerCase().includes(search.toLowerCase()) ||
      (log.source || '').toLowerCase().includes(search.toLowerCase());
    return matchLevel && matchSearch;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-slate-100">Event Logs</h1>
          <p className="text-xs text-slate-400 mt-0.5">Nhật ký hệ thống & chẩn đoán kết nối (tự làm mới mỗi 5s)</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['logs'] })}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Xóa toàn bộ nhật ký hệ thống?')) clearMutation.mutate();
            }}
            disabled={clearMutation.isPending}
            className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            Clear All
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo nội dung hoặc nguồn..."
            aria-label="Tìm kiếm nhật ký"
            className="w-full bg-[#1B2336] border border-slate-700 text-slate-100 placeholder-slate-400 rounded-lg pl-9 pr-3 py-2 text-xs focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          aria-label="Lọc mức độ log"
          className="bg-[#1B2336] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none cursor-pointer"
        >
          <option value="">Tất cả mức độ</option>
          <option value="ERROR">ERROR</option>
          <option value="WARNING">WARNING</option>
          <option value="INFO">INFO</option>
          <option value="DEBUG">DEBUG</option>
        </select>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          aria-label="Số lượng bản ghi tối đa"
          className="bg-[#1B2336] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-xs focus:border-emerald-500 focus:outline-none cursor-pointer"
        >
          <option value={100}>100 bản ghi</option>
          <option value={200}>200 bản ghi</option>
          <option value={500}>500 bản ghi</option>
          <option value={1000}>1000 bản ghi</option>
        </select>
        <span className="ml-auto text-xs font-mono text-slate-400 bg-[#1B2336] border border-slate-800 px-3 py-2 rounded-lg">
          Hiển thị <strong className="text-slate-100">{filteredLogs.length}</strong> / tổng{' '}
          <strong className="text-emerald-400">{totalCount.toLocaleString()}</strong> bản ghi
        </span>
      </div>

      {/* Error */}
      {isError && (
        <div className="bg-red-500/15 border border-red-500/40 rounded-xl p-4 flex items-center gap-3 text-red-200">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" aria-hidden="true" />
          <p className="text-sm">{error?.message || 'Cannot connect to backend'}</p>
        </div>
      )}

      {/* Table */}
      <div className="glass-panel rounded-xl shadow-md overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs font-mono">Loading logs...</p>
            </div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400">
            <FileText className="w-10 h-10 mb-3 opacity-30" aria-hidden="true" />
            <p className="text-sm">Chưa có nhật ký nào.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead className="bg-[#0F172A]/80 border-b border-slate-800">
                <tr>
                  <th className="text-left px-4 py-3 font-heading font-semibold text-slate-400 uppercase tracking-wider w-44">Timestamp</th>
                  <th className="text-left px-4 py-3 font-heading font-semibold text-slate-400 uppercase tracking-wider w-24">Level</th>
                  <th className="text-left px-4 py-3 font-heading font-semibold text-slate-400 uppercase tracking-wider w-36">Source</th>
                  <th className="text-left px-4 py-3 font-heading font-semibold text-slate-400 uppercase tracking-wider">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {filteredLogs.map((log, idx) => {
                  const level = (log.level || 'INFO').toUpperCase();
                  const rowStyle = ROW_STYLES[level] || '';
                  const badgeStyle = LEVEL_STYLES[level] || LEVEL_STYLES.INFO;
                  return (
                    <tr key={log.id || idx} className={`${rowStyle} hover:bg-slate-800/50 transition-colors`}>
                      <td className="px-4 py-2.5 text-slate-400 font-mono whitespace-nowrap">
                        {formatTimestamp(log.timestamp || log.created_at)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded font-mono text-[11px] font-bold ${badgeStyle}`}>
                          {level}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-300 font-mono">{log.source || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-200 break-all">{log.message}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
