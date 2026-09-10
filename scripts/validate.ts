/**
 * Invariantes do M1. Falhou, não faz deploy (§4).
 *
 * O critério de pronto original da §9 — "o total bate com o DivulgaCandContas"
 * — não é verificável: a API responde 200 com lista vazia para 2026
 * (verificado em 10/09/2026, CD_ELEICAO 6259). No lugar dela usamos uma
 * conferência independente de verdade: o CSV consolidado consulta_cand_2026_BRASIL.csv,
 * que o TSE gera separadamente dos arquivos por UF. Se o nosso JSON e o
 * consolidado do TSE discordarem, alguém perdeu candidato no caminho.
 */
import { readFile, readdir } from "node:fs/promises";
import { lerZip } from "./lib/unzip.ts";
import { lerCsvTse } from "./lib/csv.ts";
import { CARGOS_VOTAVEIS, DIGITOS } from "./lib/tse.ts";
import type { ArquivoCargo, Cargo } from "./lib/types.ts";

const DIR_RAW = new URL("../data/raw/", import.meta.url);
const DIR_BUILD = new URL("../data/build/", import.meta.url);
const DIAS_MAXIMOS = 7;

const falhas: string[] = [];
const avisos: string[] = [];

const falhar = (m: string) => falhas.push(m);
const avisar = (m: string) => avisos.push(m);

interface Meta {
  geradoEm: string;
  ufs: string[];
  fonte: { sha256: string; licenca: string; url: string };
  contagens: Record<string, Record<string, number>>;
  conferencia: { fonte: string; esperado: Record<string, number> };
  situacaoRegistro: { comSituacao: number; semSituacao: number };
  anomalias: { tipo: string; detalhe: string }[];
}

async function main(): Promise<void> {
  const meta: Meta = JSON.parse(await readFile(new URL("meta.json", DIR_BUILD), "utf8"));

  // ---- 1. Frescor da coleta (§4) ----
  const idadeDias = (Date.now() - Date.parse(meta.geradoEm)) / 86_400_000;
  if (!Number.isFinite(idadeDias)) falhar("meta.json: geradoEm inválido");
  else if (idadeDias > DIAS_MAXIMOS) falhar(`meta.json: coleta com ${idadeDias.toFixed(1)} dias (máximo ${DIAS_MAXIMOS})`);

  // ---- 2. Licença citável (§0.3: CC-BY exige atribuição visível) ----
  if (!/CC-BY|Atribuição/i.test(meta.fonte.licenca)) falhar(`meta.json: licença não reconhecida: ${meta.fonte.licenca}`);

  // ---- 3. Carrega tudo que foi gerado ----
  const sqGlobal = new Map<string, string>();
  const arquivos: ArquivoCargo[] = [];

  for (const uf of meta.ufs) {
    const dir = new URL(`${uf}/`, DIR_BUILD);
    for (const nome of await readdir(dir)) {
      if (!nome.endsWith(".json")) continue;
      const a: ArquivoCargo = JSON.parse(await readFile(new URL(nome, dir), "utf8"));
      arquivos.push(a);

      if (a.total !== a.candidatos.length) {
        falhar(`${uf}/${nome}: campo total=${a.total} diverge de candidatos.length=${a.candidatos.length}`);
      }

      for (const [i, c] of a.candidatos.entries()) {
        // 3a. sq único globalmente
        const chave = `${c.uf}/${c.cargo}/${c.sq}`;
        const anterior = sqGlobal.get(c.sq);
        // presidente é replicado em toda UF por construção — não é colisão
        if (anterior && anterior !== chave && c.cargo !== "presidente") {
          falhar(`sq duplicado: ${c.sq} em ${chave} e ${anterior}`);
        }
        sqGlobal.set(c.sq, chave);

        // 3b. dígitos do número por cargo (§4)
        const esperado = DIGITOS[c.cargo as Cargo];
        if (esperado && c.numero.length !== esperado) {
          falhar(`${uf}/${c.cargo}: ${c.nomeUrna} tem número "${c.numero}" com ${c.numero.length} dígitos, esperado ${esperado}`);
        }

        // 3c. ordem padrão mecânica e declarada: número crescente (§1.3)
        if (i > 0) {
          const ant = a.candidatos[i - 1]!;
          if (Number(ant.numero) > Number(c.numero)) {
            falhar(`${uf}/${c.cargo}: lista fora de ordem por número (${ant.numero} antes de ${c.numero})`);
          }
        }

        // 3d. nada preenchido por inferência (§0.2)
        if (c.situacao.disponivel && c.situacao.registro === null) {
          falhar(`${uf}/${c.cargo}: ${c.nomeUrna} marca situação disponível sem valor`);
        }
      }
    }
  }

  // ---- 4. Conferência independente contra o consolidado do TSE ----
  await conferirContraConsolidado(meta, arquivos);

  // ---- 5. Situação de registro: aviso enquanto o TSE não publicar ----
  if (meta.situacaoRegistro.comSituacao === 0) {
    avisar(
      `situação de registro indisponível em ${meta.situacaoRegistro.semSituacao} candidaturas ` +
      `(DS_SITUACAO_CANDIDATURA = #NE). O alerta da §5.4 sobre registro indeferido/cassado ` +
      `não pode ser implementado até o TSE publicar. A interface deve dizer isso, não omitir.`,
    );
  }

  // ---- 6. Anomalias do dado: nunca falham o build, sempre aparecem ----
  if (meta.anomalias.length > 0) {
    avisar(`${meta.anomalias.length} anomalias no dado do TSE — devem aparecer na aba de transparência (§6.2)`);
  }

  relatar();
}

