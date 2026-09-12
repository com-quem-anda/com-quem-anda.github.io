/**
 * Grafo de proximidade entre partidos, derivado do comportamento de aliança.
 *
 * A ideia é medir afinidade sem inferir nada: dois partidos que se coligam
 * repetidamente pelo país estão próximos; os que nunca se coligam, não estão.
 * Tudo sai do próprio pacote do TSE — não há survey, não há codificação
 * editorial, não há nota atribuída por ninguém.
 *
 * O que isto NÃO é: proximidade ideológica. Coligação brasileira é parte
 * programa e parte disputa por cargo, e a literatura sobre coligações
 * inconsistentes existe justamente por causa disso. O rótulo em qualquer
 * interface tem que ser "proximidade de aliança", nunca "proximidade
 * ideológica" — a segunda é uma afirmação que este dado não sustenta.
 */
import type { Candidato } from "./types.ts";

/** Coligação só existe em eleição majoritária desde a EC 97/2017. */
export const CARGOS_COM_COLIGACAO = ["presidente", "governador", "senador"] as const;

export interface ArestaProximidade {
  /** Jaccard: conjuntos em que os dois aparecem / conjuntos em que algum aparece. */
  v: number;
  /** Quantos conjuntos contêm os dois — abaixo de 3 a estimativa é frágil. */
  n: number;
  /** Intervalo de 95% por bootstrap sobre os conjuntos. */
  ic: [number, number];
}

export interface GrafoAlianca {
  /** Conjuntos de aliança observados (coligações distintas por SQ_COLIGACAO). */
  conjuntos: number;
  partidos: string[];
  /** Em quantos conjuntos cada partido aparece. Cobertura baixa = π instável. */
  aparicoes: Record<string, number>;
  /** partido -> sigla da federação. Federação é vínculo legal de 4 anos. */
  federacao: Record<string, string>;
  /** Só as arestas com v > 0. Par ausente entre partidos conhecidos é zero observado. */
  proximidade: Record<string, ArestaProximidade>;
}

/** Chave canônica de aresta, para o par não depender da ordem. */
export const chaveAresta = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * O TSE grafa o mesmo partido de dois jeitos: "PCDOB" em SG_PARTIDO e
 * "PC do B" dentro das composições de coligação e federação. Sem canonizar,
 * o partido do candidato nunca casa com o partido do grafo e o PCDOB fica com
 * proximidade zero contra todo mundo — inclusive contra o PT, com quem tem
 * federação. O erro é silencioso, que é o que o torna perigoso; por isso o
 * validate confere a lista inteira e falha se aparecer grafia nova.
 */
const APELIDOS: Record<string, string> = {
  "PC DO B": "PCDOB",
};

export function canonizarPartido(nome: string): string {
  const t = nome.trim();
  return APELIDOS[t.toUpperCase()] ?? t;
}

/**
 * "FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL (PT / PC do B / PV) / PSB"
 * vira ["PT", "PCDOB", "PV", "PSB"]: a federação dentro da coligação é
 * expandida nos partidos que a compõem, senão ela viraria um "partido" fantasma.
 */
export function expandirComposicao(composicao: string): string[] {
  return composicao
    .replace(/FEDERAÇÃO[^(]*\(([^)]*)\)/g, "$1")
    .split("/")
    .map((s) => canonizarPartido(s))
    .filter((s) => s.length > 0);
}

export interface ConjuntosExtraidos {
  /** SQ_COLIGACAO -> partidos. Chaveado por SQ porque a coligação do presidente
   *  aparece replicada nos 27 arquivos de UF e não pode contar 27 vezes. */
  coligacoes: Map<string, Set<string>>;
  federacoes: Map<string, string[]>;
}

export function extrairConjuntos(
  candidatosPorCargo: Iterable<{ cargo: string; candidatos: Candidato[] }>,
): ConjuntosExtraidos {
  const coligacoes = new Map<string, Set<string>>();
  const federacoes = new Map<string, string[]>();

  for (const { cargo, candidatos } of candidatosPorCargo) {
    for (const c of candidatos) {
      // Federação vale de qualquer cargo: ela é registro nacional, e os
      // deputados são onde a maioria das federações aparece.
      if (c.federacao) {
        federacoes.set(c.federacao.sigla, expandirComposicao(c.federacao.composicao ?? c.federacao.sigla));
      }
      if (!(CARGOS_COM_COLIGACAO as readonly string[]).includes(cargo)) continue;
      if (!c.coligacao.sq || !c.coligacao.composicao) continue;
      coligacoes.set(c.coligacao.sq, new Set(expandirComposicao(c.coligacao.composicao)));
    }
  }

  return { coligacoes, federacoes };
}

