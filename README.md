# Cédula Aberta

Ferramenta pública para o eleitor registrar seus votos, consultar os dados oficiais de cada
candidato e testar a coerência da própria chapa. Sem login, sem coleta, sem servidor.

Estado: **M2 — cédula estática** (§9 da spec). O pipeline de dados (M1) e a cédula funcionam;
o questionário de posições e o percentual de aderência ainda não existem, por decisão (§0.2).

Especificação completa: [`CEDULA-ABERTA-SPEC.md`](CEDULA-ABERTA-SPEC.md).

## Como rodar

```bash
npm ci
npx playwright install chromium   # só para os testes de navegador

npm run fetch                     # baixa o pacote do TSE para data/raw/ (não versionado)
npm run normalize -- --uf=SP      # gera data/build/SP/*.json   (--uf=all para as 27)
npm run validate                  # invariantes do dado; falhou, não publica

npm run dev                       # site em desenvolvimento
npm run build                     # site estático em dist/
npm run check                     # tipos + invariantes + build + todos os testes
```

## Orçamento de performance

Medido a cada execução do CI, em 360 px e Slow 4G, e não estimado. Estourou, o build falha.

| Métrica | Teto (§1.4) | Medido |
|---|---|---|
| Primeira tela da cédula | 150 KB | **37,7 KB** |
| Interativa em Slow 4G, sem cache | 3.000 ms | **1.795 ms** |
| Deslocamento de layout (CLS) | 0,05 | **0,0000** |
| Abrir a lista de 1.430 candidatos, Slow 4G | — | **1.019 ms** |

JavaScript total da cédula: 16,3 KB (5,7 KB comprimido). Zero dependências em runtime,
zero requisições para fora do site, zero fontes de terceiros.

## Fonte

TSE, Portal de Dados Abertos, dataset [`candidatos-2026`](https://dadosabertos.tse.jus.br/dataset/candidatos-2026),
licença **Creative Commons Atribuição (CC-BY)** — a atribuição é obrigatória e visível em
qualquer publicação derivada. A proveniência de cada coleta (URL, sha256, data, `last-modified`
do TSE) fica em `data/raw/proveniencia.json` e em `data/build/meta.json`.

## O que este pipeline garante

- **Universo completo.** Nenhum candidato é removido, em nenhuma etapa. Não existe lista de
  exclusão no código. `validate.ts` confere a contagem por UF e cargo contra
  `consulta_cand_2026_BRASIL.csv`, que o TSE gera separadamente dos arquivos por UF — uma
  conferência independente, e não a nossa soma conferindo a si mesma.
- **Ordem mecânica.** Toda lista sai ordenada por número na urna, crescente. É invariante testada.
- **Nada inferido.** Campo sem fonte vira `null`. Sentinelas do TSE (`#NULO#`, `#NE`, `-1`, `-3`)
  nunca chegam ao JSON como texto.
- **Anomalia é declarada, não corrigida.** Candidatura duplicada e chapa incompleta viram entrada
  em `meta.json.anomalias`, com os `SQ_CANDIDATO` envolvidos, para aparecerem na aba de
  transparência (§6.2). O pipeline não escolhe qual registro é o "verdadeiro".

## Coisas que você precisa saber antes de mexer

**Não use `curl` nem `wget` para falar com o TSE.** O CDN está atrás de Akamai e devolve
403 para clientes cujo fingerprint TLS não pareça navegador — inclusive com IP residencial
brasileiro e cabeçalhos completos. O `fetch` do Node passa. Verificado em 10/09/2026.

**A situação do registro ainda não existe.** `DS_SITUACAO_CANDIDATURA` vem `#NE` em 100% das
20.914 candidaturas de 2026, e o layout deste ano **não tem** `DS_DETALHE_SITUACAO_CAND`. Por
isso `situacao.disponivel` existe no modelo: a interface precisa dizer "o TSE ainda não julgou",
nunca traduzir ausência para "deferido". O alerta de registro indeferido/cassado (§5.4) fica
bloqueado até `meta.json.situacaoRegistro.comSituacao` deixar de ser 0 — o `validate` avisa.

**O TSE bloqueia requisições HEAD.** Devolve 403 mesmo para URL que existe. Use sempre GET
e cancele o corpo — é o que `scripts/conferir-fontes.ts` faz.

**A API DivulgaCandContas está vazia para 2026.** Responde 200 com `candidatos: []` em todos os
cargos (CD_ELEICAO 6259, verificado em 10/09/2026). O critério de pronto do M1 na spec dependia
dela; foi substituído pela conferência contra o CSV consolidado.

**O universo é menor do que a spec supõe.** São 20.914 candidaturas no país, 2.626 em SP. O maior
arquivo gerado — 1.430 deputados estaduais de SP — dá **32 KB em brotli**, contra o teto de 300 KB
da §1.4. Foi por isso que o formato escolhido foi objetos legíveis, e não colunar: o diff do PR
diário precisa ser lido por humano em período eleitoral.

**Gerar as 27 UFs produz ~12 MB em `data/build`.** Com PR diário durante a campanha isso pesa no
repositório. Decidir no M6 se o dado versionado vai minificado.

## O que a interface garante

- **Filtro reordena, nunca apaga.** A busca alcança o universo inteiro do cargo; a contagem
  fica sempre à vista ("1430 candidatos" / "12 de 1430").
- **Nenhum destaque editorial.** Sem "em alta", sem "principais", sem foto maior para uns.
  O único destaque é o que o eleitor criou ao votar.
- **A ausência de dado aparece como ausência.** A situação do registro, que o TSE ainda não
  publicou, é dita na cédula, na ficha e na página de transparência — não é omitida.
- **Funciona sem rede.** O voto vive no aparelho e a cédula desenha antes de qualquer
  requisição. O service worker guarda a casca e a lista da UF escolhida.

## Estrutura

```
scripts/
  fetch-tse.ts        download do pacote + proveniência
  normalize.ts        casca de I/O
  validate.ts         invariantes do CI
  conferir-fontes.ts  checagem semanal das URLs do §3
  lib/
    unzip.ts          leitor de ZIP sem dependência (build-time)
    csv.ts            CSV latin-1 do TSE
    normalizar.ts     lógica pura de normalização — é aqui que se mexe
    tse.ts            constantes verificadas contra o dado
    types.ts          modelo de dados
src/
  pages/              /, /[uf]/, metodologia, fontes, transparência, privacidade
  lib/
    cedula.ts         os seis slots, o diagnóstico, exportação
    folha.ts          bottom sheet de escolha
    virtual.ts        rolagem virtualizada
    alertas.ts        alertas estruturais (§5.4) — lógica pura, testada
    coligacao.ts      leitura da composição declarada
    estado.ts         localStorage, chave única
  styles/             tokens, base mobile-first, cédula, impressão
public/
  sw.js               service worker (offline)
  manifest.webmanifest
tests/                node:test + playwright, sem framework de teste
data/build/           JSONs versionados
data/raw/             baixado do TSE, fora do git
```
