/** Modelo de dados da Cédula Aberta (§4 da spec, ajustado ao layout real de 2026). */

export type Cargo =
  | "presidente"
  | "governador"
  | "senador"
  | "deputado-federal"
  | "deputado-estadual"
  | "deputado-distrital";

export interface Partido {
  sigla: string;
  numero: string;
  nome: string;
}

export interface Federacao {
  sigla: string;
  nome: string;
  composicao: string | null;
}

/**
 * Situação do registro (§5.4 depende disto).
 *
 * Em 2026 o TSE ainda publica "#NE" em 100% das linhas e o layout não traz
 * DS_DETALHE_SITUACAO_CAND. Por isso `disponivel` existe: a interface precisa
 * distinguir "deferido" de "o TSE ainda não disse", e nunca inventar o segundo.
 */
export interface SituacaoRegistro {
  disponivel: boolean;
  registro: string | null;
  codigo: string | null;
}

/** Vice ou suplente: compõe a chapa, não é votável isoladamente. */
export interface Vinculado {
  sq: string;
  cargo: string;
  nomeUrna: string;
  nomeCompleto: string;
  partido: Partido;
  situacao: SituacaoRegistro;
}

export interface Candidato {
  sq: string;
  uf: string;
  cargo: Cargo;
  numero: string;
  nomeUrna: string;
  nomeCompleto: string;
  nomeSocial: string | null;
  partido: Partido;
  federacao: Federacao | null;
  coligacao: { nome: string | null; composicao: string | null; sq: string | null };
  situacao: SituacaoRegistro;
  /** Vices (governador/presidente) e suplentes (senador), aninhados na chapa. */
  vice?: Vinculado[];
  suplentes?: Vinculado[];
  /**
   * Proposta de governo. Só existe para cargos majoritários.
   *
   * A ferramenta não hospeda nem processa o PDF: informa que ele existe e liga
   * para a página oficial do candidato no TSE.
   */
  proposta?: {
    arquivos: number;
    bytes: number;
    urlTse: string;
    coletadoEm: string;
  };
}

export interface ArquivoCargo {
  uf: string;
  cargo: Cargo;
  eleicao: { ano: number; codigo: string; descricao: string; dataPleito: string | null };
  geradoEm: string;
  fonte: string;
  total: number;
  candidatos: Candidato[];
}

export interface Anomalia {
  tipo: string;
  uf: string;
  cargo: string;
  detalhe: string;
  /** SQ_CANDIDATO envolvidos — para a aba de transparência poder mostrar quais. */
  sq: string[];
}
