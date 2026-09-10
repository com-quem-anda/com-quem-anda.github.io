/**
 * Tipos do lado do navegador.
 *
 * Espelham scripts/lib/types.ts de propósito: o front consome só o que o
 * pipeline promete no JSON, e um teste confere que os dois não divergiram.
 */
export type Cargo =
  | "presidente"
  | "governador"
  | "senador"
  | "deputado-federal"
  | "deputado-estadual"
  | "deputado-distrital";

export interface Partido { sigla: string; numero: string; nome: string }

export interface SituacaoRegistro {
  disponivel: boolean;
  registro: string | null;
  codigo: string | null;
}

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
  federacao: { sigla: string; nome: string; composicao: string | null } | null;
  coligacao: { nome: string | null; composicao: string | null; sq: string | null };
  situacao: SituacaoRegistro;
  vice?: Vinculado[];
  suplentes?: Vinculado[];
  /** Só para cargos majoritários. O PDF vive no TSE, não aqui. */
  proposta?: {
    arquivos: number;
    bytes: number;
    urlTse: string;
    coletadoEm: string;
  };
}

/** Cargos para os quais o TSE exige proposta de governo. */
export const CARGOS_COM_PROPOSTA: Cargo[] = ["presidente", "governador"];

export interface ArquivoCargo {
  uf: string;
  cargo: Cargo;
  eleicao: { ano: number; codigo: string; descricao: string; dataPleito: string | null };
  geradoEm: string;
  fonte: string;
  total: number;
  candidatos: Candidato[];
}

export const NOME_CARGO: Record<Cargo, string> = {
  presidente: "Presidente",
  governador: "Governador",
  senador: "Senador",
  "deputado-federal": "Deputado federal",
  "deputado-estadual": "Deputado estadual",
  "deputado-distrital": "Deputado distrital",
};
