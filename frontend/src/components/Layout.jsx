import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import useStore from '../store/useStore';
import { Wifi, WifiOff, Menu } from 'lucide-react';

export default function Layout() {
  const wsConnected = useStore((s) => s.wsConnected);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#0F172A] text-[#F8FAFC]">
      <Sidebar mobileOpen={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />

      {/* Main Content */}
      <div className="lg:ml-64 flex-1 flex flex-col min-h-screen min-w-0">
        {/* Frosted Glass Header */}
        <header className="sticky top-0 z-30 h-14 bg-[#0F172A]/85 backdrop-blur-md border-b border-slate-800/90 px-4 sm:px-6 flex items-center justify-between">
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
            <span className="hidden sm:inline-flex text-[11px] font-mono text-slate-300 bg-slate-800/90 border border-slate-700/80 px-2 py-0.5 rounded-md">
              PLC / IoT / OPC-UA
            </span>
          </div>

          <div className="flex items-center gap-2" aria-live="polite">
            {wsConnected ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 rounded-full">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
                Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 bg-red-500/15 border border-red-500/30 px-3 py-1 rounded-full">
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                Offline
              </span>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-5 lg:p-6 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
