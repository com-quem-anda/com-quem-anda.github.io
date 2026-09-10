import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lerZip } from "../scripts/lib/unzip.ts";

/**
 * O leitor de ZIP é próprio (zero dependência). O teste que importa é confrontá-lo
 * com o zip do sistema, e não com a nossa própria ideia de como um ZIP deveria ser.
 */
function comZipReal(fn: (zip: string, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "cedula-zip-"));
  try {
    writeFileSync(join(dir, "texto.csv"), Buffer.from('"NM";"UF"\r\n"JOSÉ";"SP"\r\n', "latin1"));
    // Conteúdo grande e repetitivo força o método deflate; pequeno e aleatório tende a "store".
    writeFileSync(join(dir, "grande.txt"), "linha repetida para comprimir\n".repeat(5000));
    writeFileSync(join(dir, "aleatorio.bin"), Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) % 251)));
    const zip = join(dir, "pacote.zip");
    execFileSync("zip", ["-q", "-r", zip, "texto.csv", "grande.txt", "aleatorio.bin"], { cwd: dir });
    fn(zip, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("extrai byte a byte o mesmo que o zip do sistema", () => {
  comZipReal((zip, dir) => {
    const entradas = lerZip(readFileSync(zip));
    assert.equal(entradas.length, 3);
    for (const e of entradas) {
      const esperado = readFileSync(join(dir, e.nome));
      assert.deepEqual(e.conteudo(), esperado, `conteúdo divergente em ${e.nome}`);
      assert.equal(e.tamanho, esperado.length, `tamanho declarado errado em ${e.nome}`);
    }
  });
});

test("preserva bytes latin-1 sem tentar decodificar", () => {
  comZipReal((zip, dir) => {
    const e = lerZip(readFileSync(zip)).find((x) => x.nome === "texto.csv")!;
    assert.deepEqual(e.conteudo(), readFileSync(join(dir, "texto.csv")));
    assert.equal(new TextDecoder("latin1").decode(e.conteudo()).includes("JOSÉ"), true);
  });
});

test("ZIP inválido falha alto em vez de devolver lixo", () => {
  assert.throws(() => lerZip(Buffer.from("isto não é um zip")), /End Of Central Directory/);
});