/** Gerador determinístico — o mesmo pacote do TSE tem que dar o mesmo grafo. */
export function prng(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEMENTE_BOOTSTRAP = 20261004;  // data do pleito, para não parecer escolhida a dedo
export const REPETICOES_BOOTSTRAP = 1000;

/**
 * Monta o grafo.
 *
 * Conjunto de um partido só entra na conta: candidatura isolada é
 * comportamento de aliança — é a recusa a se aliar — e ignorá-la inflaria a
 * proximidade de quem quase sempre anda sozinho.
 */
export function montarGrafo(extraido: ConjuntosExtraidos): GrafoAlianca {
  const conjuntos = [...extraido.coligacoes.values()];
  const partidos = [...new Set(conjuntos.flatMap((s) => [...s]))].sort();
  const indice = new Map(partidos.map((p, i) => [p, i]));

  // Cada conjunto como lista de índices, para o bootstrap não refazer strings.
  const comoIndices = conjuntos.map((s) =>
    [...s].map((p) => indice.get(p)!).filter((i) => i !== undefined).sort((a, b) => a - b),
  );

  const contar = (amostra: number[]) => {
    const porPartido = new Int32Array(partidos.length);
    const porPar = new Map<number, number>();
    for (const idx of amostra) {
      const conj = comoIndices[idx]!;
      for (const i of conj) porPartido[i]!++;
      for (let a = 0; a < conj.length; a++) {
        for (let b = a + 1; b < conj.length; b++) {
          const k = conj[a]! * partidos.length + conj[b]!;
          porPar.set(k, (porPar.get(k) ?? 0) + 1);
        }
      }
    }
    return { porPartido, porPar };
  };

  const todos = comoIndices.map((_, i) => i);
  const observado = contar(todos);

  const jaccard = (c: { porPartido: Int32Array; porPar: Map<number, number> }, i: number, j: number) => {
    const inter = c.porPar.get(i * partidos.length + j) ?? 0;
    const uniao = c.porPartido[i]! + c.porPartido[j]! - inter;
    return uniao > 0 ? inter / uniao : 0;
  };

  // Bootstrap: reamostra os conjuntos com reposição. Um par que coincidiu uma
  // vez só vai mostrar intervalo largo — que é exatamente o aviso desejado.
  const aleatorio = prng(SEMENTE_BOOTSTRAP);
  const amostras: number[][] = [];
  for (let r = 0; r < REPETICOES_BOOTSTRAP; r++) {
    const a: number[] = [];
    for (let k = 0; k < todos.length; k++) a.push(Math.floor(aleatorio() * todos.length));
    amostras.push(a);
  }
  const contagens = amostras.map(contar);

  const proximidade: Record<string, ArestaProximidade> = {};
  for (let i = 0; i < partidos.length; i++) {
    for (let j = i + 1; j < partidos.length; j++) {
      const v = jaccard(observado, i, j);
      if (v === 0) continue;  // zero observado é o padrão; não ocupa espaço no diff
      const reps = contagens.map((c) => jaccard(c, i, j)).sort((x, y) => x - y);
      proximidade[chaveAresta(partidos[i]!, partidos[j]!)] = {
        v,
        n: observado.porPar.get(i * partidos.length + j) ?? 0,
        ic: [reps[Math.floor(0.025 * (reps.length - 1))]!, reps[Math.floor(0.975 * (reps.length - 1))]!],
      };
    }
  }

  const aparicoes: Record<string, number> = {};
  partidos.forEach((p, i) => { aparicoes[p] = observado.porPartido[i]!; });

  const federacao: Record<string, string> = {};
  for (const [sigla, membros] of extraido.federacoes) for (const p of membros) federacao[p] = sigla;

  return { conjuntos: conjuntos.length, partidos, aparicoes, federacao, proximidade };
}

/**
 * Proximidade entre dois partidos.
 *
 * Federação sobrepõe o Jaccard: é vínculo jurídico de quatro anos, com
 * bancada única e disciplina comum, e não um acordo que vale uma eleição.
 * Tratá-la como mais uma coligação subestimaria a única aliança que a lei
 * obriga a durar.
 */
export function proximidade(g: GrafoAlianca, a: string, b: string): number {
  if (a === b) return 1;
  const fa = g.federacao[a];
  if (fa !== undefined && fa === g.federacao[b]) return 1;
  return g.proximidade[chaveAresta(a, b)]?.v ?? 0;
}

/** True quando o par tem evidência fina demais para ser afirmado. */
export function arestaFragil(g: GrafoAlianca, a: string, b: string): boolean {
  if (a === b || (g.federacao[a] !== undefined && g.federacao[a] === g.federacao[b])) return false;
  const e = g.proximidade[chaveAresta(a, b)];
  if (!e) return false;
  return e.n < 3 || e.ic[1] - e.ic[0] > 0.5;
}
