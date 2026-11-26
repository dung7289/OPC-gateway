import { create } from 'zustand';

const TOKEN_KEY = 'gw_auth_token';

function readInitialToken() {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

const initialToken = readInitialToken();

const useStore = create((set) => ({
  tagValues: {},
  wsConnected: false,
  token: initialToken,
  user: null,
  authChecked: !initialToken,

  setTagValue: (tagId, data) =>
    set((state) => ({
      tagValues: {
        ...state.tagValues,
        [tagId]: data,
      },
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setAuth: (token, user) => {
    try {
      if (typeof window !== 'undefined') {
        if (token) window.localStorage.setItem(TOKEN_KEY, token);
        else window.localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // ignore storage quota errors
    }
    set({
      token: token || '',
      user: user || null,
      authChecked: true,
    });
  },

  setUser: (user) => set({ user: user || null, authChecked: true }),

  setAuthChecked: (checked) => set({ authChecked: Boolean(checked) }),

  clearAuth: () => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // ignore
    }
    set({
      token: '',
      user: null,
      wsConnected: false,
      authChecked: true,
    });
  },
}));

export default useStore;
