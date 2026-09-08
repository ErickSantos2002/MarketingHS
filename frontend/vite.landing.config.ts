import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// O bundle PÚBLICO. Separado do admin de propósito: quem cai na landing por um
// anúncio não deve baixar o painel inteiro para ver um formulário.
//
// ⚠️ Nomes de arquivo fixos, sem hash: a casca HTML servida pelo FastAPI
// referencia /landing/main.js literalmente. Se um dia isso virar problema de
// cache, a saída é versionar pela query (?v=updated_at da página), não voltar
// a hashear.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    outDir: "dist-landing",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      input: path.resolve(__dirname, "src/landing/main.tsx"),
      output: {
        entryFileNames: "main.js",
        assetFileNames: "main.[ext]",
      },
    },
  },
});