/**
 * Confere a contagem contra o consolidado do TSE.
 *
 * consulta_cand_2026_BRASIL.csv é gerado pelo TSE separadamente dos arquivos
 * por UF, então comparar com ele é conferência independente — não é a nossa
 * própria soma conferindo a si mesma.
 *
 * A contagem esperada foi gravada no meta.json durante a coleta, porque o ZIP
 * bruto não é versionado e o CI precisa validar o dado já commitado. Quando o
 * ZIP está presente, refazemos a leitura a partir dele: isso pega tanto um
 * pipeline que perdeu candidato quanto um meta.json adulterado.
 */
async function conferirContraConsolidado(meta: Meta, arquivos: ArquivoCargo[]): Promise<void> {
  const esperado = meta.conferencia?.esperado;
  if (!esperado || Object.keys(esperado).length === 0) {
    falhar("meta.json não traz a contagem do consolidado do TSE — rode o normalize de novo");
    return;
  }

  for (const a of arquivos) {
    const chave = a.cargo === "presidente" ? "BR/presidente" : `${a.uf}/${a.cargo}`;
    const n = esperado[chave];
    if (n === undefined) {
      falhar(`${a.uf}/${a.cargo}: cargo inexistente no consolidado do TSE`);
    } else if (n !== a.total) {
      falhar(
        `CONTAGEM DIVERGE — ${a.uf}/${a.cargo}: geramos ${a.total}, o consolidado do TSE tem ${n}. ` +
        `Isto é bug de pipeline, nunca escolha editorial (§1.3).`,
      );
    } else {
      console.log(`  ✓ ${chave.padEnd(28)} ${a.total} candidatos — bate com o consolidado do TSE`);
    }
  }

  await reconferirComOriginal(esperado);
}

/** Se o ZIP baixado estiver por perto, refaz a contagem a partir dele. */
async function reconferirComOriginal(esperado: Record<string, number>): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readFile(new URL("consulta_cand_2026.zip", DIR_RAW));
  } catch {
    console.log("  · ZIP bruto ausente: conferência feita contra o registro do meta.json");
    return;
  }

  const consolidado = lerZip(bytes).find((e) => e.nome === "consulta_cand_2026_BRASIL.csv");
  if (!consolidado) {
    avisar("consulta_cand_2026_BRASIL.csv ausente do ZIP — releitura não executada");
    return;
  }

  const relido: Record<string, number> = {};
  for (const l of lerCsvTse(consolidado.conteudo()).linhas) {
    const cargo = CARGOS_VOTAVEIS[l["CD_CARGO"] ?? ""];
    if (!cargo) continue;
    const uf = cargo === "presidente" ? "BR" : (l["SG_UF"] ?? "");
    const chave = `${uf}/${cargo}`;
    relido[chave] = (relido[chave] ?? 0) + 1;
  }

  for (const [chave, n] of Object.entries(relido)) {
    if (esperado[chave] !== undefined && esperado[chave] !== n) {
      falhar(`meta.json diz ${esperado[chave]} para ${chave}, mas o arquivo do TSE tem ${n}`);
    }
  }
  console.log("  ✓ releitura do arquivo original do TSE confere com o meta.json");
}

function relatar(): void {
  console.log();
  for (const a of avisos) console.log(`AVISO   ${a}\n`);
  for (const f of falhas) console.log(`FALHA   ${f}`);
  if (falhas.length > 0) {
    console.error(`\n${falhas.length} invariante(s) violada(s). Não publique.`);
    process.exit(1);
  }
  console.log(`Todas as invariantes passaram. ${avisos.length} aviso(s).`);
}

await main();
