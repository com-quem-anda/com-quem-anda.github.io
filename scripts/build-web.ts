/**
 * Monta os dados que o site consome.
 *
 * O front não lê data/build direto: aqueles JSONs carregam campos que a tela
 * não usa (nome completo, coligação, situação) e somam 12 MB. Aqui eles viram
 * uma forma compacta, em arrays posicionais, servida em dois pedaços:
 *
 *   web/dados/base.json      grafo + eleitorado + malha + presidentes
 *   web/dados/uf/<UF>.json   candidatos daquela UF, carregado sob demanda
 *
 * Assim abrir o site custa a base mais um estado, e não o país inteiro.
 *
 * Uso: node scripts/build-web.ts
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { ArquivoCargo, Candidato } from "./lib/types.ts";

const DIR_BUILD = new URL("../data/build/", import.meta.url);
const DIR_WEB = new URL("../web/dados/", import.meta.url);

const ler = async (p: string) => JSON.parse(await readFile(new URL(p, DIR_BUILD), "utf8"));

/**
 * [numero, nomeUrna, partido, mandato, vinculados?]
 *
 * A posição de `mandato` é a mesma nos dois formatos de propósito: já houve
 * bug aqui por índice que mudava de significado conforme o cargo.
 * mandato: 0 sem mandato, "CD" deputado federal, "SF" senador.
 */
type Mandatos = Record<string, { casa: string }>;
/**
 * Vice e suplentes, sem repetir a mesma pessoa.
 *
 * Candidatura duplicada no pacote do TSE faz o mesmo suplente aparecer duas
 * vezes — apareceu na cédula impressa de um usuário, com "1º suplente: MEDON"
 * listado em duplicata. O dado bruto continua intacto em data/build e a
 * anomalia segue declarada em meta.json; o que se colapsa aqui é só a
 * exibição, e apenas quando papel, nome e partido são idênticos.
 */
const vinculados = (c: Candidato) => {
  const vistos = new Set<string>();
  const saida: string[][] = [];
  for (const v of [...(c.vice ?? []), ...(c.suplentes ?? [])]) {
    const chave = `${v.cargo}|${v.nomeUrna}|${v.partido.sigla}`;
    if (vistos.has(chave)) { duplicadosColapsados++; continue; }
    vistos.add(chave);
    saida.push([v.cargo, v.nomeUrna, v.partido.sigla]);
  }
  return saida;
};
const mandato = (c: Candidato, m: Mandatos) =>
  m[c.sq] ? (m[c.sq]!.casa === "senado" ? "SF" : "CD") : 0;
const majoritario = (c: Candidato, m: Mandatos) => [c.numero, c.nomeUrna, c.partido.sigla, mandato(c, m), vinculados(c)];
const proporcional = (c: Candidato, m: Mandatos) => [c.numero, c.nomeUrna, c.partido.sigla, mandato(c, m), 0];

/**
 * A mesma candidatura aparece mais de uma vez no pacote do TSE.
 *
 * São 16 pessoas no país com dois registros de mesmo número, nome e partido —
 * anomalia que o pipeline declara desde o M1. Na lista de escolha isso virava
 * duas linhas idênticas e indistinguíveis, que é confusão e não transparência.
 *
 * Aqui a lista mostra a pessoa uma vez e carrega quantos registros existem, no
 * índice 5. A tela usa isso para AVISAR o eleitor — a duplicidade é informação
 * que interessa a quem vai votar, não sujeira a varrer para baixo do tapete.
 * O dado bruto em data/build continua com as duas linhas, e meta.json continua
 * declarando a anomalia.
 */
function colapsarDuplicatas(linhas: (string | number | string[][])[][]): (string | number | string[][])[][] {
  const porChave = new Map<string, (string | number | string[][])[]>();
  for (const l of linhas) {
    const chave = `${l[0]}|${l[1]}|${l[2]}`;
    const ja = porChave.get(chave);
    if (ja) { ja[5] = ((ja[5] as number) ?? 1) + 1; duplicadasColapsadas++; continue; }
    porChave.set(chave, l);
  }
  return [...porChave.values()];
}

let duplicadosColapsados = 0;
let duplicadasColapsadas = 0;

