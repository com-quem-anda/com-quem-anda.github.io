/**
 * Invariantes dos workflows, porque erro aqui não aparece na tela.
 *
 * Um workflow com permissão a mais não quebra nada visível: só amplia o
 * estrago possível no dia em que alguém enviar um PR malicioso. Não há teste
 * de fumaça que pegue isso, e revisão de YAML cansa.
 *
 * O que importa não é "nenhuma escrita em lugar nenhum" — publicar.yml precisa
 * escrever no Pages e só roda em push na main, onde não há código de estranho.
 * O que importa é: workflow que UM ESTRANHO CONSEGUE DISPARAR não pode dar
 * escrita ampla ao código que ele enviou.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("../.github/workflows/", import.meta.url);
const arquivos = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

/** Sem comentários: este arquivo fala de pull_request_target para explicá-lo. */
const semComentarios = (txt: string) =>
  txt.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

/** Só o bloco `on:`, para não confundir gatilho com menção no corpo. */
function gatilhos(txt: string): string {
  const m = /^on:\n((?:[ \t]+.*\n|\n)*)/m.exec(semComentarios(txt));
  return m?.[1] ?? "";
}

test("nenhum workflow usa pull_request_target", () => {
  // Ele roda no contexto do repositório base, COM segredos e token de escrita,
  // sobre código enviado por um estranho. Trocar "pull_request" por ele parece
  // correção inocente e é um dos caminhos mais conhecidos de comprometimento.
  for (const f of arquivos) {
    const txt = semComentarios(readFileSync(new URL(f, DIR), "utf8"));
    assert.ok(!/pull_request_target/.test(txt),
      `${f} usa pull_request_target: roda código de terceiro com escrita e segredos`);
  }
});

test("workflow disparável por estranho não declara escrita no topo", () => {
  // Permissão no topo vale para TODO job do arquivo. Num workflow que roda em
  // pull_request, isso alcançaria o job que executa o código enviado.
  for (const f of arquivos) {
    const txt = readFileSync(new URL(f, DIR), "utf8");
    if (!/pull_request/.test(gatilhos(txt))) continue;
    const topo = /^permissions:\n((?:[ \t]+.*\n)+)/m.exec(semComentarios(txt));
    if (!topo) continue;
    assert.ok(!/\bwrite\b/.test(topo[1]!),
      `${f} roda em pull_request e declara escrita no topo; mova para o job que precisa`);
  }
});

test("todo workflow declara permissions — o padrão do GitHub é generoso demais", () => {
  for (const f of arquivos) {
    const txt = semComentarios(readFileSync(new URL(f, DIR), "utf8"));
    assert.match(txt, /^permissions:/m, `${f} não declara permissions`);
  }
});
