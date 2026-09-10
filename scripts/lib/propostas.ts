/**
 * Índice de propostas de governo.
 *
 * Decisão de produto: o PDF NÃO é baixado, hospedado, extraído nem resumido.
 * A ferramenta apenas informa que a proposta existe e liga para a página
 * oficial do candidato no TSE. Isso elimina de uma vez o risco do §12 nº 3
 * (resumo gerado por IA sair errado) e a dívida de OCR do §3.3.
 *
 * O que continua sendo nosso trabalho: saber QUEM registrou proposta, sem o
 * que o link viraria promessa vazia. Isso vem do índice do pacote oficial,
 * lido por requisição Range — cerca de 8 KB por UF (ver zip-remoto.ts).
 */
import type { Cargo } from "./types.ts";

/** Só cargos majoritários registram proposta. Verificado no dado de 2026:
 *  13 de 13 presidentes e 6 de 7 governadores de SP têm arquivo; senadores,
 *  nenhum. */
export const CARGOS_COM_PROPOSTA: Cargo[] = ["presidente", "governador"];

export const urlPacote = (uf: string): string =>
  `https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2026_${uf}.zip`;

/**
 * Página oficial do candidato no DivulgaCandContas, onde a proposta é
 * publicada pelo próprio TSE.
 *
 * O código da eleição é diferente para o pleito federal (6257) e para cada
 * pleito estadual (6259 em SP) — por isso vem do dado, nunca fixo no código.
 */
export const urlCandidatoNoTse = (cdEleicao: string, sgUe: string, sq: string): string =>
  `https://divulgacandcontas.tse.jus.br/divulga/#/candidato/2026/${cdEleicao}/${sgUe}/${sq}`;

/** "SP/2026SP250002549705_01.pdf" -> { sq, sequencial } */
export function lerNomeArquivo(nome: string): { sq: string; sequencial: string } | null {
  const m = /(?:^|\/)2026[A-Z]{2}(\d+)_(\d+)\.pdf$/i.exec(nome);
  return m ? { sq: m[1]!, sequencial: m[2]! } : null;
}

export interface IndiceProposta {
  /** Quantos arquivos a campanha registrou. Pode ser mais de um. */
  arquivos: number;
  /** Soma dos tamanhos, para a interface avisar antes de alguém baixar 7 MB. */
  bytes: number;
}

export interface ArquivoPropostas {
  geradoEm: string;
  metodo: string;
  pacotes: Record<string, { url: string; arquivos: number; atualizadoEm: string | null }>;
  /** SQ_CANDIDATO -> índice. */
  porCandidato: Record<string, IndiceProposta>;
}
