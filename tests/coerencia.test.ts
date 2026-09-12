import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alavancagem, coerencia, distribuicaoNula, integridadeChapa, percentil, type Escolha,
} from "../scripts/lib/coerencia.ts";
import { chaveAresta, type GrafoAlianca } from "../scripts/lib/alianca.ts";

/** Grafo sintético: A e B aliados fortes, C e D isolados de todos, E federado com A. */
const g: GrafoAlianca = {
  conjuntos: 10,
  partidos: ["A", "B", "C", "D", "E"],
  aparicoes: { A: 10, B: 10, C: 10, D: 10, E: 10 },
  federacao: { A: "A/E", E: "A/E" },
  proximidade: {
    [chaveAresta("A", "B")]: { v: 0.8, n: 8, ic: [0.7, 0.9] },
    [chaveAresta("B", "C")]: { v: 0.2, n: 2, ic: [0.05, 0.4] },
  },
};

const esc = (cargo: string, partido: string, nome = partido): Escolha =>
  ({ cargo, sq: `${cargo}-${partido}`, nomeUrna: nome, partido });

test("coerência é a proximidade média entre todos os pares de votos", () => {
  // A~B = 0.8, A~C = 0, B~C = 0.2  ->  média = 1.0/3
  assert.equal(coerencia(["A", "B", "C"], g), 1 / 3);
});

test("federação entra como 1 mesmo sem aresta registrada", () => {
  assert.equal(coerencia(["A", "E"], g), 1);
});

test("um voto só não tem coerência, e isso é null e não zero", () => {
  assert.equal(coerencia(["A"], g), null, "zero afirmaria incoerência onde não há o que comparar");
});

test("a alavancagem aponta o voto dissonante, não o minoritário", () => {
  const r = alavancagem([esc("presidente", "A"), esc("governador", "B"), esc("senador", "D")], g);
  assert.equal(r[0]!.escolha.partido, "D", "tirar D deixa A~B=0.8 sozinho, que é o maior salto");
  assert.ok(r[0]!.delta > 0);
  assert.ok(r.at(-1)!.delta <= r[0]!.delta, "vem ordenado do mais dissonante para o menos");
});

test("com poucas combinações a distribuição nula é enumerada, sem sorteio", () => {
  const n = distribuicaoNula({ presidente: ["A", "B"], governador: ["A", "C"] }, g);
  assert.equal(n.exata, true);
  assert.equal(n.combinacoes, 4);
  // (A,A)=1 · (A,C)=0 · (B,A)=0.8 · (B,C)=0.2
  assert.deepEqual(n.valores, [0, 0.2, 0.8, 1]);
});

test("o senador conta como dois votos do mesmo eleitor", () => {
  // C(3,2) = 3 combinações de senador, x 1 presidente
  const n = distribuicaoNula({ presidente: ["A"], senador: ["A", "B", "C"] }, g);
  assert.equal(n.combinacoes, 3);
  assert.equal(n.valores.length, 3);
});

test("o Monte Carlo é determinístico — mesmo pacote, mesmo percentil", () => {
  // Acima de LIMITE_EXATO a enumeração é inviável e o sorteio entra no lugar:
  // 1000 x 1000 x 3 combinações é o cenário real de deputado federal + estadual.
  const gerar = (n: number) => Array.from({ length: n }, (_, i) => "ABCD"[i % 4]!);
  const pools = { "deputado-estadual": gerar(1000), "deputado-federal": gerar(1000), governador: ["A", "B", "C"] };
  const a = distribuicaoNula(pools, g, { sorteios: 500 });
  const b = distribuicaoNula(pools, g, { sorteios: 500 });
  assert.equal(a.exata, false);
  assert.deepEqual(a.valores, b.valores);
});

test("o percentil conta o que está estritamente abaixo", () => {
  const n = { valores: [0, 0.1, 0.2, 0.3], exata: true, combinacoes: 4 };
  assert.equal(percentil(n, 0), 0, "o mínimo não supera ninguém");
  assert.equal(percentil(n, 0.25), 75);
  assert.equal(percentil(n, 0.3), 75, "empate não conta como superação");
});

test("suplente de outro partido é sinalizado, e suplente da federação não", () => {
  const r = integridadeChapa({
    partido: { sigla: "A" },
    suplentes: [
      { nomeUrna: "MESMO", cargo: "1º SUPLENTE", partido: { sigla: "A" } },
      { nomeUrna: "FEDERADO", cargo: "2º SUPLENTE", partido: { sigla: "E" } },
      { nomeUrna: "ESTRANHO", cargo: "2º SUPLENTE", partido: { sigla: "D" } },
    ],
  }, g);
  assert.deepEqual(r.map((v) => v.relacao), ["mesmo-partido", "mesma-federacao", "sem-alianca"]);
  assert.equal(r[2]!.proximidade, 0);
});
