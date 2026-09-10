/**
 * A cédula: seis slots na ordem da urna.
 *
 * Todo o estado vive em localStorage e nada sai do navegador (§8). Depois do
 * carregamento inicial, a única rede permitida é buscar /dados/<uf>/<cargo>.json
 * — e mesmo essa some quando o service worker já tem o arquivo.
 */
import { abrirFicha } from "./ficha.ts";
import { abrirFolha } from "./folha.ts";
import { alertasDaCedula, type EntradaCedula } from "./alertas.ts";
import { carregarCargo } from "./dados.ts";
import { ORDEM_URNA, atualizar, ler } from "./estado.ts";
import { NOME_CARGO, type Candidato, type Cargo } from "./tipos.ts";

/** Rótulo do slot; o Senado tem duas vagas e a pessoa precisa saber qual é qual. */
function rotuloSlot(cargo: Cargo, slot: number): string {
  if (cargo !== "senador") return NOME_CARGO[cargo];
  const primeiro = ORDEM_URNA.indexOf("senador");
  return slot === primeiro ? "Senador — 1ª vaga" : "Senador — 2ª vaga";
}

class CedulaApp extends HTMLElement {
  private uf = "";
  private ordem: Cargo[] = ORDEM_URNA;
  private porCargo = new Map<Cargo, readonly Candidato[]>();
  private sqAnomalos: ReadonlySet<string> = new Set();
  private slots!: HTMLElement;
  private diagnostico!: HTMLElement;

  connectedCallback(): void {
    this.uf = this.dataset.uf ?? "";
    // DF elege deputado distrital no lugar do estadual.
    if (this.dataset.cargos) this.ordem = this.dataset.cargos.split(",") as Cargo[];

    this.slots = this.querySelector(".slots")!;
    this.diagnostico = this.querySelector(".diagnostico")!;

    atualizar((e) => (e.uf === this.uf ? e : { ...e, uf: this.uf, votos: {} }));

    this.querySelector("[data-acao=imprimir]")?.addEventListener("click", () => window.print());
    this.querySelector("[data-acao=exportar]")?.addEventListener("click", () => this.exportar());
    this.querySelector("[data-acao=limpar]")?.addEventListener("click", () => this.limparTudo());

    this.slots.addEventListener("click", (ev) => {
      const alvo = (ev.target as HTMLElement).closest<HTMLElement>("[data-slot]");
      if (alvo) void this.escolher(Number(alvo.dataset.slot));
    });

    // Desenha primeiro. O meta.json só alimenta um alerta secundário e não pode
    // custar uma viagem de rede antes da primeira tela aparecer (§1.4).
    this.desenhar();
    void this.carregarAnomalias().then(() => this.desenharDiagnostico());
  }

  /** Marca no diagnóstico as candidaturas que o pipeline achou duplicadas. */
  private async carregarAnomalias(): Promise<void> {
    try {
      const meta = await fetch("/dados/meta.json").then((r) => r.json());
      const sq = new Set<string>();
      for (const a of meta.anomalias ?? []) for (const s of a.sq ?? []) sq.add(s);
      this.sqAnomalos = sq;
    } catch {
      // Sem meta.json o diagnóstico perde um alerta, mas a cédula funciona.
    }
  }

  /**
   * O voto salvo carrega uma cópia do candidato, então o slot desenha sem rede.
   * Se a lista do cargo já veio, o registro do TSE prevalece sobre a cópia —
   * é ele que pode ter mudado desde a escolha.
   */
  private candidatoDoSlot(slot: number): Candidato | null {
    const salvo = ler().votos[slot];
    if (!salvo) return null;
    const lista = this.porCargo.get(this.ordem[slot]!);
    if (!lista) return salvo;
    return lista.find((c) => c.sq === salvo.sq) ?? salvo;
  }

  /** Candidatura que sumiu da lista oficial depois de escolhida. */
  private sumiuDaLista(slot: number): Candidato | null {
    const salvo = ler().votos[slot];
    const lista = this.porCargo.get(this.ordem[slot]!);
    if (!salvo || !lista) return null;
    return lista.some((c) => c.sq === salvo.sq) ? null : salvo;
  }

  private async escolher(slot: number): Promise<void> {
    const cargo = this.ordem[slot]!;
    const botao = this.slots.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    botao?.setAttribute("aria-busy", "true");

    let candidatos: readonly Candidato[];
    try {
      candidatos = await this.candidatos(cargo);
    } catch {
      this.erro(`Não foi possível carregar a lista de ${NOME_CARGO[cargo].toLowerCase()}. Verifique a conexão e tente de novo.`);
      return;
    } finally {
      botao?.removeAttribute("aria-busy");
    }

    const atualSq = ler().votos[slot]?.sq ?? null;
    const r = await abrirFolha({
      cargo,
      candidatos,
      escolhidoSq: atualSq,
      aoVerFicha: (c) => { void abrirFicha(c, c.sq === atualSq); },
    });

    if (r.acao === "escolher" && r.candidato) this.gravarVoto(slot, r.candidato);
    else if (r.acao === "limpar") this.gravarVoto(slot, null);
    else return;

    this.desenhar();
    this.slots.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.focus();
  }

  private async candidatos(cargo: Cargo): Promise<readonly Candidato[]> {
    const emMemoria = this.porCargo.get(cargo);
    if (emMemoria) return emMemoria;
    const arquivo = await carregarCargo(this.uf, cargo);
    this.porCargo.set(cargo, arquivo.candidatos);
    return arquivo.candidatos;
  }

  private gravarVoto(slot: number, candidato: Candidato | null): void {
    atualizar((e) => {
      const votos = { ...e.votos };
      if (candidato) votos[slot] = candidato;
      else delete votos[slot];
      return { ...e, votos };
    });
  }

