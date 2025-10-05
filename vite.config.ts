import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

// Optional: vite-bundle-visualizer for analyzing chunks (only when ANALYZE=true)
const visualizer = async (): Promise<PluginOption | null> => {
  if (process.env.ANALYZE !== 'true') return null;
  const mod = await import('rollup-plugin-visualizer');
  return (mod as any).visualizer({ open: true, filename: 'stats.html', gzipSize: true, brotliSize: true });
};

export default defineConfig(async () => {
  const analyzePlugin = await visualizer();
  return {
    plugins: [react(), ...(analyzePlugin ? [analyzePlugin] : [])],
    server: {
      port: 5174,
      cors: true,
      strictPort: true
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
  };
});