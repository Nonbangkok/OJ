import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Only the REACT_APP_* variables are read from the environment / .env files.
  const env = loadEnv(mode, process.cwd(), 'REACT_APP_');

  return {
    plugins: [react()],
    // `define` (instead of `import.meta.env`) keeps the app source and Jest reading
    // `process.env.REACT_APP_*`, and keeps the compose/CI build-arg names unchanged.
    // API URL: set (even to "") is used as is; fully unset falls back to '/api'.
    // Large-upload URL: unset stays `undefined`.
    define: {
      'process.env.REACT_APP_API_URL': JSON.stringify(env.REACT_APP_API_URL ?? '/api'),
      'process.env.REACT_APP_LARGE_UPLOAD_API_URL':
        env.REACT_APP_LARGE_UPLOAD_API_URL === undefined
          ? 'undefined'
          : JSON.stringify(env.REACT_APP_LARGE_UPLOAD_API_URL),
    },
    server: {
      port: 3000,
      // :8080 is the compose stack's nginx reverse proxy (HTTP_PORT=8080), which
      // strips `/api` before the backend; the dev proxy forwards the path unchanged.
      proxy: {
        '/api': { target: 'http://localhost:8080', changeOrigin: true },
      },
    },
    build: {
      outDir: 'build',
      emptyOutDir: true,
      sourcemap: true,
      target: ['es2020', 'chrome87', 'safari14', 'firefox78', 'edge88'],
    },
  };
});
