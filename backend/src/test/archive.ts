import { ZipFile } from "yazl";

export async function reportZip(
  entries: Array<{ name: string; content: Buffer; mode?: number; compress?: boolean }> = [
    { name: "report.json", content: Buffer.from('{"version":1}') },
  ],
): Promise<Buffer> {
  const zip = new ZipFile();
  const result = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.on("error", reject);
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries) {
    if (entry.name.endsWith("/")) {
      zip.addEmptyDirectory(entry.name);
      continue;
    }
    zip.addBuffer(entry.content, entry.name, {
      ...(entry.mode === undefined ? {} : { mode: entry.mode }),
      ...(entry.compress === undefined ? {} : { compress: entry.compress }),
    });
  }
  zip.end();
  return result;
}

export function patchZipCentralDirectory(
  archive: Buffer,
  patch: (archive: Buffer, offset: number) => void,
) {
  const copy = Buffer.from(archive);
  const offset = copy.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  if (offset < 0) throw new Error("ZIP fixture lacks central directory");
  patch(copy, offset);
  return copy;
}
