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
import { ANO, CARGOS_VOTAVEIS, URL_CANDIDATOS, dataIso } from "./lib/tse.ts";
import { urlCandidatoNoTse, type ArquivoPropostas } from "./lib/propostas.ts";
import type { Anomalia, ArquivoCargo, Cargo, Candidato } from "./lib/types.ts";

const DIR_RAW = new URL("../data/raw/", import.meta.url);
const DIR_BUILD = new URL("../data/build/", import.meta.url);

/** Lê o índice de propostas, se ele já tiver sido gerado. */
async function lerIndicePropostas(): Promise<ArquivoPropostas | null> {
  try {
    return JSON.parse(await readFile(new URL("propostas.json", DIR_BUILD), "utf8")) as ArquivoPropostas;
  } catch {
    // Sem o índice, nenhum candidato recebe o bloco de proposta — que é o
    // comportamento certo: não afirmamos existência que não conferimos.
    return null;
  }
}

/** Anexa a proposta aos candidatos que a registraram. */
function aplicarPropostas(
  lista: Candidato[],
  propostas: ArquivoPropostas | null,
  cdEleicao: string,
  sgUe: string,
): void {
  if (!propostas) return;
  for (const c of lista) {
    const ind = propostas.porCandidato[c.sq];
    if (!ind) continue;
    c.proposta = {
      arquivos: ind.arquivos,
      bytes: ind.bytes,
      urlTse: urlCandidatoNoTse(cdEleicao, sgUe, c.sq),
      coletadoEm: propostas.geradoEm,
    };
  }
}

/** Lê consulta_cand_2026_BRASIL.csv e conta candidaturas por UF e cargo. */
function contarConsolidado(zipBytes: Buffer): Record<string, number> {
  const entrada = lerZip(zipBytes).find((e) => e.nome === "consulta_cand_2026_BRASIL.csv");
  if (!entrada) throw new Error("consulta_cand_2026_BRASIL.csv ausente: sem ele não há conferência independente");

  const contagem: Record<string, number> = {};
  for (const l of lerCsvTse(entrada.conteudo()).linhas) {
    const cargo = CARGOS_VOTAVEIS[l["CD_CARGO"] ?? ""];
    if (!cargo) continue;   // vices e suplentes contam pela chapa, não pela lista
    const uf = cargo === "presidente" ? "BR" : (l["SG_UF"] ?? "");
    const chave = `${uf}/${cargo}`;
    contagem[chave] = (contagem[chave] ?? 0) + 1;
  }
  return contagem;
}

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

  // Contagem independente, tirada do consolidado que o TSE gera à parte dos
  // arquivos por UF. Fica gravada no meta.json para o CI poder conferir sem ter
  // o ZIP bruto em mãos — ele não é versionado.
  const esperadoTse = contarConsolidado(zipBytes);
  const anomalias: Anomalia[] = [];

  // Presidente é nacional (SG_UF = BR) e é copiado para a pasta de cada UF, para
  // o front carregar sempre por data/build/<uf>/<cargo>.json (§2). São 13
  // registros — o custo de repetir é irrelevante perto de um caso especial no front.
  const csvBr = csvPorUf.get("BR");
  if (!csvBr) throw new Error("consulta_cand_2026_BR.csv ausente no pacote");
  const linhasBr = lerCsvTse(csvBr).linhas;
  const presidentes: Candidato[] = processarUf("BR", linhasBr, anomalias).get("presidente") ?? [];

  // O pleito federal tem CD_ELEICAO próprio (6257), diferente do estadual
  // (6259 em SP). Usar o do estado aqui geraria link quebrado para o TSE.
  const eleicaoBr = {
    ano: ANO,
    codigo: linhasBr[0]?.["CD_ELEICAO"] ?? "",
    descricao: linhasBr[0]?.["DS_ELEICAO"] ?? "",
    dataPleito: dataIso(limparValor(linhasBr[0]?.["DT_ELEICAO"] ?? "")),
  };

  const propostas = await lerIndicePropostas();
  aplicarPropostas(presidentes, propostas, eleicaoBr.codigo, "BR");

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
    for (const [cargo, lista] of porCargoUf) {
      if (cargo !== "presidente") aplicarPropostas(lista, propostas, eleicao.codigo, uf);
    }
    porCargoUf.set("presidente", presidentes);

    const dir = new URL(`${uf}/`, DIR_BUILD);
    await mkdir(dir, { recursive: true });
    contagens[uf] = {};

    for (const [cargo, candidatos] of porCargoUf) {
      const arquivo: ArquivoCargo = {
        uf, cargo: cargo as Cargo,
        eleicao: cargo === "presidente" ? eleicaoBr : eleicao,
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
    conferencia: {
      fonte: "consulta_cand_2026_BRASIL.csv",
      descricao:
        "Contagem por UF e cargo lida do arquivo consolidado do TSE, gerado por ele " +
        "separadamente dos arquivos por UF. O validate compara os JSONs contra isto.",
      esperado: esperadoTse,
    },
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
