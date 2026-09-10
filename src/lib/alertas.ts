/**
 * Alertas estruturais da cédula (§5.4).
 *
 * Todos são FATO derivável do dado do TSE, nunca opinião. Nenhum diz que uma
 * escolha é boa ou ruim — dizem o que ela é. Se um alerta aqui não puder ser
 * apontado para uma linha do CSV, ele não pertence a este arquivo.
 */
import { partidosDaColigacao } from "./coligacao.ts";
import { NOME_CARGO, type Candidato, type Cargo } from "./tipos.ts";

export type Gravidade = "alerta" | "aviso" | "informacao";

export interface Alerta {
  tipo: string;
  gravidade: Gravidade;
  titulo: string;
  detalhe: string;
}

export interface EntradaCedula {
  slot: number;
  cargo: Cargo;
  candidato: Candidato | null;
}

/**
 * @param entradas os 6 slots na ordem da urna
 * @param universo candidatos por cargo já carregados, para achar rivais
 * @param sqComAnomalia SQ_CANDIDATO que o pipeline marcou como anômalos
 */
export function alertasDaCedula(
  entradas: readonly EntradaCedula[],
  universo: Partial<Record<Cargo, readonly Candidato[]>>,
  sqComAnomalia: ReadonlySet<string> = new Set(),
): Alerta[] {
  const alertas: Alerta[] = [];

  // ---- 1. Voto repetido nas duas vagas de Senado ----
  const senado = entradas.filter((e) => e.cargo === "senador");
  const [s1, s2] = [senado[0]?.candidato, senado[1]?.candidato];
  if (s1 && s2 && s1.sq === s2.sq) {
    alertas.push({
      tipo: "senado-repetido",
      gravidade: "alerta",
      titulo: "O mesmo candidato ocupa as duas vagas de Senado",
      detalhe:
        `Você escolheu ${s1.nomeUrna} nas duas vagas. Na urna, o segundo voto igual ao ` +
        `primeiro é anulado — só um dos dois é computado.`,
    });
  }

  // ---- 2. Cargos não preenchidos ----
  const vazios = entradas.filter((e) => !e.candidato);
  if (vazios.length > 0) {
    const nomes = [...new Set(vazios.map((e) => NOME_CARGO[e.cargo]))];
    alertas.push({
      tipo: "cargo-vazio",
      gravidade: "aviso",
      titulo: `${vazios.length} ${vazios.length === 1 ? "voto ainda não escolhido" : "votos ainda não escolhidos"}`,
      detalhe: `Falta escolher: ${nomes.join(", ")}.`,
    });
  }

  // ---- 3. Presidente e governador em coligações adversárias ----
  alertas.push(...coligacaoAdversaria(entradas, universo));

  // ---- 4. Candidatura com registro duplicado no dado do TSE ----
  for (const e of entradas) {
    if (e.candidato && sqComAnomalia.has(e.candidato.sq)) {
      alertas.push({
        tipo: "candidatura-anomala",
        gravidade: "aviso",
        titulo: `A candidatura de ${e.candidato.nomeUrna} tem registro duplicado no TSE`,
        detalhe:
          `O mesmo número ou a mesma pessoa aparece mais de uma vez no arquivo oficial ` +
          `para ${NOME_CARGO[e.candidato.cargo].toLowerCase()}. Confira o número no seu ` +
          `título antes de votar. A lista completa das divergências está na página de transparência.`,
      });
    }
  }

  // ---- 5. Situação do registro: o alerta que ainda não tem fonte ----
  const semSituacao = entradas.filter((e) => e.candidato && !e.candidato.situacao.disponivel);
  if (semSituacao.length > 0) {
    alertas.push({
      tipo: "situacao-indisponivel",
      gravidade: "informacao",
      titulo: "O TSE ainda não publicou a situação dos registros",
      detalhe:
        "Não é possível dizer aqui se um registro está deferido, indeferido, cassado ou sub judice: " +
        "o campo vem vazio no arquivo oficial de 2026. Nenhuma candidatura desta cédula foi verificada " +
        "quanto a isso — nem por esta ferramenta, nem contra ela.",
    });
  }

  // O que é grave aparece primeiro; "faltam votos" não pode empurrar para
  // baixo um conflito de coligação.
  const peso: Record<Gravidade, number> = { alerta: 0, aviso: 1, informacao: 2 };
  return alertas.sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
}

function coligacaoAdversaria(
  entradas: readonly EntradaCedula[],
  universo: Partial<Record<Cargo, readonly Candidato[]>>,
): Alerta[] {
  const presidente = entradas.find((e) => e.cargo === "presidente")?.candidato;
  const governador = entradas.find((e) => e.cargo === "governador")?.candidato;
  if (!presidente || !governador) return [];

  const naColigacaoDoGovernador = partidosDaColigacao(governador.coligacao.composicao);
  if (naColigacaoDoGovernador.has(presidente.partido.sigla)) return [];

  // O partido do presidente escolhido não está na coligação do governador.
  // Isso só vira alerta se a coligação do governador apoiar outro presidenciável —
  // aí a divergência é um fato declarado no registro, não uma leitura nossa.
  const rivais = (universo.presidente ?? []).filter(
    (p) => p.sq !== presidente.sq && naColigacaoDoGovernador.has(p.partido.sigla),
  );
  if (rivais.length === 0) return [];

  const lista = rivais.map((p) => `${p.nomeUrna} (${p.partido.sigla})`).join(", ");
  return [{
    tipo: "coligacao-adversaria",
    gravidade: "alerta",
    titulo: "Seu governador e seu presidente estão em campos opostos",
    detalhe:
      `A coligação de ${governador.nomeUrna} reúne ${[...naColigacaoDoGovernador].join(", ")}. ` +
      `O ${presidente.partido.sigla}, partido de ${presidente.nomeUrna}, não está nela — ` +
      `mas ${rivais.length === 1 ? "está o partido de" : "estão os partidos de"} ${lista}, ` +
      `que ${rivais.length === 1 ? "disputa" : "disputam"} a Presidência. ` +
      `Isso é o que consta no registro das candidaturas; a decisão continua sendo sua.`,
  }];
}
