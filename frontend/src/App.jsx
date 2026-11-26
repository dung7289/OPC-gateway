import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useWebSocket } from './hooks/useWebSocket';
import useStore from './store/useStore';
import { fetchMeApi } from './api/auth';

import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Connections from './pages/Connections';
import Tags from './pages/Tags';
import Logs from './pages/Logs';
import Docs from './pages/Docs';
import OpcUaSettings from './pages/OpcUaSettings';
import IoTGateway from './pages/IoTGateway';
import Historian from './pages/Historian';
import SystemSettings from './pages/SystemSettings';
import UsrM100Control from './pages/UsrM100Control';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
    },
  },
});

function ProtectedShell() {
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const authChecked = useStore((s) => s.authChecked);
  const location = useLocation();

  useWebSocket();

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center text-slate-300">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-mono text-slate-400">Đang xác thực phiên làm việc...</p>
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Layout />;
}

function AppContent() {
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const clearAuth = useStore((s) => s.clearAuth);

  useEffect(() => {
    if (!token || user) return undefined;
    let cancelled = false;
    fetchMeApi()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch(() => {
        if (!cancelled) clearAuth();
      });
    return () => {
      cancelled = true;
    };
  }, [token, user, setUser, clearAuth]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/historian" element={<Historian />} />
          <Route path="/opcua-server" element={<OpcUaSettings />} />
          <Route path="/iot-gateway" element={<IoTGateway />} />
          <Route path="/usr-m100" element={<UsrM100Control />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/system" element={<SystemSettings />} />
          <Route path="/docs" element={<Docs />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            borderRadius: '10px',
            background: '#1f2937',
            color: '#fff',
            fontSize: '14px',
          },
          success: {
            iconTheme: { primary: '#10b981', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#ef4444', secondary: '#fff' },
          },
        }}
      />
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
