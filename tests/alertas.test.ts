import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alertasDaCedula, type EntradaCedula } from "../src/lib/alertas.ts";
import { partidosDaColigacao } from "../src/lib/coligacao.ts";
import type { ArquivoCargo, Candidato, Cargo } from "../src/lib/tipos.ts";

const ler = (cargo: string): ArquivoCargo =>
  JSON.parse(readFileSync(new URL(`../data/build/SP/${cargo}.json`, import.meta.url), "utf8"));

const PRESIDENTES = ler("presidente").candidatos;
const GOVERNADORES = ler("governador").candidatos;
const SENADORES = ler("senador").candidatos;

const acharPorNumero = (lista: Candidato[], n: string): Candidato => {
  const c = lista.find((x) => x.numero === n);
  if (!c) throw new Error(`número ${n} não encontrado na fixture`);
  return c;
};

/** Cédula completa, para os testes isolarem um alerta por vez. */
function cedula(p: Partial<Record<number, Candidato>>): EntradaCedula[] {
  const cargos: Cargo[] = ["deputado-estadual", "deputado-federal", "senador", "senador", "governador", "presidente"];
  return cargos.map((cargo, slot) => ({ slot, cargo, candidato: p[slot] ?? null }));
}

test("composição de coligação: federação entrega os integrantes, não o nome", () => {
  const s = partidosDaColigacao("PDT / PSB / FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL (PT / PC do B / PV)");
  assert.equal(s.has("PT"), true);
  assert.equal(s.has("PDT"), true);
  assert.equal([...s].some((x) => x.startsWith("FEDERAÇÃO")), false, "nome de federação não é partido");
});

test("presidente e governador em campos opostos: alerta com dado real", () => {
  const lula = acharPorNumero(PRESIDENTES, "13");
  const tarcisio = acharPorNumero(GOVERNADORES, "10");
  const a = alertasDaCedula(cedula({ 4: tarcisio, 5: lula }), { presidente: PRESIDENTES });
  const adv = a.find((x) => x.tipo === "coligacao-adversaria");

  assert.ok(adv, "a coligação de Tarcísio inclui PL, que lança candidato a presidente");
  assert.match(adv.detalhe, /PL/);
  assert.equal(adv.gravidade, "alerta");
});

test("chapa alinhada não gera alerta de coligação", () => {
  const lula = acharPorNumero(PRESIDENTES, "13");
  const haddad = acharPorNumero(GOVERNADORES, "13");
  const a = alertasDaCedula(cedula({ 4: haddad, 5: lula }), { presidente: PRESIDENTES });
  assert.equal(a.find((x) => x.tipo === "coligacao-adversaria"), undefined);
});

test("governador de partido isolado sem rival na coligação não gera alerta", () => {
  // PCO lança governadora e presidente; a coligação é "PCO" e não abriga rival.
  const pco = acharPorNumero(PRESIDENTES, "29");
  const izadora = acharPorNumero(GOVERNADORES, "29");
  const a = alertasDaCedula(cedula({ 4: izadora, 5: pco }), { presidente: PRESIDENTES });
  assert.equal(a.find((x) => x.tipo === "coligacao-adversaria"), undefined);
});

test("mesmo senador nas duas vagas é alertado", () => {
  const s = SENADORES[0]!;
  const a = alertasDaCedula(cedula({ 2: s, 3: s }), {});
  const rep = a.find((x) => x.tipo === "senado-repetido");
  assert.ok(rep);
  assert.equal(rep.gravidade, "alerta");
});

test("senadores diferentes nas duas vagas não alertam", () => {
  const a = alertasDaCedula(cedula({ 2: SENADORES[0]!, 3: SENADORES[1]! }), {});
  assert.equal(a.find((x) => x.tipo === "senado-repetido"), undefined);
});

test("cédula vazia lista os cargos que faltam, sem quebrar", () => {
  const a = alertasDaCedula(cedula({}), {});
  const vazio = a.find((x) => x.tipo === "cargo-vazio");
  assert.ok(vazio);
  assert.match(vazio.titulo, /6 votos/);
});

test("candidatura com registro duplicado no TSE é sinalizada ao eleitor", () => {
  const s = SENADORES[0]!;
  const a = alertasDaCedula(cedula({ 2: s }), {}, new Set([s.sq]));
  assert.ok(a.find((x) => x.tipo === "candidatura-anomala"));
});

test("situação indisponível é informada, não silenciada (§0.2)", () => {
  const a = alertasDaCedula(cedula({ 5: PRESIDENTES[0]! }), {});
  const s = a.find((x) => x.tipo === "situacao-indisponivel");
  assert.ok(s, "enquanto o TSE publicar #NE, a interface tem que dizer isso");
  assert.equal(s.gravidade, "informacao");
});

test("proposta só é anexada a cargo majoritário, e só com fonte", () => {
  const comProposta = PRESIDENTES.filter((c) => c.proposta);
  assert.equal(comProposta.length, PRESIDENTES.length, "todos os 13 presidentes registraram proposta");

  const gov = GOVERNADORES.filter((c) => c.proposta);
  assert.ok(gov.length < GOVERNADORES.length, "há governador sem proposta, e isso tem que aparecer como ausência");

  // Senador não registra proposta — verificado contra o pacote oficial de 2026.
  assert.equal(SENADORES.filter((c) => c.proposta).length, 0);
});

test("o link da proposta usa o código de eleição do próprio pleito", () => {
  // Federal é 6257, estadual de SP é 6259. Trocar os dois quebra o link no TSE.
  const lula = acharPorNumero(PRESIDENTES, "13");
  assert.match(lula.proposta!.urlTse, /\/2026\/6257\/BR\/280002542548$/);

  const haddad = acharPorNumero(GOVERNADORES, "13");
  assert.match(haddad.proposta!.urlTse, /\/2026\/6259\/SP\/250002549705$/);
});

test("nenhuma proposta é servida pelo próprio site", () => {
  // O produto liga para o TSE; não republica o documento (§3.3, §12 nº 3).
  for (const c of [...PRESIDENTES, ...GOVERNADORES].filter((x) => x.proposta)) {
    assert.match(c.proposta!.urlTse, /^https:\/\/divulgacandcontas\.tse\.jus\.br\//);
  }
});
