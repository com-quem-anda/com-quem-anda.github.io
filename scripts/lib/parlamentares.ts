/**
 * Liga candidatura de 2026 a mandato em exercício.
 *
 * É a chave de junção que qualquer avaliação externa de desempenho vai exigir:
 * antes de trazer nota de alguém, é preciso saber de quem se está falando. A
 * fonte aqui é oficial e aberta — Câmara e Senado —, então esta camada existe
 * independentemente de qualquer acordo com terceiros.
 *
 * O casamento é por nome normalizado mais UF. Não é infalível: homônimo dentro
 * da mesma UF colidiria. Por isso o resultado carrega `confianca` e o build
 * reporta quantos casaram, para o número ser conferível em vez de confiável
 * por decreto.
 */

export interface Mandato {
  casa: "camara" | "senado";
  /** id na API da Câmara; o Senado não expõe id estável na lista de exercício. */
  id: number | null;
  nome: string;
  uf: string;
  partido: string;
}

export interface Vinculo {
  sq: string;
  mandato: Mandato;
  /** "nome-urna" casa o nome de urna; "nome-civil" casa o nome completo. */
  confianca: "nome-urna" | "nome-civil";
}

/** Maiúsculas, sem acento, sem pontuação — "JOSÉ DA SILVA-NETO" vira "JOSE DA SILVA NETO". */
export function normalizarNome(s: string): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const chave = (nome: string, uf: string) => `${normalizarNome(nome)}|${uf}`;

export interface IndiceMandatos {
  porNomeUrna: Map<string, Mandato>;
  porNomeCivil: Map<string, Mandato>;
  /**
   * Sem UF na chave, para o cargo nacional. Candidato a presidente tem
   * SG_UF = "BR" no TSE, então exigir UF igual descartaria justamente quem
   * tem mandato e disputa o Planalto — foi assim que Flávio Bolsonaro, senador
   * pelo RJ, deixou de casar na primeira versão.
   */
  porNomeSemUf: Map<string, Mandato>;
  /** Nomes que aparecem duas vezes na mesma chave: casamento ambíguo, não se usa. */
  ambiguos: Set<string>;
}

export function indexarMandatos(mandatos: { m: Mandato; nomeUrna: string; nomeCivil?: string }[]): IndiceMandatos {
  const porNomeUrna = new Map<string, Mandato>();
  const porNomeCivil = new Map<string, Mandato>();
  const porNomeSemUf = new Map<string, Mandato>();
  const ambiguos = new Set<string>();

  const por = (mapa: Map<string, Mandato>, nome: string, uf: string, m: Mandato) => {
    const k = chave(nome, uf);
    if (!k.startsWith("|")) {
      if (mapa.has(k) && mapa.get(k) !== m) ambiguos.add(k);
      mapa.set(k, m);
    }
  };
  for (const { m, nomeUrna, nomeCivil } of mandatos) {
    por(porNomeUrna, nomeUrna, m.uf, m);
    por(porNomeSemUf, nomeUrna, "BR", m);
    if (nomeCivil) {
      por(porNomeCivil, nomeCivil, m.uf, m);
      por(porNomeSemUf, nomeCivil, "BR", m);
    }
  }
  return { porNomeUrna, porNomeCivil, porNomeSemUf, ambiguos };
}

/**
 * Casa um candidato. Tenta nome de urna primeiro, depois nome civil.
 * Devolve null em ambiguidade: nome repetido na mesma UF não vira palpite.
 */
export function casar(
  candidato: { sq: string; uf: string; nomeUrna: string; nomeCompleto: string },
  indice: IndiceMandatos,
): Vinculo | null {
  const kUrna = chave(candidato.nomeUrna, candidato.uf);
  const kCivil = chave(candidato.nomeCompleto, candidato.uf);
  if (indice.ambiguos.has(kUrna) || indice.ambiguos.has(kCivil)) return null;

  // Cargo nacional: o mandato é de um estado, a candidatura não é de nenhum.
  if (candidato.uf === "BR") {
    const porUrnaBr = indice.porNomeSemUf.get(kUrna);
    if (porUrnaBr) return { sq: candidato.sq, mandato: porUrnaBr, confianca: "nome-urna" };
    const porCivilBr = indice.porNomeSemUf.get(kCivil);
    if (porCivilBr) return { sq: candidato.sq, mandato: porCivilBr, confianca: "nome-civil" };
    return null;
  }

  const porUrna = indice.porNomeUrna.get(kUrna) ?? indice.porNomeCivil.get(kUrna);
  if (porUrna) return { sq: candidato.sq, mandato: porUrna, confianca: "nome-urna" };

  const porCivil = indice.porNomeCivil.get(kCivil) ?? indice.porNomeUrna.get(kCivil);
  if (porCivil) return { sq: candidato.sq, mandato: porCivil, confianca: "nome-civil" };

  return null;
}
