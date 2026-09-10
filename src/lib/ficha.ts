/**
 * Ficha do candidato: tela cheia no celular (§6.3).
 *
 * Mostra só o que o TSE publica, e mostra o vazio como vazio. Campo sem fonte
 * aparece dizendo que não há fonte — nunca sumindo da tela (§0.2).
 */
import { CARGOS_COM_PROPOSTA, NOME_CARGO, type Candidato } from "./tipos.ts";

export function abrirFicha(c: Candidato, escolhido: boolean): Promise<"escolher" | "fechar"> {
  return new Promise((resolver) => {
    const dialogo = document.createElement("dialog");
    dialogo.className = "ficha";

    const corpo = document.createElement("div");
    corpo.className = "ficha__corpo";

    const id = document.createElement("div");
    id.className = "ficha__id";
    const numero = document.createElement("span");
    numero.className = "numero";
    numero.textContent = c.numero;
    const nomes = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.id = "ficha-titulo";
    h2.style.margin = "0";
    h2.textContent = c.nomeUrna;
    const cargo = document.createElement("div");
    cargo.className = "slot__meta";
    cargo.textContent = `${NOME_CARGO[c.cargo]} · ${c.uf}`;
    nomes.append(h2, cargo);
    id.append(numero, nomes);
    dialogo.setAttribute("aria-labelledby", h2.id);

    const campos = document.createElement("dl");
    campos.className = "campos";

    campo(campos, "Nome completo", c.nomeCompleto);
    if (c.nomeSocial) campo(campos, "Nome social", c.nomeSocial);
    campo(campos, "Partido", `${c.partido.sigla} — ${c.partido.nome} (${c.partido.numero})`);
    campo(campos, "Federação", c.federacao ? `${c.federacao.nome} (${c.federacao.composicao ?? c.federacao.sigla})` : null,
      "não integra federação");
    campo(campos, "Coligação", c.coligacao.nome === "PARTIDO ISOLADO" ? "Partido isolado" : c.coligacao.nome);
    campo(campos, "Composição da coligação", c.coligacao.composicao);

    campo(
      campos,
      "Situação do registro",
      c.situacao.disponivel ? c.situacao.registro : null,
      "o TSE ainda não publicou este dado para 2026",
    );

    if (c.vice?.length) {
      campo(campos, c.vice.length > 1 ? "Vices registrados" : "Vice",
        c.vice.map((v) => `${v.nomeUrna} (${v.partido.sigla})`).join(" · "));
      if (c.vice.length > 1) {
        const nota = document.createElement("p");
        nota.className = "aviso-caixa aviso-caixa--aviso";
        nota.textContent =
          "O arquivo do TSE traz mais de um vice para esta chapa. Esta ferramenta não escolhe " +
          "qual vale — os dois estão acima, como constam no registro.";
        corpo.append(nota);
      }
    }
    if (c.suplentes?.length) {
      campo(campos, "Suplentes", c.suplentes.map((v) => `${v.nomeUrna} (${v.partido.sigla})`).join(" · "));
    }

    campo(campos, "Identificador no TSE (SQ_CANDIDATO)", c.sq);

    corpo.append(id, campos, blocoProposta(c));

    const base = document.createElement("div");
    base.className = "ficha__base";
    const escolher = document.createElement("button");
    escolher.type = "button";
    escolher.className = "botao botao--primario";
    escolher.textContent = escolhido ? "Já é o seu voto" : "Escolher";
    escolher.disabled = escolhido;
    const fechar = document.createElement("button");
    fechar.type = "button";
    fechar.className = "botao";
    fechar.textContent = "Voltar";
    base.append(fechar, escolher);

    dialogo.append(corpo, base);
    document.body.append(dialogo);

    const concluir = (r: "escolher" | "fechar"): void => {
      dialogo.close();
      dialogo.remove();
      resolver(r);
    };
    escolher.addEventListener("click", () => concluir("escolher"));
    fechar.addEventListener("click", () => concluir("fechar"));
    dialogo.addEventListener("cancel", (e) => { e.preventDefault(); concluir("fechar"); });

    dialogo.showModal();
  });
}

/**
 * Proposta de governo.
 *
 * O documento não é hospedado, extraído nem resumido aqui: o eleitor vai ler a
 * versão oficial, no TSE. Um resumo automático errado em ano eleitoral é
 * processo garantido, e nenhum ganho de conveniência paga esse risco.
 */
function blocoProposta(c: Candidato): HTMLElement {
  const secao = document.createElement("section");
  secao.className = "proposta";

  const titulo = document.createElement("h3");
  titulo.textContent = "Proposta de governo";
  secao.append(titulo);

  if (!CARGOS_COM_PROPOSTA.includes(c.cargo)) {
    const p = document.createElement("p");
    p.className = "vazio";
    p.textContent = `O TSE não exige proposta de governo para o cargo de ${NOME_CARGO[c.cargo].toLowerCase()}.`;
    secao.append(p);
    return secao;
  }

  if (!c.proposta) {
    const p = document.createElement("p");
    p.className = "vazio";
    p.textContent = "Não consta proposta registrada para este candidato na última coleta.";
    secao.append(p);
    return secao;
  }

  const resumo = document.createElement("p");
  resumo.textContent =
    c.proposta.arquivos === 1
      ? `O TSE tem 1 documento registrado (${tamanho(c.proposta.bytes)}).`
      : `O TSE tem ${c.proposta.arquivos} documentos registrados (${tamanho(c.proposta.bytes)} no total).`;

  const link = document.createElement("a");
  link.className = "botao botao--primario botao--largo";
  link.href = c.proposta.urlTse;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Ler a proposta no site do TSE";

  const nota = document.createElement("p");
  nota.className = "proposta__nota";
  nota.textContent =
    "O documento é o que a campanha registrou, sem edição, resumo ou comentário desta ferramenta. " +
    "O link abre o site do Tribunal Superior Eleitoral.";

  secao.append(resumo, link, nota);
  return secao;
}

function tamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`.replace(".", ",")
    : `${Math.round(bytes / 1024)} KB`;
}

function campo(lista: HTMLElement, rotulo: string, valor: string | null, textoVazio = "sem informação no arquivo do TSE"): void {
  const bloco = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = rotulo;
  const dd = document.createElement("dd");
  if (valor) {
    dd.textContent = valor;
  } else {
    dd.className = "vazio";
    dd.textContent = textoVazio;
  }
  bloco.append(dt, dd);
  lista.append(bloco);
}
