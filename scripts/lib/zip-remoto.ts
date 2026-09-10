/**
 * Lê o índice de um ZIP remoto sem baixá-lo.
 *
 * O pacote de propostas de SP tem 13,6 MB, e nas 27 UFs passaria de 380 MB por
 * coleta — para descobrir apenas QUAIS candidatos registraram proposta. O CDN
 * do TSE aceita requisições Range (verificado em 10/09/2026: devolve 206), então
 * lemos só o fim do arquivo, onde mora o índice: cerca de 8 KB por UF.
 *
 * Nenhum PDF é baixado, hospedado ou processado. O produto liga para a fonte
 * oficial; não a republica.
 */

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;

export interface EntradaRemota {
  nome: string;
  tamanho: number;
}

async function pedacoFinal(url: string, bytes: number): Promise<{ dados: Buffer; total: number }> {
  const r = await fetch(url, { headers: { Range: `bytes=-${bytes}` } });
  if (r.status !== 206) {
    throw new Error(`${url} não aceitou Range (status ${r.status}) — seria preciso baixar o pacote inteiro`);
  }
  const intervalo = r.headers.get("content-range") ?? "";
  const total = Number(intervalo.split("/")[1] ?? 0);
  return { dados: Buffer.from(await r.arrayBuffer()), total };
}

async function intervalo(url: string, inicio: number, fim: number): Promise<Buffer> {
  const r = await fetch(url, { headers: { Range: `bytes=${inicio}-${fim}` } });
  if (r.status !== 206) throw new Error(`${url} recusou o intervalo ${inicio}-${fim} (status ${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Devolve a lista de arquivos de um ZIP remoto, sem transferir o conteúdo. */
export async function listarZipRemoto(url: string): Promise<EntradaRemota[]> {
  // 64 KB do fim cobrem o EOCD e, na prática, o índice inteiro destes pacotes.
  const { dados, total } = await pedacoFinal(url, 65536);

  let eocd = -1;
  for (let i = dados.length - 22; i >= 0; i--) {
    if (dados.readUInt32LE(i) === ASSINATURA_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`EOCD não encontrado nos últimos 64 KB de ${url}`);

  const quantas = dados.readUInt16LE(eocd + 10);
  const tamanhoCentral = dados.readUInt32LE(eocd + 12);
  const inicioCentral = dados.readUInt32LE(eocd + 16);

  if (quantas === 0xffff || inicioCentral === 0xffffffff) {
    throw new Error(`ZIP64 não suportado em ${url}`);
  }

  // O índice pode ter ficado antes do trecho que baixamos; nesse caso, busca-se
  // exatamente o intervalo dele.
  const deslocamentoLocal = inicioCentral - (total - dados.length);
  const central = deslocamentoLocal >= 0 && deslocamentoLocal + tamanhoCentral <= dados.length
    ? dados.subarray(deslocamentoLocal, deslocamentoLocal + tamanhoCentral)
    : await intervalo(url, inicioCentral, inicioCentral + tamanhoCentral - 1);

  const entradas: EntradaRemota[] = [];
  let p = 0;
  for (let i = 0; i < quantas; i++) {
    if (central.readUInt32LE(p) !== ASSINATURA_CENTRAL) {
      throw new Error(`índice corrompido em ${url}, entrada ${i}`);
    }
    const tamOriginal = central.readUInt32LE(p + 24);
    const tamNome = central.readUInt16LE(p + 28);
    const tamExtra = central.readUInt16LE(p + 30);
    const tamComentario = central.readUInt16LE(p + 32);
    entradas.push({
      nome: central.subarray(p + 46, p + 46 + tamNome).toString("latin1"),
      tamanho: tamOriginal,
    });
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}
