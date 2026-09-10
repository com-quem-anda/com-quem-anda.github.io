/**
 * Confere semanalmente que as fontes do §3 continuam respondendo (§10).
 *
 * Usa fetch do Node de propósito: o CDN do TSE devolve 403 para curl.
 */
import { URL_CANDIDATOS, URL_CKAN } from "./lib/tse.ts";

// Sempre GET, nunca HEAD: o Akamai do TSE devolve 403 para HEAD mesmo em URL
// que existe. O corpo é cancelado logo após o cabeçalho chegar.
const ALVOS: { nome: string; url: string }[] = [
  { nome: "Pacote de candidaturas", url: URL_CANDIDATOS },
  { nome: "Catálogo CKAN", url: URL_CKAN },
  { nome: "Dataset no portal", url: "https://dadosabertos.tse.jus.br/dataset/candidatos-2026" },
];

let falhou = false;

for (const alvo of ALVOS) {
  try {
    const r = await fetch(alvo.url);
    await r.body?.cancel();   // não baixar 3 MB só para saber que existe
    const ok = r.status === 200;
    console.log(`${ok ? "✓" : "✗"} ${r.status} ${alvo.nome} — ${alvo.url}`);
    if (!ok) falhou = true;
  } catch (e) {
    console.log(`✗ ERRO ${alvo.nome} — ${(e as Error).message}`);
    falhou = true;
  }
}

if (falhou) {
  console.error("\nAlguma fonte do §3 mudou de lugar ou saiu do ar. Conferir antes da próxima coleta.");
  process.exit(1);
}
console.log("\nTodas as fontes respondem.");
