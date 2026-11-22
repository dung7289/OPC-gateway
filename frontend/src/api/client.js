import axios from 'axios';

// Automatically adapt: use relative path when served by FastAPI (port 8000), or fallback to port 8000 in dev
const isViteDev = typeof window !== 'undefined' && window.location.port === '5173';
export const API_BASE = isViteDev ? 'http://localhost:8000' : '';
export const WS_URL = typeof window !== 'undefined'
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${isViteDev ? 'localhost:8000' : window.location.host}/ws`
  : 'ws://localhost:8000/ws';

const client = axios.create({ baseURL: API_BASE });

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      error.message = 'Cannot connect to backend. Please ensure the server is running at ' + API_BASE;
    }
    return Promise.reject(error);
  }
);

export default client;
