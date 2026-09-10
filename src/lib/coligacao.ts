/**
 * Leitura da composição de coligação declarada pelo TSE.
 *
 * O campo vem como texto: "REPUBLICANOS / PL / MDB / FEDERAÇÃO UNIÃO
 * PROGRESSISTA (UNIÃO / PP)". Federações aparecem pelo nome, com os partidos
 * integrantes entre parênteses — e são os integrantes que interessam.
 */

/** Extrai as siglas de partido de uma composição declarada. */
export function partidosDaColigacao(composicao: string | null): Set<string> {
  const siglas = new Set<string>();
  if (!composicao) return siglas;

  // 1. Partidos dentro de parênteses são os integrantes de uma federação.
  for (const m of composicao.matchAll(/\(([^)]*)\)/g)) {
    for (const p of m[1]!.split("/")) {
      const s = p.trim();
      if (s) siglas.add(s);
    }
  }

  // 2. Fora dos parênteses ficam os partidos avulsos e os nomes das federações;
  //    o nome da federação é descartado porque seus integrantes já entraram.
  const semParenteses = composicao.replace(/\([^)]*\)/g, "");
  for (const p of semParenteses.split("/")) {
    const s = p.trim();
    if (s && !/^FEDERAÇÃO\b/i.test(s)) siglas.add(s);
  }

  return siglas;
}
