/**
 * Índice de coerência da chapa — lógica pura, sem I/O.
 *
 * Três decisões de método valem ser lidas antes de mexer aqui:
 *
 * 1. O número cru não significa nada. C = 0,42 é alto ou baixo? Depende de
 *    quem estava na urna daquele estado. Por isso o que a interface mostra é
 *    a posição de C numa distribuição nula construída com o universo real de
 *    candidatos da UF — e não C, e não uma nota de 0 a 100.
 *
 * 2. Quando dá para enumerar todas as combinações possíveis, enumeramos.
 *    Só caímos em Monte Carlo (com semente fixa) quando o produto explode por
 *    causa das proporcionais. Isso mantém o resultado reproduzível: mesmo
 *    pacote do TSE, mesmo percentil, sempre.
 *
 * 3. Coerência não é virtude. Voto dividido é estratégia legítima — quem quer
 *    freio e contrapeso monta chapa dispersa de propósito. Nada nesta
 *    biblioteca chama chapa dispersa de erro, e a interface também não deve.
 */
import { proximidade, prng, type GrafoAlianca } from "./alianca.ts";

export interface Escolha {
  cargo: string;
  sq: string;
  nomeUrna: string;
  partido: string;
}

/** Proximidade média entre todos os pares de escolhas. Null com menos de duas. */
export function coerencia(partidos: string[], g: GrafoAlianca): number | null {
  if (partidos.length < 2) return null;
  let soma = 0;
  let pares = 0;
  for (let i = 0; i < partidos.length; i++) {
    for (let j = i + 1; j < partidos.length; j++) {
      soma += proximidade(g, partidos[i]!, partidos[j]!);
      pares++;
    }
  }
  return soma / pares;
}

export interface Alavancagem {
  escolha: Escolha;
  /** Quanto a coerência sobe tirando este voto. Positivo alto = voto dissonante. */
  delta: number;
}

/**
 * Deixa-um-de-fora: qual voto está puxando a chapa para longe dos outros.
 * É o análogo da distância de Cook, e é a saída de fato útil — muito mais do
 * que o agregado, que só diz "sua chapa é dispersa" sem dizer por causa de quê.
 */
export function alavancagem(escolhas: Escolha[], g: GrafoAlianca): Alavancagem[] {
  const base = coerencia(escolhas.map((e) => e.partido), g);
  if (base === null || escolhas.length < 3) return [];
  return escolhas
    .map((escolha, i) => {
      const sem = escolhas.filter((_, j) => j !== i).map((e) => e.partido);
      return { escolha, delta: (coerencia(sem, g) ?? 0) - base };
    })
    .sort((a, b) => b.delta - a.delta);
}

/** Quantos assentos cada cargo elege por eleitor — quantas vezes ele vota naquele cargo. */
export const VOTOS_POR_CARGO: Record<string, number> = {
  presidente: 1,
  governador: 1,
  // 2026 renova 2/3 do Senado, então cada eleitor vota em dois nomes. Confirmado.
  senador: 2,
  "deputado-federal": 1,
  "deputado-estadual": 1,
  "deputado-distrital": 1,
};

export const LIMITE_EXATO = 500_000;
export const SORTEIOS_MONTE_CARLO = 20_000;
export const SEMENTE_NULA = 20261004;

export interface DistribuicaoNula {
  /** Valores de C ordenados, para o percentil ser uma busca binária. */
  valores: number[];
  /** True quando todas as combinações foram enumeradas, sem sorteio. */
  exata: boolean;
  combinacoes: number;
}

/** Combinações de tamanho k, sem repetição, dentro de um cargo. */
function combinacoes<T>(itens: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > itens.length) return [];
  const saida: T[][] = [];
  const passo = (inicio: number, atual: T[]) => {
    if (atual.length === k) { saida.push([...atual]); return; }
    for (let i = inicio; i < itens.length; i++) {
      atual.push(itens[i]!);
      passo(i + 1, atual);
      atual.pop();
    }
  };
  passo(0, []);
  return saida;
}

