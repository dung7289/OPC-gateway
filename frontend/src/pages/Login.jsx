import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Cpu, Lock, User, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { loginApi } from '../api/auth';
import useStore from '../store/useStore';

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const setAuth = useStore((s) => s.setAuth);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (token && user) {
    const dest = location.state?.from?.pathname || '/';
    return <Navigate to={dest} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    if (!username.trim() || !password) {
      setErrorMsg('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await loginApi({
        username: username.trim(),
        password,
        remember,
      });
      setAuth(res.token, res.user);
      toast.success(
        `Xin chào ${res.user.full_name || res.user.username} (${res.user.role === 'admin' ? 'Admin' : 'Chỉ xem'})`
      );
      const dest = location.state?.from?.pathname || '/';
      navigate(dest, { replace: true });
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || 'Đăng nhập thất bại';
      setErrorMsg(detail);
      toast.error(detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle ambient glows matching Dark Tech industrial aesthetic */}
      <div
        className="pointer-events-none absolute -top-32 -left-24 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-24 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="w-full max-w-md glass-panel rounded-2xl border border-slate-700/80 shadow-2xl p-6 sm:p-8 space-y-6 relative z-10">
        {/* Brand */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_24px_rgba(34,197,94,0.2)]">
            <Cpu className="w-6 h-6 text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-heading text-xl font-bold tracking-tight text-slate-100">
              Industrial <span className="text-emerald-400">GATEWAY</span>
            </h1>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              PLC / IoT / OPC-UA Supervision Console
            </p>
          </div>
        </div>

        {/* Error Box */}
        {errorMsg && (
          <div className="bg-red-500/15 border border-red-500/40 rounded-xl px-3.5 py-2.5 text-xs text-red-200">
            {errorMsg}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Tên đăng nhập
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin hoặc viewer"
                className="w-full bg-[#1B2336] border border-slate-700 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Mật khẩu
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nhập mật khẩu"
                className="w-full bg-[#1B2336] border border-slate-700 rounded-xl pl-10 pr-10 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="p-1 text-slate-400 hover:text-slate-200 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                aria-label={showPwd ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-slate-600 bg-[#1B2336] text-emerald-500 focus:ring-emerald-500"
            />
            <span>Ghi nhớ phiên đăng nhập (7 ngày)</span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-[#0F172A] font-heading font-bold text-sm transition-colors cursor-pointer disabled:opacity-50 shadow-md"
          >
            <LogIn className="w-4 h-4" aria-hidden="true" />
            {submitting ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>
        </form>

        {/* RBAC Role Info */}
        <div className="bg-[#0B1120]/80 border border-slate-800 rounded-xl p-3.5 space-y-2 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Phân quyền truy cập hệ thống</span>
          </div>
          <div className="grid grid-cols-1 gap-1 leading-relaxed">
            <div>
              • <strong className="text-emerald-300">Admin:</strong> Toàn quyền cấu hình kênh PLC, Tag, Scan OPC/TIA, ghi giá trị, Backup &amp; quản lý tài khoản.
            </div>
            <div>
              • <strong className="text-sky-300">Viewer (Chỉ xem):</strong> Giám sát Dashboard realtime, biểu đồ Historian, nhật ký hệ thống &amp; xuất báo cáo Excel.
            </div>
          </div>
          <div className="pt-1 border-t border-slate-800/80 text-[10px] font-mono text-slate-500">
            Mặc định lần đầu: admin / admin123 · viewer / viewer123 (hãy đổi mật khẩu ở /system)
          </div>
        </div>
      </div>
    </div>
  );
}
