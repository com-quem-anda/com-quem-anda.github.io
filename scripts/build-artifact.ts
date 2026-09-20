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

/**
 * Substitui exigindo que o padrão exista. Um regex que deixa de casar aqui é
 * silencioso: o artifact sai sem o pedaço e ninguém percebe até abrir. Já
 * aconteceu com a tag do app.js ao ganhar um atributo.
 */
function trocar(texto: string, padrao: RegExp, por: string): string {
  if (!padrao.test(texto)) throw new Error(`padrão nunca casou em build-artifact: ${padrao}`);
  return texto.replace(padrao, por);
}

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
  const corpo = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";

  // O artifact recebe só o conteúdo: doctype, html, head e body são dele.
  const conteudo = trocar(corpo, /<script src="app\.js"[^>]*><\/script>/, "").trim();

  // O arquivo único tem de abrir sem rede: as fontes entram como data: dentro
  // do próprio CSS. A lista sai do CSS, não daqui — fonte nova é embutida sem
  // ninguém lembrar de vir editar este script.
  const refs = [...css.matchAll(/url\(fontes\/([^)]+)\)/g)].map((m) => m[1]!);
  if (refs.length === 0) throw new Error("build-artifact: o CSS não referencia nenhuma fonte em fontes/");
  let cssEmbutido = css;
  for (const arquivo of new Set(refs)) {
    const b64 = (await readFile(new URL(`fontes/${arquivo}`, DIR_WEB))).toString("base64");
    cssEmbutido = trocar(cssEmbutido, new RegExp(`url\\(fontes/${arquivo}\\)`, "g"),
                         `url(data:font/woff2;base64,${b64})`);
  }

  // </script> dentro de string quebraria o bloco; < evita sem alterar o valor.
  const dados = JSON.stringify({ base, ufs }).replace(/</g, "\\u003c");

  const saida = `<title>${titulo}</title>
<style>
${cssEmbutido}
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
