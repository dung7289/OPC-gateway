import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Send,
  Radio,
  Globe,
  RefreshCw,
  Sliders,
  AlertCircle,
  Play,
  Square,
  Zap,
} from 'lucide-react';
import client from '../api/client';
import { fetchConnections } from '../api/connections';
import { formatTimestamp } from '../utils/helpers';

export default function IoTGateway() {
  const queryClient = useQueryClient();

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['forwardConfig'],
    queryFn: async () => {
      const { data } = await client.get('/api/forward/config');
      return data;
    },
    refetchInterval: 5000,
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
  });

  const [form, setForm] = useState(null);

  useEffect(() => {
    if (config && Object.keys(config).length > 0 && form === null) {
      queueMicrotask(() => {
        setForm((prev) =>
          prev || {
            enabled: !!config.enabled,
            publish_interval_seconds: config.publish_interval_seconds ?? 5,
            connection_ids: config.connection_ids || [],
            mqtt: {
              enabled: !!config.mqtt?.enabled,
              host: config.mqtt?.host || '127.0.0.1',
              port: config.mqtt?.port || 1883,
              username: config.mqtt?.username || '',
              password: config.mqtt?.password || '',
              topic_prefix: config.mqtt?.topic_prefix || 'gateway',
              qos: config.mqtt?.qos ?? 0,
            },
            webhook: {
              enabled: !!config.webhook?.enabled,
              url: config.webhook?.url || '',
              method: config.webhook?.method || 'POST',
              auth_header: config.webhook?.auth_header || '',
            },
          }
        );
      });
    }
  }, [config, form]);

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await client.put('/api/forward/config', payload);
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Đã lưu cấu hình IoT Gateway!');
      queryClient.invalidateQueries({ queryKey: ['forwardConfig'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Lỗi lưu cấu hình'),
  });

  const toggleMutation = useMutation({
    mutationFn: async (start) => {
      const { data } = await client.post(start ? '/api/forward/start' : '/api/forward/stop');
      return data;
    },
    onSuccess: (data) => {
      setForm((prev) => (prev ? { ...prev, enabled: !!data.enabled } : prev));
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ['forwardConfig'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const { data } = await client.post('/api/forward/test');
      return data;
    },
    onSuccess: (data) => {
      if (data.ok) toast.success(data.message);
      else toast.error(data.message);
      queryClient.invalidateQueries({ queryKey: ['forwardConfig'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message),
  });

  if (isLoading || form === null) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const toggleConnFilter = (connId) => {
    setForm((prev) => {
      const exists = prev.connection_ids.includes(connId);
      const next = exists
        ? prev.connection_ids.filter((id) => id !== connId)
        : [...prev.connection_ids, connId];
      return { ...prev, connection_ids: next };
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-slate-700/80">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
              <Send className="w-5 h-5 text-sky-400" aria-hidden="true" />
            </div>
            <h1 className="font-heading text-lg sm:text-xl font-bold text-slate-100">
              IoT Gateway (Forward Engine)
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            Đẩy dữ liệu tag thời gian thực ra MQTT Broker hoặc HTTP REST Webhook (tương tự Kepware IoT Gateway)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 bg-[#0F172A]/80 px-3 py-1.5 rounded-xl border border-slate-700">
            <span
              className={`w-2.5 h-2.5 rounded-full ${config.running ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}
              aria-hidden="true"
            />
            <span className="font-heading text-xs font-semibold text-slate-200">
              {config.running ? 'Running' : 'Stopped'}
            </span>
          </div>

          <button
            type="button"
            disabled={toggleMutation.isPending}
            onClick={() => toggleMutation.mutate(!config.running)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
              config.running
                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40'
                : 'bg-emerald-500 hover:bg-emerald-400 text-[#0F172A]'
            }`}
          >
            {config.running ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {config.running ? 'Dừng' : 'Chạy ngay'}
          </button>

          <button
            type="button"
            disabled={testMutation.isPending}
            onClick={() => testMutation.mutate()}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            title="Đẩy thử 1 gói dữ liệu ngay lập tức"
          >
            <Zap className="w-3.5 h-3.5" />
            {testMutation.isPending ? 'Đang gửi...' : 'Gửi thử'}
          </button>
        </div>
      </div>

      {/* Telemetry Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-panel rounded-xl p-3.5">
          <p className="text-[11px] text-slate-400">Số chu kỳ đã đẩy thành công</p>
          <p className="font-heading text-xl font-bold text-emerald-400 mt-0.5 tabular-nums">
            {config.published_count || 0}
          </p>
        </div>
        <div className="glass-panel rounded-xl p-3.5">
          <p className="text-[11px] text-slate-400">Trạng thái MQTT Outbound</p>
          <p className="font-heading text-sm font-bold mt-1 text-slate-200">
            {config.mqtt_connected ? (
              <span className="text-emerald-400">Connected</span>
            ) : (
              <span className="text-slate-400">Not connected</span>
            )}
          </p>
        </div>
        <div className="glass-panel rounded-xl p-3.5">
          <p className="text-[11px] text-slate-400">Lần đẩy gần nhất</p>
          <p className="font-mono text-xs text-slate-200 mt-1">
            {config.last_publish_at ? formatTimestamp(config.last_publish_at) : 'Chưa gửi'}
          </p>
        </div>
      </div>

      {config.last_error && (
        <div className="bg-red-500/15 border border-red-500/35 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{config.last_error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* General Settings */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" /> Cài Đặt Chung & Phạm Vi Kênh
            </h2>
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="rounded accent-emerald-500 cursor-pointer"
              />
              <span>Tự động chạy khi khởi động Gateway</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Chu kỳ đẩy dữ liệu (giây)
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="3600"
                value={form.publish_interval_seconds}
                onChange={(e) => setForm({ ...form, publish_interval_seconds: parseFloat(e.target.value) || 5 })}
                className="w-full rounded-lg px-3 py-2 text-sm font-mono border"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                Lọc theo kênh kết nối (bỏ trống = đẩy toàn bộ)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {connections.map((c) => {
                  const active = form.connection_ids.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleConnFilter(c.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors cursor-pointer ${
                        active
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-bold'
                          : 'bg-[#0F172A] text-slate-400 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
                {connections.length === 0 && (
                  <span className="text-xs text-slate-500 italic">Chưa có kênh nào</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* MQTT Outbound */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <Radio className="w-4 h-4 text-violet-400" /> Đẩy Ra MQTT Broker (Outbound)
            </h2>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.mqtt.enabled}
                onChange={(e) => setForm({ ...form, mqtt: { ...form.mqtt, enabled: e.target.checked } })}
                className="rounded accent-emerald-500 cursor-pointer"
              />
              <span>Bật MQTT</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-300 block mb-1">Broker Host / IP</label>
              <input
                type="text"
                value={form.mqtt.host}
                onChange={(e) => setForm({ ...form, mqtt: { ...form.mqtt, host: e.target.value } })}
                placeholder="127.0.0.1 hoặc broker.hivemq.com"
                className="w-full rounded-lg px-3 py-2 text-xs font-mono border"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Port</label>
              <input
                type="number"
                value={form.mqtt.port}
                onChange={(e) => setForm({ ...form, mqtt: { ...form.mqtt, port: parseInt(e.target.value, 10) || 1883 } })}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono border"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Topic Prefix</label>
              <input
                type="text"
                value={form.mqtt.topic_prefix}
                onChange={(e) => setForm({ ...form, mqtt: { ...form.mqtt, topic_prefix: e.target.value } })}
                placeholder="gateway"
                className="w-full rounded-lg px-3 py-2 text-xs font-mono border"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Username (tùy chọn)</label>
              <input
                type="text"
                value={form.mqtt.username}
                onChange={(e) => setForm({ ...form, mqtt: { ...form.mqtt, username: e.target.value } })}
                className="w-full rounded-lg px-3 py-2 text-xs border"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Password (tùy chọn)</label>
              <input
                type="password"
                value={form.mqtt.password}
                onChange={(e) => setForm({ ...form, mqtt: { ...form.mqtt, password: e.target.value } })}
                className="w-full rounded-lg px-3 py-2 text-xs border"
              />
            </div>
          </div>

          <div className="bg-[#0F172A]/80 border border-slate-800 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-400">
            Cấu trúc Topic xuất bản:{' '}
            <span className="text-emerald-400 font-semibold">
              {form.mqtt.topic_prefix || 'gateway'}/&lt;Connection&gt;/&lt;Folder&gt;/&lt;TagName&gt;
            </span>
          </div>
        </div>

        {/* HTTP REST Webhook */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-400" /> Đẩy Ra HTTP REST Webhook (JSON Batch)
            </h2>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.webhook.enabled}
                onChange={(e) => setForm({ ...form, webhook: { ...form.webhook, enabled: e.target.checked } })}
                className="rounded accent-emerald-500 cursor-pointer"
              />
              <span>Bật Webhook</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-3">
              <label className="text-xs font-semibold text-slate-300 block mb-1">Webhook URL</label>
              <input
                type="text"
                value={form.webhook.url}
                onChange={(e) => setForm({ ...form, webhook: { ...form.webhook, url: e.target.value } })}
                placeholder="https://api.example.com/v1/telemetry"
                className="w-full rounded-lg px-3 py-2 text-xs font-mono border"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Method</label>
              <select
                value={form.webhook.method}
                onChange={(e) => setForm({ ...form, webhook: { ...form.webhook, method: e.target.value } })}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono border cursor-pointer"
              >
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
              </select>
            </div>
            <div className="md:col-span-4">
              <label className="text-xs font-semibold text-slate-300 block mb-1">
                Authorization Header (tùy chọn, ví dụ: Bearer eyJhbGci...)
              </label>
              <input
                type="text"
                value={form.webhook.auth_header}
                onChange={(e) => setForm({ ...form, webhook: { ...form.webhook, auth_header: e.target.value } })}
                placeholder="Bearer ..."
                className="w-full rounded-lg px-3 py-2 text-xs font-mono border"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-[#0F172A] bg-emerald-500 hover:bg-emerald-400 rounded-xl transition-colors shadow-md cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${saveMutation.isPending ? 'animate-spin' : ''}`} />
            {saveMutation.isPending ? 'Đang lưu...' : 'Lưu & Áp Dụng Cấu Hình'}
          </button>
        </div>
      </form>
    </div>
  );
}
