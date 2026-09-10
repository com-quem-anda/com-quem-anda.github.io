/**
 * Folha de escolha de candidato (bottom sheet).
 *
 * Sobe de baixo, com busca e ações NA BASE — o alcance do polegar é o terço
 * inferior da tela (§1.4). Fecha por arrastar para baixo, por Esc e por botão.
 * Nada aqui depende de hover.
 */
import { ListaVirtual } from "./virtual.ts";
import { filtrar } from "./dados.ts";
import { NOME_CARGO, type Candidato, type Cargo } from "./tipos.ts";

const ALTURA_ITEM = 72;  // casa com .item no cedula.css

export interface ResultadoFolha {
  acao: "escolher" | "limpar" | "cancelar";
  candidato?: Candidato;
}

export function abrirFolha(op: {
  cargo: Cargo;
  candidatos: readonly Candidato[];
  escolhidoSq: string | null;
  aoVerFicha: (c: Candidato) => void;
}): Promise<ResultadoFolha> {
  return new Promise((resolver) => {
    const dialogo = document.createElement("dialog");
    dialogo.className = "folha";

    const puxador = document.createElement("div");
    puxador.className = "folha__puxador";
    puxador.setAttribute("aria-hidden", "true");

    const titulo = document.createElement("div");
    titulo.className = "folha__titulo";
    const h2 = document.createElement("h2");
    h2.id = "folha-titulo";
    h2.textContent = NOME_CARGO[op.cargo];
    const contagem = document.createElement("p");
    contagem.className = "contagem";
    titulo.append(h2, contagem);
    dialogo.setAttribute("aria-labelledby", h2.id);

    const lista = document.createElement("div");
    lista.className = "folha__lista";
    lista.setAttribute("role", "listbox");
    lista.setAttribute("aria-label", `Candidatos a ${NOME_CARGO[op.cargo].toLowerCase()}`);

    const base = document.createElement("div");
    base.className = "folha__base";

    // ---- Busca: teclado numérico por padrão, alternável para texto (§1.4) ----
    const busca = document.createElement("div");
    busca.className = "busca";
    const campo = document.createElement("input");
    campo.type = "text";
    campo.inputMode = "numeric";
    campo.dataset.modo = "numero";
    campo.autocomplete = "off";
    campo.placeholder = "Digite o número";
    campo.setAttribute("aria-label", "Buscar por número ou nome");
    const alternar = document.createElement("button");
    alternar.type = "button";
    alternar.className = "botao";
    alternar.textContent = "ABC";
    alternar.setAttribute("aria-label", "Alternar para busca por nome");
    busca.append(campo, alternar);

    const acoes = document.createElement("div");
    acoes.className = "folha__acoes";
    const limpar = document.createElement("button");
    limpar.type = "button";
    limpar.className = "botao";
    limpar.textContent = "Deixar em branco";
    const fechar = document.createElement("button");
    fechar.type = "button";
    fechar.className = "botao";
    fechar.textContent = "Fechar";
    acoes.append(limpar, fechar);

    base.append(busca, acoes);
    dialogo.append(puxador, titulo, lista, base);
    document.body.append(dialogo);

    // ---- Lista virtualizada ----
    let visiveis: Candidato[] = [...op.candidatos];

    const virtual = new ListaVirtual<Candidato>({
      container: lista,
      alturaItem: ALTURA_ITEM,
      render: (c) => item(c, c.sq === op.escolhidoSq, () => concluir({ acao: "escolher", candidato: c }), () => op.aoVerFicha(c)),
    });

    const vazio = document.createElement("p");
    vazio.className = "folha__vazio";
    vazio.hidden = true;

    function aplicar(termo: string): void {
      visiveis = filtrar(op.candidatos, termo);
      virtual.definir(visiveis);
      const t = op.candidatos.length;
      contagem.textContent = visiveis.length === t
        ? `${t} candidatos`
        : `${visiveis.length} de ${t}`;
      vazio.hidden = visiveis.length > 0;
      vazio.textContent = visiveis.length === 0 ? `Nenhum candidato para "${termo}".` : "";
    }

    lista.append(vazio);
    aplicar("");

    // Resultado aparece antes de terminar de digitar (§1.4): sem debounce, o
    // filtro é síncrono sobre um array já em memória.
    campo.addEventListener("input", () => aplicar(campo.value));

    alternar.addEventListener("click", () => {
      const paraTexto = campo.dataset.modo === "numero";
      campo.dataset.modo = paraTexto ? "texto" : "numero";
      campo.inputMode = paraTexto ? "text" : "numeric";
      campo.placeholder = paraTexto ? "Digite o nome" : "Digite o número";
      alternar.textContent = paraTexto ? "123" : "ABC";
      alternar.setAttribute("aria-label", paraTexto ? "Alternar para busca por número" : "Alternar para busca por nome");
      campo.focus();
    });

    limpar.addEventListener("click", () => concluir({ acao: "limpar" }));
    fechar.addEventListener("click", () => concluir({ acao: "cancelar" }));
    dialogo.addEventListener("cancel", (e) => { e.preventDefault(); concluir({ acao: "cancelar" }); });

    arrastarParaFechar(dialogo, puxador, () => concluir({ acao: "cancelar" }));

    dialogo.showModal();
    // Não focar o campo: no celular o teclado subiria por cima da lista antes
    // de a pessoa decidir se quer digitar ou rolar.

    function concluir(r: ResultadoFolha): void {
      virtual.destruir();
      dialogo.close();
      dialogo.remove();
      resolver(r);
    }
  });
}

function item(c: Candidato, escolhido: boolean, aoEscolher: () => void, aoVerFicha: () => void): HTMLElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "item";
  b.setAttribute("role", "option");
  b.setAttribute("aria-current", String(escolhido));

  const numero = document.createElement("span");
  numero.className = "item__numero";
  numero.textContent = c.numero;

  const texto = document.createElement("span");
  texto.className = "item__texto";
  const nome = document.createElement("span");
  nome.className = "item__nome";
  nome.textContent = c.nomeUrna;
  const meta = document.createElement("span");
  meta.className = "item__meta";
  meta.textContent = c.partido.sigla + (c.coligacao.nome && c.coligacao.nome !== "PARTIDO ISOLADO" ? ` · ${c.coligacao.nome}` : "");
  texto.append(nome, meta);

  b.append(numero, texto);
  b.addEventListener("click", aoEscolher);
  // Toque longo abre a ficha sem escolher — no desktop, o botão direito.
  b.addEventListener("contextmenu", (e) => { e.preventDefault(); aoVerFicha(); });
  return b;
}

/** Arrastar o puxador para baixo fecha a folha (§1.4). */
function arrastarParaFechar(dialogo: HTMLElement, puxador: HTMLElement, aoFechar: () => void): void {
  let inicioY = 0;
  let arrastando = false;

  puxador.addEventListener("pointerdown", (e) => {
    arrastando = true;
    inicioY = e.clientY;
    puxador.setPointerCapture(e.pointerId);
  });

  puxador.addEventListener("pointermove", (e) => {
    if (!arrastando) return;
    const dy = Math.max(0, e.clientY - inicioY);
    dialogo.style.transform = `translateY(${dy}px)`;
  });

  const soltar = (e: PointerEvent): void => {
    if (!arrastando) return;
    arrastando = false;
    puxador.releasePointerCapture(e.pointerId);
    const dy = e.clientY - inicioY;
    dialogo.style.transform = "";
    if (dy > 90) aoFechar();
  };
  puxador.addEventListener("pointerup", soltar);
  puxador.addEventListener("pointercancel", soltar);
}
