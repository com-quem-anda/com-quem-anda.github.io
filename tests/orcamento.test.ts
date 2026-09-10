import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { servir, type ServidorTeste } from "./ajuda/servidor.ts";

/**
 * Orçamento de performance da §1.4, medido — não estimado.
 *
 * Cenário de referência: em pé, na fila da seção, uma mão, 4G ruim, 360 px.
 */
const TETO_PRIMEIRA_TELA = 150 * 1024;   // bytes transferidos
const TETO_TTI_MS = 3000;                // em Slow 4G, sem cache
const TETO_CLS = 0.05;

// Slow 4G do DevTools do Chrome.
const SLOW_4G = { offline: false, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 562.5 };

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

describe("orçamento de performance (§1.4)", () => {
  test("a primeira tela da cédula cabe em 150 KB transferidos", async () => {
    const contexto = await navegador.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await contexto.newPage();

    let bytes = 0;
    const porRecurso: Record<string, number> = {};
    page.on("response", async (r) => {
      try {
        const corpo = await r.body();
        bytes += corpo.length;
        porRecurso[new URL(r.url()).pathname] = corpo.length;
      } catch { /* redirecionamento ou resposta sem corpo */ }
    });

    await page.goto(servidor.url + "/SP/", { waitUntil: "networkidle" });

    const detalhe = Object.entries(porRecurso)
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${p} ${(n / 1024).toFixed(1)}KB`)
      .join("\n      ");
    assert.ok(
      bytes <= TETO_PRIMEIRA_TELA,
      `primeira tela usou ${(bytes / 1024).toFixed(1)} KB, teto ${TETO_PRIMEIRA_TELA / 1024} KB:\n      ${detalhe}`,
    );
    console.log(`      primeira tela: ${(bytes / 1024).toFixed(1)} KB de ${TETO_PRIMEIRA_TELA / 1024} KB`);
    await contexto.close();
  });

  test("fica interativa em menos de 3 s numa Slow 4G, sem cache", async () => {
    const contexto = await navegador.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await contexto.newPage();
    const cdp = await contexto.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", SLOW_4G);

    const inicio = Date.now();
    await page.goto(servidor.url + "/SP/");
    // Interativa de verdade: os seis slots existem e respondem ao toque.
    await page.locator('[data-slot="5"]').waitFor({ state: "visible" });
    const tti = Date.now() - inicio;

    assert.ok(tti <= TETO_TTI_MS, `ficou interativa em ${tti} ms, teto ${TETO_TTI_MS} ms`);
    console.log(`      interativa em ${tti} ms de ${TETO_TTI_MS} ms (Slow 4G)`);
    await contexto.close();
  });

  test("nada se desloca depois do carregamento (CLS ≈ 0)", async () => {
    const contexto = await navegador.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await contexto.newPage();

    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    await page.goto(servidor.url + "/SP/", { waitUntil: "networkidle" });
    // Os slots são preenchidos pelo cliente: é aqui que um layout mal reservado saltaria.
    await page.locator(".slot__cargo").first().waitFor();
    await page.waitForTimeout(600);

    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    assert.ok(cls <= TETO_CLS, `CLS ficou em ${cls.toFixed(4)}, teto ${TETO_CLS}`);
    console.log(`      CLS: ${cls.toFixed(4)} de ${TETO_CLS}`);
    await contexto.close();
  });

  test("abrir a lista de deputado estadual não estoura a espera do usuário", async () => {
    const contexto = await navegador.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await contexto.newPage();
    await page.goto(servidor.url + "/SP/", { waitUntil: "networkidle" });

    const cdp = await contexto.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", SLOW_4G);

    const inicio = Date.now();
    await page.locator('[data-slot="0"]').click();
    await page.locator(".item").first().waitFor();
    const ms = Date.now() - inicio;

    // 1.430 candidatos sob demanda, em Slow 4G. É o pior caso do produto.
    assert.ok(ms <= 5000, `a lista maior levou ${ms} ms para aparecer`);
    console.log(`      lista de 1.430 candidatos em Slow 4G: ${ms} ms`);
    await contexto.close();
  });
});
