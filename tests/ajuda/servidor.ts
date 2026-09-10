/** Servidor estático mínimo para os testes de navegador. Só lê de dist/. */
import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const RAIZ = fileURLToPath(new URL("../../dist/", import.meta.url));

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

export interface ServidorTeste { url: string; fechar: () => Promise<void> }

export async function servir(): Promise<ServidorTeste> {
  const servidor: Server = createServer(async (req, res) => {
    try {
      const caminho = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      // normalize corta "..", impedindo o teste de ler fora de dist/.
      let alvo = join(RAIZ, normalize(caminho));
      const info = await stat(alvo).catch(() => null);
      if (info?.isDirectory()) alvo = join(alvo, "index.html");

      const bruto = await readFile(alvo);
      const tipo = TIPOS[extname(alvo)] ?? "application/octet-stream";

      // Comprime como qualquer CDN faz. Medir sem isto daria um número que a
      // produção nunca vai ver, e levaria a otimizar o problema errado.
      const aceita = String(req.headers["accept-encoding"] ?? "");
      const comprimivel = /text|json|javascript|svg|manifest/.test(tipo);
      let corpo = bruto;
      const cabecalhos: Record<string, string> = { "content-type": tipo };

      if (comprimivel && aceita.includes("br")) {
        corpo = brotliCompressSync(bruto);
        cabecalhos["content-encoding"] = "br";
      } else if (comprimivel && aceita.includes("gzip")) {
        corpo = gzipSync(bruto);
        cabecalhos["content-encoding"] = "gzip";
      }

      cabecalhos["content-length"] = String(corpo.length);
      res.writeHead(200, cabecalhos);
      res.end(corpo);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("nao encontrado");
    }
  });

  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = (servidor.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${porta}`,
    fechar: () => new Promise<void>((r) => servidor.close(() => r())),
  };
}
