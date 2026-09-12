/**
 * Malha dos estados para o mapa, do IBGE.
 *
 * Fonte diferente do resto do projeto: o TSE não publica geometria. O IBGE
 * serve em `qualidade=minima`, que são 96 KB para as 27 UFs — resolução de
 * sobra para um mapa de tela e pequena o bastante para carregar junto.
 *
 * Também não entra no cron diário: fronteira de estado não muda toda noite.
 */
import { writeFile } from "node:fs/promises";

const URL_MALHA =
  "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR" +
  "?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=minima";

/** Código de UF do IBGE -> sigla. Fixo desde 1988. */
const CODIGO_UF: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL",
  "28": "SE", "29": "BA", "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS", "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};

interface Feature { properties: Record<string, string>; geometry: unknown }

async function main(): Promise<void> {
  const r = await fetch(URL_MALHA, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`IBGE respondeu ${r.status}`);
  const geo = (await r.json()) as { features: Feature[] };

  const semSigla: string[] = [];
  for (const f of geo.features) {
    const uf = CODIGO_UF[f.properties["codarea"] ?? ""];
    if (!uf) { semSigla.push(f.properties["codarea"] ?? "?"); continue; }
    f.properties = { uf };
  }
  if (semSigla.length > 0) throw new Error(`códigos de UF desconhecidos no IBGE: ${semSigla.join(", ")}`);
  if (geo.features.length !== 27) throw new Error(`esperado 27 UFs, veio ${geo.features.length}`);

  const saida = {
    geradoEm: new Date().toISOString(),
    fonte: {
      nome: "IBGE — malhas territoriais, divisão por UF, qualidade mínima",
      url: URL_MALHA,
      licenca: "Dados abertos do IBGE",
    },
    ...geo,
  };
  await writeFile(new URL("../data/build/malha-uf.json", import.meta.url), JSON.stringify(saida) + "\n");
  console.log(`malha-uf.json | ${geo.features.length} UFs`);
}

await main();
