/*
 * Service worker da Cédula Aberta.
 *
 * Existe por um motivo concreto: no dia da eleição, dentro de um prédio de
 * escola com dez mil pessoas no mesmo setor de rede, não vai ter sinal — e a
 * cédula da pessoa precisa abrir mesmo assim (§1.4).
 *
 * Só cacheia recursos do próprio site. Não intercepta, não registra e não
 * transmite nada sobre a navegação de ninguém.
 */

const VERSAO = "v1";
const CACHE_CASCA = `casca-${VERSAO}`;
const CACHE_DADOS = `dados-${VERSAO}`;

// Telas que precisam abrir offline mesmo que a pessoa nunca as tenha visitado.
const CASCA = ["/", "/metodologia/", "/fontes/", "/transparencia/", "/privacidade/", "/manifest.webmanifest", "/icone.svg"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_CASCA)
      // addAll é tudo-ou-nada; individualmente uma 404 não impede a instalação.
      .then((cache) => Promise.allSettled(CASCA.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => c !== CACHE_CASCA && c !== CACHE_DADOS).map((c) => caches.delete(c)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Nunca tocar em origem de terceiro — não deveria haver nenhuma (§8).
  if (url.origin !== self.location.origin) return;

  // Navegação: rede primeiro, cache quando faltar sinal.
  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE_CASCA).then((c) => c.put(req, copia));
          return resp;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Listas de candidatos: serve do cache na hora e atualiza por trás.
  if (url.pathname.startsWith("/dados/")) {
    evento.respondWith(
      caches.open(CACHE_DADOS).then((cache) =>
        cache.match(req).then((emCache) => {
          const naRede = fetch(req)
            .then((resp) => {
              if (resp.ok) cache.put(req, resp.clone());
              return resp;
            })
            .catch(() => emCache);
          return emCache || naRede;
        }),
      ),
    );
    return;
  }

  // Assets com hash no nome: imutáveis, cache primeiro.
  evento.respondWith(
    caches.match(req).then((emCache) =>
      emCache ||
      fetch(req).then((resp) => {
        if (resp.ok && (url.pathname.startsWith("/_a/") || url.pathname.startsWith("/_astro/"))) {
          const copia = resp.clone();
          caches.open(CACHE_CASCA).then((c) => c.put(req, copia));
        }
        return resp;
      }),
    ),
  );
});
