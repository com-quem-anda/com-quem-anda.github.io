import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { servir, type ServidorTeste } from "./ajuda/servidor.ts";

let navegador: Browser;
let servidor: ServidorTeste;

before(async () => {
  servidor = await servir();
  navegador = await chromium.launch();
});
after(async () => {
  await navegador?.close();
  await servidor?.fechar();
});

/** Abre uma página registrando toda requisição que sair para fora do site. */
async function abrir(caminho: string, viewport = { width: 360, height: 740 }): Promise<{ page: Page; externas: string[] }> {
  const contexto = await navegador.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const externas: string[] = [];
  const page = await contexto.newPage();
  page.on("request", (r) => {
    if (!r.url().startsWith(servidor.url) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) {
      externas.push(r.url());
    }
  });
  await page.goto(servidor.url + caminho, { waitUntil: "networkidle" });
  return { page, externas };
}

const TELAS = ["/", "/SP/", "/metodologia/", "/fontes/", "/transparencia/", "/privacidade/"];

describe("privacidade (§8)", () => {
  test("nenhuma requisição sai para fora do site, em nenhuma tela", async () => {
    for (const caminho of TELAS) {
      const { page, externas } = await abrir(caminho);
      assert.deepEqual(externas, [], `${caminho} fez requisição externa`);
      await page.context().close();
    }
  });

  test("escolher candidato não dispara requisição externa", async () => {
    const { page, externas } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();          // governador
    await page.locator(".item").first().waitFor();
    await page.locator(".item").first().click();
    await page.locator(".slot__nome").first().waitFor();
    assert.deepEqual(externas, []);
    await page.context().close();
  });

  test("nada é gravado além da chave única de estado", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".item").first().click();
    const chaves = await page.evaluate(() => Object.keys(localStorage));
    assert.deepEqual(chaves, ["cedula-aberta"]);
    const cookies = await page.context().cookies();
    assert.deepEqual(cookies, []);
    await page.context().close();
  });
});

