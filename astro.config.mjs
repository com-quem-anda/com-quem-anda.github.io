// @ts-check
import { defineConfig } from "astro/config";

// Saída 100% estática: não há runtime de servidor em lugar nenhum (§0.1, §8).
export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "always" },
  // Sem integrações, sem framework de componente: o orçamento da §1.4 não
  // sobrevive a um runtime de UI, e a cédula é uma tela só.
  devToolbar: { enabled: false },
  vite: {
    build: {
      // Um bundle previsível é mais fácil de medir contra o teto de 150 KB.
      cssCodeSplit: false,
      rollupOptions: { output: { entryFileNames: "_a/[name].[hash].js", assetFileNames: "_a/[name].[hash][extname]" } },
    },
  },
});
