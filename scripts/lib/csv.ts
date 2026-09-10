/**
 * Parser dos CSVs do TSE.
 *
 * Armadilhas tratadas (§3.1 da spec): encoding latin-1, separador ";",
 * campos entre aspas duplas com aspas escapadas por duplicação, quebras CRLF.
 * Hoje o dataset não traz separador dentro de campo, mas o layout permite —
 * então o parser é de estado, não split(";").
 */

/** Valores que o TSE usa para dizer "não há dado". Viram null, nunca string. */
const SENTINELAS = new Set(["#NULO#", "#NULO", "#NE#", "#NE", "-1", "-3", ""]);

export function limparValor(v: string): string | null {
  const t = v.trim();
  return SENTINELAS.has(t) ? null : t;
}

/** Divide uma linha respeitando aspas. */
function dividirLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]!;
    if (dentroDeAspas) {
      if (c === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i++; }  // "" escapa uma aspa
        else dentroDeAspas = false;
      } else atual += c;
    } else if (c === '"') {
      dentroDeAspas = true;
    } else if (c === sep) {
      campos.push(atual); atual = "";
    } else atual += c;
  }
  campos.push(atual);
  return campos;
}

export interface CsvTse {
  colunas: string[];
  /** Cada linha como mapa coluna -> valor bruto (ainda com sentinelas). */
  linhas: Record<string, string>[];
}

export function lerCsvTse(bytes: Buffer, sep = ";"): CsvTse {
  const texto = new TextDecoder("latin1").decode(bytes);
  const linhasBrutas = texto.split(/\r?\n/).filter((l) => l.length > 0);
  if (linhasBrutas.length === 0) throw new Error("CSV vazio");

  const colunas = dividirLinha(linhasBrutas[0]!, sep).map((c) => c.trim());
  const linhas: Record<string, string>[] = [];

  for (let i = 1; i < linhasBrutas.length; i++) {
    const campos = dividirLinha(linhasBrutas[i]!, sep);
    if (campos.length !== colunas.length) {
      throw new Error(
        `CSV: linha ${i + 1} tem ${campos.length} campos, esperado ${colunas.length}. ` +
        `O layout do TSE mudou — conferir antes de gerar dados.`,
      );
    }
    const registro: Record<string, string> = {};
    for (let j = 0; j < colunas.length; j++) registro[colunas[j]!] = campos[j]!;
    linhas.push(registro);
  }

  return { colunas, linhas };
}
