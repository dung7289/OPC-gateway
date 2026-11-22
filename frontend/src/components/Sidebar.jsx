import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Plug, Tag, FileText, Cpu, BookOpen, Server, Send, X, History, HardDriveDownload, Radio } from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/connections', icon: Plug, label: 'Connections' },
  { to: '/tags', icon: Tag, label: 'Tags' },
  { to: '/historian', icon: History, label: 'Lịch sử & Logger' },
  { to: '/opcua-server', icon: Server, label: 'OPC-UA Server' },
  { to: '/iot-gateway', icon: Send, label: 'IoT Gateway' },
  { to: '/usr-m100', icon: Radio, label: 'USR-M100 Control' },
  { to: '/logs', icon: FileText, label: 'Logs' },
  { to: '/system', icon: HardDriveDownload, label: 'Hệ thống & Sao lưu' },
  { to: '/docs', icon: BookOpen, label: 'Hướng dẫn SD' },
];

export default function Sidebar({ mobileOpen = false, onClose }) {
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`w-64 min-h-screen bg-[#0B1120] border-r border-slate-800/90 flex flex-col fixed left-0 top-0 bottom-0 z-40 transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Main navigation"
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-slate-800/90">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(34,197,94,0.18)]">
              <Cpu className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            </div>
            <div>
              <div className="font-heading text-slate-100 font-bold text-sm tracking-tight leading-none">
                Industrial
              </div>
              <div className="font-heading text-emerald-400 font-semibold text-xs tracking-wide mt-0.5 leading-none">
                GATEWAY
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg cursor-pointer transition-colors"
            aria-label="Đóng menu điều hướng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-xs'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 border border-transparent'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-emerald-400"
                      aria-hidden="true"
                    />
                  )}
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`}
                    aria-hidden="true"
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom version */}
        <div className="px-5 py-3.5 border-t border-slate-800/90 bg-[#080D1A]/60">
          <div className="flex items-center justify-between">
            <span className="font-heading text-[11px] font-semibold text-slate-300">v1.0.0</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
              SCADA CORE
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Industrial Gateway Engine</p>
        </div>
      </aside>
    </>
  );
}
