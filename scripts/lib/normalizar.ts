/**
 * Lógica pura de normalização — sem I/O, para poder ser testada isoladamente.
 *
 * Duas regras estruturais mandam neste arquivo:
 *  1. Nada é removido. Registro duplicado ou chapa incoerente vira anomalia
 *     declarada, nunca linha descartada em silêncio (§1.3).
 *  2. Nada é inferido. Campo sem fonte vira null e a interface mostra o vazio
 *     como vazio (§0.2).
 */
import { limparValor } from "./csv.ts";
import { CARGOS_VOTAVEIS, VINCULOS } from "./tse.ts";
import type { Anomalia, Candidato, Cargo, SituacaoRegistro, Vinculado } from "./types.ts";

export type Linha = Record<string, string>;

/** Quantas linhas já trouxeram situação de registro de fato (§5.4 depende disto). */
let situacaoConhecida = 0;
let situacaoAusente = 0;

/** Contadores de situação, para o meta.json. */
export const contadoresSituacao = () => ({ comSituacao: situacaoConhecida, semSituacao: situacaoAusente });
export const zerarContadoresSituacao = () => { situacaoConhecida = 0; situacaoAusente = 0; };

const v = (l: Linha, c: string): string | null => limparValor(l[c] ?? "");
const obrigatorio = (l: Linha, c: string): string => {
  const x = v(l, c);
  if (x === null) throw new Error(`campo obrigatório ausente: ${c} (SQ ${l["SQ_CANDIDATO"] ?? "?"})`);
  return x;
};

export function situacao(l: Linha): SituacaoRegistro {
  const registro = v(l, "DS_SITUACAO_CANDIDATURA");
  if (registro === null) situacaoAusente++; else situacaoConhecida++;
  // "#NE" (não encontrado) vira disponivel:false — o TSE ainda não julgou os
  // registros de 2026. Jamais traduzir ausência para "deferido".
  return { disponivel: registro !== null, registro, codigo: v(l, "CD_SITUACAO_CANDIDATURA") };
}

export function partido(l: Linha) {
  return {
    sigla: obrigatorio(l, "SG_PARTIDO"),
    numero: obrigatorio(l, "NR_PARTIDO"),
    nome: obrigatorio(l, "NM_PARTIDO"),
  };
}

export function vinculado(l: Linha): Vinculado {
  return {
    sq: obrigatorio(l, "SQ_CANDIDATO"),
    cargo: obrigatorio(l, "DS_CARGO"),
    nomeUrna: obrigatorio(l, "NM_URNA_CANDIDATO"),
    nomeCompleto: obrigatorio(l, "NM_CANDIDATO"),
    partido: partido(l),
    situacao: situacao(l),
  };
}

export function candidato(l: Linha, uf: string, cargo: Cargo): Candidato {
  const sgFed = v(l, "SG_FEDERACAO");
  return {
    sq: obrigatorio(l, "SQ_CANDIDATO"),
    uf,
    cargo,
    numero: obrigatorio(l, "NR_CANDIDATO"),
    nomeUrna: obrigatorio(l, "NM_URNA_CANDIDATO"),
    nomeCompleto: obrigatorio(l, "NM_CANDIDATO"),
    nomeSocial: v(l, "NM_SOCIAL_CANDIDATO"),
    partido: partido(l),
    federacao: sgFed ? { sigla: sgFed, nome: v(l, "NM_FEDERACAO") ?? sgFed, composicao: v(l, "DS_COMPOSICAO_FEDERACAO") } : null,
    coligacao: {
      nome: v(l, "NM_COLIGACAO"),
      composicao: v(l, "DS_COMPOSICAO_COLIGACAO"),
      sq: v(l, "SQ_COLIGACAO"),
    },
    situacao: situacao(l),
  };
}

/** Agrupa linhas por CD_CARGO. */
export function porCargo(linhas: Linha[]): Map<string, Linha[]> {
  const m = new Map<string, Linha[]>();
  for (const l of linhas) {
    const cd = l["CD_CARGO"] ?? "";
    (m.get(cd) ?? m.set(cd, []).get(cd)!).push(l);
  }
  return m;
}

/** Índice de vinculados por número de chapa. */
export function porNumero(linhas: Linha[]): Map<string, Linha[]> {
  const m = new Map<string, Linha[]>();
  for (const l of linhas) {
    const n = l["NR_CANDIDATO"] ?? "";
    (m.get(n) ?? m.set(n, []).get(n)!).push(l);
  }
  return m;
}

