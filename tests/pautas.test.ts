/**
 * Invariantes da lista de pautas.
 *
 * O texto que descreve cada tema cita as votações NAQUELE tema — "Aqui: o
 * corte de benefícios tributários e o arcabouço fiscal". Trocar uma votação e
 * esquecer o texto não quebra nada na tela: fica uma descrição que promete uma
 * pergunta que não existe mais. Aconteceu ao substituir quatro itens de uma vez.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const base = JSON.parse(readFileSync(new URL("../web/dados/base.json", import.meta.url), "utf8"));
type Item = { tema: string; tipoVoto: string; idVotacao: string; ano: number;
              sim_votos: number; nao_votos: number; url: string };
/** O arquivo é um objeto: os itens ficam em `itens`, ao lado dos textos de autoria. */
const bruto = JSON.parse(readFileSync(new URL("../scripts/pautas/itens.json", import.meta.url), "utf8"));
const itens: Item[] = Array.isArray(bruto) ? bruto : bruto.itens;

test("os temas descritos na tela são exatamente os temas das perguntas", () => {
  const bloco = /const TEMAS_DESC = \{([\s\S]*?)\n\s*\};/.exec(app);
  assert.ok(bloco, "TEMAS_DESC não encontrado em app.js");
  const descritos = new Set([...bloco[1]!.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]!));
  const reais = new Set(itens.map((i) => i.tema));
  for (const t of reais) assert.ok(descritos.has(t), `tema "${t}" existe nas perguntas e não tem descrição`);
  for (const t of descritos) assert.ok(reais.has(t), `tema "${t}" descrito na tela não tem nenhuma pergunta`);
});

test("toda pergunta aponta para uma votação real e conferível", () => {
  for (const i of itens) {
    assert.match(i.url, /^https:\/\/www\.camara\.leg\.br\//, `URL fora da Câmara: ${i.url}`);
    assert.match(String(i.idVotacao), /^\d+-\d+$/, `idVotacao com forma estranha: ${i.idVotacao}`);
    assert.ok(i.ano >= 2023 && i.ano <= 2026, `ano fora da 57ª legislatura: ${i.ano}`);
    // Corte declarado no método: 100 votos e 5% de minoria.
    const tot = i.sim_votos + i.nao_votos;
    assert.ok(tot >= 100, `votação com menos de 100 votos: ${i.idVotacao}`);
    assert.ok(Math.min(i.sim_votos, i.nao_votos) / tot >= 0.05,
      `votação abaixo do corte de 5% de minoria: ${i.idVotacao}`);
    assert.ok(["merito", "urgencia"].includes(i.tipoVoto), `tipoVoto inválido: ${i.tipoVoto}`);
  }
});

test("a contagem publicada bate com o número de perguntas", () => {
  // base.json republica o arquivo inteiro, com os textos de autoria ao lado.
  const publicados = base.itensPautas?.itens ?? base.itensPautas ?? [];
  assert.equal(itens.length, publicados.length,
    "itens.json e o payload publicado têm contagens diferentes — faltou rodar npm run pautas?");
  assert.equal(itens.length, 12, "o site diz 'doze' em vinte lugares; mudar o número exige mudar o texto");
});
