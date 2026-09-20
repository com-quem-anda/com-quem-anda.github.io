/**
 * Troca o endereço público do site, de uma vez e em todos os lugares.
 *
 * O endereço está cravado em sete pontos de quatro arquivos. Trocar à mão é
 * como se perde um: um canonical apontando para domínio errado não quebra
 * nada visível — só manda o Google indexar o lugar errado, calado, por
 * semanas. Por isso aqui cada ponto é contado e a divergência é erro.
 *
 * Uso:  node scripts/migrar-dominio.ts com-quem-anda.com.br
 *       node scripts/migrar-dominio.ts com-quem-anda.com.br --conferir
 *
 * Com --conferir nada é escrito: só relata o que mudaria. Use antes.
 */
import { readFile, writeFile } from "node:fs/promises";

const DIR = new URL("../", import.meta.url);

/** Onde o endereço aparece, e quantas vezes tem de aparecer. */
const PONTOS: { arquivo: string; vezes: number }[] = [
  { arquivo: "web/index.html", vezes: 5 },   // canonical, og:url, og:image, twitter:image, JSON-LD
  { arquivo: "web/sitemap.xml", vezes: 1 },  // <loc>
  { arquivo: "web/robots.txt", vezes: 1 },   // Sitemap:
  { arquivo: "tests/privacidade.test.ts", vezes: 1 }, // PROPRIO
];

async function main(): Promise<void> {
  const novo = process.argv[2];
  const conferir = process.argv.includes("--conferir");

  if (!novo || novo.startsWith("-")) {
    throw new Error("uso: node scripts/migrar-dominio.ts <dominio.novo> [--conferir]");
  }
  if (novo.includes("/") || novo.includes(":")) {
    throw new Error(`passe só o domínio, sem esquema nem barra: recebi "${novo}"`);
  }

  // O endereço atual sai do canonical, que é a única declaração normativa de
  // "onde este site mora". Ler dele evita manter uma constante que envelhece.
  const html = await readFile(new URL("web/index.html", DIR), "utf8");
  const atual = /<link rel="canonical" href="https:\/\/([^/"]+)\/?">/.exec(html)?.[1];
  if (!atual) throw new Error("não achei o canonical em web/index.html para saber o endereço atual");
  if (atual === novo) {
    console.log(`nada a fazer: o site já se declara em ${novo}`);
    return;
  }

  console.log(`${atual}  ->  ${novo}${conferir ? "  (conferindo, nada será escrito)" : ""}\n`);

  for (const { arquivo, vezes } of PONTOS) {
    const url = new URL(arquivo, DIR);
    const texto = await readFile(url, "utf8");
    const achadas = texto.split(atual).length - 1;
    if (achadas !== vezes) {
      throw new Error(
        `${arquivo}: esperava ${vezes} ocorrência(s) de ${atual}, achei ${achadas}. ` +
        `O arquivo mudou de forma — confira à mão antes de migrar, e corrija PONTOS.`,
      );
    }
    if (!conferir) await writeFile(url, texto.split(atual).join(novo));
    console.log(`  ${arquivo.padEnd(30)} ${achadas} ocorrência(s)`);
  }

  // O deploy é por Actions e publica o conteúdo de web/. Sem este arquivo no
  // artefato, o domínio próprio pode se perder numa publicação — e o site
  // volta calado para o endereço antigo.
  if (!conferir) {
    await writeFile(new URL("web/CNAME", DIR), `${novo}\n`);
  }
  console.log(`  ${"web/CNAME".padEnd(30)} ${conferir ? "seria criado" : "criado"} com ${novo}`);

  console.log(
    conferir
      ? "\nNada escrito. Rode sem --conferir quando o domínio já responder."
      : "\nFeito. Rode `npm test` e só publique depois que o domínio novo servir o site.",
  );
}

await main();
