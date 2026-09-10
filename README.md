# Cédula Aberta

Ferramenta pública para o eleitor registrar seus votos, consultar os dados oficiais de cada
candidato e testar a coerência da própria chapa. Sem login, sem coleta, sem servidor.

Este repositório está no **M1: pipeline de dados** (§9 da spec). Ainda não há interface.

Especificação completa: [`CEDULA-ABERTA-SPEC.md`](CEDULA-ABERTA-SPEC.md).

## Como rodar

```bash
npm ci
npm run fetch                   # baixa o pacote do TSE para data/raw/ (não versionado)
npm run normalize -- --uf=SP    # gera data/build/SP/*.json   (--uf=all para as 27)
npm run validate                # invariantes; falhou, não publica
npm run check                   # tipos + testes + invariantes
```

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

**A API DivulgaCandContas está vazia para 2026.** Responde 200 com `candidatos: []` em todos os
cargos (CD_ELEICAO 6259, verificado em 10/09/2026). O critério de pronto do M1 na spec dependia
dela; foi substituído pela conferência contra o CSV consolidado.

**O universo é menor do que a spec supõe.** São 20.914 candidaturas no país, 2.626 em SP. O maior
arquivo gerado — 1.430 deputados estaduais de SP — dá **32 KB em brotli**, contra o teto de 300 KB
da §1.4. Foi por isso que o formato escolhido foi objetos legíveis, e não colunar: o diff do PR
diário precisa ser lido por humano em período eleitoral.

**Gerar as 27 UFs produz ~12 MB em `data/build`.** Com PR diário durante a campanha isso pesa no
repositório. Decidir no M6 se o dado versionado vai minificado.

## Estrutura

```
scripts/
  fetch-tse.ts        download do pacote + proveniência
  normalize.ts        casca de I/O
  validate.ts         invariantes do CI
  lib/
    unzip.ts          leitor de ZIP sem dependência (build-time)
    csv.ts            CSV latin-1 do TSE
    normalizar.ts     lógica pura de normalização — é aqui que se mexe
    tse.ts            constantes verificadas contra o dado
    types.ts          modelo de dados
tests/                node:test, sem framework
data/build/           JSONs versionados
data/raw/             baixado do TSE, fora do git
```
