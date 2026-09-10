/**
 * Copia data/build/ para public/dados/, que é o que o navegador busca em runtime.
 *
 * O front carrega sempre por /dados/<uf>/<cargo>.json — caminho único, para o
 * service worker poder cachear por regra simples (§1.4).
 */
import { cp, mkdir, rm } from "node:fs/promises";

const origem = new URL("../data/build/", import.meta.url);
const destino = new URL("../public/dados/", import.meta.url);

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });
await cp(origem, destino, { recursive: true });
console.log("dados copiados para public/dados/");