  private limparTudo(): void {
    if (!confirm("Apagar todos os votos desta cédula? Isso não pode ser desfeito.")) return;
    atualizar((e) => ({ ...e, votos: {} }));
    this.desenhar();
  }

  /** Exportar em JSON: são os votos da própria pessoa, e custa 10 linhas (§7). */
  private exportar(): void {
    const e = ler();
    const conteudo = {
      ferramenta: "cedula-aberta",
      uf: e.uf,
      exportadoEm: new Date().toISOString(),
      votos: this.ordem.map((cargo, slot) => {
        const c = this.candidatoDoSlot(slot);
        return { slot, cargo, numero: c?.numero ?? null, nomeUrna: c?.nomeUrna ?? null, sq: c?.sq ?? null };
      }),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(conteudo, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cedula-${e.uf ?? "br"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private erro(mensagem: string): void {
    const caixa = document.createElement("p");
    caixa.className = "aviso-caixa aviso-caixa--alerta";
    caixa.setAttribute("role", "alert");
    caixa.textContent = mensagem;
    this.diagnostico.prepend(caixa);
    setTimeout(() => caixa.remove(), 8000);
  }

  private desenhar(): void {
    const fragmento = document.createDocumentFragment();
    for (const [slot, cargo] of this.ordem.entries()) {
      fragmento.append(this.desenharSlot(slot, cargo, this.candidatoDoSlot(slot)));
    }
    this.slots.replaceChildren(fragmento);
    this.desenharDiagnostico();
    void this.garantirUniversoPresidente();
  }

  private desenharSlot(slot: number, cargo: Cargo, c: Candidato | null): HTMLElement {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = c ? "slot" : "slot slot--vazio";
    b.dataset.slot = String(slot);

    const rotulo = document.createElement("span");
    rotulo.className = "slot__cargo";
    rotulo.textContent = rotuloSlot(cargo, slot);

    const numero = document.createElement("span");
    numero.className = "slot__numero";
    numero.textContent = c ? c.numero : "—";

    b.append(rotulo, numero);

    if (c) {
      const nome = document.createElement("span");
      nome.className = "slot__nome";
      const forte = document.createElement("b");
      forte.textContent = c.nomeUrna;
      const meta = document.createElement("span");
      meta.className = "slot__meta";
      meta.textContent = c.partido.sigla + (c.coligacao.nome && c.coligacao.nome !== "PARTIDO ISOLADO" ? ` · ${c.coligacao.nome}` : "");
      nome.append(forte, meta);
      b.append(nome);
      b.setAttribute("aria-label", `${rotuloSlot(cargo, slot)}: ${c.nomeUrna}, número ${c.numero.split("").join(" ")}. Trocar.`);
    } else {
      const acao = document.createElement("span");
      acao.className = "slot__acao";
      acao.textContent = "Escolher candidato";
      b.append(acao);
      b.setAttribute("aria-label", `${rotuloSlot(cargo, slot)}: nenhum voto escolhido. Escolher.`);
    }

    li.append(b);
    return li;
  }

  /**
   * O alerta de coligações adversárias precisa saber quais partidos lançam
   * presidente. São 13 registros: carregar sob demanda custa menos que manter
   * a tabela duplicada, e o alerta nunca some por causa de um recarregamento.
   */
  private async garantirUniversoPresidente(): Promise<void> {
    if (this.porCargo.has("presidente")) return;
    const temGovernador = this.candidatoDoSlot(this.ordem.indexOf("governador")) !== null;
    const temPresidente = this.candidatoDoSlot(this.ordem.indexOf("presidente")) !== null;
    if (!temGovernador || !temPresidente) return;

    try {
      await this.candidatos("presidente");
      this.desenharDiagnostico();
    } catch {
      // Sem a lista o diagnóstico perde um alerta; o resto continua de pé.
    }
  }

  private desenharDiagnostico(): void {
    const entradas: EntradaCedula[] = this.ordem.map((cargo, slot) => ({
      slot, cargo, candidato: this.candidatoDoSlot(slot),
    }));

    const universo: Partial<Record<Cargo, readonly Candidato[]>> = {};
    for (const [cargo, lista] of this.porCargo) universo[cargo] = lista;

    const alertas = alertasDaCedula(entradas, universo, this.sqAnomalos);

    // Escolha que não consta mais do arquivo oficial: fato novo, e grave.
    for (const slot of this.ordem.keys()) {
      const sumiu = this.sumiuDaLista(slot);
      if (sumiu) {
        alertas.unshift({
          tipo: "candidatura-removida",
          gravidade: "alerta",
          titulo: `${sumiu.nomeUrna} não está mais na lista oficial`,
          detalhe:
            `Esta candidatura constava quando você escolheu, e não consta na coleta mais ` +
            `recente do TSE. Ela continua na sua cédula para você decidir o que fazer — ` +
            `confira a situação antes de votar.`,
        });
      }
    }

    const h2 = document.createElement("h2");
    h2.textContent = "Diagnóstico da chapa";

    const fragmento = document.createDocumentFragment();
    fragmento.append(h2);

    if (alertas.length === 0) {
      const p = document.createElement("p");
      p.className = "alerta alerta--informacao";
      p.textContent = "Nenhuma inconsistência estrutural encontrada nos seus seis votos.";
      fragmento.append(p);
    }

    for (const a of alertas) {
      const div = document.createElement("div");
      div.className = `alerta alerta--${a.gravidade}`;
      const b = document.createElement("b");
      b.textContent = a.titulo;
      const p = document.createElement("p");
      p.textContent = a.detalhe;
      div.append(b, p);
      fragmento.append(div);
    }

    this.diagnostico.replaceChildren(fragmento);
  }
}

customElements.define("cedula-app", CedulaApp);
