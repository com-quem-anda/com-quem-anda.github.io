/**
 * Empacota o site em um HTML único, para publicar como artifact.
 *
 * Mesma fonte do site estático: web/{index.html,estilo.css,app.js}. O que muda
 * é só a entrega — aqui CSS, JS e dados entram embutidos, e o app.js detecta
 * isso por window.CEDULA_DADOS em vez de buscar pela rede. Não existe uma
 * segunda versão do código para ficar fora de sincronia.
 *
 * Uso: node scripts/build-artifact.ts [destino.html]
 */
import { readFile, readdir, writeFile } from "node:fs/promises";

const DIR_WEB = new URL("../web/", import.meta.url);

async function main(): Promise<void> {
  const destino = process.argv[2] ?? new URL("../web/artifact.html", import.meta.url).pathname;

  const html = await readFile(new URL("index.html", DIR_WEB), "utf8");
  const css = await readFile(new URL("estilo.css", DIR_WEB), "utf8");
  const js = await readFile(new URL("app.js", DIR_WEB), "utf8");

  const base = JSON.parse(await readFile(new URL("dados/base.json", DIR_WEB), "utf8"));
  const ufs: Record<string, unknown> = {};
  for (const nome of await readdir(new URL("dados/uf/", DIR_WEB))) {
    if (!nome.endsWith(".json")) continue;
    ufs[nome.replace(".json", "")] = JSON.parse(await readFile(new URL(`dados/uf/${nome}`, DIR_WEB), "utf8"));
  }

  const titulo = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "Coerência da Chapa";
  const fontes = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.[^>]*>/g)].map((m) => m[0]).join("\n");
  const corpo = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";

  // O artifact recebe só o conteúdo: doctype, html, head e body são dele.
  const conteudo = corpo
    .replace(/<script src="app\.js"><\/script>/, "")
    .trim();

  // </script> dentro de string quebraria o bloco; < evita sem alterar o valor.
  const dados = JSON.stringify({ base, ufs }).replace(/</g, "\\u003c");

  const saida = `<title>${titulo}</title>
${fontes}
<style>
${css}
</style>
${conteudo}
<script id="dados" type="application/json">${dados}</script>
<script>
window.CEDULA_DADOS = JSON.parse(document.getElementById("dados").textContent);
</script>
<script>
${js}
</script>
`;

  await writeFile(destino, saida);
  console.log(`${destino} | ${(saida.length / 1024).toFixed(0)} KB | ${Object.keys(ufs).length} UFs embutidas`);
}

await main();