async function main(): Promise<void> {
  await mkdir(new URL("uf/", DIR_WEB), { recursive: true });

  const meta = await ler("meta.json");
  const grafo = await ler("alianca.json");
  const eleitorado = await ler("eleitorado.json");
  const malha = await ler("malha-uf.json");
  let pautas: unknown = null;
  try { pautas = await ler("pautas-posicoes.json"); }
  catch { console.log("AVISO pautas-posicoes.json ausente — rode `npm run pautas`"); }
  let itensPautas: unknown = null;
  try { itensPautas = JSON.parse(await readFile(new URL("pautas/itens.json", import.meta.url), "utf8")); }
  catch { /* opcional */ }

  let parlamentares: { vinculos: Mandatos; comMandato: number; fontes: unknown[]; metodo: string } | null = null;
  try { parlamentares = await ler("parlamentares.json"); }
  catch { console.log("AVISO parlamentares.json ausente — rode `npm run parlamentares`"); }
  const mand: Mandatos = parlamentares?.vinculos ?? {};

  // Só v das arestas: o site não usa n nem o intervalo, mas precisa saber quais
  // são frágeis para poder marcá-las.
  const prox: Record<string, number> = {};
  const fragil: Record<string, 1> = {};
  for (const [k, e] of Object.entries(grafo.proximidade as Record<string, { v: number; n: number }>)) {
    prox[k] = e.v;
    if (e.n < 3) fragil[k] = 1;
  }

  const ufs = (await readdir(DIR_BUILD, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^[A-Z]{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();

  const presidentes: ArquivoCargo = await ler(`${ufs[0]}/presidente.json`);

  const base = {
    versao: "0.3.0",
    fonte: {
      tse: { sha256: meta.fonte.sha256, url: meta.fonte.url, geradoEm: meta.geradoEm },
      eleitorado: { url: eleitorado.fonte.url, geradoEm: eleitorado.geradoEm, sha256: eleitorado.fonte.sha256 },
      ibge: { url: malha.fonte.url, geradoEm: malha.geradoEm },
    },
    eleicao: presidentes.eleicao,
    grafo: {
      conjuntos: grafo.conjuntos,
      partidos: grafo.partidos,
      federacao: grafo.federacao,
      prox,
      fragil,
      metodo: grafo.metodo,
    },
    eleitorado: { ufs: eleitorado.ufs, total: eleitorado.total, exterior: eleitorado.exterior },
    malha: { type: malha.type, features: malha.features },
    presidentes: colapsarDuplicatas(presidentes.candidatos.map((c) => majoritario(c, mand))),
    mandatos: parlamentares
      ? { comMandato: parlamentares.comMandato, fontes: parlamentares.fontes, metodo: parlamentares.metodo }
      : null,
    pautas,
    itensPautas,
    anomalias: meta.anomalias.length,
    ufsDisponiveis: ufs,
  };

  await writeFile(new URL("base.json", DIR_WEB), JSON.stringify(base));

  let maior = 0;
  for (const uf of ufs) {
    const arqs = await readdir(new URL(`${uf}/`, DIR_BUILD));
    const pega = async (cargo: string) => {
      if (!arqs.includes(`${cargo}.json`)) return null;
      return (await ler(`${uf}/${cargo}.json`)) as ArquivoCargo;
    };
    const gov = await pega("governador");
    const sen = await pega("senador");
    const df = await pega("deputado-federal");
    const de = (await pega("deputado-estadual")) ?? (await pega("deputado-distrital"));

    const dados = {
      uf,
      distrital: de?.cargo === "deputado-distrital",
      gov: colapsarDuplicatas((gov?.candidatos ?? []).map((c) => majoritario(c, mand))),
      sen: colapsarDuplicatas((sen?.candidatos ?? []).map((c) => majoritario(c, mand))),
      df: colapsarDuplicatas((df?.candidatos ?? []).map((c) => proporcional(c, mand))),
      de: colapsarDuplicatas((de?.candidatos ?? []).map((c) => proporcional(c, mand))),
    };
    const txt = JSON.stringify(dados);
    maior = Math.max(maior, txt.length);
    await writeFile(new URL(`uf/${uf}.json`, DIR_WEB), txt);
  }

  const baseKb = JSON.stringify(base).length / 1024;
  if (duplicadasColapsadas > 0) {
    console.log(`AVISO  ${duplicadasColapsadas} candidaturas repetidas colapsadas na lista, marcadas com o número de registros — anomalia segue declarada em meta.json`);
  }
  if (duplicadosColapsados > 0) {
    console.log(`AVISO  ${duplicadosColapsados} vinculados repetidos colapsados na exibição — reflexo de candidatura duplicada no pacote do TSE, que segue declarada em meta.json`);
  }
  console.log(`base.json ${baseKb.toFixed(0)} KB | ${ufs.length} arquivos de UF, maior ${(maior / 1024).toFixed(0)} KB`);
  console.log(`abrir o site em SP custa ~${(baseKb + maior / 1024).toFixed(0)} KB sem compressão`);
}

await main();
