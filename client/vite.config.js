import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // '/app/' standalone; overridden to '/ai/app/' for the claimpaid.io reverse proxy
  base: process.env.VITE_BASE || '/app/',
  server: {
    proxy: {
      '/api': 'http://localhost:4001',
    },
  },
});
