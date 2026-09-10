/**
 * Leitor de ZIP sem dependência externa.
 *
 * Só roda no build (§0.1), nunca no navegador. Suporta os dois métodos que o TSE
 * usa: "store" (0) e "deflate" (8). Recusa explicitamente ZIP64 em vez de ler
 * lixo silenciosamente — os pacotes do TSE ficam muito abaixo dos limites.
 */
import { inflateRawSync } from "node:zlib";

export interface EntradaZip {
  nome: string;
  tamanho: number;
  conteudo: () => Buffer;
}

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

/** Localiza o End Of Central Directory varrendo do fim para o começo. */
function acharEocd(buf: Buffer): number {
  // O EOCD tem 22 bytes fixos + até 65535 de comentário.
  const minimo = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === ASSINATURA_EOCD) return i;
  }
  throw new Error("ZIP inválido: End Of Central Directory não encontrado");
}

export function lerZip(buf: Buffer): EntradaZip[] {
  const eocd = acharEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const inicioCentral = buf.readUInt32LE(eocd + 16);

  if (total === 0xffff || inicioCentral === 0xffffffff) {
    throw new Error("ZIP64 não suportado — o pacote do TSE cresceu além do previsto");
  }

  const entradas: EntradaZip[] = [];
  let p = inicioCentral;

  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== ASSINATURA_CENTRAL) {
      throw new Error(`ZIP inválido: cabeçalho central ausente na entrada ${i}`);
    }
    const metodo = buf.readUInt16LE(p + 10);
    const tamComprimido = buf.readUInt32LE(p + 20);
    const tamOriginal = buf.readUInt32LE(p + 24);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComentario = buf.readUInt16LE(p + 32);
    const deslocamentoLocal = buf.readUInt32LE(p + 42);
    // Nomes de arquivo do TSE são ASCII; latin1 evita quebrar se houver acento.
    const nome = buf.subarray(p + 46, p + 46 + tamNome).toString("latin1");

    entradas.push({
      nome,
      tamanho: tamOriginal,
      conteudo: () => extrair(buf, deslocamentoLocal, metodo, tamComprimido, nome),
    });

    p += 46 + tamNome + tamExtra + tamComentario;
  }

  return entradas;
}

function extrair(buf: Buffer, deslocamento: number, metodo: number, tamComprimido: number, nome: string): Buffer {
  if (buf.readUInt32LE(deslocamento) !== ASSINATURA_LOCAL) {
    throw new Error(`ZIP inválido: cabeçalho local ausente para "${nome}"`);
  }
  // O cabeçalho local tem tamanhos próprios de nome/extra, que podem diferir do central.
  const tamNome = buf.readUInt16LE(deslocamento + 26);
  const tamExtra = buf.readUInt16LE(deslocamento + 28);
  const inicio = deslocamento + 30 + tamNome + tamExtra;
  const dados = buf.subarray(inicio, inicio + tamComprimido);

  if (metodo === 0) return Buffer.from(dados);
  if (metodo === 8) return inflateRawSync(dados);
  throw new Error(`ZIP: método de compressão ${metodo} não suportado em "${nome}"`);
}
