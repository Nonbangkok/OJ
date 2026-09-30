import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL ?? env.REACT_APP_API_URL ?? '/api';
  const largeUploadApiUrl = env.VITE_LARGE_UPLOAD_API_URL
    ?? env.REACT_APP_LARGE_UPLOAD_API_URL
    ?? '';

  return {
    plugins: [react()],
    define: {
      // Keep the existing application API configuration stable while the
      // bundler changes; the compose build args map to the Vite variables.
      'process.env.REACT_APP_API_URL': JSON.stringify(apiUrl),
      'process.env.REACT_APP_LARGE_UPLOAD_API_URL': JSON.stringify(largeUploadApiUrl),
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'build',
      emptyOutDir: true,
    },
  };
});
