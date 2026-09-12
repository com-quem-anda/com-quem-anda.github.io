/**
 * Cédula Aberta — camada vertical.
 *
 * Sem framework e sem dependência: é uma página estática de utilidade pública,
 * e cada KB aqui é tempo de carregamento de quem vai abrir no celular. A
 * matemática é porte fiel de scripts/lib/{alianca,coerencia}.ts, conferida
 * valor a valor contra a biblioteca testada antes de cada publicação.
 *
 * Dois modos de dados, mesmo código:
 *   window.CEDULA_DADOS presente  -> tudo embutido (arquivo único do artifact)
 *   ausente                       -> busca ./dados/base.json e ./dados/uf/<UF>.json
 */
(() => {
  "use strict";

  /* =================== matemática =================== */

  let D = null;                       // base: grafo, eleitorado, malha, presidentes
  const cacheUf = new Map();          // UF -> candidatos
  const cacheNula = new Map();

  const chave = (a, b) => (a < b ? a + "|" + b : b + "|" + a);

  function proximidade(a, b) {
    if (a === b) return 1;
    const fa = D.grafo.federacao[a];
    if (fa !== undefined && fa === D.grafo.federacao[b]) return 1;
    return D.grafo.prox[chave(a, b)] ?? 0;
  }

  function coerencia(ps) {
    if (ps.length < 2) return null;
    let soma = 0, pares = 0;
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) { soma += proximidade(ps[i], ps[j]); pares++; }
    return soma / pares;
  }

  function prng(semente) {
    let s = semente >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const LIMITE_EXATO = 500000, SORTEIOS = 20000, SEMENTE = 20261004;

  const binom = (n, k) => { if (k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return Math.round(r); };

  function combinacoes(itens, k) {
    if (k === 0) return [[]];
    if (k > itens.length) return [];
    const out = [];
    const passo = (ini, atual) => {
      if (atual.length === k) { out.push(atual.slice()); return; }
      for (let i = ini; i < itens.length; i++) { atual.push(itens[i]); passo(i + 1, atual); atual.pop(); }
    };
    passo(0, []);
    return out;
  }

  function distribuicaoNula(pools, votos) {
    const cargos = Object.keys(pools).filter((c) => pools[c].length > 0);
    const k = (c) => Math.min(votos[c] ?? 1, pools[c].length);
    let total = 1;
    for (const c of cargos) total *= binom(pools[c].length, k(c));

    if (total > 0 && total <= LIMITE_EXATO) {
      const valores = [];
      const porCargo = cargos.map((c) => combinacoes(pools[c], k(c)));
      const passo = (i, acc) => {
        if (i === cargos.length) { const v = coerencia(acc); if (v !== null) valores.push(v); return; }
        for (const combo of porCargo[i]) passo(i + 1, acc.concat(combo));
      };
      passo(0, []);
      valores.sort((a, b) => a - b);
      return { valores, exata: true, combinacoes: total };
    }

    const rnd = prng(SEMENTE), valores = [];
    for (let s = 0; s < SORTEIOS; s++) {
      const acc = [];
      for (const c of cargos) {
        const pool = pools[c], quantos = k(c), usados = new Set();
        while (usados.size < quantos) usados.add(Math.floor(rnd() * pool.length));
        for (const i of usados) acc.push(pool[i]);
      }
      const v = coerencia(acc);
      if (v !== null) valores.push(v);
    }
    valores.sort((a, b) => a - b);
    return { valores, exata: false, combinacoes: total };
  }

  function percentil(nula, valor) {
    const v = nula.valores;
    if (!v.length) return 0;
    let lo = 0, hi = v.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v[m] < valor) lo = m + 1; else hi = m; }
    return (100 * lo) / v.length;
  }

  function relacaoChapa(pt, pv) {
    if (pv === pt) return "mesmo-partido";
    if (D.grafo.federacao[pt] !== undefined && D.grafo.federacao[pt] === D.grafo.federacao[pv]) return "mesma-federacao";
    return proximidade(pt, pv) > 0 ? "aliado" : "sem-alianca";
  }

  /** Partido, nunca candidato: candidatos do mesmo partido empatam exatamente. */
  function sugerirPartidos(escolhidos, poolDoCargo) {
    if (!escolhidos.length || !poolDoCargo.length) return [];
    const quantos = new Map();
    for (const p of poolDoCargo) quantos.set(p, (quantos.get(p) ?? 0) + 1);
    const atual = coerencia(escolhidos);
    return [...quantos.entries()]
      .map(([partido, candidatos]) => {
        const c = coerencia([...escolhidos, partido]);
        return { partido, coerencia: c, delta: atual === null ? 0 : c - atual, candidatos };
      })
      .sort((a, b) => b.coerencia - a.coerencia || a.partido.localeCompare(b.partido, "pt-BR"));
  }

  const NIVEIS = [
    { min: 0, nome: "Dispersa", frase: "Seus votos vão para partidos que quase nunca aparecem juntos em coligação." },
    { min: 20, nome: "Mista", frase: "Há afinidade entre parte dos seus votos e nenhuma entre os outros." },
    { min: 50, nome: "Inclinada", frase: "A maior parte dos seus votos está em partidos que costumam se aliar, com exceções." },
    { min: 80, nome: "Alinhada", frase: "Quase todos os seus votos estão no mesmo campo de alianças." },
    { min: 97, nome: "Bloco único", frase: "Seus votos estão praticamente todos no mesmo bloco de alianças." },
  ];
  const nivelDe = (pct) => { let i = 0; for (let k = 0; k < NIVEIS.length; k++) if (pct >= NIVEIS[k].min) i = k; return i; };

  /* =================== estado =================== */

  const CARGOS = [
    ["presidente", "Presidente", null, 1],
    ["governador", "Governador", "gov", 1],
    ["senador", "Senador — 1º voto", "sen", 2],
    ["senador2", "Senador — 2º voto", "sen", 2],
    ["deputado-federal", "Deputado federal", "df", 1],
    ["deputado-estadual", "Deputado estadual", "de", 1],
  ];
  const cargoBase = (k) => (k === "senador2" ? "senador" : k);
  const meta = (slot) => CARGOS.find((c) => c[0] === slot);

  let uf = "SP", escolhas = {}, aberto = null, busca = "", sugCargo = "deputado-estadual";

  const dadosUf = () => cacheUf.get(uf) ?? { gov: [], sen: [], df: [], de: [], distrital: false };
  const pool = (slot) => { const campo = meta(slot)[2]; return campo === null ? D.presidentes : (dadosUf()[campo] ?? []); };
  const cand = (slot) => { const i = escolhas[slot]; return i === undefined ? null : pool(slot)[i] ?? null; };
  const rotulo = (slot) => (slot === "deputado-estadual" && dadosUf().distrital ? "Deputado distrital" : meta(slot)[1]);

  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (x, d = 3) => x.toFixed(d).replace(".", ",");
  const mil = (n) => n.toLocaleString("pt-BR");

  /* =================== carregamento =================== */

  async function carregarBase() {
    if (window.CEDULA_DADOS) { D = window.CEDULA_DADOS.base; return; }
    const r = await fetch("dados/base.json");
    if (!r.ok) throw new Error(`base.json respondeu ${r.status}`);
    D = await r.json();
  }

  async function carregarUf(sigla) {
    if (cacheUf.has(sigla)) return;
    if (window.CEDULA_DADOS) { cacheUf.set(sigla, window.CEDULA_DADOS.ufs[sigla]); return; }
    const r = await fetch(`dados/uf/${sigla}.json`);
    if (!r.ok) throw new Error(`${sigla}.json respondeu ${r.status}`);
    cacheUf.set(sigla, await r.json());
  }

  /* =================== cédula =================== */

  function renderCedula() {
    el("cedula").innerHTML = CARGOS.map(([slot]) => {
      const c = cand(slot);
      const corpo = c ? `<span class="num">${esc(c[0])}</span>${esc(c[1])}` : "sem voto";
      return `<div class="slot">
        <button class="slot-topo" type="button" data-slot="${slot}" aria-expanded="${aberto === slot}">
          <span class="slot-cargo">${esc(rotulo(slot))}</span>
          <span class="slot-nome${c ? "" : " vazio"}">${corpo}</span>
          <span class="slot-acao">${c ? `<span class="sigla">${esc(c[2])}</span>` : "escolher"}</span>
        </button>${aberto === slot ? `<div class="picker">
          <input type="search" id="busca" placeholder="Nome, número ou partido — ${pool(slot).length} candidatos" value="${esc(busca)}" autocomplete="off" aria-label="Buscar candidato">
          <div class="lista" id="lista">${renderLista(slot)}</div></div>` : ""}</div>`;
    }).join("");
  }

  function renderLista(slot) {
    const lista = pool(slot);
    const bloqueado = slot === "senador" ? escolhas["senador2"] : slot === "senador2" ? escolhas["senador"] : undefined;
    const termo = busca.trim().toLowerCase();
    const achados = [];
    for (let i = 0; i < lista.length && achados.length < 160; i++) {
      if (i === bloqueado) continue;
      const c = lista[i];
      if (termo && !(c[1].toLowerCase().includes(termo) || c[0].startsWith(termo) || c[2].toLowerCase().includes(termo))) continue;
      achados.push([i, c]);
    }
    if (!achados.length) return `<div class="vazio-msg">Nenhum candidato com esse nome, número ou partido.</div>`;
    return achados.map(([i, c]) => `<button class="opcao" type="button" data-slot="${slot}" data-i="${i}" aria-current="${escolhas[slot] === i}">
      <span class="n">${esc(c[0])}</span><span>${esc(c[1])}</span><span class="p">${esc(c[2])}</span></button>`).join("");
  }

  function calcular() {
    const preenchidos = CARGOS.filter(([s]) => escolhas[s] !== undefined);
    const partidos = preenchidos.map(([s]) => cand(s)[2]);
    const C = coerencia(partidos);
    if (C === null) return { C: null };

    const votos = {};
    for (const [slot] of preenchidos) { const b = cargoBase(slot); votos[b] = (votos[b] ?? 0) + 1; }

    // Pools sempre da UF selecionada: nenhuma cédula impossível entra na referência.
    const pools = {};
    for (const b of Object.keys(votos)) pools[b] = pool(CARGOS.find((c) => cargoBase(c[0]) === b)[0]).map((c) => c[2]);

    const k = uf + "|" + Object.entries(votos).map(([c, n]) => c + ":" + n).sort().join(",");
    if (!cacheNula.has(k)) cacheNula.set(k, distribuicaoNula(pools, votos));
    const nula = cacheNula.get(k);

    let alav = [];
    if (preenchidos.length >= 3) {
      alav = preenchidos.map(([slot], i) => ({
        slot, cand: cand(slot), delta: (coerencia(partidos.filter((_, j) => j !== i)) ?? 0) - C,
      })).sort((a, b) => b.delta - a.delta);
    }
    return { C, nula, pct: percentil(nula, C), alav, preenchidos };
  }

  function renderResultado(r) {
    if (r.C === null) {
      el("nivelNome").textContent = "—";
      el("nivelFrase").textContent = "Escolha pelo menos dois cargos para o índice existir.";
      el("nivelPct").textContent = "";
      el("degraus").innerHTML = NIVEIS.map(() => `<span class="degrau"></span>`).join("");
      el("metricas").innerHTML = ""; el("hist").innerHTML = ""; el("alavancagem").innerHTML = "";
      return;
    }
    const i = nivelDe(r.pct), saturado = r.pct >= 99.95;
    el("nivelNome").textContent = NIVEIS[i].nome;
    el("nivelFrase").textContent = NIVEIS[i].frase;
    el("degraus").innerHTML = NIVEIS.map((_, k) => `<span class="degrau${k <= i ? " on" : ""}"></span>`).join("");
    el("nivelPct").innerHTML = saturado
      ? `mais coesa que <b>praticamente todas</b> as cédulas possíveis em ${uf}`
      : `mais coesa que <b>${num(r.pct, 1)}%</b> das cédulas possíveis em ${uf}`;

    const mediana = r.nula.valores[Math.floor(r.nula.valores.length / 2)];
    el("metricas").innerHTML = `
      <span>coerência bruta <b>${num(r.C)}</b> <button class="info" type="button" data-info="Proximidade média entre todos os pares de votos da sua cédula, de 0 a 1. Sozinho este número não tem escala — por isso o que vale é a posição dele na distribuição.">?</button></span>
      <span>mediana ao acaso <b>${num(mediana)}</b> <button class="info" type="button" data-info="A coerência de uma cédula típica montada ao acaso neste estado. É o ponto de comparação.">?</button></span>
      ${mediana > 0 ? `<span>acima da mediana <b>${num(r.C / mediana, 1)}×</b> <button class="info" type="button" data-info="Quantas vezes sua coerência supera a de uma cédula típica ao acaso. Serve onde o percentil satura: duas cédulas podem estar as duas no topo e mesmo assim ser muito diferentes uma da outra.">?</button></span>` : ""}
      <span>referência <b>${r.nula.exata ? mil(r.nula.combinacoes) + " cédulas" : "20.000 sorteios"}</b> <button class="info" type="button" data-info="${r.nula.exata ? "Universo pequeno o bastante para ser percorrido inteiro: nenhuma cédula possível ficou de fora, não há sorteio." : "São " + r.nula.combinacoes.toExponential(2).replace(".", ",") + " cédulas possíveis — demais para contar uma a uma. Sorteamos 20.000 com semente fixa, então o resultado é sempre o mesmo. Isto é Monte Carlo."}">?</button></span>`;

    desenharHistograma(r, mediana);

    el("alavancagem").innerHTML = r.alav.length
      ? r.alav.map((a, k) => {
          const forte = k === 0 && a.delta > 0.001;
          return `<li><span class="quem">${esc(a.cand[1])}<small>${esc(rotulo(a.slot))} · ${esc(a.cand[2])}</small></span>
            <span class="delta ${forte ? "forte" : "fraco"}">${a.delta >= 0 ? "+" : "−"}${num(Math.abs(a.delta))}</span></li>`;
        }).join("")
      : `<li><span class="quem" style="color:var(--muted)">Com menos de três votos não há um voto a isolar.</span></li>`;
  }

  function desenharHistograma(r, mediana) {
    const W = 560, H = 164, ml = 4, mr = 4, mt = 30, mb = 22;
    const vals = r.nula.valores;
    const max = Math.max(vals[vals.length - 1], r.C, 0.1);
    const NB = 44, bins = new Array(NB).fill(0);
    for (const v of vals) bins[Math.min(NB - 1, Math.floor((v / max) * NB))]++;
    const pico = Math.max(...bins);
    const x = (v) => ml + (v / max) * (W - ml - mr);
    const y = (n) => H - mb - (n / pico) * (H - mt - mb);
    const bw = (W - ml - mr) / NB;

    const barras = bins.map((n, i) => n === 0 ? "" :
      `<rect x="${(ml + i * bw + 1).toFixed(1)}" y="${y(n).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(0.8, H - mb - y(n)).toFixed(1)}" rx="1" fill="var(--barra)" data-lo="${num((i / NB) * max)}" data-hi="${num(((i + 1) / NB) * max)}" data-n="${n}"></rect>`).join("");

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max).map((v) =>
      `<text x="${x(v).toFixed(1)}" y="${H - 6}" fill="var(--muted)" font-size="10" font-family="IBM Plex Mono, monospace" text-anchor="middle">${num(v, 2)}</text>`).join("");

    const xm = x(mediana);
    const marcaMediana = `<line x1="${xm.toFixed(1)}" y1="${mt + 4}" x2="${xm.toFixed(1)}" y2="${H - mb}" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="2 3"></line>
      <text x="${xm.toFixed(1)}" y="${mt}" fill="var(--muted)" font-size="9.5" font-family="IBM Plex Mono, monospace" text-anchor="middle">mediana</text>`;

    const xc = x(r.C);
    const anc = xc > W - 80 ? "end" : xc < 62 ? "start" : "middle";
    const marca = `<line x1="${xc.toFixed(1)}" y1="${mt - 12}" x2="${xc.toFixed(1)}" y2="${H - mb}" stroke="var(--marca)" stroke-width="2"></line>
      <text x="${xc.toFixed(1)}" y="${mt - 17}" fill="var(--marca)" font-size="11" font-weight="600" font-family="IBM Plex Sans, sans-serif" text-anchor="${anc}">sua cédula · ${num(r.C)}</text>`;

    el("hist").innerHTML = `<line x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}" stroke="var(--line-strong)" stroke-width="1"></line>${barras}${ticks}${Math.abs(xm - xc) > 46 ? marcaMediana : ""}${marca}`;
  }

  function renderChapa() {
    const itens = [];
    for (const slot of ["governador", "senador", "senador2"]) {
      const c = cand(slot);
      if (!c || !c[3] || !c[3].length) continue;
      itens.push(`<div class="chapa-item">
        <span class="titulo">${esc(c[1])} <span class="sigla">${esc(c[2])}</span> <span class="cargo">${esc(rotulo(slot))}</span></span>
        ${c[3].map(([papel, nome, part]) => {
          const rel = relacaoChapa(c[2], part);
          const txt = { "mesmo-partido": "mesmo partido", "mesma-federacao": "mesma federação", "aliado": "partido aliado", "sem-alianca": "sem aliança com o titular" }[rel];
          return `<span class="vinc">${esc(papel.toLowerCase())}: ${esc(nome)} <span class="rel ${rel}">${esc(part)} · ${txt}</span></span>`;
        }).join("")}</div>`);
    }
    el("chapa").innerHTML = itens.length ? itens.join("")
      : `<p class="nota">Escolha um governador ou senador para ver quem entra junto.</p>`;
  }

  function renderSugestao() {
    el("sugCargo").innerHTML = CARGOS.filter(([s]) => s !== "senador2")
      .map(([s]) => `<option value="${s}"${s === sugCargo ? " selected" : ""}>${esc(rotulo(s))}</option>`).join("");

    // O voto do próprio cargo analisado sai da base: senão a chapa é comparada consigo mesma.
    const fixos = CARGOS.filter(([s]) => escolhas[s] !== undefined && cargoBase(s) !== cargoBase(sugCargo))
      .map(([s]) => cand(s)[2]);
    const r = sugerirPartidos(fixos, pool(sugCargo).map((c) => c[2]));

    if (!r.length) {
      el("sugNota").textContent = "Escolha ao menos um voto em outro cargo para haver com o que ser coerente.";
      el("sug").innerHTML = "";
      return;
    }
    const escolhido = cand(sugCargo)?.[2] ?? null;
    const posicao = escolhido ? r.findIndex((x) => x.partido === escolhido) + 1 : 0;
    el("sugNota").innerHTML =
      `Partidos, não pessoas: candidatos do mesmo partido empatam exatamente neste cálculo.` +
      (escolhido ? ` Seu voto atual é <strong>${esc(escolhido)}</strong>, ${posicao}º de ${r.length}.` : "");

    const topo = r.slice(0, 5), fundo = r.slice(-2).filter((x) => !topo.includes(x));
    const linha = (x) => `<li>
      <span class="p">${esc(x.partido)}${x.partido === escolhido ? " ◂" : ""}</span>
      <span class="trilho"><i style="width:${(x.coerencia * 100).toFixed(1)}%"></i></span>
      <span class="v">${num(x.coerencia)} <span class="qt">· ${x.candidatos}</span></span></li>`;
    el("sug").innerHTML = topo.map(linha).join("")
      + (fundo.length ? `<li style="grid-column:1/-1;color:var(--muted);font-size:.75rem;font-family:var(--mono);padding-top:4px">e no outro extremo</li>` + fundo.map(linha).join("") : "");
  }

  function render() { renderCedula(); renderChapa(); renderSugestao(); renderResultado(calcular()); }

  /* =================== mapa =================== */

  function renderMapa() {
    const elei = D.eleitorado.ufs;
    const valores = Object.values(elei).sort((a, b) => a - b);
    const q = (f) => valores[Math.floor(f * (valores.length - 1))];
    const cortes = [q(0.2), q(0.4), q(0.6), q(0.8)];
    const faixa = (v) => (v <= cortes[0] ? 1 : v <= cortes[1] ? 2 : v <= cortes[2] ? 3 : v <= cortes[3] ? 4 : 5);

    // Projeção equirretangular com correção de latitude: o Brasil inteiro numa tela.
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const cada = (geom, fn) => {
      const poligonos = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      for (const poli of poligonos) for (const anel of poli) for (const pt of anel) fn(pt);
    };
    for (const f of D.malha.features) cada(f.geometry, ([lon, lat]) => {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    });
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    const larg = (maxLon - minLon) * k, alt = maxLat - minLat;
    const S = Math.min(500 / larg, 500 / alt);
    const px = (lon) => 10 + (lon - minLon) * k * S + (500 - larg * S) / 2;
    const py = (lat) => 10 + (maxLat - lat) * S + (500 - alt * S) / 2;

    const caminho = (geom) => {
      const poligonos = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
      let d = "";
      for (const poli of poligonos) for (const anel of poli) {
        d += anel.map(([lon, lat], i) => `${i ? "L" : "M"}${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`).join("") + "Z";
      }
      return d;
    };

    el("mapa").innerHTML = D.malha.features.map((f) => {
      const s = f.properties.uf, v = elei[s] ?? 0;
      return `<path d="${caminho(f.geometry)}" fill="var(--ramp-${faixa(v)})" data-uf="${s}" aria-current="${s === uf}"
        data-info="${s}: ${mil(v)} eleitores"><title>${s} — ${mil(v)} eleitores</title></path>`;
    }).join("");

    el("legFaixas").innerHTML = [1, 2, 3, 4, 5].map((n) => `<span class="legenda-faixa" style="background:var(--ramp-${n})"></span>`).join("");
    el("legRotulos").innerHTML = `<span>${mil(valores[0])}</span><span>${mil(valores[valores.length - 1])} eleitores</span>`;

    const total = D.eleitorado.total;
    el("mapaResumo").innerHTML = `<strong>${mil(total)}</strong> eleitores aptos no país. As faixas do mapa são quintis — cinco grupos de tamanho igual — porque a distribuição é muito desigual: São Paulo sozinho tem mais eleitores que os onze menores estados somados.`;
    el("mapaExterior").textContent = `${mil(D.eleitorado.exterior)} eleitores no exterior não aparecem no mapa: votam para presidente e não pertencem a nenhum estado.`;

    const linhas = Object.entries(elei).sort((a, b) => b[1] - a[1]);
    el("tabUfs").innerHTML = linhas.map(([s, v]) =>
      `<tr data-uf="${s}" aria-current="${s === uf}"><td>${s}</td><td>${mil(v)}</td><td>${((100 * v) / D.eleitorado.totalUf || (100 * v) / total).toFixed(1).replace(".", ",")}%</td><td id="qt-${s}">—</td></tr>`).join("");
  }

  function marcarUfNoMapa() {
    for (const p of document.querySelectorAll("#mapa path")) p.setAttribute("aria-current", String(p.dataset.uf === uf));
    for (const t of document.querySelectorAll(".tab-ufs tr[data-uf]")) t.setAttribute("aria-current", String(t.dataset.uf === uf));
    const td = el(`qt-${uf}`);
    if (td) { const d = dadosUf(); td.textContent = mil(d.gov.length + d.sen.length + d.df.length + d.de.length); }
  }

  /* =================== dica flutuante =================== */

  const dica = el("dica");
  let dicaFixa = null;
  function mostrarDica(alvo, texto) {
    dica.textContent = texto;
    dica.classList.add("on");
    const r = alvo.getBoundingClientRect();
    const w = Math.min(270, innerWidth - 24);
    dica.style.width = w + "px";
    dica.style.left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 12)) + "px";
    dica.style.top = (r.top > 120 ? r.top - dica.offsetHeight - 8 : r.bottom + 8) + "px";
  }
  const esconderDica = () => { dica.classList.remove("on"); dicaFixa = null; };

  document.addEventListener("pointerover", (e) => {
    const b = e.target.closest(".info");
    if (b && !dicaFixa) mostrarDica(b, b.dataset.info);
    else if (!b && !dicaFixa && !e.target.closest("#hist")) dica.classList.remove("on");
  });
  document.addEventListener("focusin", (e) => { const b = e.target.closest(".info"); if (b) mostrarDica(b, b.dataset.info); });
  document.addEventListener("focusout", (e) => { if (e.target.closest(".info") && !dicaFixa) esconderDica(); });

  el("hist").addEventListener("pointermove", (e) => {
    const r = e.target.closest("rect");
    if (!r || !r.dataset.n) { if (!dicaFixa) dica.classList.remove("on"); return; }
    dica.textContent = `${mil(Number(r.dataset.n))} cédulas com coerência entre ${r.dataset.lo} e ${r.dataset.hi}`;
    dica.classList.add("on");
    dica.style.width = "auto";
    dica.style.left = Math.min(e.clientX + 12, innerWidth - 260) + "px";
    dica.style.top = Math.max(8, e.clientY - 46) + "px";
  });
  el("hist").addEventListener("pointerleave", () => { if (!dicaFixa) dica.classList.remove("on"); });

  /* =================== eventos =================== */

  async function trocarUf(novo) {
    if (novo === uf) return;
    const pres = escolhas["presidente"];
    uf = novo;
    await carregarUf(uf);
    // Trocar de estado zera tudo menos o presidente, que é nacional.
    escolhas = pres === undefined ? {} : { presidente: pres };
    aberto = null; busca = ""; cacheNula.clear();
    el("uf").value = uf;
    marcarUfNoMapa();
    render();
  }

  document.addEventListener("click", async (e) => {
    const info = e.target.closest(".info");
    if (info) { if (dicaFixa === info) esconderDica(); else { dicaFixa = info; mostrarDica(info, info.dataset.info); } return; }
    if (dicaFixa) esconderDica();

    const aba = e.target.closest(".aba");
    if (aba) {
      for (const t of document.querySelectorAll(".aba")) t.setAttribute("aria-selected", String(t === aba));
      for (const id of ["cedula", "mapa", "metodo"]) el("pane-" + id).hidden = aba.id !== "tab-" + id;
      return;
    }
    const noMapa = e.target.closest("#mapa path, .tab-ufs tr[data-uf]");
    if (noMapa) { await trocarUf(noMapa.dataset.uf); return; }

    const topo = e.target.closest(".slot-topo");
    if (topo) {
      const s = topo.dataset.slot;
      aberto = aberto === s ? null : s; busca = ""; render();
      if (aberto) el("busca")?.focus();
      return;
    }
    const op = e.target.closest(".opcao");
    if (op) {
      const s = op.dataset.slot, i = Number(op.dataset.i);
      if (escolhas[s] === i) delete escolhas[s]; else escolhas[s] = i;
      aberto = null; busca = ""; render();
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "busca" && aberto) { busca = e.target.value; el("lista").innerHTML = renderLista(aberto); }
  });

  document.addEventListener("change", async (e) => {
    if (e.target.id === "uf") await trocarUf(e.target.value);
    if (e.target.id === "sugCargo") { sugCargo = e.target.value; renderSugestao(); }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && aberto) { aberto = null; busca = ""; render(); return; }
    if (e.key === "Escape" && dicaFixa) { esconderDica(); return; }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && aberto) {
      const ops = [...document.querySelectorAll(".opcao")];
      if (!ops.length) return;
      e.preventDefault();
      const at = ops.indexOf(document.activeElement);
      const prox = e.key === "ArrowDown" ? (at < 0 ? 0 : Math.min(at + 1, ops.length - 1)) : (at <= 0 ? -1 : at - 1);
      if (prox < 0) el("busca")?.focus(); else ops[prox].focus();
    }
  });

  function sortear(semente) {
    const rnd = prng(semente);
    escolhas = {};
    for (const [slot] of CARGOS) {
      const p = pool(slot);
      if (!p.length) continue;
      let i = Math.floor(rnd() * p.length);
      if (slot === "senador2" && escolhas["senador"] === i) i = (i + 1) % p.length;
      escolhas[slot] = i;
    }
    aberto = null; busca = ""; render();
  }

  el("sortear").addEventListener("click", () => sortear(Date.now() >>> 0));
  el("limpar").addEventListener("click", () => { escolhas = {}; aberto = null; busca = ""; render(); });

  /* =================== início =================== */

  function renderMetodoEstatico() {
    el("tabNiveis").innerHTML = NIVEIS.map((n, i) => {
      const ate = i < NIVEIS.length - 1 ? NIVEIS[i + 1].min : 100;
      return `<tr><td>${n.nome}</td><td style="font-family:var(--mono);font-size:.8rem;color:var(--muted)">${n.min}–${ate}</td><td>${n.frase}</td></tr>`;
    }).join("");

    const dt = (s) => s ? new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
    const f = D.fonte;
    el("fontes").innerHTML = `
      <div class="fonte">
        <h3>Candidaturas de 2026</h3>
        <p>Quem está na urna, com partido, coligação, federação, vice e suplentes. É a base de tudo: da cédula, do grafo de aliança e da distribuição de referência.</p>
        <p class="meta">TSE · Portal de Dados Abertos · dataset candidatos-2026 · CC-BY<br>${esc(f.tse.url)}<br>sha256 ${esc(f.tse.sha256)}<br>coletado em ${dt(f.tse.geradoEm)}</p>
      </div>
      <div class="fonte">
        <h3>Perfil do eleitorado de 2026</h3>
        <p>Quantos eleitores aptos há em cada estado, no mapa. Soma de <code>QT_ELEITORES</code> nos arquivos por UF — o consolidado nacional do pacote não foi usado porque o ZIP declara um tamanho estourado para ele.</p>
        <p class="meta">TSE · Portal de Dados Abertos · dataset eleitorado-2026 · CC-BY<br>${esc(f.eleitorado.url)}<br>sha256 ${esc(f.eleitorado.sha256)}<br>agregado em ${dt(f.eleitorado.geradoEm)}</p>
      </div>
      <div class="fonte">
        <h3>Malha territorial dos estados</h3>
        <p>A geometria do mapa, em qualidade mínima — resolução suficiente para tela e leve o bastante para carregar junto com o resto.</p>
        <p class="meta">IBGE · malhas territoriais, divisão por UF<br>${esc(f.ibge.url)}<br>obtida em ${dt(f.ibge.geradoEm)}</p>
      </div>
      <div class="fonte">
        <h3>O que não é fonte daqui</h3>
        <p>
          Rankings e notas de desempenho parlamentar — como o do Ranking dos Políticos — avaliam
          mandatos com critérios atribuídos por um conselho editorial. É um trabalho legítimo e de
          natureza diferente da deste índice, que não atribui mérito a ninguém. Além disso cobriria só
          quem já tem mandato, e "sem nota" acabaria lido como nota neutra. Se um dia entrar, entra com
          autorização, rótulo próprio e por fora do índice — nunca dissolvido dentro dele.
        </p>
      </div>`;

    el("versao").innerHTML = `<span>versão ${esc(D.versao)}</span><span>candidaturas de ${dt(f.tse.geradoEm)}</span><span>eleitorado de ${dt(f.eleitorado.geradoEm)}</span>`;
    el("rodapeGrafo").textContent =
      `Grafo de aliança: ${D.grafo.conjuntos} conjuntos observados nas 27 UFs, ${D.grafo.partidos.length} partidos, ${Object.keys(D.grafo.prox).length} arestas com proximidade maior que zero — ${Object.keys(D.grafo.fragil).length} delas apoiadas em menos de três coincidências. ${D.anomalias} anomalias no pacote do TSE ainda não aparecem nesta tela.`;
  }

  (async () => {
    try {
      await carregarBase();
      await carregarUf(uf);
      el("uf").innerHTML = D.ufsDisponiveis.map((u) => `<option value="${u}"${u === uf ? " selected" : ""}>${u}</option>`).join("");
      renderMetodoEstatico();
      renderMapa();
      marcarUfNoMapa();
      sortear(SEMENTE);   // abre com uma cédula sorteada: mostra o que faz sem sugerir voto em ninguém
    } catch (err) {
      el("cedula").innerHTML = `<div class="vazio-msg">Não foi possível carregar os dados: ${esc(err.message)}. Recarregue a página.</div>`;
      console.error(err);
    }
  })();
})();
