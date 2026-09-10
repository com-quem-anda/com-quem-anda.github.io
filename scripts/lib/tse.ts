/** Constantes e mapeamentos do TSE, verificados contra o pacote de 2026. */
import type { Cargo } from "./types.ts";

export const ANO = 2026;

export const URL_CANDIDATOS =
  "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip";

export const URL_CKAN =
  "https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2026";

/** CD_CARGO -> chave interna. Confirmado no dado: 27 UFs + BR. */
export const CARGOS_VOTAVEIS: Record<string, Cargo> = {
  "1": "presidente",
  "3": "governador",
  "5": "senador",
  "6": "deputado-federal",
  "7": "deputado-estadual",
  "8": "deputado-distrital",
};

/** Cargos que compõem chapa com um titular, e não entram em lista de voto. */
export const CARGO_VICE = "4";
export const CARGO_VICE_PRESIDENTE = "2";
export const CARGO_SUPLENTE_1 = "9";
export const CARGO_SUPLENTE_2 = "10";

/** Titular -> cargos vinculados que devem ser aninhados nele. */
export const VINCULOS: Record<string, string[]> = {
  "1": [CARGO_VICE_PRESIDENTE],
  "3": [CARGO_VICE],
  "5": [CARGO_SUPLENTE_1, CARGO_SUPLENTE_2],
};

/** Dígitos esperados do número na urna, por cargo (invariante da §4). */
export const DIGITOS: Record<Cargo, number> = {
  presidente: 2,
  governador: 2,
  senador: 3,
  "deputado-federal": 4,
  "deputado-estadual": 5,
  "deputado-distrital": 5,
};

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "BR", "CE", "DF", "ES", "GO", "MA", "MG", "MS",
  "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE",
  "SP", "TO",
] as const;

/** Converte "dd/mm/aaaa" do TSE para ISO, ou null. */
export function dataIso(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
