import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  History,
  Save,
  Play,
  Download,
  Trash2,
  RefreshCw,
  Database,
  Activity,
} from 'lucide-react';
import { fetchTags } from '../api/tags';
import { fetchConnections } from '../api/connections';
import {
  fetchHistoryConfig,
  updateHistoryConfig,
  sampleHistoryNow,
  queryTagHistory,
  clearTagHistory,
} from '../api/history';
import StatusBadge from '../components/StatusBadge';

const WINDOWS = [
  { label: '1 giờ', hours: 1 },
  { label: '6 giờ', hours: 6 },
  { label: '24 giờ', hours: 24 },
  { label: '7 ngày', hours: 168 },
];

export default function Historian() {
  const queryClient = useQueryClient();

  const { data: configData, isLoading: loadingCfg } = useQuery({
    queryKey: ['historyConfig'],
    queryFn: fetchHistoryConfig,
    refetchInterval: 5000,
  });

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: () => fetchTags(),
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
  });

  const connMap = useMemo(
    () => Object.fromEntries(connections.map((c) => [c.id, c])),
    [connections]
  );

  // Config form state
  const [enabled, setEnabled] = useState(false);
  const [intervalSec, setIntervalSec] = useState(10);
  const [deadband, setDeadband] = useState(0);
  const [retentionDays, setRetentionDays] = useState(30);
  const [logAll, setLogAll] = useState(false);
  const [cfgHydrated, setCfgHydrated] = useState(false);

  useEffect(() => {
    if (configData && !cfgHydrated) {
      queueMicrotask(() => {
        setEnabled(Boolean(configData.enabled));
        setIntervalSec(configData.interval_seconds ?? 10);
        setDeadband(configData.deadband ?? 0);
        setRetentionDays(configData.retention_days ?? 30);
        setLogAll(Boolean(configData.log_all));
        setCfgHydrated(true);
      });
    }
  }, [configData, cfgHydrated]);

  // Selected tag & query window
  const [selectedTagId, setSelectedTagId] = useState('');
  const [hours, setHours] = useState(24);

  useEffect(() => {
    if (!selectedTagId && tags.length > 0) {
      queueMicrotask(() => {
        setSelectedTagId((prev) => prev || String(tags[0].id));
      });
    }
  }, [tags, selectedTagId]);

  const activeTag = useMemo(
    () => tags.find((t) => String(t.id) === String(selectedTagId)) || null,
    [tags, selectedTagId]
  );

  const {
    data: historyData,
    isLoading: loadingQuery,
    refetch: refetchQuery,
  } = useQuery({
    queryKey: ['tagHistory', selectedTagId, hours],
    queryFn: () => queryTagHistory({ tagId: Number(selectedTagId), hours, limit: 2000 }),
    enabled: Boolean(selectedTagId),
    refetchInterval: enabled ? 5000 : false,
  });

  const saveConfigMutation = useMutation({
    mutationFn: updateHistoryConfig,
    onSuccess: (res) => {
      toast.success(res.message || 'Đã lưu cấu hình Data Logger');
      queryClient.invalidateQueries({ queryKey: ['historyConfig'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Lưu thất bại'),
  });

  const sampleNowMutation = useMutation({
    mutationFn: sampleHistoryNow,
    onSuccess: (res) => {
      if (res.written > 0) toast.success(res.message);
      else toast(res.message || 'Không có mẫu mới được ghi');
      queryClient.invalidateQueries({ queryKey: ['historyConfig'] });
      queryClient.invalidateQueries({ queryKey: ['tagHistory'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Lỗi ghi mẫu'),
  });

  const clearMutation = useMutation({
    mutationFn: (tagId) => clearTagHistory(tagId),
    onSuccess: (res) => {
      toast.success(res.message || 'Đã xóa lịch sử');
      queryClient.invalidateQueries({ queryKey: ['historyConfig'] });
      queryClient.invalidateQueries({ queryKey: ['tagHistory'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Xóa thất bại'),
  });

  const handleSaveConfig = (e) => {
    e.preventDefault();
    saveConfigMutation.mutate({
      enabled,
      interval_seconds: Number(intervalSec) || 10,
      deadband: Number(deadband) || 0,
      retention_days: parseInt(retentionDays, 10) || 30,
      log_all: logAll,
    });
  };

  const chartData = useMemo(() => {
    const samples = historyData?.samples || [];
    return samples.map((s) => ({
      ...s,
      timeLabel: new Date(s.ts * 1000).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      fullTime: new Date(s.ts * 1000).toLocaleString('vi-VN'),
    }));
  }, [historyData]);

  const handleExportExcel = () => {
    const samples = historyData?.samples || [];
    if (samples.length === 0) {
      toast.error('Chưa có dữ liệu lịch sử để xuất Excel');
      return;
    }
    const tagName = activeTag?.name || `tag_${selectedTagId}`;
    const connName = connMap[activeTag?.connection_id]?.name || '';
    const rows = samples.map((s) => ({
      'Thời gian (Local)': new Date(s.ts * 1000).toLocaleString('vi-VN'),
      'ISO Timestamp (UTC)': s.iso,
      'Connection': connName,
      'Tag Name': tagName,
      'Value': s.value,
      'Unit': activeTag?.unit || '',
      'Quality': s.quality,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 22 },
      { wch: 28 },
      { wch: 16 },
      { wch: 24 },
      { wch: 14 },
      { wch: 10 },
      { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'History');
    XLSX.writeFile(wb, `history_${tagName}_${hours}h.xlsx`);
    toast.success(`Đã xuất ${samples.length} mẫu ra Excel`);
  };

  const recentSamples = useMemo(() => {
    return [...chartData].reverse().slice(0, 50);
  }, [chartData]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-slate-100 flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" />
            Lịch sử Tag &amp; Data Logger (Historian)
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Ghi nhận chuỗi dữ liệu số tự động vào SQLite với Deadband &amp; vẽ biểu đồ xu hướng theo thời gian
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                configData?.running ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span className="text-slate-300 font-medium">
              {configData?.running ? 'Logger Đang Chạy' : 'Logger Đang Tắt'}
            </span>
            <span className="text-slate-500">|</span>
            <span className="font-mono text-emerald-400">
              {(configData?.total_samples ?? 0).toLocaleString()} mẫu
            </span>
          </div>
        </div>
      </div>

      {/* Config Panel */}
      <form onSubmit={handleSaveConfig} className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Database className="w-4 h-4 text-sky-400" />
            <h2 className="font-heading text-sm font-bold text-slate-100">
              Cấu hình Ghi Dữ Liệu Tự Động (SQLite Historian)
            </h2>
          </div>

          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-200">
              Bật Data Logger chạy nền
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Chu kỳ lấy mẫu (giây)
            </label>
            <input
              type="number"
              min="1"
              max="3600"
              step="1"
              value={intervalSec}
              onChange={(e) => setIntervalSec(e.target.value)}
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Deadband (ngưỡng bỏ qua nhiễu)
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={deadband}
              onChange={(e) => setDeadband(e.target.value)}
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Thời gian giữ lịch sử (ngày)
            </label>
            <input
              type="number"
              min="1"
              max="3650"
              value={retentionDays}
              onChange={(e) => setRetentionDays(e.target.value)}
              className="w-full bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono"
            />
          </div>

          <div className="flex flex-col justify-end pb-1">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={logAll}
                onChange={(e) => setLogAll(e.target.checked)}
                className="accent-emerald-500 rounded cursor-pointer"
              />
              <span>Ghi tất cả tag có giá trị số</span>
            </label>
            <span className="text-[10px] text-slate-500 mt-1">
              Nếu bỏ chọn: chỉ ghi tag đã bật &ldquo;Ghi lịch sử&rdquo;
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-[11px] text-slate-400 font-mono">
            {loadingCfg
              ? 'Đang tải cấu hình...'
              : `Phiên hiện tại đã ghi: ${configData?.total_written ?? 0} mẫu${
                  configData?.last_sample_at
                    ? ` • Lần cuối: ${new Date(configData.last_sample_at * 1000).toLocaleTimeString('vi-VN')}`
                    : ''
                }`}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => sampleNowMutation.mutate()}
              disabled={sampleNowMutation.isPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sky-200 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {sampleNowMutation.isPending ? 'Đang ghi...' : 'Ghi mẫu ngay'}
            </button>
            <button
              type="submit"
              disabled={saveConfigMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saveConfigMutation.isPending ? 'Đang lưu...' : 'Lưu cấu hình'}
            </button>
          </div>
        </div>
      </form>

      {/* Query & Chart Panel */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
            <select
              value={selectedTagId}
              onChange={(e) => setSelectedTagId(e.target.value)}
              className="bg-[#0F172A] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 min-w-[240px] max-w-md font-medium"
            >
              {tags.length === 0 ? (
                <option value="">Chưa có tag nào</option>
              ) : (
                tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{connMap[t.connection_id]?.name || `ID ${t.connection_id}`}] {t.tag_group ? `${t.tag_group}/` : ''}{t.name}
                    {t.unit ? ` (${t.unit})` : ''}
                  </option>
                ))
              )}
            </select>

            <div className="inline-flex rounded-lg bg-[#0F172A] border border-slate-700 p-0.5">
              {WINDOWS.map((w) => (
                <button
                  key={w.hours}
                  type="button"
                  onClick={() => setHours(w.hours)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors cursor-pointer ${
                    hours === w.hours
                      ? 'bg-emerald-500 text-[#0F172A] font-bold'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => refetchQuery()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Làm mới
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={!chartData.length}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 rounded-lg cursor-pointer disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              Xuất Excel
            </button>
            {selectedTagId && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Xóa toàn bộ lịch sử của tag '${activeTag?.name || selectedTagId}'?`)) {
                    clearMutation.mutate(Number(selectedTagId));
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Xóa lịch sử tag
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-[#0F172A]/80 border border-slate-800 rounded-lg px-4 py-3">
            <div className="text-[11px] text-slate-400">Số mẫu</div>
            <div className="font-mono text-lg font-bold text-slate-100 mt-0.5">
              {historyData?.count ?? 0}
            </div>
          </div>
          <div className="bg-[#0F172A]/80 border border-slate-800 rounded-lg px-4 py-3">
            <div className="text-[11px] text-slate-400">Nhỏ nhất (Min)</div>
            <div className="font-mono text-lg font-bold text-sky-400 mt-0.5">
              {historyData?.min !== null && historyData?.min !== undefined
                ? `${historyData.min}${activeTag?.unit ? ` ${activeTag.unit}` : ''}`
                : '—'}
            </div>
          </div>
          <div className="bg-[#0F172A]/80 border border-slate-800 rounded-lg px-4 py-3">
            <div className="text-[11px] text-slate-400">Lớn nhất (Max)</div>
            <div className="font-mono text-lg font-bold text-amber-400 mt-0.5">
              {historyData?.max !== null && historyData?.max !== undefined
                ? `${historyData.max}${activeTag?.unit ? ` ${activeTag.unit}` : ''}`
                : '—'}
            </div>
          </div>
          <div className="bg-[#0F172A]/80 border border-slate-800 rounded-lg px-4 py-3">
            <div className="text-[11px] text-slate-400">Trung bình (Avg)</div>
            <div className="font-mono text-lg font-bold text-emerald-400 mt-0.5">
              {historyData?.avg !== null && historyData?.avg !== undefined
                ? `${historyData.avg}${activeTag?.unit ? ` ${activeTag.unit}` : ''}`
                : '—'}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="h-[320px] w-full bg-[#0F172A]/70 border border-slate-800 rounded-xl p-3">
          {loadingQuery ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
              Đang tải dữ liệu lịch sử...
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs space-y-1.5">
              <History className="w-8 h-8 opacity-30" />
              <p>Chưa có mẫu dữ liệu nào cho tag này trong khoảng thời gian đã chọn.</p>
              <p className="text-slate-500">
                Bật Data Logger hoặc nhấn &ldquo;Ghi mẫu ngay&rdquo; để bắt đầu lưu lịch sử.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 4, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis
                  dataKey="timeLabel"
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  minTickGap={24}
                />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  width={56}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#f1f5f9',
                  }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullTime || ''}
                  formatter={(val) => [
                    `${val}${activeTag?.unit ? ` ${activeTag.unit}` : ''}`,
                    activeTag?.name || 'Giá trị',
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={chartData.length <= 60 ? { r: 2.5, fill: '#22c55e' } : false}
                  activeDot={{ r: 5, fill: '#4ade80' }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Recent Samples Table */}
        {recentSamples.length > 0 && (
          <div className="overflow-x-auto border border-slate-800 rounded-xl">
            <table className="w-full text-xs">
              <thead className="bg-[#0F172A]/80 border-b border-slate-800">
                <tr>
                  <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Thời gian</th>
                  <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Giá trị</th>
                  <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {recentSamples.map((s, idx) => (
                  <tr key={`${s.ts}-${idx}`} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2 font-mono text-slate-300">{s.fullTime}</td>
                    <td className="px-4 py-2 font-mono font-bold text-slate-100">
                      {s.value}
                      {activeTag?.unit ? (
                        <span className="ml-1 font-normal text-slate-400">{activeTag.unit}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={s.quality} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
