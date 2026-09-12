import { test } from "node:test";
import assert from "node:assert/strict";
import { casar, indexarMandatos, normalizarNome, type Mandato } from "../scripts/lib/parlamentares.ts";

const m = (nome: string, uf: string, casa: Mandato["casa"] = "camara"): Mandato =>
  ({ casa, id: 1, nome, uf, partido: "XX" });

const cand = (nomeUrna: string, nomeCompleto: string, uf = "SP") =>
  ({ sq: "1", uf, nomeUrna, nomeCompleto });

test("acento, caixa e pontuação não impedem o casamento", () => {
  assert.equal(normalizarNome("José da Silva-Neto"), "JOSE DA SILVA NETO");
  assert.equal(normalizarNome("  ÂNGELA   MARIA  "), "ANGELA MARIA");
});

test("casa pelo nome de urna e pelo nome civil", () => {
  const i = indexarMandatos([{ m: m("Zé do Bairro", "SP"), nomeUrna: "Zé do Bairro", nomeCivil: "José Aparecido Souza" }]);
  assert.equal(casar(cand("ZE DO BAIRRO", "OUTRO NOME"), i)?.confianca, "nome-urna");
  assert.equal(casar(cand("APELIDO NOVO", "JOSE APARECIDO SOUZA"), i)?.confianca, "nome-civil");
});

test("UF diferente não casa — mandato é de um estado", () => {
  const i = indexarMandatos([{ m: m("Zé do Bairro", "SP"), nomeUrna: "Zé do Bairro" }]);
  assert.equal(casar(cand("ZE DO BAIRRO", "ZE DO BAIRRO", "RJ"), i), null);
});

test("homônimo na mesma UF vira null, não vira palpite", () => {
  const i = indexarMandatos([
    { m: m("João Silva", "SP"), nomeUrna: "João Silva" },
    { m: m("João Silva", "SP", "senado"), nomeUrna: "João Silva" },
  ]);
  assert.ok(i.ambiguos.size > 0);
  assert.equal(casar(cand("JOAO SILVA", "JOAO SILVA"), i), null, "ambiguidade não pode virar vínculo errado");
});

test("quem não tem mandato simplesmente não casa", () => {
  const i = indexarMandatos([{ m: m("Zé do Bairro", "SP"), nomeUrna: "Zé do Bairro" }]);
  assert.equal(casar(cand("ESTREANTE QUALQUER", "ESTREANTE QUALQUER"), i), null);
});

test("candidato a presidente casa sem UF — o mandato é de um estado, a candidatura não", () => {
  const i = indexarMandatos([{ m: m("Fulano de Tal", "RJ", "senado"), nomeUrna: "Fulano de Tal", nomeCivil: "Fulano de Tal Silva" }]);
  const pres = { sq: "9", uf: "BR", nomeUrna: "FULANO DE TAL", nomeCompleto: "FULANO DE TAL SILVA" };
  assert.equal(casar(pres, i)?.mandato.casa, "senado", "exigir UF igual descartaria quem disputa o Planalto");
  assert.equal(casar({ ...pres, nomeUrna: "OUTRO", nomeCompleto: "OUTRO" }, i), null);
});
