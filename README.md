# Com Quem Anda

Ferramenta pública para o eleitor analisar seus votos, consultar os dados oficiais de cada
candidato e testar a coerência da própria chapa. Sem login, sem coleta, sem servidor.

Este repositório tem o **M1 (pipeline de dados)** e a **camada vertical do M2**: o índice de
coerência da chapa. Ainda não há interface versionada aqui — o protótipo da camada vertical roda
como artifact, a partir dos mesmos JSONs de `data/build`.

Especificação completa: [`CEDULA-ABERTA-SPEC.md`](CEDULA-ABERTA-SPEC.md).

## Privacidade

Quatro fatos, e os textos da página descrevem exatamente estes:

1. **A cédula, as respostas das pautas e os resultados nunca saem do aparelho.** Não há
   `fetch` nem `POST` que os carregue, não há `pushState` e nada vai para a query string.
2. **O navegador baixa arquivos do próprio domínio** — `dados/base.json`, `dados/uf/{UF}.json`
   e as fontes. Por isso "nada sai do aparelho" seria **impreciso**, e foi abandonado de
   propósito: a promessa honesta é sobre o que o usuário **faz**, não sobre tráfego de rede,
   que existe em qualquer página.
3. **`localStorage` guarda uma única chave** (`TOUR_CHAVE`), marcando que o tutorial já foi
   visto. Não identifica ninguém e some ao limpar os dados do site.
4. **Sem cookie, `sessionStorage`, IndexedDB, service worker, script externo ou analytics no
   navegador.** A contagem de acessos é feita apenas na borda pelo host, agregada, sem JS.

### Teste manual obrigatório

O beacon do Cloudflare Web Analytics foi **desligado no painel em 21/09/2026**. Ele podia ser
injetado na borda por "Automatic setup", **sem passar por este repositório** — então nenhum
teste automatizado daqui o veria. Depois de qualquer mudança de host ou de configuração do CDN:

> DevTools → **Network**, recarregar, e confirmar que **não** aparece `cloudflareinsights`
> nem `/cdn-cgi/rum`.

Se aparecer, a página está mentindo e o texto de privacidade precisa mudar junto — ou o beacon
precisa sair.

## Métricas de acesso

**A medição de acesso acontece na borda do Cloudflare, não na página.** Em
`Analytics & Logs → Traffic` estão requisições, banda e país, contados no servidor
porque o tráfego passa por lá. O visitante não executa nada, não recebe cookie e não é
identificado — é a única forma de medição compatível com a premissa de não coletar
dado de ninguém, e por isso o medidor embutido segue desligado.

O bloco abaixo existe para o caso de o site sair do Cloudflare. Está vazio de propósito;
preenchê-lo religa um medidor **dentro** da página, que é o que se quer evitar.

```js
window.CQA_ANALYTICS = { provedor: "goatcounter", token: "<subdominio>" };
// ou { provedor: "goatcounter", token: "<subdominio>" }
```

Os dois provedores suportados são **sem cookie e sem impressão digital**: contam
visita, origem e país em agregado. Qualquer outro é barrado pelo teste, porque o
texto de privacidade da página **nomeia** o medidor — e nomear o errado seria pior
que não ter medidor.

**O que nunca é enviado:** a cédula, as respostas do questionário e os pesos de tema.
`tests/privacidade.test.ts` confere isso no código publicado — que o front só busca
`dados/`, que não existe `sendBeacon` nem `XMLHttpRequest`, e que a função de métricas
não toca em `escolhas`, `respostas` ou `pesos`.

O texto de privacidade das abas Método e Avisos é **gerado a partir dessa configuração**,
então não tem como a página dizer que não mede enquanto mede.

## Tirar do ar — botão do pânico

Três camadas, da mais rápida para a mais definitiva. **Emergência acontece longe do
computador**, então a camada 1 é a única que importa projetar bem: ela funciona pelo
navegador do celular, sem terminal e sem `gh` autenticado.

### Camada 1 — regra no Cloudflare (segundos, do celular)

A regra fica **criada e desativada** de antemão. Criar sob pressão é onde se erra.

