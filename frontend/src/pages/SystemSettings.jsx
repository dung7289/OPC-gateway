import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  HardDriveDownload,
  Download,
  Upload,
  Power,
  ShieldCheck,
  Activity,
  Terminal,
  RefreshCw,
} from 'lucide-react';
import { fetchConnections } from '../api/connections';
import {
  downloadBackup,
  restoreBackup,
  fetchAutostart,
  setAutostart,
} from '../api/system';
import StatusBadge from '../components/StatusBadge';

export default function SystemSettings() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [restoreMode, setRestoreMode] = useState('replace');
  const [loadedBundle, setLoadedBundle] = useState(null);
  const [loadedFileName, setLoadedFileName] = useState('');
  const [downloading, setDownloading] = useState(false);

  const { data: autostart, isLoading: loadingAutostart } = useQuery({
    queryKey: ['autostart'],
    queryFn: fetchAutostart,
  });

  const { data: connections = [], refetch: refetchConns } = useQuery({
    queryKey: ['connections'],
    queryFn: fetchConnections,
    refetchInterval: 5000,
  });

  const autostartMutation = useMutation({
    mutationFn: (enabled) => setAutostart(enabled),
    onSuccess: (res) => {
      toast.success(res.message || 'Đã cập nhật Auto-Start');
      queryClient.invalidateQueries({ queryKey: ['autostart'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Lỗi Registry'),
  });

  const restoreMutation = useMutation({
    mutationFn: restoreBackup,
    onSuccess: (res) => {
      toast.success(res.message || 'Khôi phục cấu hình thành công!');
      setLoadedBundle(null);
      setLoadedFileName('');
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['tagGroups'] });
      queryClient.invalidateQueries({ queryKey: ['historyConfig'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || err.message || 'Khôi phục thất bại'),
  });

  const handleDownloadBackup = async () => {
    setDownloading(true);
    try {
      const bundle = await downloadBackup();
      const jsonStr = JSON.stringify(bundle, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `industrial-gateway-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Đã tải backup (${bundle.connections?.length || 0} kênh, ${bundle.tags?.length || 0} tag)`
      );
    } catch (err) {
      toast.error(err.response?.data?.detail || err.message || 'Lỗi xuất backup');
    } finally {
      setDownloading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || '{}'));
        if (!Array.isArray(parsed.connections) || !Array.isArray(parsed.tags)) {
          toast.error('File JSON không đúng định dạng Backup của Industrial Gateway');
          return;
        }
        setLoadedBundle(parsed);
        setLoadedFileName(file.name);
        toast.success(`Đã nạp file '${file.name}'`);
      } catch {
        toast.error('Không đọc được nội dung JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleRestoreSubmit = () => {
    if (!loadedBundle) return;
    const warnMsg =
      restoreMode === 'replace'
        ? 'Chế độ Thay thế sẽ XÓA toàn bộ kênh và tag hiện tại trước khi khôi phục. Bạn có chắc chắn?'
        : 'Chế độ Gộp sẽ giữ cấu hình hiện tại và chỉ thêm các kênh/tag chưa tồn tại. Tiếp tục?';
    if (!window.confirm(warnMsg)) return;
    restoreMutation.mutate({ mode: restoreMode, data: loadedBundle });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="font-heading text-xl font-bold text-slate-100 flex items-center gap-2">
          <HardDriveDownload className="w-5 h-5 text-emerald-400" />
          Hệ thống, Sao lưu Dự án &amp; Tự động Khởi động
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Sao lưu / Khôi phục toàn bộ cấu hình (.json), cấu hình chạy ngầm Auto-Start Windows và giám sát _System Tags
        </p>
      </div>

      {/* Backup / Restore + Auto-Start Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Project Backup / Restore */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <Download className="w-4 h-4 text-sky-400" />
              Sao lưu &amp; Khôi phục Cấu hình Dự án
            </h2>
            <button
              type="button"
              onClick={handleDownloadBackup}
              disabled={downloading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Đang xuất...' : 'Tải Backup (.json)'}
            </button>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Gói sao lưu lưu toàn bộ Channels, Thư mục, Danh sách Tag (kèm Scaling, Access RO/RW, Deadband), cấu hình OPC-UA Server, IoT Forwarder và Data Logger trong 1 file duy nhất (tương tự file <code className="text-emerald-400">.opf</code> của Kepware).
          </p>

          <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-200">Khôi phục từ file Backup</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/40 rounded-lg cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Chọn file .json
              </button>
            </div>

            {loadedBundle && (
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-emerald-400 font-semibold">{loadedFileName}</span>
                  <span className="text-slate-400">
                    {loadedBundle.exported_at
                      ? new Date(loadedBundle.exported_at).toLocaleString('vi-VN')
                      : ''}
                  </span>
                </div>
                <div className="text-xs text-slate-300">
                  Nội dung: <b>{loadedBundle.connections?.length || 0}</b> kênh •{' '}
                  <b>{loadedBundle.tag_groups?.length || 0}</b> thư mục •{' '}
                  <b>{loadedBundle.tags?.length || 0}</b> tags
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      value="replace"
                      checked={restoreMode === 'replace'}
                      onChange={() => setRestoreMode('replace')}
                      className="accent-emerald-500"
                    />
                    <span>Thay thế toàn bộ (Replace)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="radio"
                      name="restoreMode"
                      value="merge"
                      checked={restoreMode === 'merge'}
                      onChange={() => setRestoreMode('merge')}
                      className="accent-emerald-500"
                    />
                    <span>Gộp thêm (Merge)</span>
                  </label>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleRestoreSubmit}
                    disabled={restoreMutation.isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-[#0F172A] rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {restoreMutation.isPending ? 'Đang khôi phục...' : 'Tiến hành Khôi phục'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Windows Auto-Start & Hidden Mode */}
        <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <Power className="w-4 h-4 text-emerald-400" />
              Tự động Khởi động cùng Windows (Chạy ngầm)
            </h2>
            {!loadingAutostart && autostart?.supported && (
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                  autostart.enabled
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {autostart.enabled ? 'Đang Bật' : 'Đang Tắt'}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Đăng ký Industrial Gateway vào <code className="text-sky-300">HKCU\...\Run</code> thông qua trình khởi chạy <code className="text-emerald-400">start_hidden.vbs</code> để tự chạy ngầm ngay khi bật máy mà <strong>không hiện cửa sổ CMD đen</strong>.
          </p>

          <div className="bg-[#0F172A]/80 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-xs text-slate-300 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{autostart?.detail || 'Đang kiểm tra Windows Registry...'}</span>
            </div>

            {autostart?.command && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] font-mono text-slate-400 break-all flex items-start gap-2">
                <Terminal className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span>{autostart.command}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              {autostart?.supported ? (
                <button
                  type="button"
                  onClick={() => autostartMutation.mutate(!autostart.enabled)}
                  disabled={autostartMutation.isPending}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${
                    autostart.enabled
                      ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/40'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-[#0F172A]'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  {autostart.enabled ? 'Tắt Auto-Start Windows' : 'Bật Auto-Start chạy ngầm'}
                </button>
              ) : (
                <span className="text-xs text-amber-400">
                  Tính năng chỉ hoạt động trên hệ điều hành Windows.
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* _System Tags Monitor */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading text-sm font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              Giám sát _System Tags (Watchdog trên OPC-UA Server)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Mỗi kênh đang bật tự động sinh nhóm <code className="text-sky-300">_System</code> chứa{' '}
              <code className="text-slate-300">_Connected, _Error, _Demoted, _TagCount, _GoodCount, _BadCount, _Timestamp</code>
            </p>
          </div>

          <button
            type="button"
            onClick={() => refetchConns()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Làm mới
          </button>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-[#0F172A]/80 border-b border-slate-800">
              <tr>
                <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">Kênh (Channel)</th>
                <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">_Connected / _Demoted</th>
                <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">_GoodCount / _TagCount</th>
                <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">_BadCount</th>
                <th className="text-left px-4 py-2.5 text-slate-400 font-semibold">OPC-UA _System NodeId Mẫu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {connections.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    Chưa có kênh kết nối nào.
                  </td>
                </tr>
              ) : (
                connections.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 font-semibold text-slate-100">{c.name}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {c.enabled === false ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-slate-700 text-slate-300">
                            Disabled
                          </span>
                        ) : (
                          <StatusBadge status={c.connected ? 'connected' : 'disconnected'} size="sm" />
                        )}
                        {c.demoted && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/15 text-amber-300 border border-amber-500/40">
                            Demoted
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono">
                      <span className="text-emerald-400 font-semibold">{c.good_count ?? 0}</span>
                      <span className="text-slate-500"> / </span>
                      <span className="text-slate-200">{c.tag_count ?? 0}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono">
                      <span className={(c.bad_count ?? 0) > 0 ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                        {c.bad_count ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-sky-300">
                      ns=2;s={c.name}._System._Connected
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
