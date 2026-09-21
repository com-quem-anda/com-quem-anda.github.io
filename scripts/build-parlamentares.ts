/**
 * Quem, entre os candidatos de 2026, tem mandato em exercício hoje.
 *
 * Fontes oficiais e abertas: a API da Câmara e a do Senado. Nada aqui depende
 * de terceiro nem de acordo de uso — é o que permite mostrar "tem mandato" já,
 * e é também a chave de junção que qualquer nota externa de desempenho exigiria
 * antes de poder ser exibida ao lado do candidato certo.
 *
 * Fora do cron diário: composição de bancada muda em semanas, não em horas.
 *
 * Uso: node scripts/build-parlamentares.ts
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { casar, indexarMandatos, type Mandato } from "./lib/parlamentares.ts";
import type { ArquivoCargo } from "./lib/types.ts";

const DIR_BUILD = new URL("../data/build/", import.meta.url);
const API_CAMARA = "https://dadosabertos.camara.leg.br/api/v2/deputados";
const API_SENADO = "https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json";

async function camara(): Promise<{ m: Mandato; nomeUrna: string }[]> {
  const saida: { m: Mandato; nomeUrna: string }[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await fetch(`${API_CAMARA}?itens=100&pagina=${pagina}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Câmara respondeu ${r.status}`);
    const j = (await r.json()) as { dados: { id: number; nome: string; siglaUf: string; siglaPartido: string }[] };
    for (const d of j.dados) {
      saida.push({ m: { casa: "camara", id: d.id, nome: d.nome, uf: d.siglaUf, partido: d.siglaPartido }, nomeUrna: d.nome });
    }
    if (j.dados.length < 100) break;
  }
  return saida;
}

async function senado(): Promise<{ m: Mandato; nomeUrna: string; nomeCivil?: string }[]> {
  const r = await fetch(API_SENADO, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Senado respondeu ${r.status}`);
  const j = (await r.json()) as {
    ListaParlamentarEmExercicio?: { Parlamentares?: { Parlamentar?: { IdentificacaoParlamentar?: Record<string, string> }[] } };
  };
  const lista = j.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ?? [];
  return lista.map((p) => {
    const i = p.IdentificacaoParlamentar ?? {};
    return {
      m: { casa: "senado" as const, id: null, nome: i["NomeParlamentar"] ?? "", uf: i["UfParlamentar"] ?? "", partido: i["SiglaPartidoParlamentar"] ?? "" },
      nomeUrna: i["NomeParlamentar"] ?? "",
      nomeCivil: i["NomeCompletoParlamentar"],
    };
  });
}

/**
 * Composição do Congresso hoje, por partido.
 *
 * Não confundir com o `n` do gráfico de posições: aquele conta deputados que
 * entraram na análise de votação nominal (presentes em metade das votações
 * divididas), e é uma amostra. Este conta a bancada inteira das duas casas,
 * que é o que alguém quer saber ao perguntar "qual o tamanho desse partido".
 *
 * Sai das mesmas listas oficiais já buscadas para casar mandato — 513
 * deputados e 81 senadores — então não custa requisição nenhuma a mais.
 */
function composicaoAtual(
  dep: { m: Mandato }[],
  sen: { m: Mandato }[],
): Record<string, { camara: number; senado: number; total: number; pct: number }> {
  const acc: Record<string, { camara: number; senado: number; total: number; pct: number }> = {};
  const somar = (sigla: string, casa: "camara" | "senado") => {
    const k = sigla.trim().toUpperCase();
    if (!k) return;
    acc[k] ??= { camara: 0, senado: 0, total: 0, pct: 0 };
    acc[k]![casa] += 1;
    acc[k]!.total += 1;
  };
  for (const d of dep) somar(d.m.partido, "camara");
  for (const s of sen) somar(s.m.partido, "senado");

  const congresso = dep.length + sen.length;
  for (const v of Object.values(acc)) v.pct = Number(((100 * v.total) / congresso).toFixed(2));

  const soma = Object.values(acc).reduce((t, v) => t + v.total, 0);
  if (soma !== congresso) {
    throw new Error(`composição perdeu parlamentar: ${soma} somados contra ${congresso} buscados`);
  }
  return acc;
}

