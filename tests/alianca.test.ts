import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arestaFragil, canonizarPartido, chaveAresta, expandirComposicao, extrairConjuntos, montarGrafo, proximidade,
} from "../scripts/lib/alianca.ts";
import type { Candidato } from "../scripts/lib/types.ts";

/** Candidato mínimo com o que o extrator lê. */
function cand(p: { partido: string; coligacaoSq?: string; composicao?: string; federacao?: string }): Candidato {
  return {
    sq: "1", uf: "SP", cargo: "governador", numero: "10",
    nomeUrna: "X", nomeCompleto: "X", nomeSocial: null,
    partido: { sigla: p.partido, numero: "99", nome: p.partido },
    federacao: p.federacao ? { sigla: p.federacao, nome: p.federacao, composicao: p.federacao } : null,
    coligacao: { nome: null, composicao: p.composicao ?? null, sq: p.coligacaoSq ?? null },
    situacao: { disponivel: false, registro: null, codigo: null },
  } as Candidato;
}

test("federação dentro da coligação é expandida nos partidos que a compõem", () => {
  assert.deepEqual(
    expandirComposicao("FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL (PT / PC do B / PV) / PSB"),
    ["PT", "PCDOB", "PV", "PSB"],
  );
});

test("a coligação do presidente, replicada nas 27 UFs, conta uma vez só", () => {
  const replicas = Array.from({ length: 27 }, () =>
    ({ cargo: "presidente", candidatos: [cand({ partido: "PT", coligacaoSq: "MESMO_SQ", composicao: "PT / PSB" })] }));
  const { coligacoes } = extrairConjuntos(replicas);
  assert.equal(coligacoes.size, 1, "SQ_COLIGACAO é a chave justamente para isto");
});

test("cargo proporcional não gera aresta — coligação proporcional não existe desde a EC 97/2017", () => {
  const { coligacoes } = extrairConjuntos([
    { cargo: "deputado-federal", candidatos: [cand({ partido: "PT", coligacaoSq: "A", composicao: "PT" })] },
    { cargo: "deputado-estadual", candidatos: [cand({ partido: "PL", coligacaoSq: "B", composicao: "PL" })] },
  ]);
  assert.equal(coligacoes.size, 0);
});

test("federação vale 1 mesmo sem nenhuma coligação em comum", () => {
  const g = montarGrafo(extrairConjuntos([
    { cargo: "governador", candidatos: [
      cand({ partido: "PT", coligacaoSq: "A", composicao: "PT", federacao: "PT/PV" }),
      cand({ partido: "PV", coligacaoSq: "B", composicao: "PV", federacao: "PT/PV" }),
    ] },
  ]));
  assert.equal(g.proximidade[chaveAresta("PT", "PV")], undefined, "nunca se coligaram");
  assert.equal(proximidade(g, "PT", "PV"), 1, "mas a federação é vínculo legal de 4 anos");
});

test("candidatura isolada conta no denominador e derruba a proximidade", () => {
  const juntos = { cargo: "governador", candidatos: [cand({ partido: "A", coligacaoSq: "1", composicao: "A / B" })] };
  const soJuntos = montarGrafo(extrairConjuntos([juntos]));
  const comIsolada = montarGrafo(extrairConjuntos([
    juntos,
    { cargo: "senador", candidatos: [cand({ partido: "A", coligacaoSq: "2", composicao: "A" })] },
  ]));
  assert.equal(proximidade(soJuntos, "A", "B"), 1);
  assert.equal(proximidade(comIsolada, "A", "B"), 0.5, "A apareceu 2x, juntos 1x: recusar aliança é comportamento de aliança");
});

test("o mesmo pacote do TSE produz o mesmo grafo, bootstrap incluído", () => {
  const entrada = () => [{ cargo: "governador", candidatos: [
    cand({ partido: "A", coligacaoSq: "1", composicao: "A / B" }),
    cand({ partido: "C", coligacaoSq: "2", composicao: "C / B" }),
    cand({ partido: "D", coligacaoSq: "3", composicao: "D" }),
  ] }];
  assert.deepEqual(montarGrafo(extrairConjuntos(entrada())), montarGrafo(extrairConjuntos(entrada())));
});

test("aresta apoiada em uma única coincidência é marcada como frágil", () => {
  const g = montarGrafo(extrairConjuntos([
    { cargo: "governador", candidatos: [
      cand({ partido: "A", coligacaoSq: "1", composicao: "A / B" }),
      cand({ partido: "A", coligacaoSq: "2", composicao: "A" }),
      cand({ partido: "B", coligacaoSq: "3", composicao: "B" }),
    ] },
  ]));
  assert.ok(proximidade(g, "A", "B") > 0);
  assert.ok(arestaFragil(g, "A", "B"), "uma coincidência só não sustenta afirmação");
});

test("PC do B e PCDOB são o mesmo partido — sem isto, ele zera contra todo mundo", () => {
  assert.deepEqual(
    expandirComposicao("FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL (PT / PC do B / PV)"),
    ["PT", "PCDOB", "PV"],
  );
  assert.equal(canonizarPartido("pc do b"), "PCDOB", "a grafia do TSE varia no caixa");
  assert.equal(canonizarPartido("PT"), "PT", "quem não tem apelido passa intacto");
});

test("número do partido na frente do nome é removido — o TSE passou a prefixar dentro das federações", () => {
  assert.equal(canonizarPartido("13-PT"), "PT");
  assert.equal(canonizarPartido("65-PC do B"), "PCDOB", "prefixo some e o apelido ainda vale");
  assert.equal(canonizarPartido("77-SOLIDARIEDADE"), "SOLIDARIEDADE");
  assert.equal(canonizarPartido("PL"), "PL", "quem vem sem prefixo passa intacto");
  assert.deepEqual(
    expandirComposicao("FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL (13-PT / 65-PC do B / 43-PV) / PSB"),
    ["PT", "PCDOB", "PV", "PSB"],
  );
});
