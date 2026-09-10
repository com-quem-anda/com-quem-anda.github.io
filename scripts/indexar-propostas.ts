/**
 * Descobre quais candidatos registraram proposta de governo.
 *
 * Lê apenas o ÍNDICE dos pacotes oficiais, por requisição Range: nenhum PDF é
 * transferido. Em SP isso troca 13,6 MB por cerca de 8 KB.
 *
 * Uso: node scripts/indexar-propostas.ts [--uf=SP|all]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { listarZipRemoto } from "./lib/zip-remoto.ts";
import { lerNomeArquivo, urlPacote, type ArquivoPropostas, type IndiceProposta } from "./lib/propostas.ts";
import { UFS } from "./lib/tse.ts";

const DIR_BUILD = new URL("../data/build/", import.meta.url);
const PAUSA_MS = 300;   // a documentação do TSE pede intervalo entre requisições

const espera = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith("--uf="))?.slice(5) ?? "SP";
  // BR entra sempre: é de onde vêm as propostas dos candidatos a presidente.
  const alvos = arg === "all" ? [...UFS] : [...new Set(["BR", arg])];

  const porCandidato: Record<string, IndiceProposta> = {};
  const pacotes: ArquivoPropostas["pacotes"] = {};

  for (const uf of alvos) {
    const url = urlPacote(uf);
    try {
      const entradas = await listarZipRemoto(url);
      let comProposta = 0;

      for (const e of entradas) {
        const info = lerNomeArquivo(e.nome);
        if (!info) continue;   // leiame.pdf e afins
        const atual = porCandidato[info.sq] ?? { arquivos: 0, bytes: 0 };
        atual.arquivos += 1;
        atual.bytes += e.tamanho;
        porCandidato[info.sq] = atual;
        comProposta++;
      }

      pacotes[uf] = { url, arquivos: comProposta, atualizadoEm: new Date().toISOString() };
      console.log(`${uf}: ${comProposta} arquivos de proposta`);
    } catch (erro) {
      // Transparência inclui admitir buraco (§6.2): a falha fica registrada.
      pacotes[uf] = { url, arquivos: -1, atualizadoEm: null };
      console.log(`${uf}: FALHA — ${(erro as Error).message}`);
    }
    await espera(PAUSA_MS);
  }

  const saida: ArquivoPropostas = {
    geradoEm: new Date().toISOString(),
    metodo:
      "Índice do pacote oficial lido por requisição HTTP Range. Nenhum PDF é " +
      "baixado, hospedado ou processado; a ferramenta liga para a página do TSE.",
    pacotes,
    porCandidato,
  };

  await mkdir(DIR_BUILD, { recursive: true });
  await writeFile(new URL("propostas.json", DIR_BUILD), JSON.stringify(saida, null, 2) + "\n");
  console.log(`\npropostas.json: ${Object.keys(porCandidato).length} candidatos com proposta registrada`);
}

await main();