async function main(): Promise<void> {
  const dep = await camara();
  const sen = await senado();
  console.log(`Câmara ${dep.length} deputados | Senado ${sen.length} senadores`);
  if (dep.length < 400 || sen.length < 60) throw new Error("bancada implausivelmente pequena — API mudou ou veio incompleta");

  const indice = indexarMandatos([...dep, ...sen]);
  if (indice.ambiguos.size > 0) console.log(`  ${indice.ambiguos.size} nomes ambíguos dentro da mesma UF — não serão casados`);

  const meta = JSON.parse(await readFile(new URL("meta.json", DIR_BUILD), "utf8")) as { ufs: string[] };
  const vinculos: Record<string, { casa: string; id: number | null; uf: string; partidoAtual: string; confianca: string }> = {};
  const porCargo: Record<string, number> = {};
  let total = 0;

  for (const uf of meta.ufs) {
    for (const nome of await readdir(new URL(`${uf}/`, DIR_BUILD))) {
      if (!nome.endsWith(".json")) continue;
      const a = JSON.parse(await readFile(new URL(`${uf}/${nome}`, DIR_BUILD), "utf8")) as ArquivoCargo;
      if (a.cargo === "presidente" && uf !== meta.ufs[0]) continue;   // replicado nas 27 UFs
      for (const c of a.candidatos) {
        total++;
        const v = casar(c, indice);
        if (!v) continue;
        vinculos[c.sq] = {
          casa: v.mandato.casa, id: v.mandato.id, uf: v.mandato.uf,
          partidoAtual: v.mandato.partido, confianca: v.confianca,
        };
        porCargo[a.cargo] = (porCargo[a.cargo] ?? 0) + 1;
      }
    }
  }

  const casados = Object.keys(vinculos).length;
  const saida = {
    geradoEm: new Date().toISOString(),
    fontes: [
      { nome: "Câmara dos Deputados — Dados Abertos, deputados em exercício", url: API_CAMARA, registros: dep.length },
      { nome: "Senado Federal — Dados Abertos, parlamentares em exercício", url: API_SENADO, registros: sen.length },
    ],
    metodo:
      "Casamento por nome normalizado (sem acento, sem pontuação, em maiúsculas) mais UF, " +
      "testando nome de urna e nome completo. Homônimo dentro da mesma UF não é casado: " +
      "vínculo errado é pior que vínculo ausente.",
    /**
     * Deliberadamente vazio. É aqui que entraria uma avaliação externa de
     * desempenho — do Ranking dos Políticos ou de quem for — depois de
     * autorização expressa do detentor. Enquanto não houver, fica vazio, e a
     * interface mostra ausência como ausência. O robots.txt do ranking.org.br
     * hoje proíbe acesso automatizado a /api/, e não há termos de reuso publicados.
     */
    desempenho: {} as Record<string, unknown>,
    totalCandidaturas: total,
    comMandato: casados,
    porCargoDisputado: porCargo,
    composicao: composicaoAtual(dep, sen),
    vinculos,
  };

  await writeFile(new URL("parlamentares.json", DIR_BUILD), JSON.stringify(saida, null, 1) + "\n");
  console.log(`parlamentares.json | ${casados} de ${total} candidaturas têm mandato (${((100 * casados) / total).toFixed(2)}%)`);
  console.log(`  ${((100 * casados) / (dep.length + sen.length)).toFixed(0)}% dos parlamentares em exercício estão concorrendo`);
  console.log(`  por cargo disputado: ${Object.entries(porCargo).map(([c, n]) => `${c}=${n}`).join(" ")}`);
}

await main();