const binom = (n: number, k: number): number => {
  if (k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
};

/**
 * Distribuição de C sobre as cédulas que dava para montar naquela UF.
 *
 * `pools` traz, por cargo, o partido de cada candidato disponível — uma
 * entrada por candidatura, não por partido, porque o sorteio é sobre pessoas
 * na urna. Um partido com 400 deputados é 400 vezes mais provável, e é isso
 * mesmo que uma cédula ao acaso significa.
 */
export function distribuicaoNula(
  pools: Record<string, string[]>,
  g: GrafoAlianca,
  opcoes: { sorteios?: number; semente?: number } = {},
): DistribuicaoNula {
  const cargos = Object.keys(pools).filter((c) => (pools[c]?.length ?? 0) > 0);
  const k = (c: string) => Math.min(VOTOS_POR_CARGO[c] ?? 1, pools[c]!.length);

  let total = 1;
  for (const c of cargos) total *= binom(pools[c]!.length, k(c));

  if (total > 0 && total <= LIMITE_EXATO) {
    const valores: number[] = [];
    const porCargo = cargos.map((c) => combinacoes(pools[c]!, k(c)));
    const passo = (i: number, acc: string[]) => {
      if (i === cargos.length) {
        const v = coerencia(acc, g);
        if (v !== null) valores.push(v);
        return;
      }
      for (const combo of porCargo[i]!) passo(i + 1, [...acc, ...combo]);
    };
    passo(0, []);
    valores.sort((a, b) => a - b);
    return { valores, exata: true, combinacoes: total };
  }

  const sorteios = opcoes.sorteios ?? SORTEIOS_MONTE_CARLO;
  const aleatorio = prng(opcoes.semente ?? SEMENTE_NULA);
  const valores: number[] = [];
  for (let s = 0; s < sorteios; s++) {
    const acc: string[] = [];
    for (const c of cargos) {
      const pool = pools[c]!;
      const quantos = k(c);
      const usados = new Set<number>();
      while (usados.size < quantos) usados.add(Math.floor(aleatorio() * pool.length));
      for (const i of usados) acc.push(pool[i]!);
    }
    const v = coerencia(acc, g);
    if (v !== null) valores.push(v);
  }
  valores.sort((a, b) => a - b);
  return { valores, exata: false, combinacoes: total };
}

/** Fração da distribuição estritamente abaixo de `valor`, em 0–100. */
export function percentil(nula: DistribuicaoNula, valor: number): number {
  const v = nula.valores;
  if (v.length === 0) return 0;
  let lo = 0;
  let hi = v.length;
  while (lo < hi) {
    const meio = (lo + hi) >> 1;
    if (v[meio]! < valor) lo = meio + 1; else hi = meio;
  }
  return (100 * lo) / v.length;
}

export type RelacaoChapa = "mesmo-partido" | "mesma-federacao" | "aliado" | "sem-alianca";

export interface VinculoChapa {
  papel: string;
  nomeUrna: string;
  partido: string;
  relacao: RelacaoChapa;
  proximidade: number;
}

/**
 * Titular contra vice e suplentes.
 *
 * Não precisa de grafo para a parte que mais importa: o eleitor quase nunca
 * sabe que está elegendo junto dois suplentes de senador que podem ser de
 * outro partido. Isso está no JSON desde o M1 e nunca foi mostrado a ninguém.
 */
export function integridadeChapa(
  titular: { partido: { sigla: string }; vice?: { nomeUrna: string; cargo: string; partido: { sigla: string } }[]; suplentes?: { nomeUrna: string; cargo: string; partido: { sigla: string } }[] },
  g: GrafoAlianca,
): VinculoChapa[] {
  const p = titular.partido.sigla;
  const vinculados = [...(titular.vice ?? []), ...(titular.suplentes ?? [])];
  return vinculados.map((v) => {
    const q = v.partido.sigla;
    const prox = proximidade(g, p, q);
    const relacao: RelacaoChapa =
      q === p ? "mesmo-partido"
      : g.federacao[p] !== undefined && g.federacao[p] === g.federacao[q] ? "mesma-federacao"
      : prox > 0 ? "aliado"
      : "sem-alianca";
    return { papel: v.cargo, nomeUrna: v.nomeUrna, partido: q, relacao, proximidade: prox };
  });
}

export interface SugestaoPartido {
  partido: string;
  /** Coerência da chapa se o voto que falta for para este partido. */
  coerencia: number;
  /** Variação em relação à chapa como está hoje. */
  delta: number;
  /** Quantos candidatos deste partido existem no cargo em aberto. */
  candidatos: number;
}

/**
 * Que PARTIDO deixaria a chapa mais coesa no cargo que falta.
 *
 * Partido, e não candidato — e a distinção não é escrúpulo, é o que o dado
 * permite. π é medido entre legendas, então todos os candidatos de um mesmo
 * partido empatam exatamente, até a última casa. Ranquear pessoas aqui seria
 * inventar uma diferença que a fonte não tem, e ainda por cima pareceria
 * recomendação de voto em alguém.
 *
 * Ordena por coerência resultante. Devolve lista vazia sem nada escolhido:
 * não há com o que ser coerente.
 */
export function sugerirPartidos(
  partidosEscolhidos: string[],
  poolDoCargo: string[],
  g: GrafoAlianca,
): SugestaoPartido[] {
  if (partidosEscolhidos.length === 0 || poolDoCargo.length === 0) return [];

  const quantos = new Map<string, number>();
  for (const p of poolDoCargo) quantos.set(p, (quantos.get(p) ?? 0) + 1);

  const atual = coerencia(partidosEscolhidos, g);

  return [...quantos.entries()]
    .map(([partido, candidatos]) => {
      const c = coerencia([...partidosEscolhidos, partido], g)!;
      return { partido, coerencia: c, delta: atual === null ? 0 : c - atual, candidatos };
    })
    .sort((a, b) => b.coerencia - a.coerencia || a.partido.localeCompare(b.partido, "pt-BR"));
}
