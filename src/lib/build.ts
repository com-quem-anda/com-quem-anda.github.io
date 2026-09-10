/** Leitura do data/build/ em tempo de build. Nada disto vai para o navegador. */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const DIR = new URL("../../data/build/", import.meta.url);

export interface Meta {
  geradoEm: string;
  ufs: string[];
  fonte: { nome: string; url: string; licenca: string; sha256: string };
  contagens: Record<string, Record<string, number>>;
  linhasCsvLidas: number;
  situacaoRegistroDisponivel: boolean;
  situacaoRegistro: { comSituacao: number; semSituacao: number; observacao: string | null };
  anomalias: { tipo: string; uf: string; cargo: string; detalhe: string; sq: string[] }[];
}

export const meta = (): Meta => JSON.parse(readFileSync(new URL("meta.json", DIR), "utf8"));

export const ufsDisponiveis = (): string[] =>
  existsSync(DIR)
    ? readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];

export const NOME_UF: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso", PA: "Pará",
  PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul",
  SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

/** Data legível em pt-BR a partir de ISO. */
export function dataBr(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}
