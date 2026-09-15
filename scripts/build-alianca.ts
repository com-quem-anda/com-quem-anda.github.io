/**
 * Gera data/build/alianca.json a partir dos JSONs por UF.
 *
 * Roda depois do normalize e antes do validate. Só há I/O aqui; a matemática
 * está em lib/alianca.ts.
 *
 * Uso: node scripts/build-alianca.ts
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extrairConjuntos, montarGrafo, REPETICOES_BOOTSTRAP, SEMENTE_BOOTSTRAP } from "./lib/alianca.ts";
import type { ArquivoCargo } from "./lib/types.ts";

const DIR_BUILD = new URL("../data/build/", import.meta.url);

async function main(): Promise<void> {
  const meta = JSON.parse(await readFile(new URL("meta.json", DIR_BUILD), "utf8")) as {
    ufs: string[];
    fonte: { sha256: string; url: string; licenca: string };
  };

  const arquivos: { cargo: string; candidatos: ArquivoCargo["candidatos"] }[] = [];
  for (const uf of meta.ufs) {
    const dir = new URL(`${uf}/`, DIR_BUILD);
    for (const nome of await readdir(dir)) {
      if (!nome.endsWith(".json")) continue;
      const a = JSON.parse(await readFile(new URL(nome, dir), "utf8")) as ArquivoCargo;
      arquivos.push({ cargo: a.cargo, candidatos: a.candidatos });
    }
  }

  const extraido = extrairConjuntos(arquivos);
  const grafo = montarGrafo(extraido);

  const arestas = Object.values(grafo.proximidade);
  const fragilidade = arestas.filter((e) => e.n < 3).length;

  const saida = {
    geradoEm: new Date().toISOString(),
    fonte: meta.fonte,
    metodo: {
      similaridade: "jaccard sobre conjuntos de aliança",
      cargosComColigacao: ["presidente", "governador", "senador"],
      federacao: "aresta fixa de peso 1 — vínculo legal de 4 anos, não acordo de uma eleição",
      candidaturaIsolada: "conta no denominador: recusar aliança também é comportamento de aliança",
      bootstrap: { repeticoes: REPETICOES_BOOTSTRAP, semente: SEMENTE_BOOTSTRAP },
      observacao:
        "Isto mede proximidade de ALIANÇA, não de ideologia. Coligação brasileira mistura " +
        "programa e disputa por cargo; qualquer interface que chamar isto de eixo ideológico " +
        "está afirmando mais do que o dado sustenta.",
    },
    ufs: meta.ufs,
    conjuntos: grafo.conjuntos,
    partidos: grafo.partidos,
    aparicoes: grafo.aparicoes,
    federacao: grafo.federacao,
    proximidade: grafo.proximidade,
  };

  await writeFile(new URL("alianca.json", DIR_BUILD), JSON.stringify(saida, null, 1) + "\n");

  console.log(`alianca.json escrito`);
  console.log(`  ${grafo.conjuntos} conjuntos de aliança | ${grafo.partidos.length} partidos | ${arestas.length} arestas não-nulas`);
  console.log(`  ${Object.keys(grafo.federacao).length} partidos em federação`);
  if (fragilidade > 0) {
    console.log(`  AVISO  ${fragilidade} arestas apoiadas em menos de 3 coincidências — a interface tem que marcá-las como frágeis`);
  }
  const poucos = grafo.partidos.filter((p) => (grafo.aparicoes[p] ?? 0) < 10);
  if (poucos.length > 0) {
    console.log(`  AVISO  partidos com menos de 10 aparições: ${poucos.map((p) => `${p}(${grafo.aparicoes[p]})`).join(", ")}`);
  }
}

await main();
