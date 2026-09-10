import { test } from "node:test";
import assert from "node:assert/strict";
import { processarUf, zerarContadoresSituacao, type Linha } from "../scripts/lib/normalizar.ts";
import type { Anomalia } from "../scripts/lib/types.ts";

/** Linha mínima com as colunas que o normalizador lê. */
function linha(p: Partial<Linha> & { CD_CARGO: string; NR_CANDIDATO: string; SQ_CANDIDATO: string }): Linha {
  return {
    DS_CARGO: "CARGO", NM_CANDIDATO: "NOME COMPLETO", NM_URNA_CANDIDATO: "NOME URNA",
    NM_SOCIAL_CANDIDATO: "#NULO#", NR_CPF_CANDIDATO: "00000000000",
    SG_PARTIDO: "XX", NR_PARTIDO: "99", NM_PARTIDO: "PARTIDO XX",
    SG_FEDERACAO: "#NULO#", NM_FEDERACAO: "#NULO#", DS_COMPOSICAO_FEDERACAO: "#NULO#",
    NM_COLIGACAO: "PARTIDO ISOLADO", DS_COMPOSICAO_COLIGACAO: "XX", SQ_COLIGACAO: "1",
    DS_SITUACAO_CANDIDATURA: "#NE", CD_SITUACAO_CANDIDATURA: "#NE",
    ...p,
  };
}

test("vice é aninhado no titular pelo número da chapa", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  const r = processarUf("SP", [
    linha({ CD_CARGO: "3", NR_CANDIDATO: "10", SQ_CANDIDATO: "1", NM_URNA_CANDIDATO: "TITULAR" }),
    linha({ CD_CARGO: "4", NR_CANDIDATO: "10", SQ_CANDIDATO: "2", NM_URNA_CANDIDATO: "VICE" }),
  ], a);

  const gov = r.get("governador")!;
  assert.equal(gov.length, 1, "vice não pode virar candidato votável");
  assert.equal(gov[0]!.vice?.length, 1);
  assert.equal(gov[0]!.vice![0]!.nomeUrna, "VICE");
  assert.deepEqual(a, [], "chapa completa não gera anomalia");
});

test("senador leva os dois suplentes, e só eles", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  const r = processarUf("SP", [
    linha({ CD_CARGO: "5", NR_CANDIDATO: "111", SQ_CANDIDATO: "1" }),
    linha({ CD_CARGO: "9", NR_CANDIDATO: "111", SQ_CANDIDATO: "2" }),
    linha({ CD_CARGO: "10", NR_CANDIDATO: "111", SQ_CANDIDATO: "3" }),
  ], a);
  assert.equal(r.get("senador")!.length, 1);
  assert.equal(r.get("senador")![0]!.suplentes?.length, 2);
  assert.deepEqual(a, []);
});

test("titular com dois vices vira anomalia, e nenhum vice é descartado (§1.3)", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  const r = processarUf("SP", [
    linha({ CD_CARGO: "3", NR_CANDIDATO: "36", SQ_CANDIDATO: "1" }),
    linha({ CD_CARGO: "4", NR_CANDIDATO: "36", SQ_CANDIDATO: "2", NM_URNA_CANDIDATO: "VICE A" }),
    linha({ CD_CARGO: "4", NR_CANDIDATO: "36", SQ_CANDIDATO: "3", NM_URNA_CANDIDATO: "VICE B" }),
  ], a);
  assert.equal(r.get("governador")![0]!.vice?.length, 2, "os dois vices continuam no arquivo");
  assert.equal(a.filter((x) => x.tipo === "vice-multiplo").length, 1);
});

test("vice sem titular correspondente é reportado como órfão", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  processarUf("SP", [
    linha({ CD_CARGO: "3", NR_CANDIDATO: "10", SQ_CANDIDATO: "1" }),
    linha({ CD_CARGO: "4", NR_CANDIDATO: "10", SQ_CANDIDATO: "2" }),
    linha({ CD_CARGO: "4", NR_CANDIDATO: "77", SQ_CANDIDATO: "9", NM_URNA_CANDIDATO: "ORFAO" }),
  ], a);
  const orfaos = a.filter((x) => x.tipo === "vinculado-orfao");
  assert.equal(orfaos.length, 1);
  assert.match(orfaos[0]!.detalhe, /ORFAO/);
});

test("mesma pessoa registrada duas vezes é reportada, não deduplicada", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  const r = processarUf("SP", [
    linha({ CD_CARGO: "6", NR_CANDIDATO: "1000", SQ_CANDIDATO: "1", NR_CPF_CANDIDATO: "11111111111" }),
    linha({ CD_CARGO: "6", NR_CANDIDATO: "1000", SQ_CANDIDATO: "2", NR_CPF_CANDIDATO: "11111111111" }),
  ], a);
  assert.equal(r.get("deputado-federal")!.length, 2, "o site não escolhe qual registro é o válido");
  assert.equal(a.filter((x) => x.tipo === "cpf-duplicado").length, 1);
  assert.equal(a.filter((x) => x.tipo === "numero-duplicado").length, 1);
});

test("ordem padrão é número na urna crescente (§1.3)", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  const r = processarUf("SP", [
    linha({ CD_CARGO: "7", NR_CANDIDATO: "80123", SQ_CANDIDATO: "1" }),
    linha({ CD_CARGO: "7", NR_CANDIDATO: "10001", SQ_CANDIDATO: "2" }),
    linha({ CD_CARGO: "7", NR_CANDIDATO: "45999", SQ_CANDIDATO: "3" }),
  ], a);
  assert.deepEqual(r.get("deputado-estadual")!.map((c) => c.numero), ["10001", "45999", "80123"]);
});

test("situação #NE vira disponivel:false, nunca 'deferido' (§0.2)", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  const r = processarUf("SP", [linha({ CD_CARGO: "3", NR_CANDIDATO: "10", SQ_CANDIDATO: "1" })], a);
  const s = r.get("governador")![0]!.situacao;
  assert.equal(s.disponivel, false);
  assert.equal(s.registro, null);
});

test("campos ausentes viram null em vez de string sentinela", () => {
  zerarContadoresSituacao();
  const a: Anomalia[] = [];
  const r = processarUf("SP", [linha({ CD_CARGO: "3", NR_CANDIDATO: "10", SQ_CANDIDATO: "1" })], a);
  const c = r.get("governador")![0]!;
  assert.equal(c.nomeSocial, null);
  assert.equal(c.federacao, null);
});
