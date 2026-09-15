/**
 * Monta data/build/pautas.json: as pautas do país, como os partidos votaram
 * nelas, e a posição de cada partido no eixo de votação da Câmara.
 *
 * Fora do cron diário — baixa ~200 MB de votações nominais da Câmara e roda
 * uma decomposição sobre uma matriz de 462 x 964. Legislatura não muda à noite.
 *
 * Três coisas convivem aqui, e a diferença entre elas é o ponto:
 *   - o que é MEDIDO: posição, dispersão, como cada partido votou;
 *   - o que é CITADO: as pesquisas de prioridade, com fonte e data;
 *   - o que é AUTORAL: o texto das perguntas, em scripts/pautas/itens.json.
 *
 * Uso: node --max-old-space-size=8192 scripts/build-pautas.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const DIR_BUILD = new URL("../data/build/", import.meta.url);
const DIR_RAW = new URL("../data/raw/camara/", import.meta.url);
const ANOS = [2023, 2024, 2025, 2026] as const;
const BASE = "https://dadosabertos.camara.leg.br/arquivos";

/** CSV com aspas e quebra de linha DENTRO de campo — a Câmara usa nas ementas. */
export function lerCsv(texto: string, sep = ";"): { cols: string[]; linhas: string[][] } {
  const linhas: string[][] = [];
  let campo = "", atual: string[] = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!;
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { atual.push(campo); campo = ""; }
    else if (c === "\n") { atual.push(campo); campo = ""; linhas.push(atual); atual = []; }
    else if (c !== "\r") campo += c;
  }
  if (campo || atual.length) { atual.push(campo); linhas.push(atual); }
  const cols = linhas[0]!.map((s) => s.trim());
  return { cols, linhas: linhas.slice(1).filter((l) => l.length === cols.length) };
}

async function baixar(nome: string, pasta: string): Promise<string> {
  await mkdir(DIR_RAW, { recursive: true });
  const destino = new URL(nome, DIR_RAW);
  if (existsSync(destino)) return readFile(destino, "utf8");
  const r = await fetch(`${BASE}/${pasta}/csv/${nome}`);
  if (!r.ok) throw new Error(`Câmara respondeu ${r.status} para ${nome}`);
  const t = await r.text();
  await writeFile(destino, t);
  return t;
}

/** Divididas: ao menos 100 votos Sim/Não e minoria de ao menos 5%. */
const MIN_VOTOS = 100, MIN_MINORIA = 0.05;
/** Partido só recebe posição com ao menos 3 deputados no recorte. */
export const MINIMO_DEPUTADOS = 3;