> Cloudflare → página **Security rules** → **Create rule** → **Custom rules**
> Nome: `pânico` · Field `Hostname` · Operator `contains` · Value `com-quem-anda`
> Action: **Block** · **deixar desativada**

O Block devolve **403**. Personalizar essa página exige plano Pro; no Free vem a
tela padrão do Cloudflare, que para o caso basta.

⚠️ **O painel do Cloudflare muda de nome com frequência.** Em set/2026 isto já
esteve em `Security → WAF → Custom rules`, a documentação oficial citava um botão
`Save as Draft` que não existia na tela, e o caminho real era outro. Não confie no
passo a passo acima ao pé da letra: o que importa é que exista uma regra que bloqueie
o hostname e que ela esteja **desligada** até você precisar. Confirme pelo efeito,
não pelo nome do menu:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://com-quem-anda.com.br/
```

Para derrubar: abrir a regra, ativar. Todo mundo passa a receber 403 em segundos, no
mundo inteiro, sem esperar propagação de DNS. Para voltar: desativar.

Como o `com-quem-anda.github.io` faz 301 para o domínio próprio, **esta regra derruba os
dois endereços** — é por isso que não existe espelho independente aqui.

Ela não alcança o repositório: o código segue público. Se o problema for o código, pule
para a camada 3.

### Camada 2 — desligar o Pages (tira a origem, não só a borda)

```bash
gh api -X DELETE repos/com-quem-anda/com-quem-anda.github.io/pages
```

### Camada 3 — fechar o repositório (site e código)

```bash
gh repo edit com-quem-anda/com-quem-anda.github.io --visibility private --accept-visibility-change-consequences
```

Para religar: `gh api -X POST repos/com-quem-anda/com-quem-anda.github.io/pages -f build_type=workflow`
e um push na `main`.

### Ensaio — ⬜ PENDENTE

> **Nunca foi executado.** A regra existe e está desligada desde 20/09/2026, mas
> **ninguém confirmou que ela derruba o site**, nem quanto tempo leva. Até o ensaio
> acontecer, este runbook é uma hipótese, não um procedimento.
>
> Marcado para 21/09/2026.

Botão do pânico nunca testado não é botão do pânico. Faça uma vez ao criar a regra, e de
novo a cada mudança de infraestrutura:

```bash
# 1. ativar a regra no painel, então:
curl -s -o /dev/null -w "com a regra ligada:  %{http_code}\n" https://com-quem-anda.com.br/
# esperado: 403

