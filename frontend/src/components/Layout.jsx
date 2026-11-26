import React, { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Sidebar from './Sidebar';
import useStore from '../store/useStore';
import { logoutApi } from '../api/auth';
import { Wifi, WifiOff, Menu, ShieldCheck, Eye, LogOut } from 'lucide-react';

export default function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const wsConnected = useStore((s) => s.wsConnected);
  const user = useStore((s) => s.user);
  const clearAuth = useStore((s) => s.clearAuth);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAdmin = user?.role === 'admin';

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // ignore errors on expired token
    }
    queryClient.clear();
    clearAuth();
    toast.success('Đã đăng xuất');
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-[#0F172A] text-[#F8FAFC]">
      <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Main Content */}
      <div className="lg:ml-64 flex-1 flex flex-col min-h-screen min-w-0">
        {/* Frosted Glass Header */}
        <header className="sticky top-0 z-30 h-14 bg-[#0F172A]/85 backdrop-blur-md border-b border-slate-800/90 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-1 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
              aria-label="Mở menu điều hướng"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-heading text-sm sm:text-base font-bold text-slate-100 truncate">
              Industrial Gateway
            </h1>
            <span className="hidden md:inline-flex text-[11px] font-mono text-slate-300 bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 rounded-md">
              PLC / IoT / OPC-UA
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3" aria-live="polite">
            {wsConnected ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2.5 sm:px-3 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Live</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 bg-red-500/15 border border-red-500/30 px-2.5 sm:px-3 py-1 rounded-full">
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Offline</span>
              </span>
            )}

            {user && (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                    isAdmin
                      ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
                      : 'bg-sky-500/15 border-sky-500/35 text-sky-300'
                  }`}
                  title={isAdmin ? 'Quản trị viên (Toàn quyền)' : 'Người xem (Chỉ xem)'}
                >
                  {isAdmin ? (
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="max-w-[90px] truncate">{user.username}</span>
                  <span className="text-[10px] font-mono opacity-80 hidden sm:inline">
                    {isAdmin ? 'ADMIN' : 'CHỈ XEM'}
                  </span>
                </span>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-medium text-slate-200 cursor-pointer transition-colors"
                  title="Đăng xuất tài khoản"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Đăng xuất</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Viewer Read-Only Banner */}
        {user && !isAdmin && (
          <div className="bg-amber-500/10 border-b border-amber-500/25 px-4 sm:px-6 py-2 flex items-center gap-2 text-xs text-amber-200">
            <Eye className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
            <span>
              <strong>Chế độ Chỉ xem (Viewer)</strong> — Bạn chỉ có quyền giám sát dữ liệu và xem báo cáo; các nút cấu hình &amp; điều khiển thiết bị đã được khóa (chỉ tài khoản <strong>Admin</strong> mới được thao tác).
            </span>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-5 lg:p-6 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
