/**
 * Baixa o pacote de candidaturas do TSE para data/raw/.
 *
 * ATENÇÃO — não troque isto por curl/wget. O CDN do TSE está atrás de Akamai,
 * que rejeita o fingerprint TLS do curl com 403 mesmo com IP brasileiro e
 * cabeçalhos de navegador. O fetch do Node passa. Verificado em 10/09/2026.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { URL_CANDIDATOS, URL_CKAN } from "./lib/tse.ts";

const DIR_RAW = new URL("../data/raw/", import.meta.url);

async function baixar(url: string): Promise<{ bytes: Buffer; modificadoEm: string | null }> {
  const resposta = await fetch(url, { headers: { Accept: "*/*" } });
  if (!resposta.ok) {
    throw new Error(
      `TSE respondeu ${resposta.status} em ${url}. ` +
      `Se for 403, confira se a chamada está usando fetch do Node e não curl.`,
    );
  }
  return {
    bytes: Buffer.from(await resposta.arrayBuffer()),
    modificadoEm: resposta.headers.get("last-modified"),
  };
}

/** Descobre recursos via CKAN (§3.1) — nada de URL hardcoded no futuro. */
async function catalogo(): Promise<{ licenca: string; atualizadoEm: string; recursos: number } | null> {
  try {
    const r = await fetch(URL_CKAN, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = (await r.json()) as { result: { license_title: string; metadata_modified: string; resources: unknown[] } };
    return {
      licenca: j.result.license_title,
      atualizadoEm: j.result.metadata_modified,
      recursos: j.result.resources.length,
    };
  } catch {
    return null;  // CKAN é conveniência; a coleta não depende dele (§3.2)
  }
}

async function main(): Promise<void> {
  await mkdir(DIR_RAW, { recursive: true });

  console.log("catalogando dataset candidatos-2026 no CKAN...");
  const cat = await catalogo();
  if (cat) console.log(`  licença: ${cat.licenca} | atualizado: ${cat.atualizadoEm} | ${cat.recursos} recursos`);
  else console.log("  CKAN indisponível — seguindo com a URL conhecida");

  console.log(`baixando ${URL_CANDIDATOS}`);
  const { bytes, modificadoEm } = await baixar(URL_CANDIDATOS);
  const sha = createHash("sha256").update(bytes).digest("hex");

  const destino = new URL("consulta_cand_2026.zip", DIR_RAW);
  await writeFile(destino, bytes);

  const proveniencia = {
    coletadoEm: new Date().toISOString(),
    url: URL_CANDIDATOS,
    bytes: bytes.length,
    sha256: sha,
    lastModified: modificadoEm,
    licenca: cat?.licenca ?? "Creative Commons Atribuição cc-by",
    ckanAtualizadoEm: cat?.atualizadoEm ?? null,
  };
  await writeFile(new URL("proveniencia.json", DIR_RAW), JSON.stringify(proveniencia, null, 2) + "\n");

  console.log(`  ${(bytes.length / 1024 / 1024).toFixed(1)} MB | sha256 ${sha.slice(0, 16)}… | TSE gerou em ${modificadoEm}`);
}

await main();
