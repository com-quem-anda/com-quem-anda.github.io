/**
 * Total de eleitores por UF, a partir do perfil do eleitorado do TSE.
 *
 * NÃO faz parte do cron diário, de propósito. O pacote tem 389 MB comprimidos
 * e passa de 2 GB descomprimido, para produzir 28 números que mudam devagar —
 * o cadastro eleitoral não é atualizado de hora em hora. Roda sob demanda com
 * `npm run eleitorado` e o resultado fica versionado.
 *
 * Duas armadilhas do pacote:
 *  - perfil_eleitorado_2026_BRASIL.csv declara exatos 4096 MB, que é o estouro
 *    do campo de 32 bits do ZIP. O tamanho é mentira e o arquivo é ignorado:
 *    somamos pelos arquivos por UF, cujos tamanhos cabem em 32 bits.
 *  - ZZ é o eleitorado do exterior. Não é estado e não entra no mapa, mas
 *    também não some: vai para um campo próprio, porque descartar em silêncio
 *    é exatamente o que este projeto não faz.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { lerZip } from "./lib/unzip.ts";

const DIR_RAW = new URL("../data/raw/", import.meta.url);
const DIR_BUILD = new URL("../data/build/", import.meta.url);

const URL_PERFIL =
  "https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_eleitorado/perfil_eleitorado_2026.zip";

/**
 * Soma uma coluna numérica varrendo bytes.
 *
 * O CSV de SP tem 310 MB; decodificar para string custaria o dobro em UTF-16.
 * Aqui o buffer é percorrido byte a byte, respeitando aspas, e só o campo
 * procurado vira número.
 */
function somarColuna(buf: Buffer, indiceColuna: number): { soma: number; linhas: number } {
  const SEP = 0x3b, ASPA = 0x22, LF = 0x0a, CR = 0x0d;
  let soma = 0, linhas = 0;
  let coluna = 0, dentroDeAspas = false;
  let inicioCampo = 0, primeiraLinha = true;

  const valor = (ini: number, fim: number): number => {
    let i = ini, f = fim;
    if (buf[i] === ASPA) i++;
    if (f > i && buf[f - 1] === ASPA) f--;
    let n = 0, viu = false;
    for (let k = i; k < f; k++) {
      const c = buf[k]!;
      if (c >= 0x30 && c <= 0x39) { n = n * 10 + (c - 0x30); viu = true; }
    }
    return viu ? n : 0;
  };

  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]!;
    if (c === ASPA) { dentroDeAspas = !dentroDeAspas; continue; }
    if (dentroDeAspas) continue;
    if (c === SEP) {
      if (coluna === indiceColuna && !primeiraLinha) soma += valor(inicioCampo, i);
      coluna++; inicioCampo = i + 1;
    } else if (c === LF || c === CR) {
      if (i > inicioCampo || coluna > 0) {
        if (coluna === indiceColuna && !primeiraLinha) {
          soma += valor(inicioCampo, buf[i - 1] === CR ? i - 1 : i);
        }
        if (!primeiraLinha) linhas++;
        primeiraLinha = false;
      }
      coluna = 0; inicioCampo = i + 1;
      if (c === CR && buf[i + 1] === LF) { i++; inicioCampo = i + 1; }
    }
  }
  return { soma, linhas };
}

async function main(): Promise<void> {
  await mkdir(DIR_RAW, { recursive: true });
  const destino = new URL("perfil_eleitorado_2026.zip", DIR_RAW);

  let bytes: Buffer;
  try {
    bytes = await readFile(destino);
    console.log(`usando pacote já baixado (${(bytes.length / 1024 / 1024).toFixed(0)} MB)`);
  } catch {
    console.log(`baixando ${URL_PERFIL} — 389 MB, isto demora`);
    const r = await fetch(URL_PERFIL, { headers: { Accept: "*/*" } });
    if (!r.ok) throw new Error(`TSE respondeu ${r.status}. Use fetch do Node, não curl.`);
    bytes = Buffer.from(await r.arrayBuffer());
    await writeFile(destino, bytes);
  }

  const sha = createHash("sha256").update(bytes).digest("hex");
  const entradas = lerZip(bytes);

  // Descobre o índice de QT_ELEITORES pelo cabeçalho, em vez de cravar 23:
  // se o TSE mudar o layout, o certo é falhar alto, não somar a coluna errada.
  const primeira = entradas.find((e) => /_[A-Z]{2}\.csv$/.test(e.nome) && !e.nome.includes("BRASIL"))!;
  const cabecalho = new TextDecoder("latin1").decode(primeira.conteudo().subarray(0, 4000)).split(/\r?\n/)[0]!;
  const colunas = cabecalho.split(";").map((c) => c.replace(/"/g, "").trim());
  const iQt = colunas.indexOf("QT_ELEITORES");
  if (iQt < 0) throw new Error(`QT_ELEITORES ausente do layout. Colunas: ${colunas.join(", ")}`);
  console.log(`QT_ELEITORES na coluna ${iQt} de ${colunas.length}`);

  const porUf: Record<string, number> = {};
  let exterior = 0;

  for (const e of entradas) {
    const m = /_([A-Z]{2})\.csv$/.exec(e.nome);
    if (!m || e.nome.includes("BRASIL")) continue;   // BRASIL tem tamanho estourado; somamos por UF
    const uf = m[1]!;
    const { soma, linhas } = somarColuna(e.conteudo(), iQt);
    if (uf === "ZZ") exterior = soma;
    else porUf[uf] = soma;
    console.log(`  ${uf} ${soma.toLocaleString("pt-BR").padStart(12)} eleitores (${linhas.toLocaleString("pt-BR")} linhas)`);
  }

  const totalUf = Object.values(porUf).reduce((a, b) => a + b, 0);
  const saida = {
    geradoEm: new Date().toISOString(),
    fonte: {
      nome: "TSE — Portal de Dados Abertos, dataset eleitorado-2026, perfil do eleitorado",
      url: URL_PERFIL,
      licenca: "Creative Commons Atribuição (CC-BY)",
      sha256: sha,
    },
    observacao:
      "Soma de QT_ELEITORES nos arquivos por UF. O consolidado BRASIL.csv não foi usado: " +
      "o ZIP declara tamanho estourado de 32 bits para ele.",
    ufs: Object.fromEntries(Object.entries(porUf).sort(([a], [b]) => a.localeCompare(b))),
    totalUf,
    exterior,
    total: totalUf + exterior,
  };

  await writeFile(new URL("eleitorado.json", DIR_BUILD), JSON.stringify(saida, null, 1) + "\n");
  console.log(`\neleitorado.json | ${Object.keys(porUf).length} UFs | ${totalUf.toLocaleString("pt-BR")} eleitores + ${exterior.toLocaleString("pt-BR")} no exterior`);
}

await main();
