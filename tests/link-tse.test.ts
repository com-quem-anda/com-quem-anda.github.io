/**
 * O link para o DivulgaCandContas foi obtido por engenharia reversa.
 *
 * O portal devolve 403 para qualquer requisição nossa (Akamai), então não há
 * como testar o link buscando a página. O que dá para fazer — e é o que este
 * arquivo faz — é travar o formato contra URLs reais, copiadas da barra de
 * endereço de um navegador. Se alguém mudar a montagem, o teste mostra a
 * diferença contra uma URL que comprovadamente abria.
 *
 * Um link quebrado aqui não derruba nada e não aparece em teste de fumaça:
 * manda o eleitor para uma página de erro do TSE, calado. Por isso o formato
 * é invariante, não detalhe de implementação.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const ler = (uf: string) =>
  JSON.parse(readFileSync(new URL(`../web/dados/uf/${uf}.json`, import.meta.url), "utf8"));

/** Mesma montagem de web/app.js. Se lá mudar, o teste abaixo acusa. */
const REGIAO: Record<string, string> = {
  SP: "SUDESTE", RN: "NORDESTE", ES: "SUDESTE", MG: "SUDESTE", RJ: "SUDESTE",
  AL: "NORDESTE", BA: "NORDESTE", CE: "NORDESTE", MA: "NORDESTE",
  PB: "NORDESTE", PE: "NORDESTE", PI: "NORDESTE", SE: "NORDESTE",
  AC: "NORTE", AP: "NORTE", AM: "NORTE", PA: "NORTE",
  RO: "NORTE", RR: "NORTE", TO: "NORTE",
  DF: "CENTRO-OESTE", GO: "CENTRO-OESTE", MT: "CENTRO-OESTE", MS: "CENTRO-OESTE",
  PR: "SUL", RS: "SUL", SC: "SUL",
};
const ID_ESTADUAL = "20322002026";
const montar = (uf: string, sq: string) =>
  `https://divulgacandcontas.tse.jus.br/divulga/#/candidato/${REGIAO[uf]}/${uf}/${ID_ESTADUAL}/${sq}/2026/${uf}`;

/** URLs copiadas da barra de endereço, com a página aberta. São a verdade. */
const REAIS = [
  { uf: "SP", cargo: "gov", nome: "TARCÍSIO",
    url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/SUDESTE/SP/20322002026/250002541303/2026/SP" },
  { uf: "SP", cargo: "gov", nome: "FERNANDO HADDAD",
    url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/SUDESTE/SP/20322002026/250002549705/2026/SP" },
  { uf: "RN", cargo: "sen", nome: "SAMANDA DE LULA",
    url: "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/NORDESTE/RN/20322002026/200002533841/2026/RN" },
];

test("a URL montada bate com as URLs reais do DivulgaCandContas", () => {
  for (const alvo of REAIS) {
    const lista = ler(alvo.uf)[alvo.cargo] as unknown[][];
    const c = lista.find((x) => x[1] === alvo.nome);
    assert.ok(c, `${alvo.nome} sumiu de ${alvo.uf}/${alvo.cargo} — o pacote do TSE mudou?`);
    const sq = c![6] as string;
    assert.equal(montar(alvo.uf, sq), alvo.url,
      `URL diferente da que comprovadamente abria para ${alvo.nome}`);
  }
});

test("o app usa o mesmo id de eleição e as mesmas regiões que o teste", () => {
  // Duas cópias do mapa divergirem é o jeito silencioso de isto quebrar:
  // o teste passaria contra si mesmo enquanto a tela monta outra coisa.
  assert.ok(app.includes(`"${ID_ESTADUAL}"`), "o id da eleição estadual mudou em app.js");
  for (const [uf, reg] of Object.entries(REGIAO)) {
    assert.match(app, new RegExp(`${uf}:\\s*"${reg}"`), `região de ${uf} diverge entre app.js e o teste`);
  }
});

test("todo candidato publicado tem sq, e presidente não ganha link", () => {
  // sq ausente vira link para /undefined/. Melhor não ter link.
  const uf = ler("SP");
  for (const [cargo, lista] of Object.entries(uf)) {
    if (!Array.isArray(lista)) continue;
    for (const c of lista as unknown[][]) {
      assert.equal(typeof c[6], "string", `candidatura sem sq em SP/${cargo}: ${c[1]}`);
      assert.match(String(c[6]), /^\d+$/, `sq não numérico em SP/${cargo}: ${c[1]}`);
    }
  }
  // Presidente é outra eleição (CD_ELEICAO 6257) e o id dela não é conhecido.
  assert.match(app, /slot === "presidente"\) return ""/,
    "app.js precisa continuar recusando link para presidente enquanto o id federal for desconhecido");
});