async function main(): Promise<void> {
  const votosPorDep = new Map<string, Map<string, number>>();
  /**
   * Partido ATUAL do deputado — a última legenda vista no registro.
   *
   * A escolha importa e não é neutra: quem migrou de partido durante a
   * legislatura tem o histórico inteiro de votos atribuído à legenda de agora.
   * É o certo para o uso desta ferramenta, que é dizer o que esperar de um
   * candidato de 2026 pelo partido em que ele está hoje — mas significa que
   * parte do comportamento medido é anterior à troca. O número de migrantes
   * vai no arquivo, para a conta ser conferível.
   */
  const partidoDe = new Map<string, string>();
  const partidoInicial = new Map<string, string>();
  const divididas: string[] = [];
  const contagem = new Map<string, { sim: number; nao: number }>();

  for (const ano of ANOS) {
    const W = lerCsv((await baixar(`votacoesVotos-${ano}.csv`, "votacoesVotos")).replace(/^﻿/, ""));
    const jV = W.cols.indexOf("idVotacao"), jVo = W.cols.indexOf("voto"),
          jI = W.cols.indexOf("deputado_id"), jP = W.cols.indexOf("deputado_siglaPartido");
    const tot = new Map<string, { sim: number; nao: number }>();
    for (const c of W.linhas) {
      const v = c[jVo]!.trim();
      if (v !== "Sim" && v !== "Não") continue;
      const vid = `${ano}:${c[jV]}`;
      if (!tot.has(vid)) tot.set(vid, { sim: 0, nao: 0 });
      const t = tot.get(vid)!;
      v === "Sim" ? t.sim++ : t.nao++;
      if (!votosPorDep.has(c[jI]!)) votosPorDep.set(c[jI]!, new Map());
      votosPorDep.get(c[jI]!)!.set(vid, v === "Sim" ? 1 : -1);
      partidoDe.set(c[jI]!, c[jP]!);
      if (!partidoInicial.has(c[jI]!)) partidoInicial.set(c[jI]!, c[jP]!);
    }
    for (const [vid, t] of tot) {
      const n = t.sim + t.nao;
      if (n >= MIN_VOTOS && Math.min(t.sim, t.nao) / n >= MIN_MINORIA) { divididas.push(vid); contagem.set(vid, t); }
    }
  }

  // Deputados com participação em ao menos metade das divididas.
  const deps = [...votosPorDep.keys()].filter((d) => {
    let k = 0;
    for (const v of divididas) if (votosPorDep.get(d)!.has(v)) k++;
    return k >= divididas.length * 0.5;
  });

  // Primeiro componente principal por iteração de potência, matriz centrada.
  const X = deps.map((d) => divididas.map((v) => votosPorDep.get(d)!.get(v) ?? 0));
  const mu = divididas.map((_, j) => X.reduce((a, r) => a + r[j]!, 0) / X.length);
  for (const r of X) for (let j = 0; j < r.length; j++) r[j]! -= mu[j]!;
  let w = divididas.map((_, j) => Math.sin(j * 1.7));   // início determinístico
  for (let it = 0; it < 150; it++) {
    const p = X.map((r) => r.reduce((a, x, j) => a + x * w[j]!, 0));
    const nw = divididas.map((_, j) => X.reduce((a, r, i) => a + r[j]! * p[i]!, 0));
    const n = Math.hypot(...nw);
    w = nw.map((x) => x / n);
  }
  const bruto = X.map((r) => r.reduce((a, x, j) => a + x * w[j]!, 0));
  const sd0 = Math.hypot(...bruto) / Math.sqrt(bruto.length);
  const theta = bruto.map((x) => x / sd0);

  const porPartido = new Map<string, number[]>();
  deps.forEach((d, i) => {
    const p = partidoDe.get(d)!;
    if (!porPartido.has(p)) porPartido.set(p, []);
    porPartido.get(p)!.push(theta[i]!);
  });
  const q = (a: number[], f: number) => [...a].sort((x, y) => x - y)[Math.floor(f * (a.length - 1))]!;
  const posicoes = [...porPartido.entries()]
    .filter(([, a]) => a.length >= MINIMO_DEPUTADOS)
    .map(([sigla, a]) => {
      const m = a.reduce((x, y) => x + y, 0) / a.length;
      return { sigla, mediana: q(a, 0.5), q1: q(a, 0.25), q3: q(a, 0.75), min: q(a, 0), max: q(a, 1),
               desvio: Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length), n: a.length };
    })
    .sort((a, b) => a.mediana - b.mediana);

  const abaixoDoCorte = [...porPartido.entries()]
    .filter(([, a]) => a.length < MINIMO_DEPUTADOS)
    .map(([sigla, a]) => ({ sigla, n: a.length }));

  // Como cada partido votou nos itens autorais — só para partidos com posição.
  const comPosicao = new Set(posicoes.map((p) => p.sigla));
  const idsItens = new Map<string, string>();
  const autoraisTmp = JSON.parse(await readFile(new URL("pautas/itens.json", import.meta.url), "utf8"));
  for (const it of autoraisTmp.itens) idsItens.set(`${it.ano}:${it.idVotacao}`, it.sigla);

  const porItem: Record<string, Record<string, { sim: number; nao: number }>> = {};
  for (const ano of ANOS) {
    const W = lerCsv((await baixar(`votacoesVotos-${ano}.csv`, "votacoesVotos")).replace(/^﻿/, ""));
    const jV = W.cols.indexOf("idVotacao"), jVo = W.cols.indexOf("voto"), jI = W.cols.indexOf("deputado_id");
    for (const c of W.linhas) {
      const sigla = idsItens.get(`${ano}:${c[jV]}`);
      if (!sigla) continue;
      const v = c[jVo]!.trim();
      if (v !== "Sim" && v !== "Não") continue;
      // Partido ATUAL do deputado, coerente com o resto do arquivo.
      const p = partidoDe.get(c[jI]!);
      if (!p || !comPosicao.has(p)) continue;
      ((porItem[sigla] ??= {})[p] ??= { sim: 0, nao: 0 });
      v === "Sim" ? porItem[sigla]![p]!.sim++ : porItem[sigla]![p]!.nao++;
    }
  }

  const migrantes = deps.filter((d) => partidoDe.get(d) !== partidoInicial.get(d)).length;

  const autorais = JSON.parse(await readFile(new URL("pautas/itens.json", import.meta.url), "utf8"));

  await writeFile(new URL("pautas-posicoes.json", DIR_BUILD), JSON.stringify({
    geradoEm: new Date().toISOString(),
    metodo: {
      fonte: "Câmara dos Deputados — votações nominais da 57ª legislatura, dados abertos",
      matriz: `${deps.length} deputados x ${divididas.length} votações divididas`,
      dividida: `ao menos ${MIN_VOTOS} votos Sim/Não e minoria de ao menos ${100 * MIN_MINORIA}%`,
      participacao: "deputado presente em ao menos metade das votações divididas",
      decomposicao: "primeiro componente principal, matriz centrada por votação, iteração de potência determinística",
      corte: `partido com menos de ${MINIMO_DEPUTADOS} deputados no recorte não recebe posição — média de uma ou duas pessoas não descreve uma legenda`,
      rotulo: "Isto é um eixo de VOTAÇÃO, não de ideologia. O primeiro componente numa legislatura capta alinhamento com o Executivo.",
      filiacao: "Cada deputado é contado no partido em que está hoje, não no de 2023.",
    },
    migrantes,
    deputados: deps.length,
    votacoesDivididas: divididas.length,
    posicoes,
    abaixoDoCorte,
    votosPorItem: porItem,
    autoria: autorais._leia,
  }, null, 1) + "\n");

  console.log(`pautas-posicoes.json | ${deps.length} deputados x ${divididas.length} votações`);
  console.log(`  ${migrantes} dos ${deps.length} deputados trocaram de partido durante a legislatura`);
  console.log(`  ${Object.keys(porItem).length} itens com voto por partido apurado`);
  console.log(`  ${posicoes.length} partidos com posição | ${abaixoDoCorte.length} abaixo do corte de ${MINIMO_DEPUTADOS}: ${abaixoDoCorte.map((x) => `${x.sigla}(${x.n})`).join(", ")}`);
}

await main();
