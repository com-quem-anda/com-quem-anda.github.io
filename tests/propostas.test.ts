import { test } from "node:test";
import assert from "node:assert/strict";
import { lerNomeArquivo, urlCandidatoNoTse } from "../scripts/lib/propostas.ts";

test("nome de arquivo do pacote entrega o SQ_CANDIDATO", () => {
  assert.deepEqual(lerNomeArquivo("SP/2026SP250002549705_01.pdf"), { sq: "250002549705", sequencial: "01" });
  assert.deepEqual(lerNomeArquivo("BR/2026BR280002542548_01.pdf"), { sq: "280002542548", sequencial: "01" });
});

test("um candidato pode ter vários arquivos, e os sequenciais são distintos", () => {
  const a = lerNomeArquivo("SP/2026SP250002544912_01.pdf")!;
  const b = lerNomeArquivo("SP/2026SP250002544912_03.pdf")!;
  assert.equal(a.sq, b.sq);
  assert.notEqual(a.sequencial, b.sequencial);
});

test("leiame.pdf e nomes fora do padrão são ignorados", () => {
  assert.equal(lerNomeArquivo("SP/leiame.pdf"), null);
  assert.equal(lerNomeArquivo("SP/qualquer-coisa.pdf"), null);
  assert.equal(lerNomeArquivo("SP/2026SP250002549705_01.txt"), null);
});

test("a URL do TSE carrega o pleito certo", () => {
  assert.equal(
    urlCandidatoNoTse("6257", "BR", "280002542548"),
    "https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2026/6257/BR/280002542548",
  );
});
