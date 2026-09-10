/**
 * Rolagem virtualizada.
 *
 * Obrigatória acima de ~200 itens (§6.3): deputado estadual em SP são 1.430,
 * e montar 1.430 nós derruba o navegador de celular. Altura de linha fixa,
 * o que basta aqui porque todo item da lista tem o mesmo formato.
 */

export interface OpcoesVirtual<T> {
  container: HTMLElement;
  alturaItem: number;
  /** Linhas extras acima e abaixo da janela, para a rolagem não piscar. */
  folga?: number;
  render: (item: T, indice: number) => HTMLElement;
}

export class ListaVirtual<T> {
  private itens: readonly T[] = [];
  private readonly espacador: HTMLElement;
  private readonly janela: HTMLElement;
  private ultimoInicio = -1;
  private ultimoFim = -1;
  private agendado = false;
  private readonly op: OpcoesVirtual<T>;
  private readonly observador: ResizeObserver;

  constructor(op: OpcoesVirtual<T>) {
    this.op = op;
    this.espacador = document.createElement("div");
    this.espacador.className = "virt";
    this.janela = document.createElement("div");
    this.janela.className = "virt__janela";
    this.espacador.append(this.janela);
    op.container.append(this.espacador);
    op.container.addEventListener("scroll", this.aoRolar, { passive: true });

    // O container costuma ter altura 0 no primeiro desenho — a folha ainda não
    // foi aberta. Sem isto, a lista renderiza só a folga e o resto fica em branco.
    this.observador = new ResizeObserver(() => {
      this.ultimoInicio = this.ultimoFim = -1;
      this.desenhar();
    });
    this.observador.observe(op.container);
  }

  definir(itens: readonly T[]): void {
    this.itens = itens;
    this.espacador.style.height = `${itens.length * this.op.alturaItem}px`;
    this.op.container.scrollTop = 0;
    this.ultimoInicio = this.ultimoFim = -1;
    this.desenhar();
  }

  destruir(): void {
    this.observador.disconnect();
    this.op.container.removeEventListener("scroll", this.aoRolar);
    this.espacador.remove();
  }

  private aoRolar = (): void => {
    // Uma pintura por quadro: o listener de scroll não pode desenhar direto.
    if (this.agendado) return;
    this.agendado = true;
    requestAnimationFrame(() => {
      this.agendado = false;
      this.desenhar();
    });
  };

  private desenhar(): void {
    const { container, alturaItem, folga = 4, render } = this.op;
    const total = this.itens.length;

    const primeiroVisivel = Math.floor(container.scrollTop / alturaItem);
    const cabem = Math.ceil(container.clientHeight / alturaItem);
    const inicio = Math.max(0, primeiroVisivel - folga);
    const fim = Math.min(total, primeiroVisivel + cabem + folga);

    if (inicio === this.ultimoInicio && fim === this.ultimoFim) return;
    this.ultimoInicio = inicio;
    this.ultimoFim = fim;

    const fragmento = document.createDocumentFragment();
    for (let i = inicio; i < fim; i++) {
      const no = render(this.itens[i]!, i);
      no.style.position = "absolute";
      no.style.top = `${(i - inicio) * alturaItem}px`;
      no.style.left = "0";
      no.style.right = "0";
      fragmento.append(no);
    }
    this.janela.style.transform = `translateY(${inicio * alturaItem}px)`;
    this.janela.replaceChildren(fragmento);
  }
}
