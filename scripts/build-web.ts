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

/** [numero, nomeUrna, partido, vinculados] — vinculados só nos majoritários. */
const vinculados = (c: Candidato) =>
  [...(c.vice ?? []), ...(c.suplentes ?? [])].map((v) => [v.cargo, v.nomeUrna, v.partido.sigla]);
const majoritario = (c: Candidato) => [c.numero, c.nomeUrna, c.partido.sigla, vinculados(c)];
const proporcional = (c: Candidato) => [c.numero, c.nomeUrna, c.partido.sigla];

async function main(): Promise<void> {
  await mkdir(new URL("uf/", DIR_WEB), { recursive: true });

  const meta = await ler("meta.json");
  const grafo = await ler("alianca.json");
  const eleitorado = await ler("eleitorado.json");
  const malha = await ler("malha-uf.json");

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
    presidentes: presidentes.candidatos.map(majoritario),
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
      gov: (gov?.candidatos ?? []).map(majoritario),
      sen: (sen?.candidatos ?? []).map(majoritario),
      df: (df?.candidatos ?? []).map(proporcional),
      de: (de?.candidatos ?? []).map(proporcional),
    };
    const txt = JSON.stringify(dados);
    maior = Math.max(maior, txt.length);
    await writeFile(new URL(`uf/${uf}.json`, DIR_WEB), txt);
  }

  const baseKb = JSON.stringify(base).length / 1024;
  console.log(`base.json ${baseKb.toFixed(0)} KB | ${ufs.length} arquivos de UF, maior ${(maior / 1024).toFixed(0)} KB`);
  console.log(`abrir o site em SP custa ~${(baseKb + maior / 1024).toFixed(0)} KB sem compressão`);
}

await main();
