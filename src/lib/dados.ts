/**
 * Carregamento dos JSONs de candidatos.
 *
 * Um cargo por vez, sob demanda (§1.4): abrir a cédula não pode baixar os
 * 1.430 deputados estaduais antes de a pessoa pedir a lista.
 */
import type { ArquivoCargo, Candidato, Cargo } from "./tipos.ts";

const cache = new Map<string, Promise<ArquivoCargo>>();

export function caminhoCargo(uf: string, cargo: Cargo): string {
  return `/dados/${uf}/${cargo}.json`;
}

export function carregarCargo(uf: string, cargo: Cargo): Promise<ArquivoCargo> {
  const chave = `${uf}/${cargo}`;
  const emCache = cache.get(chave);
  if (emCache) return emCache;

  const p = fetch(caminhoCargo(uf, cargo))
    .then((r) => {
      if (!r.ok) throw new Error(`Não foi possível carregar ${chave} (${r.status})`);
      return r.json() as Promise<ArquivoCargo>;
    })
    .catch((erro) => {
      cache.delete(chave);  // permite nova tentativa quando a rede voltar
      throw erro;
    });

  cache.set(chave, p);
  return p;
}

/** Texto sem acento e em maiúsculas, para busca por nome (§1.4). */
export function normalizarBusca(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

/**
 * Casa por prefixo de número ou por trecho de nome sem acento.
 * O número tem prioridade: no celular a pessoa digita 111, não "Guilherme".
 */
export function filtrar(candidatos: readonly Candidato[], termo: string): Candidato[] {
  const t = normalizarBusca(termo.trim());
  if (!t) return [...candidatos];

  if (/^\d+$/.test(t)) {
    const porNumero = candidatos.filter((c) => c.numero.startsWith(t));
    if (porNumero.length > 0) return porNumero;
  }
  return candidatos.filter(
    (c) =>
      normalizarBusca(c.nomeUrna).includes(t) ||
      normalizarBusca(c.nomeCompleto).includes(t) ||
      normalizarBusca(c.partido.sigla).includes(t) ||
      c.numero.startsWith(t),
  );
}
