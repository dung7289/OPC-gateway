import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Server,
  Shield,
  Key,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Lock,
  Unlock,
  Sliders,
  Zap,
  Copy,
} from 'lucide-react';
import client from '../api/client';

export default function OpcUaSettings() {
  const queryClient = useQueryClient();

  const { data: config = {}, isLoading } = useQuery({
    queryKey: ['opcuaConfig'],
    queryFn: async () => {
      const { data } = await client.get('/api/opcua/config');
      return data;
    },
  });

  const [form, setForm] = useState(null);

  React.useEffect(() => {
    if (config && Object.keys(config).length > 0 && form === null) {
      queueMicrotask(() => {
        setForm((prev) =>
          prev || {
            port: config.port || 4840,
            security_mode: config.security_mode || 'None',
            require_auth: !!config.require_auth,
            username: config.username || 'admin',
            password: config.password || 'password123',
            server_name: config.server_name || 'Industrial Gateway OPC-UA Server',
            enabled: config.enabled !== false,
          }
        );
      });
    }
  }, [config, form]);

  const updateMutation = useMutation({
    mutationFn: async (updatedData) => {
      const { data } = await client.put('/api/opcua/config', updatedData);
      return data;
    },
    onSuccess: (data) => {
      if (data.port) {
        setForm((prev) => (prev ? { ...prev, port: data.port } : prev));
      }
      if (data.running) {
        toast.success(data.message || 'Cập nhật cấu hình và khởi động lại OPC-UA Server thành công!');
      } else {
        toast.error(data.last_error || data.message || 'Cổng đang bị chiếm dụng. Không thể khởi động OPC-UA Server.');
      }
      queryClient.invalidateQueries({ queryKey: ['opcuaConfig'] });
    },
    onError: (err) => {
      toast.error('Lỗi: ' + (err.response?.data?.detail || err.message));
    },
  });

  const toggleServerMutation = useMutation({
    mutationFn: async (start) => {
      const endpoint = start ? '/api/opcua/start' : '/api/opcua/stop';
      const { data } = await client.post(endpoint);
      return data;
    },
    onSuccess: (data) => {
      if (data.port) {
        setForm((prev) => (prev ? { ...prev, port: data.port } : prev));
      }
      if (data.running) {
        toast.success('OPC-UA Server đã khởi động thành công!');
      } else if (data.message?.includes('dừng')) {
        toast.success('Đã dừng OPC-UA Server');
      } else {
        toast.error(data.last_error || data.message || 'Không thể khởi động OPC-UA Server');
      }
      queryClient.invalidateQueries({ queryKey: ['opcuaConfig'] });
    },
    onError: (err) => {
      toast.error('Lỗi: ' + (err.response?.data?.detail || err.message));
    },
  });

  if (isLoading || form === null) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    updateMutation.mutate(form);
  };

  const applyPortAndRestart = (targetPort) => {
    const updated = { ...form, port: targetPort };
    setForm(updated);
    updateMutation.mutate(updated);
  };

  const endpointUrl = config.endpoint || `opc.tcp://0.0.0.0:${form.port}/freeopcua/server/`;

  const handleCopyEndpoint = () => {
    navigator.clipboard?.writeText(endpointUrl);
    toast.success('Đã sao chép Endpoint URL');
  };

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">
      {/* Header Banner */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-slate-700/80">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Server className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            </div>
            <h1 className="font-heading text-lg sm:text-xl font-bold text-slate-100">
              Cấu Hình OPC-UA Server Cho SCADA
            </h1>
          </div>
          <p className="text-xs text-slate-400">
            Tùy biến cổng mạng, chế độ bảo mật (Security Policy) và xác thực tài khoản (User/Password)
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2 bg-[#0F172A]/80 px-3.5 py-2 rounded-xl border border-slate-700">
            <span
              className={`w-2.5 h-2.5 rounded-full ${config.running ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`}
              aria-hidden="true"
            />
            <span className="font-heading text-xs font-semibold text-slate-200">
              {config.running ? `Online (${config.nodes_count || 0} Nodes)` : 'Stopped'}
            </span>
          </div>

          <button
            type="button"
            disabled={toggleServerMutation.isPending || updateMutation.isPending}
            onClick={() => toggleServerMutation.mutate(!config.running)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${
              config.running
                ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40'
                : 'bg-emerald-500 hover:bg-emerald-400 text-[#0F172A]'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${toggleServerMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            {config.running ? 'Dừng Server' : 'Khởi Động Lại'}
          </button>
        </div>
      </div>

      {/* Port conflict or auto-fallback alert */}
      {!config.running ? (
        <div className="bg-red-500/10 border border-red-500/35 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 text-xs text-red-200 space-y-2">
            <p className="font-heading font-bold text-sm text-red-300">
              OPC-UA Server Chưa Thể Khởi Động (Stopped)
            </p>
            <p className="leading-relaxed text-red-200/90">
              {config.last_error || `Cổng ${config.port || 4840} đang bị ứng dụng khác (ví dụ: Kepware hoặc Windows OPC Service) chiếm dụng trên máy tính này.`}
            </p>
            <div className="pt-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-300">Chuyển nhanh sang cổng trống:</span>
              {[4841, 4845, 49320].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => applyPortAndRestart(p)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F172A] border border-red-500/40 hover:bg-red-500/20 rounded-lg text-red-200 font-mono font-semibold transition-colors cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                  Đổi sang cổng {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : config.auto_fallback ? (
        <div className="bg-amber-500/10 border border-amber-500/35 rounded-xl p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 text-xs text-amber-200 space-y-1">
            <p className="font-heading font-bold text-sm text-amber-300">
              OPC-UA Server Đang Hoạt Động Trên Cổng Tự Động
            </p>
            <p className="text-amber-200/90">{config.last_error}</p>
            <p className="font-mono font-bold text-emerald-300 pt-0.5">
              Endpoint cho SCADA / Kepware Client: {endpointUrl}
            </p>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* General Settings */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
            <Sliders className="w-4 h-4 text-emerald-400" aria-hidden="true" /> Cài Đặt Chung
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="opcua-port" className="text-xs font-semibold text-slate-300 block mb-1.5">
                Cổng Port OPC-UA *
              </label>
              <input
                id="opcua-port"
                type="number"
                required
                min="1024"
                max="65535"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value, 10) || 4840 })}
                className="w-full bg-[#0F172A] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm font-mono focus:border-emerald-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Chuẩn công nghiệp: 4840 (tự chuyển 4841 nếu bị Kepware chiếm)
              </p>
            </div>

            <div>
              <label htmlFor="opcua-name" className="text-xs font-semibold text-slate-300 block mb-1.5">
                Tên Server (Server Name)
              </label>
              <input
                id="opcua-name"
                type="text"
                value={form.server_name}
                onChange={(e) => setForm({ ...form, server_name: e.target.value })}
                className="w-full bg-[#0F172A] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="bg-[#0F172A]/85 p-3 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <span className="text-slate-400">Endpoint URL hiện tại:</span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-emerald-400 break-all">{endpointUrl}</span>
              <button
                type="button"
                onClick={handleCopyEndpoint}
                className="p-1.5 text-slate-400 hover:text-emerald-300 hover:bg-slate-800 rounded-md transition-colors cursor-pointer"
                title="Sao chép Endpoint URL"
                aria-label="Sao chép Endpoint URL"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Security Policy */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
            <Shield className="w-4 h-4 text-sky-400" aria-hidden="true" /> Chế Độ Mã Hóa & Bảo Mật (Security Policy)
          </h2>

          <p className="text-xs text-slate-400">
            Chọn mức độ an ninh mà phần mềm SCADA của bạn yêu cầu:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              {
                id: 'None',
                title: 'Không bảo mật (None)',
                desc: 'Phù hợp mạng LAN nội bộ, kết nối nhanh, không cần chứng chỉ SSL.',
                icon: Unlock,
                color: 'text-slate-300',
              },
              {
                id: 'Sign',
                title: 'Ký số (Sign)',
                desc: 'Xác thực toàn vẹn gói tin bằng chứng chỉ x509 (Basic256Sha256).',
                icon: Key,
                color: 'text-amber-400',
              },
              {
                id: 'SignAndEncrypt',
                title: 'Ký & Mã hóa (Sign & Encrypt)',
                desc: 'Mức bảo mật cao nhất, mã hóa toàn bộ dữ liệu truyền thông.',
                icon: Lock,
                color: 'text-emerald-400',
              },
            ].map((item) => {
              const isSelected = form.security_mode === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setForm({ ...form, security_mode: item.id })}
                  aria-pressed={isSelected}
                  className={`text-left border rounded-xl p-4 cursor-pointer transition-all duration-150 ${
                    isSelected
                      ? 'border-emerald-500/80 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                      : 'border-slate-700/80 hover:border-slate-500 bg-[#0F172A]/60'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className={`w-4 h-4 ${item.color}`} aria-hidden="true" />
                    <span className="font-semibold text-xs text-slate-100">{item.title}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{item.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* User Authentication */}
        <div className="glass-panel rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" /> Xác Thực Tài Khoản Đăng Nhập
            </h2>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.require_auth}
                onChange={(e) => setForm({ ...form, require_auth: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500" />
              <span className="ml-2.5 text-xs font-medium text-slate-300">
                {form.require_auth ? 'Bắt buộc đăng nhập' : 'Cho phép Anonymous'}
              </span>
            </label>
          </div>

          {form.require_auth ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-emerald-500/5 p-4 rounded-xl border border-emerald-500/20">
              <div>
                <label htmlFor="opcua-user" className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Tên đăng nhập (Username) *
                </label>
                <input
                  id="opcua-user"
                  type="text"
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full bg-[#0F172A] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="opcua-pass" className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Mật khẩu (Password) *
                </label>
                <input
                  id="opcua-pass"
                  type="password"
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full bg-[#0F172A] border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-300 bg-[#0F172A]/70 p-3 rounded-lg border border-slate-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
              <span>
                Chế độ <strong className="text-slate-100">Anonymous</strong> đang bật: SCADA kết nối trực tiếp không cần username/password.
              </span>
            </div>
          )}
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-[#0F172A] bg-emerald-500 hover:bg-emerald-400 rounded-xl transition-colors shadow-md cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${updateMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            {updateMutation.isPending ? 'Đang lưu & Khởi động lại...' : 'Lưu & Khởi Động Lại Server'}
          </button>
        </div>
      </form>
    </div>
  );
}