export function processarUf(uf: string, linhas: Linha[], anomalias: Anomalia[]): Map<Cargo, Candidato[]> {
  const grupos = porCargo(linhas);
  const resultado = new Map<Cargo, Candidato[]>();
  const vinculadosUsados = new Set<string>();

  for (const [cd, cargo] of Object.entries(CARGOS_VOTAVEIS)) {
    const titulares = grupos.get(cd);
    if (!titulares || titulares.length === 0) continue;

    const cargosVinculados = VINCULOS[cd] ?? [];
    const indices = cargosVinculados.map((c) => [c, porNumero(grupos.get(c) ?? [])] as const);

    const lista: Candidato[] = titulares.map((l) => {
      const c = candidato(l, uf, cargo);
      for (const [cdVinc, indice] of indices) {
        const achados = indice.get(c.numero) ?? [];
        for (const a of achados) vinculadosUsados.add(a["SQ_CANDIDATO"]!);
        if (achados.length === 0) continue;
        const convertidos = achados.map(vinculado);
        // Vice e vice-presidente vão em `vice`; 1º/2º suplente em `suplentes`.
        if (cdVinc === "2" || cdVinc === "4") c.vice = [...(c.vice ?? []), ...convertidos];
        else c.suplentes = [...(c.suplentes ?? []), ...convertidos];
      }
      return c;
    });

    conferirChapas(uf, cargo, cd, lista, anomalias);
    conferirDuplicatas(uf, cargo, titulares, anomalias);

    // Ordem padrão obrigatória: número na urna, crescente (§1.3).
    lista.sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }) || a.nomeUrna.localeCompare(b.nomeUrna, "pt-BR"));
    resultado.set(cargo, lista);
  }

  // Vice ou suplente cujo número não casa com nenhum titular ficaria invisível.
  for (const cdVinc of ["2", "4", "9", "10"]) {
    for (const l of grupos.get(cdVinc) ?? []) {
      if (!vinculadosUsados.has(l["SQ_CANDIDATO"]!)) {
        anomalias.push({
          tipo: "vinculado-orfao",
          uf,
          cargo: l["DS_CARGO"] ?? cdVinc,
          detalhe: `${l["NM_URNA_CANDIDATO"]} (nº ${l["NR_CANDIDATO"]}) não casa com nenhum titular`,
          sq: [l["SQ_CANDIDATO"]!],
        });
      }
    }
  }

  return resultado;
}

export function conferirChapas(uf: string, cargo: Cargo, cd: string, lista: Candidato[], anomalias: Anomalia[]): void {
  if (!VINCULOS[cd]) return;
  const esperaSuplentes = cd === "5";
  for (const c of lista) {
    if (esperaSuplentes) {
      const n = c.suplentes?.length ?? 0;
      if (n !== 2) {
        anomalias.push({
          tipo: n === 0 ? "suplentes-ausentes" : "suplentes-cardinalidade",
          uf, cargo,
          detalhe: `${c.nomeUrna} (nº ${c.numero}) tem ${n} suplentes, esperado 2`,
          sq: [c.sq, ...(c.suplentes ?? []).map((s) => s.sq)],
        });
      }
    } else {
      const n = c.vice?.length ?? 0;
      if (n !== 1) {
        anomalias.push({
          tipo: n === 0 ? "vice-ausente" : "vice-multiplo",
          uf, cargo,
          detalhe: `${c.nomeUrna} (nº ${c.numero}) tem ${n} vices, esperado 1`,
          sq: [c.sq, ...(c.vice ?? []).map((s) => s.sq)],
        });
      }
    }
  }
}

export function conferirDuplicatas(uf: string, cargo: Cargo, titulares: Linha[], anomalias: Anomalia[]): void {
  const porCpf = new Map<string, Linha[]>();
  const porNum = new Map<string, Linha[]>();
  for (const l of titulares) {
    const cpf = l["NR_CPF_CANDIDATO"] ?? "";
    const num = l["NR_CANDIDATO"] ?? "";
    (porCpf.get(cpf) ?? porCpf.set(cpf, []).get(cpf)!).push(l);
    (porNum.get(num) ?? porNum.set(num, []).get(num)!).push(l);
  }
  for (const [cpf, ls] of porCpf) {
    if (ls.length > 1) {
      anomalias.push({
        tipo: "cpf-duplicado",
        uf, cargo,
        detalhe: `${ls[0]!["NM_URNA_CANDIDATO"]} aparece ${ls.length}x com o mesmo CPF (…${cpf.slice(-4)})`,
        sq: ls.map((l) => l["SQ_CANDIDATO"]!),
      });
    }
  }
  for (const [num, ls] of porNum) {
    if (ls.length > 1) {
      anomalias.push({
        tipo: "numero-duplicado",
        uf, cargo,
        detalhe: `nº ${num} usado por ${ls.length} candidaturas: ${ls.map((l) => l["NM_URNA_CANDIDATO"]).join(", ")}`,
        sq: ls.map((l) => l["SQ_CANDIDATO"]!),
      });
    }
  }
}

