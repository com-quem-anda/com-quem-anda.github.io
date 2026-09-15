import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Invariantes de privacidade do front.
 *
 * A página promete, no próprio texto, que a cédula e as respostas do eleitor
 * não saem do navegador. Promessa que depende de alguém lembrar é promessa que
 * um dia quebra — então ela vira teste. Estes conferem o código publicado, não
 * a intenção de quem escreveu.
 */
const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");

/** Estado que descreve escolhas do eleitor e nunca pode ser transmitido. */
const ESTADO_DO_ELEITOR = ["escolhas", "respostas", "pesos"];

test("o front só busca dados do próprio site", () => {
  const destinos = [...app.matchAll(/fetch\(\s*[`"']([^`"']+)/g)].map((m) => m[1]!);
  assert.ok(destinos.length > 0, "esperado ao menos um fetch de dados");
  for (const d of destinos) {
    assert.ok(
      d.startsWith("dados/"),
      `fetch para destino externo: ${d}. O front carrega só os JSONs do próprio site.`,
    );
  }
});

test("nenhum caminho de envio existe no código do front", () => {
  for (const proibido of ["sendBeacon", "XMLHttpRequest", "new Image(", "navigator.connection"]) {
    assert.ok(!app.includes(proibido), `${proibido} não deve existir: é caminho de envio de dado`);
  }
});

test("o estado do eleitor nunca é serializado para sair da página", () => {
  for (const nome of ESTADO_DO_ELEITOR) {
    const suspeitas = new RegExp(`(JSON\\.stringify\\(\\s*${nome}\\b|body:[^\\n]*\\b${nome}\\b)`);
    assert.ok(!suspeitas.test(app), `${nome} aparece sendo serializado para envio`);
  }
});

test("o medidor de acesso, se ligado, não recebe estado do eleitor", () => {
  const bloco = app.slice(app.indexOf("function ligarAnalytics"), app.indexOf("function textoPrivacidade"));
  assert.ok(bloco.length > 50, "função de analytics não encontrada");
  for (const nome of ESTADO_DO_ELEITOR) {
    assert.ok(!bloco.includes(nome), `ligarAnalytics referencia ${nome}`);
  }
  // Só os dois provedores sem cookie são aceitos pelo código.
  const hosts = [...bloco.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]!);
  for (const h of hosts) {
    assert.ok(
      ["static.cloudflareinsights.com", "gc.zgo.at"].includes(h),
      `provedor não previsto em ligarAnalytics: ${h}`,
    );
  }
});

test("o texto de privacidade é gerado pela configuração, não escrito à mão", () => {
  // Se o texto voltasse a ser fixo no HTML, ele poderia mentir sobre o que está ligado.
  for (const id of ["privacidadeAviso", "privacidadeConsequencia", "metodoUso"]) {
    const vazio = new RegExp(`<p id="${id}"></p>`);
    assert.ok(vazio.test(html), `${id} deve ficar vazio no HTML e ser preenchido pelo código`);
  }
  assert.ok(app.includes("function textoPrivacidade"), "o texto precisa sair da configuração");
});

test("se houver medidor configurado, é um dos dois sem cookie", () => {
  // Esta trava não impede ligar métricas — impede ligar um provedor que a
  // página não descreve. O texto de privacidade nomeia o medidor, e nomear o
  // errado seria pior que não ter medidor nenhum.
  const m = /VC_ANALYTICS\s*=\s*\{\s*provedor:\s*"([^"]*)",\s*token:\s*"([^"]*)"/.exec(html);
  assert.ok(m, "bloco de configuração não encontrado");
  const [, provedor, token] = m!;
  if (provedor === "") {
    assert.equal(token, "", "sem provedor não deve haver token sobrando");
    return;
  }
  assert.ok(["cloudflare", "goatcounter"].includes(provedor!), `provedor não suportado: ${provedor}`);
  assert.ok(token!.length > 4, "provedor configurado sem token válido");
  assert.ok(!/TOKEN|EXEMPLO|SEU_/i.test(token!), "token de exemplo não pode ir ao ar");
});

test("todo host de terceiro no front está na lista declarada", () => {
  // A página nomeia quem ela contata. Um host novo que entre sem passar por
  // aqui tornaria esse texto falso — foi assim que "nem chamada a servidor de
  // terceiros" ficou desatualizado enquanto as fontes já vinham do Google.
  const DECLARADOS = [
    "fonts.googleapis.com",        // fontes, no carregamento
    "fonts.gstatic.com",           // arquivos das fontes
    "cdnjs.cloudflare.com",        // gerador de PDF, só ao exportar
    "static.cloudflareinsights.com", // medidor de acesso, se ligado
    "gc.zgo.at",                   // idem, alternativa
  ];
  for (const fonte of [app, html]) {
    for (const m of fonte.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) {
      const host = m[1]!;
      if (host.endsWith("camara.leg.br") || host.endsWith("tse.jus.br")
          || host.endsWith("ibge.gov.br") || host.endsWith("senado.leg.br")
          || host === "ranking.org.br" || host === "github.com") continue;  // só citados em texto
      assert.ok(DECLARADOS.includes(host), `host não declarado no texto de privacidade: ${host}`);
    }
  }
});
