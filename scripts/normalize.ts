/**
 * CSV latin-1 do TSE -> JSON tipado em data/build/.
 * A lógica de normalização vive em lib/normalizar.ts; aqui só há I/O.
 *
 * Uso: node scripts/normalize.ts [--uf=SP|all]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { lerZip } from "./lib/unzip.ts";
import { lerCsvTse, limparValor } from "./lib/csv.ts";
import { contadoresSituacao, processarUf } from "./lib/normalizar.ts";
import { ANO, URL_CANDIDATOS, dataIso } from "./lib/tse.ts";
import type { Anomalia, ArquivoCargo, Cargo, Candidato } from "./lib/types.ts";

const DIR_RAW = new URL("../data/raw/", import.meta.url);
const DIR_BUILD = new URL("../data/build/", import.meta.url);

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith("--uf="))?.slice(5) ?? "SP";

  const zipBytes = await readFile(new URL("consulta_cand_2026.zip", DIR_RAW));
  const sha = createHash("sha256").update(zipBytes).digest("hex");

  const csvPorUf = new Map<string, Buffer>();
  for (const e of lerZip(zipBytes)) {
    const m = /^consulta_cand_2026_([A-Z]{2})\.csv$/.exec(e.nome);
    if (m) csvPorUf.set(m[1]!, e.conteudo());
  }

  const alvos = arg === "all" ? [...csvPorUf.keys()].filter((u) => u !== "BR").sort() : [arg];
  const anomalias: Anomalia[] = [];

  // Presidente é nacional (SG_UF = BR) e é copiado para a pasta de cada UF, para
  // o front carregar sempre por data/build/<uf>/<cargo>.json (§2). São 13
  // registros — o custo de repetir é irrelevante perto de um caso especial no front.
  const csvBr = csvPorUf.get("BR");
  if (!csvBr) throw new Error("consulta_cand_2026_BR.csv ausente no pacote");
  const linhasBr = lerCsvTse(csvBr).linhas;
  const presidentes: Candidato[] = processarUf("BR", linhasBr, anomalias).get("presidente") ?? [];

  const contagens: Record<string, Record<string, number>> = {};
  let totalLinhas = linhasBr.length;

  for (const uf of alvos) {
    const bytes = csvPorUf.get(uf);
    if (!bytes) throw new Error(`UF ${uf} não encontrada no pacote do TSE`);
    const { linhas } = lerCsvTse(bytes);
    totalLinhas += linhas.length;

    const cab = linhas[0]!;
    const eleicao = {
      ano: ANO,
      codigo: cab["CD_ELEICAO"] ?? "",
      descricao: cab["DS_ELEICAO"] ?? "",
      dataPleito: dataIso(limparValor(cab["DT_ELEICAO"] ?? "")),
    };

    const porCargoUf = processarUf(uf, linhas, anomalias);
    porCargoUf.set("presidente", presidentes);

    const dir = new URL(`${uf}/`, DIR_BUILD);
    await mkdir(dir, { recursive: true });
    contagens[uf] = {};

    for (const [cargo, candidatos] of porCargoUf) {
      const arquivo: ArquivoCargo = {
        uf, cargo: cargo as Cargo, eleicao,
        geradoEm: new Date().toISOString(),
        fonte: URL_CANDIDATOS,
        total: candidatos.length,
        candidatos,
      };
      // indent 1: o diff do PR diário precisa ser legível por humano.
      await writeFile(new URL(`${cargo}.json`, dir), JSON.stringify(arquivo, null, 1) + "\n");
      contagens[uf]![cargo] = candidatos.length;
    }
    console.log(`${uf}: ${Object.entries(contagens[uf]!).map(([c, n]) => `${c}=${n}`).join(" ")}`);
  }

  const sit = contadoresSituacao();
  const meta = {
    geradoEm: new Date().toISOString(),
    ufs: alvos,
    fonte: {
      nome: "TSE — Portal de Dados Abertos, dataset candidatos-2026",
      url: URL_CANDIDATOS,
      licenca: "Creative Commons Atribuição (CC-BY)",
      sha256: sha,
    },
    contagens,
    linhasCsvLidas: totalLinhas,
    situacaoRegistroDisponivel: sit.comSituacao > 0,
    situacaoRegistro: {
      ...sit,
      observacao:
        sit.comSituacao === 0
          ? "O TSE ainda publica #NE em DS_SITUACAO_CANDIDATURA para 2026. " +
            "Enquanto isto for 0, o alerta de registro indeferido/cassado (§5.4) não tem fonte."
          : null,
    },
    anomalias,
  };
  await mkdir(DIR_BUILD, { recursive: true });
  await writeFile(new URL("meta.json", DIR_BUILD), JSON.stringify(meta, null, 2) + "\n");

  console.log(`\nmeta.json escrito | ${anomalias.length} anomalias registradas`);
}

await main();
