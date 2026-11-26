import { useEffect, useRef, useCallback } from 'react';
import { WS_URL } from '../api/client';
import useStore from '../store/useStore';

const RECONNECT_DELAY = 3000;

export function useWebSocket() {
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const connectRef = useRef(null);
  const setTagValue = useStore((s) => s.setTagValue);
  const setWsConnected = useStore((s) => s.setWsConnected);
  const clearAuth = useStore((s) => s.clearAuth);
  const isConnected = useStore((s) => s.wsConnected);
  const token = useStore((s) => s.token);
  const user = useStore((s) => s.user);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (!token || !user) {
      setWsConnected(false);
      return;
    }

    try {
      const sep = WS_URL.includes('?') ? '&' : '?';
      const ws = new WebSocket(`${WS_URL}${sep}token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'tag_update') {
            const data = msg.data || msg;
            setTagValue(data.tag_id, {
              value: data.value,
              quality: data.quality,
              timestamp: data.timestamp,
            });
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };

      ws.onclose = (event) => {
        setWsConnected(false);
        if (event?.code === 4401) {
          clearAuth();
          return;
        }
        reconnectTimerRef.current = setTimeout(() => {
          connectRef.current?.();
        }, RECONNECT_DELAY);
      };
    } catch {
      setWsConnected(false);
      reconnectTimerRef.current = setTimeout(() => {
        connectRef.current?.();
      }, RECONNECT_DELAY);
    }
  }, [token, user, setTagValue, setWsConnected, clearAuth]);

  useEffect(() => {
    connectRef.current = connect;
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { isConnected };
}
