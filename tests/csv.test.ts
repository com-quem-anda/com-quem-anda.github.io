import { test } from "node:test";
import assert from "node:assert/strict";
import { lerCsvTse, limparValor } from "../scripts/lib/csv.ts";

/** Monta um CSV como o TSE entrega: latin-1, CRLF, ";" e aspas duplas. */
function csvTse(linhas: string[]): Buffer {
  return Buffer.from(linhas.join("\r\n") + "\r\n", "latin1");
}

test("decodifica latin-1, não UTF-8", () => {
  const { linhas } = lerCsvTse(csvTse([
    '"NM_CANDIDATO";"SG_PARTIDO"',
    '"JOSÉ DA CONCEIÇÃO";"PARTIDO"',
  ]));
  assert.equal(linhas[0]!["NM_CANDIDATO"], "JOSÉ DA CONCEIÇÃO");
});

test("aspas duplicadas dentro de campo viram uma aspa", () => {
  const { linhas } = lerCsvTse(csvTse([
    '"NM_URNA_CANDIDATO"',
    '"MARIA ""PEIXINHO"" SILVA"',
  ]));
  assert.equal(linhas[0]!["NM_URNA_CANDIDATO"], 'MARIA "PEIXINHO" SILVA');
});

test("separador dentro de campo entre aspas não divide a coluna", () => {
  // O layout do TSE permite; hoje o dado não usa. O parser não pode depender disso.
  const { linhas } = lerCsvTse(csvTse([
    '"DS_COMPOSICAO_COLIGACAO";"SG_PARTIDO"',
    '"PARTIDO A; PARTIDO B";"PA"',
  ]));
  assert.equal(linhas[0]!["DS_COMPOSICAO_COLIGACAO"], "PARTIDO A; PARTIDO B");
  assert.equal(linhas[0]!["SG_PARTIDO"], "PA");
});

test("sentinelas do TSE viram null, nunca string", () => {
  for (const s of ["#NULO#", "#NE", "#NE#", "-1", "-3", "", "  "]) {
    assert.equal(limparValor(s), null, `"${s}" deveria virar null`);
  }
  assert.equal(limparValor("PT"), "PT");
  // Cuidado: "-1" é sentinela, mas um número que por acaso valha -1 em outro
  // contexto não deve passar por aqui. limparValor só se aplica a campos do TSE.
});

test("linha com contagem de campos diferente do cabeçalho falha alto", () => {
  assert.throws(
    () => lerCsvTse(csvTse(['"A";"B";"C"', '"1";"2"'])),
    /layout do TSE mudou/,
  );
});

test("CRLF e LF são aceitos, linhas vazias ignoradas", () => {
  const buf = Buffer.from('"A"\n"1"\n\n"2"\n', "latin1");
  assert.equal(lerCsvTse(buf).linhas.length, 2);
});
