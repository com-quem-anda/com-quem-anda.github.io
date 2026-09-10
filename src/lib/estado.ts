/**
 * Estado do usuário. Chave única em localStorage, nada mais (§8).
 *
 * Nenhum byte disto sai do navegador. Não há requisição de rede depois do
 * carregamento dos assets — existe um teste que falha se aparecer alguma.
 */
import type { Candidato, Cargo } from "./tipos.ts";

export const CHAVE = "cedula-aberta";

/** Ordem da urna. É esta a sequência dos slots, e ela não é configurável. */
export const ORDEM_URNA: Cargo[] = [
  "deputado-estadual",
  "deputado-federal",
  "senador",
  "senador",
  "governador",
  "presidente",
];

export type Tema = "sistema" | "claro" | "escuro";

export interface Estado {
  versao: 1;
  tema: Tema;
  uf: string | null;
  /**
   * Índice do slot (0..5) -> candidato escolhido. Senado ocupa os slots 2 e 3.
   *
   * Guarda o candidato inteiro, e não só o SQ_CANDIDATO, para a cédula
   * reaparecer instantaneamente ao abrir — sem buscar os cinco JSONs de cargo
   * antes de desenhar a primeira tela (§1.4), e sem depender de rede nenhuma
   * dentro da escola no dia da eleição. Quando a lista do cargo é carregada,
   * o registro fresco do TSE prevalece sobre esta cópia.
   */
  votos: Record<number, Candidato>;
}

const inicial = (): Estado => ({ versao: 1, tema: "sistema", uf: null, votos: {} });

export function ler(): Estado {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return inicial();
    const e = JSON.parse(bruto) as Partial<Estado>;
    return {
      versao: 1,
      tema: e.tema === "claro" || e.tema === "escuro" ? e.tema : "sistema",
      uf: typeof e.uf === "string" ? e.uf : null,
      votos: votosValidos(e.votos),
    };
  } catch {
    // Navegador anônimo, cookies bloqueados, cota estourada: seguir sem estado.
    return inicial();
  }
}

/** Descarta o que não for um candidato completo — inclusive formato antigo. */
function votosValidos(v: unknown): Record<number, Candidato> {
  if (!v || typeof v !== "object") return {};
  const saida: Record<number, Candidato> = {};
  for (const [slot, c] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(slot);
    if (!Number.isInteger(n) || n < 0 || n > 5) continue;
    if (c && typeof c === "object" && typeof (c as Candidato).sq === "string" && typeof (c as Candidato).numero === "string") {
      saida[n] = c as Candidato;
    }
  }
  return saida;
}

export function gravar(e: Estado): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(e));
  } catch {
    // Falhar em gravar não pode derrubar a cédula da tela.
  }
}

export function atualizar(fn: (e: Estado) => Estado): Estado {
  const novo = fn(ler());
  gravar(novo);
  return novo;
}

export function limpar(): void {
  try { localStorage.removeItem(CHAVE); } catch { /* idem */ }
}