# 2. desativar a regra, então:
curl -s -o /dev/null -w "com a regra desligada: %{http_code}\n" https://com-quem-anda.com.br/
# esperado: 200
```

Anote os dois números abaixo. **São eles, e não a existência da regra, que dizem o que
você tem numa emergência.**

| | Medido em | Tempo |
|---|---|---|
| Ativar → primeiro `403` | — | — |
| Desativar → `200` de volta | — | — |

Enquanto essa tabela estiver vazia, trate a camada 1 como não verificada e considere que
a queda pode levar mais do que você espera.

**O que o ensaio também prova, de graça:** que a regra alcança `www` e o `github.io`
(que redireciona para cá), e que desligar realmente devolve o site — um `Block` que não
volta é pior que não ter botão.

O que **não** volta atrás, em qualquer das camadas: quem já baixou, arquivos em cache de
CDN por algumas horas, e cópias em serviços de arquivo como o Internet Archive.

## No ar

**https://com-quem-anda.com.br/**

O antigo `com-quem-anda.github.io` faz 301 para cá, automaticamente e sem opção de
desligar. Migração concluída em 20/09/2026.

Site estático, publicado pelo workflow `publicar.yml` a cada push na `main`.
Abrir custa 204 KB, **todos do nosso próprio servidor**: nenhuma requisição a
terceiro no carregamento. Antes eram 86 KB vindos do Google Fonts, o que entregava
o IP de cada visitante a eles.

### DNS e domínio

| | |
|---|---|
| Domínio | `com-quem-anda.com.br` (Registro.br, registrado em 20/09/2026) |
| Titular | pessoa física — WHOIS do `.br` publica nome e CPF parcial, e não há como ocultar |
| DNS | Cloudflare (plano Free) |
| Nameservers | `brit.ns.cloudflare.com` · `colin.ns.cloudflare.com` |
| DNSSEC | **desligado** no Registro.br antes da troca de nameservers |
| Origem | GitHub Pages, via `CNAME` de `@` e `www`, ambos **proxiados** |
| TLS | Let's Encrypt via Cloudflare, `Full (strict)`, `Always Use HTTPS` |
| HSTS | ligado mas com `max-age=0` — o que, na prática, é não ter HSTS |
| Cache | **bypass** por regra, de propósito (ver abaixo) |
| E-mail | Cloudflare Email Routing: `contato@` encaminha, destino só no painel |

### Registros na zona do Cloudflare

| Nome | Tipo | Conteúdo | Proxy |
|---|---|---|---|
| `com-quem-anda.com.br` | CNAME | `com-quem-anda.github.io` | laranja |
| `www` | CNAME | `com-quem-anda.github.io` | laranja |
| `com-quem-anda.com.br` | MX | `route1/2/3.mx.cloudflare.net` | — |
| `com-quem-anda.com.br` | TXT | `v=spf1 include:_spf.mx.cloudflare.net ~all` | — |
| `_dmarc` | TXT | `v=DMARC1; p=reject` | — |

O apex é CNAME e o Cloudflare o achata para os quatro IPs do GitHub Pages
(`185.199.108–111.153`). Isso é útil como diagnóstico: **IPs do GitHub significam
nuvem cinza; IPs do Cloudflare (104.x, 172.67.x) significam laranja.**

**O SPF precisa incluir o Cloudflare.** A zona nasce com `v=spf1 -all`, que declara
que nenhum servidor pode enviar em nome do domínio — e encaminhar e-mail é enviar.
Com o DMARC em `p=reject`, isso faz o destino **rejeitar em silêncio** tudo que for
encaminhado. Parece configurado e não entrega. Junto com o SPF, o `MX 0 .` (null MX
da RFC 7505) precisa ser apagado antes do onboarding, senão ele nem começa.

### Por que o cache do Cloudflare está desligado

Uma regra de **bypass** cobre o site inteiro, e isso é deliberado. O Cloudflare está
aqui por duas coisas — analytics de borda e o botão do pânico — e nenhuma depende de
cache. A origem já é o GitHub Pages, que tem CDN próprio com nó em São Paulo, e o
Lighthouse marcava 99/100 antes de o Cloudflare existir.

Com cache ligado o custo era concreto: o Cloudflare não guarda HTML mas guarda `.js` e
`.css` por extensão, então por até 10 minutos depois de cada deploy o visitante recebia
**HTML novo com JavaScript velho**. Ganho de velocidade quase nulo, janela de site
quebrado a cada publicação.

```bash
dig com-quem-anda.com.br @brit.ns.cloudflare.com +noall +answer
```

### Três armadilhas que já custaram tempo aqui

**1. O Registro.br segura domínio novo por ~2h.** Ao apontar para nameservers
externos, ele avisa "servidores DNS em transição" e mantém a delegação anterior
até vencer a carência. Durante esse tempo a zona do Cloudflare fica `pending` e
nada resolve, por mais certa que esteja a configuração. Só esperar.

**2. "DNS secundário" não é "outros servidores DNS".** No painel do Registro.br dá
para cair numa opção que delega para `a.sec.dns.br` / `c.sec.dns.br` — servidores
deles, com a zona vazia. O sintoma é o domínio não resolver com tudo aparentemente
certo no Cloudflare. Confira sempre para onde o `.br` delega de fato:

```bash
dig NS com-quem-anda.com.br @a.dns.br +noall +authority
```

**3. O proxy tem de esperar o certificado.** O GitHub emite por desafio HTTP no
domínio; com a nuvem laranja, o *Always Use HTTPS* do Cloudflare intercepta esse
HTTP e a validação nunca fecha. E sem certificado o proxy também quebra: em
`Full (strict)` dá **526**, em `Flexible` dá loop de redirecionamento. Ordem:
cinza → certificado → *Enforce HTTPS* → laranja com `Full (strict)`.

### O painel do Cloudflare mudou de lugar (set/2026)

| O que | Onde está hoje |
|---|---|
| Email Routing | **Compute** → **Email Service** → **Email Routing** → *Onboard Domain* |
| Regra do pânico | página **Security rules** → *Create rule* → *Custom rules* |

A regra agora nasce ativa pelo botão **Deploy** — crie, faça o ensaio, e desative
pelo toggle da lista. Email Routing exige a zona já usando o DNS do Cloudflare;
com a zona `pending` ele nem aparece como opção.

**Por que o DNSSEC está desligado.** O Registro.br liga DNSSEC por padrão quando o
domínio usa o DNS dele. Se os nameservers mudam para o Cloudflare com o registro DS
ainda publicado, todo resolvedor que valida DNSSEC devolve SERVFAIL — o domínio some
da internet, sem erro que explique o motivo. Desligar antes é obrigatório. Dá para
religar depois usando o DS que o próprio Cloudflare fornece.

**O `github.io` não é espelho.** Assim que o domínio próprio é configurado, o GitHub
passa a fazer 301 do `com-quem-anda.github.io` para ele, automaticamente e sem opção
de desligar. Isso é desejável: links antigos seguem funcionando e o SEO consolida num
endereço só.

**E o 301 é porta de mão única, por visitante.** Remover o domínio próprio no GitHub
faz o servidor parar de redirecionar em um minuto — mas não desfaz nada em quem já
recebeu o 301. O navegador gravou "permanentemente" e passa a redirecionar sozinho,
sem consultar o servidor. Se o destino não responder, a pessoa fica sem site até
limpar o cache do navegador, e ninguém limpa cache.

Daí a regra, que já custou uma queda aqui: **só configure o Custom domain no GitHub
depois que o domínio novo estiver servindo o site.** Confira antes:

```bash
curl -sI https://com-quem-anda.com.br/ | head -1   # tem de ser 200
```

Configurar antes deixa o `github.io` redirecionando para um domínio que ainda não
resolve — ou seja, derruba o endereço que funcionava, para todo mundo que o abrir.

Para trocar o endereço no código, use `scripts/migrar-dominio.ts` — ele conta as sete
ocorrências nos quatro arquivos e falha se alguma sumir. Nunca troque à mão: um
`canonical` errado não quebra nada visível, só manda o Google indexar o lugar errado,
calado, por semanas.

**A atualização do dado é manual, por enquanto.** O cron diário está desligado
porque o CDN do TSE bloqueia os runners do GitHub por IP — 403 em quatro
execuções seguidas, exatamente o que o M1 previa. Para atualizar, rode a cadeia
de coleta de uma máquina com IP brasileiro e faça push de `data/build`.

## Licença

Código sob **MIT**. Os dados não: TSE e IBGE têm termos próprios, e a atribuição
do TSE é obrigatória em qualquer publicação derivada — ver `LICENSE`.

## Como rodar

```bash
npm ci
npm run fetch                   # baixa o pacote do TSE para data/raw/ (não versionado)
npm run normalize -- --uf=SP    # gera data/build/SP/*.json   (--uf=all para as 27)
npm run alianca                 # gera data/build/alianca.json  (exige --uf=all)
npm run validate                # invariantes; falhou, não publica
npm run web                     # dados compactos do site em web/dados/
npm run artifact                # empacota o site num HTML único
npm run check                   # tipos + testes + invariantes
```

## Fonte

TSE, Portal de Dados Abertos, dataset [`candidatos-2026`](https://dadosabertos.tse.jus.br/dataset/candidatos-2026),
licença **Creative Commons Atribuição (CC-BY)** — a atribuição é obrigatória e visível em
qualquer publicação derivada. A proveniência de cada coleta (URL, sha256, data, `last-modified`
do TSE) fica em `data/raw/proveniencia.json` e em `data/build/meta.json`.

## A camada vertical: coerência da chapa

Dado que o eleitor declare em quem vota, o índice diz o quanto aquelas escolhas costumam andar
juntas. Ele **não** mede ideologia, e não precisa de nenhuma fonte além do próprio TSE.

- **Proximidade é comportamento revelado.** Cada coligação majoritária e cada federação é um
  conjunto de partidos; a similaridade de Jaccard sobre os 433 conjuntos do país dá π(a,b) sem
  nenhum parâmetro para ajustar — e portanto sem espaço para escolha editorial. Federação entra
  como aresta fixa de peso 1, porque é vínculo legal de quatro anos e não acordo de uma eleição.
- **O número cru não significa nada,** então o que se reporta é a posição dele numa distribuição
  nula montada com o universo real de candidatos da UF. Quando dá para enumerar todas as
  combinações, enumeramos; só acima de 500 mil entra Monte Carlo, com semente fixa.
- **O diagnóstico é por voto, não agregado.** A alavancagem deixa-um-de-fora aponta qual escolha
  puxa a chapa para longe das outras — que é a saída útil, e não a nota.
- **Coerência não é virtude.** Voto dividido é estratégia legítima. Nada no código chama chapa
  dispersa de erro, e a interface também não deve.

Por que o grafo exige `--uf=all`: com os 11 conjuntos de São Paulo sozinho, MDB~PL cravava 1,00
porque coincidiram uma vez. Com as 27 UFs o mesmo par cai para 0,10. Grafo magro não é grafo
impreciso, é grafo errado — o `validate` reprova abaixo de 100 conjuntos.

## O site

`web/` é estático e sem dependência nenhuma — nem framework, nem analytics, nem cookie,
nem chamada a terceiros. Abrir em São Paulo custa **58 KB comprimidos**: a base (grafo,
eleitorado, malha, presidentes) mais o arquivo daquela UF, carregado sob demanda.

O mesmo código roda de dois jeitos. Se `window.CEDULA_DADOS` existir, os dados estão
embutidos no próprio HTML (é o que `build-artifact.ts` gera); senão, ele busca
`dados/base.json` e `dados/uf/<UF>.json`. Não há uma segunda versão do app para sair de sincronia.

**A matemática da tela é conferida contra a biblioteca antes de publicar.** `app.js` reimplementa
em JS o que `lib/{alianca,coerencia}.ts` faz em TypeScript, e uma reimplementação não verificada
seria só um segundo lugar onde errar. A conferência compara os 900 pares de partidos, centenas de
cédulas aleatórias, a distribuição nula enumerada, os 20.000 sorteios do Monte Carlo e a sugestão
por partido — tudo exato até 1e-12.

**Analytics: não há, por decisão.** Nem contador, nem identificador. É por isso que não existe
estatística agregada de como as pessoas montam suas cédulas: coletar isso, mesmo em agregado e
com consentimento, exigiria um servidor para receber — e servidor é exatamente o que este projeto
não tem. A promessa vale mais que o dado.

## A aba Você: o match

O eleitor responde as mesmas doze votações que os deputados enfrentaram e recebe, para cada
bancada, **a fração de deputados daquele partido que votou do mesmo lado que ele**. Não há
modelo nem estimação — é contagem direta de voto registrado, ponderada pelo peso que o próprio
eleitor deu a cada tema.

A escala é comum por construção: eleitor e deputado respondem ao mesmo item. Testado com dois
perfis espelhados, o resultado espelha — PT/PSOL/PV no topo de um, NOVO/PL no topo do outro.

O cruzamento final confronta as respostas com a cédula declarada na primeira aba: quanto cada
candidato escolhido tem de bancada votando como o eleitor. Para governador e deputado estadual
a resposta é "sem registro de votação", porque não existe — ver a nota de viabilidade da camada
horizontal.

## Pautas: o único arquivo com autor

`scripts/pautas/itens.json` é a exceção declarada à regra do projeto. Tudo o mais aqui é
derivado mecanicamente da fonte; o texto das doze perguntas foi **escrito**, e escrever é
escolher. Ele fica em arquivo próprio, versionado e apartado, justamente para que a escolha
seja visível e contestável por pull request — não diluída dentro do código.

Cada pergunta aponta para uma votação nominal real, diz o que "Sim" significou naquela
votação e leva à ficha na Câmara. Seis são votos de mérito e seis de urgência; a diferença
está marcada na tela, porque urgência mede disposição de priorizar e não concordância com
o conteúdo.

`build-pautas.ts` calcula o que é medido: o eixo de votação da 57ª legislatura (462 deputados
× 964 votações divididas, primeiro componente principal) e como cada bancada votou nas doze.
Duas escolhas metodológicas ficam gravadas no arquivo de saída porque mudam o resultado:
**o corte de três deputados** por legenda — abaixo disso não se mede coesão de bancada — e
**a filiação atual** do deputado, sabendo que 121 dos 462 trocaram de partido durante a
legislatura e carregam para a legenda de hoje um histórico anterior à troca.

## Desempenho: o encaixe existe, a nota não

Cruzar coerência com desempenho parlamentar depende de duas coisas separadas, e só uma
delas está em nossas mãos.

**A chave de ligação está pronta.** `build-parlamentares.ts` casa candidatura de 2026 com
mandato em exercício pelas APIs oficiais da Câmara e do Senado — 490 das 20.028 candidaturas.
Casa por nome normalizado mais UF, e recusa homônimo dentro da mesma UF, porque vínculo errado
é pior que vínculo ausente. Cargo nacional casa sem UF: presidente tem `SG_UF = BR`, e exigir UF
igual descartava justamente quem tem mandato e disputa o Planalto.

O teto é duro e vale saber antes de investir: **2,4% das candidaturas**. Só há registro de
mandato para quem já teve mandato. Em compensação, **82% dos 594 parlamentares em exercício
estão concorrendo**.

**A nota depende de autorização.** O Ranking dos Políticos é organização séria e o trabalho é
público — mas publicar não é licenciar. Não há termos de reuso no site, e o `robots.txt` traz
`Disallow: /api/`: o próprio operador pede que agentes automatizados não acessem a API.
`parlamentares.json` já tem o campo `desempenho`, vazio, esperando. Obtida a autorização, a nota
entra **ao lado** do índice e nunca dentro dele, com crédito visível. Coerência descreve alianças;
desempenho avalia mandato com critérios de terceiros. Somar as duas num número só destruiria as duas.

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

**O TSE grafa o mesmo partido de dois jeitos.** `SG_PARTIDO` traz `PCDOB`; as composições de
coligação e federação trazem `PC do B`. Sem canonizar, o partido do candidato nunca casa com o
partido do grafo e o PCDOB fica com proximidade zero contra todo mundo — inclusive contra o PT,
com quem tem federação. O erro é silencioso, que é o que o torna perigoso. O mapa está em
`APELIDOS`, em `lib/alianca.ts`, e o `validate` falha se aparecer grafia nova.

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
  build-alianca.ts    grafo de proximidade entre partidos
  build-parlamentares.ts quem tem mandato hoje — Câmara e Senado
  build-pautas.ts     eixo de votação da Câmara + cruzamento por pauta
  pautas/itens.json   as 12 perguntas — AUTORAL, não derivado do dado
  build-eleitorado.ts eleitores por UF — sob demanda, fora do cron
  build-malha.ts      malha dos estados, do IBGE — idem
  build-web.ts        forma compacta que o site consome
  build-artifact.ts   mesmo site num arquivo só
  validate.ts         invariantes do CI
  lib/
    unzip.ts          leitor de ZIP sem dependência (build-time)
    csv.ts            CSV latin-1 do TSE
    normalizar.ts     lógica pura de normalização — é aqui que se mexe
    alianca.ts        conjuntos de aliança + Jaccard + bootstrap
    parlamentares.ts  casamento candidato <-> mandato em exercício
    coerencia.ts      índice da chapa, distribuição nula, alavancagem
    tse.ts            constantes verificadas contra o dado
    types.ts          modelo de dados
tests/                node:test, sem framework
data/build/           JSONs versionados, incluindo alianca.json
web/                  o site: index.html, estilo.css, app.js
  dados/              forma compacta gerada por build-web.ts
data/raw/             baixado do TSE, fora do git
```
