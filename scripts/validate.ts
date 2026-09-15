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
import { chaveAresta, expandirComposicao, type GrafoAlianca } from "./lib/alianca.ts";
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
  // Grafias de partido vistas em cada lugar, para cruzar depois (ver §7).
  const siglasDeCandidato = new Set<string>();
  const nomesEmComposicao = new Set<string>();

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
        siglasDeCandidato.add(c.partido.sigla);
        for (const v of [...(c.vice ?? []), ...(c.suplentes ?? [])]) siglasDeCandidato.add(v.partido.sigla);
        if (c.coligacao.composicao) for (const p of expandirComposicao(c.coligacao.composicao)) nomesEmComposicao.add(p);
        if (c.federacao) for (const p of expandirComposicao(c.federacao.composicao ?? c.federacao.sigla)) nomesEmComposicao.add(p);

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

  // ---- 7. Grafo de aliança ----
  await conferirAlianca(siglasDeCandidato, nomesEmComposicao);

  relatar();
}

/**
 * consulta_cand_2026_BRASIL.csv é gerado pelo TSE separadamente dos arquivos por
 * UF. Contar nele e bater com o que emitimos é uma conferência de verdade
 * independente, e não a nossa própria soma conferindo a si mesma.
 */
async function conferirContraConsolidado(meta: Meta, arquivos: ArquivoCargo[]): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readFile(new URL("consulta_cand_2026.zip", DIR_RAW));
  } catch {
    // data/raw fica fora do git, então em clone novo o pacote não existe. Dizer
    // isso é útil; morrer com ENOENT cru em cima do stack trace não é.
    avisar(
      "consulta_cand_2026.zip ausente em data/raw — rode `npm run fetch`. " +
      "A conferência independente contra o consolidado do TSE NÃO foi executada.",
    );
    return;
  }
  const zip = lerZip(bytes);
  const consolidado = zip.find((e) => e.nome === "consulta_cand_2026_BRASIL.csv");
  if (!consolidado) {
    avisar("consulta_cand_2026_BRASIL.csv ausente — conferência independente não executada");
    return;
  }

  const { linhas } = lerCsvTse(consolidado.conteudo());
  const esperadoTse = new Map<string, number>();
  for (const l of linhas) {
    const cargo = CARGOS_VOTAVEIS[l["CD_CARGO"] ?? ""];
    if (!cargo) continue;  // vices e suplentes contam pela chapa, não pela lista
    const uf = cargo === "presidente" ? "BR" : (l["SG_UF"] ?? "");
    esperadoTse.set(`${uf}/${cargo}`, (esperadoTse.get(`${uf}/${cargo}`) ?? 0) + 1);
  }

  for (const a of arquivos) {
    const chave = a.cargo === "presidente" ? `BR/presidente` : `${a.uf}/${a.cargo}`;
    const esperado = esperadoTse.get(chave);
    if (esperado === undefined) {
      falhar(`${a.uf}/${a.cargo}: cargo inexistente no consolidado do TSE`);
    } else if (esperado !== a.total) {
      falhar(
        `CONTAGEM DIVERGE — ${a.uf}/${a.cargo}: geramos ${a.total}, o consolidado do TSE tem ${esperado}. ` +
        `Isto é bug de pipeline, nunca escolha editorial (§1.3).`,
      );
    } else {
      console.log(`  ✓ ${chave.padEnd(28)} ${a.total} candidatos — bate com o consolidado do TSE`);
    }
  }
}

/**
 * Invariantes do grafo de proximidade.
 *
 * O piso de conjuntos existe por causa de um erro real: com os 11 conjuntos de
 * uma UF só, MDB~PL cravava 1,00 porque coincidiram uma vez em São Paulo. Com
 * as 27 UFs o mesmo par cai para 0,10. Grafo magro não é grafo impreciso, é
 * grafo errado, e não pode ser publicado.
 */
const MINIMO_CONJUNTOS = 100;

async function conferirAlianca(siglasDeCandidato: Set<string>, nomesEmComposicao: Set<string>): Promise<void> {
  let g: GrafoAlianca & { ufs?: string[] };
  try {
    g = JSON.parse(await readFile(new URL("alianca.json", DIR_BUILD), "utf8"));
  } catch {
    avisar("alianca.json ausente — rode `npm run alianca`. A camada de coerência não tem grafo.");
    return;
  }

  if (g.conjuntos < MINIMO_CONJUNTOS) {
    falhar(
      `alianca.json: só ${g.conjuntos} conjuntos de aliança (mínimo ${MINIMO_CONJUNTOS}). ` +
      `Gere com --uf=all: um grafo montado sobre poucas UFs inventa afinidade a partir de coincidência.`,
    );
  }

  // Grafia: todo nome citado em composição tem que existir como SG_PARTIDO.
  // Foi assim que "PC do B" x "PCDOB" apareceu — e ele zerava, em silêncio,
  // todas as arestas de um partido federado ao PT.
  const orfaos = [...nomesEmComposicao].filter((p) => !siglasDeCandidato.has(p)).sort();
  if (orfaos.length > 0) {
    falhar(
      `grafia de partido sem correspondência em SG_PARTIDO: ${orfaos.join(", ")}. ` +
      `Some um apelido em APELIDOS (lib/alianca.ts) — enquanto isso, estes partidos têm ` +
      `proximidade zero contra todos, sem nenhum aviso na interface.`,
    );
  }

  const conhecidos = new Set(g.partidos);
  for (const [chave, e] of Object.entries(g.proximidade)) {
    const partes = chave.split("|");
    const [a, b] = [partes[0] ?? "", partes[1] ?? ""];

    if (partes.length !== 2 || chaveAresta(a, b) !== chave) {
      falhar(`alianca.json: chave de aresta "${chave}" fora da forma canônica`);
    }
    for (const p of [a, b]) {
      if (!conhecidos.has(p)) falhar(`alianca.json: aresta "${chave}" cita partido ausente de partidos[]: ${p}`);
    }
    if (!(e.v > 0 && e.v <= 1)) falhar(`alianca.json: ${chave} tem v=${e.v} fora de (0,1]`);
    if (e.n < 1) falhar(`alianca.json: ${chave} tem v=${e.v} com n=${e.n} — proximidade sem coincidência que a sustente`);
    if (!(e.ic[0] <= e.v && e.v <= e.ic[1])) {
      falhar(`alianca.json: ${chave} tem v=${e.v} fora do próprio IC [${e.ic[0]}, ${e.ic[1]}]`);
    }
  }

  for (const [partido, sigla] of Object.entries(g.federacao)) {
    if (!conhecidos.has(partido)) {
      avisar(`alianca.json: ${partido} está na federação ${sigla} mas não aparece em nenhuma coligação majoritária`);
    }
  }

  const fragil = Object.entries(g.proximidade).filter(([, e]) => e.n < 3);
  if (fragil.length > 0) {
    avisar(
      `${fragil.length} arestas do grafo se apoiam em menos de 3 coincidências. ` +
      `A interface tem que marcá-las como frágeis, nunca exibi-las como as demais.`,
    );
  }

  console.log(`  ✓ alianca.json ${String(g.conjuntos).padStart(19)} conjuntos, ${Object.keys(g.proximidade).length} arestas, ${g.partidos.length} partidos`);
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