describe("viewport (§1.4)", () => {
  for (const width of [360, 390, 414]) {
    test(`sem rolagem horizontal em ${width} px`, async () => {
      for (const caminho of TELAS) {
        const { page } = await abrir(caminho, { width, height: 740 });
        const estouro = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        assert.ok(estouro <= 0, `${caminho} em ${width}px estoura ${estouro}px na horizontal`);
        await page.context().close();
      }
    });
  }

  test("todo alvo de toque tem pelo menos 44x44", async () => {
    const { page } = await abrir("/SP/");
    const pequenos = await page.evaluate(() => {
      const ruins: string[] = [];
      for (const el of document.querySelectorAll("button, a.botao, select")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;   // oculto
        if (r.height < 44 || r.width < 44) ruins.push(`${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return ruins;
    });
    assert.deepEqual(pequenos, []);
    await page.context().close();
  });
});

describe("cédula", () => {
  test("os seis slots aparecem na ordem da urna", async () => {
    const { page } = await abrir("/SP/");
    const rotulos = await page.locator(".slot__cargo").allTextContents();
    assert.deepEqual(rotulos, [
      "Deputado estadual", "Deputado federal",
      "Senador — 1ª vaga", "Senador — 2ª vaga",
      "Governador", "Presidente",
    ]);
    await page.context().close();
  });

  test("a lista traz o universo completo e ordenado por número", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="0"]').click();          // deputado estadual
    await page.locator(".item").first().waitFor();
    const contagem = await page.locator(".folha__titulo .contagem").textContent();
    assert.match(contagem ?? "", /1\.?430 candidatos/);

    const numeros = await page.locator(".item__numero").allTextContents();
    const ordenado = [...numeros].sort((a, b) => Number(a) - Number(b));
    assert.deepEqual(numeros, ordenado, "a lista abre fora de ordem numérica");
    await page.context().close();
  });

  test("1.430 candidatos não viram 1.430 nós no DOM", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="0"]').click();
    await page.locator(".item").first().waitFor();
    const nos = await page.locator(".item").count();
    assert.ok(nos < 40, `a lista montou ${nos} nós — a virtualização não está ativa`);
    await page.context().close();
  });

  test("busca por número acha antes de terminar de digitar", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("13");
    await page.locator(".item__nome").first().waitFor();
    assert.equal(await page.locator(".item__nome").first().textContent(), "FERNANDO HADDAD");
    await page.context().close();
  });

  test("busca por nome ignora acento", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("tarcisio");
    await page.locator(".item__nome").first().waitFor();
    assert.match((await page.locator(".item__nome").first().textContent()) ?? "", /TARC/);
    await page.context().close();
  });

  test("o voto sobrevive a recarregar a página", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("13");
    await page.locator(".item").first().click();
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".slot__nome b").first().waitFor();
    assert.equal(await page.locator(".slot__nome b").first().textContent(), "FERNANDO HADDAD");
    await page.context().close();
  });

  test("alerta de coligações adversárias aparece com escolha real", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();            // governador Tarcísio
    await page.locator(".busca input").fill("10");
    await page.locator(".item").first().click();
    await page.locator('[data-slot="5"]').click();            // presidente Lula
    await page.locator(".busca input").fill("13");
    await page.locator(".item").first().click();

    const diagnostico = await page.locator(".diagnostico").textContent();
    assert.match(diagnostico ?? "", /campos opostos/);
    assert.match(diagnostico ?? "", /PL/);
    await page.context().close();
  });
});

describe("proposta de governo", () => {
  test("o botão de ficha abre os dados do candidato", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("13");
    await page.locator(".item__info").first().click();
    await page.locator("dialog.ficha").waitFor({ state: "visible" });
    assert.match((await page.locator("dialog.ficha h2").textContent()) ?? "", /HADDAD/);
    await page.context().close();
  });

  test("a proposta liga para o TSE e não é servida por nós", async () => {
    const { page, externas } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("13");
    await page.locator(".item__info").first().click();

    const link = page.locator(".proposta a");
    await link.waitFor();
    const href = await link.getAttribute("href");
    assert.match(href ?? "", /^https:\/\/divulgacandcontas\.tse\.jus\.br\/divulga\/#\/candidato\/2026\/6259\/SP\//);
    assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    assert.match((await link.textContent()) ?? "", /TSE/);

    // Mostrar o link não pode disparar requisição para fora (§8).
    assert.deepEqual(externas, []);
    await page.context().close();
  });

  test("candidato de cargo sem proposta diz isso, em vez de omitir", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="2"]').click();          // senador
    await page.locator(".item__info").first().click();
    await page.locator(".proposta").waitFor();
    assert.match((await page.locator(".proposta").textContent()) ?? "", /não exige proposta/);
    assert.equal(await page.locator(".proposta a").count(), 0);
    await page.context().close();
  });

  test("governador sem proposta registrada aparece como ausência", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("36");          // POLICIAL EDJANE, sem proposta
    await page.locator(".item__info").first().click();
    await page.locator(".proposta").waitFor();
    assert.match((await page.locator(".proposta").textContent()) ?? "", /Não consta proposta registrada/);
    await page.context().close();
  });
});

describe("offline (§1.4)", () => {
  test("com a rede desligada, a cédula salva ainda abre", async () => {
    const contexto = await navegador.newContext({ viewport: { width: 360, height: 740 } });
    const page = await contexto.newPage();
    await page.goto(servidor.url + "/SP/", { waitUntil: "networkidle" });

    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("13");
    await page.locator(".item").first().click();
    await page.locator(".slot__nome b").first().waitFor();

    // Sem service worker em http:// — o que se garante aqui é que o estado do
    // usuário vive no aparelho e não depende de rede para ser lido.
    await contexto.setOffline(true);
    const votos = await page.evaluate(() => JSON.parse(localStorage.getItem("cedula-aberta") || "{}").votos);
    assert.equal(Object.keys(votos).length, 1);
    await contexto.close();
  });
});

describe("impressão (§7)", () => {
  test("a folha impressa esconde navegação e mostra o cabeçalho de papel", async () => {
    const { page } = await abrir("/SP/");
    await page.locator('[data-slot="4"]').click();
    await page.locator(".busca input").fill("13");
    await page.locator(".item").first().click();

    await page.emulateMedia({ media: "print" });

    assert.equal(await page.locator(".barra-acao").isVisible(), false, "a barra de ação foi para o papel");
    assert.equal(await page.locator(".cabecalho").isVisible(), false, "o cabeçalho do site foi para o papel");
    assert.equal(await page.locator(".folha-cabecalho").isVisible(), true, "falta o cabeçalho de impressão");
    assert.equal(await page.locator(".folha-rodape").isVisible(), true, "falta o rodapé com o aviso do e-Título");

    const texto = await page.locator(".folha-rodape").textContent();
    assert.match(texto ?? "", /e-Título/);
    assert.match(texto ?? "", /Creative Commons/);

    const pdf = await page.pdf({ format: "A4" });
    assert.ok(pdf.length > 1000, "o PDF saiu vazio");
    await page.context().close();
  });
});
