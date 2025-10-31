import { defineConfig, loadEnv, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

// Optional: vite-bundle-visualizer for analyzing chunks (only when ANALYZE=true)
const visualizer = async (): Promise<PluginOption | null> => {
  if (process.env.ANALYZE !== 'true') return null;
  const mod = await import('rollup-plugin-visualizer');
  return (mod as any).visualizer({ open: true, filename: 'stats.html', gzipSize: true, brotliSize: true });
};

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const neProxyTarget = env.VITE_NE_PROXY_TARGET || 'https://www.neighborhoodexplorer.org';
  const neProxyTargetProd = env.VITE_NE_PROXY_TARGET_PROD || 'https://www.neighborhoodexplorer.org';
  const neProxyTargetStaging = env.VITE_NE_PROXY_TARGET_STAGING || 'https://neighborhood-explorer-staging.herokuapp.com';
  const analyzePlugin = await visualizer();
  return {
    plugins: [react(), ...(analyzePlugin ? [analyzePlugin] : [])],
    server: {
      port: 5174,
      cors: true,
      strictPort: true,
      proxy: {
        // Dev proxy to avoid browser CORS for NE API
        '/ne': {
          target: neProxyTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/ne/, ''),
        },
        '/neProd': {
          target: neProxyTargetProd,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/neProd/, ''),
        },
        '/neStaging': {
          target: neProxyTargetStaging,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/neStaging/, ''),
        },
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            maplibre: ['maplibre-gl'],
          },
        },
      },
    },
    envPrefix: ['VITE_', 'ADMIN_'],
  };
});
