/**
 * Registro do service worker.
 *
 * Sem push, sem notificação, sem pedir permissão para nada (§1.4). O único
 * efeito é a página abrir sem rede.
 */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sem service worker o site continua funcionando, só perde o offline.
    });
  });
}
