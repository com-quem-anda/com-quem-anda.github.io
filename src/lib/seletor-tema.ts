/** Seletor de tema com os três estados exigidos pela §6.3: sistema, claro, escuro. */
import { atualizar, ler, type Tema } from "./estado.ts";

const ROTULOS: Record<Tema, string> = { sistema: "Sistema", claro: "Claro", escuro: "Escuro" };

class SeletorTema extends HTMLElement {
  connectedCallback(): void {
    const atual = ler().tema;
    const id = "seletor-tema-campo";

    const label = document.createElement("label");
    label.className = "so-leitor";
    label.htmlFor = id;
    label.textContent = "Tema da página";

    const select = document.createElement("select");
    select.id = id;
    select.className = "seletor-tema";
    for (const [valor, rotulo] of Object.entries(ROTULOS)) {
      const o = document.createElement("option");
      o.value = valor;
      o.textContent = rotulo;
      o.selected = valor === atual;
      select.append(o);
    }
    select.addEventListener("change", () => {
      const tema = select.value as Tema;
      atualizar((e) => ({ ...e, tema }));
      aplicar(tema);
    });

    this.append(label, select);
    aplicar(atual);
  }
}

function aplicar(tema: Tema): void {
  if (tema === "sistema") delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = tema;
}

customElements.define("seletor-tema", SeletorTema);
