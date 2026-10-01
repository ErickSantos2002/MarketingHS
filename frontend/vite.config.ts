import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Frentes paralelas (worktree) com backend próprio apontam o proxy por
// MKT_BACKEND_PORT; sem a variável, é a 8100 de sempre.
const backend = `http://localhost:${process.env.MKT_BACKEND_PORT ?? 8100}`;

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Cache de dependências por checkout, não em node_modules/.vite: as
  // worktrees das frentes linkam o node_modules da principal, e um Vite novo
  // refazendo o cache compartilhado deixava o que já rodava com dois Reacts
  // ("Invalid hook call" no menu de /contacts, 01/10).
  cacheDir: path.resolve(__dirname, ".vite"),
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
        target: backend,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      // A landing pública é servida pelo backend (`GET /p/{slug}` e o bundle
      // em `/landing/`), não por este SPA. Sem estas duas entradas, "Abrir
      // página" e o link de anúncio caem no 404 do admin em desenvolvimento.
      // Em produção o nginx precisa rotear os mesmos dois prefixos.
      "/p/": { target: backend, changeOrigin: true },
      "/landing/": { target: backend, changeOrigin: true },
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
