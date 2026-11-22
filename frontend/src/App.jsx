import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useWebSocket } from './hooks/useWebSocket';

import Layout from './components/Layout';
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

function AppContent() {
  useWebSocket();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
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
