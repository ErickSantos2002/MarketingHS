import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    // 127.0.0.1 e não "::": o padrão da casa para conferência com Playwright,
    // firmado no DataCoreHS.
    host: "127.0.0.1",
    port: 8080,
    proxy: {
      // Em desenvolvimento o front fala com o backend por /api. Em produção
      // quem resolve é o nginx — e VITE_API_URL, que é build time.
      //
      // ⚠️ 8100 e não 8000: nesta máquina a 8000 é do TaskHS. Dentro do
      // contêiner o backend continua na 8000; 8100 é só o lado do host.
      "/api": {
        target: "http://localhost:8100",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-accordion',
            '@radix-ui/react-tabs',
          ],
        },
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    // Reduce chunk size warnings threshold
    chunkSizeWarningLimit: 1000,
  },
}));
