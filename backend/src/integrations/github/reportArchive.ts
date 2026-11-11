import { crc32 } from "node:zlib";
import type { Readable } from "node:stream";
import { fromBuffer, type Entry } from "yauzl";
import { GithubCliError } from "./error.js";

const maximumReportBytes = 64 * 1024;
const invalidArchive = () =>
  new GithubCliError("invalid_response", "O arquivo de relatório do GitHub é inválido.");

function validReportEntry(entry: Entry) {
  const type = (entry.externalFileAttributes >>> 16) & 0o170000;
  const creator = entry.versionMadeBy >>> 8;
  return (
    entry.fileName === "report.json" &&
    (type === 0o100000 || (type === 0 && creator === 0)) &&
    (entry.externalFileAttributes & 0x18) === 0 &&
    (entry.generalPurposeBitFlag & 0x41) === 0 &&
    entry.uncompressedSize >= 1 &&
    entry.uncompressedSize <= maximumReportBytes
  );
}

/** Reads a bounded, single-file report archive entirely in memory. */
export function readReportArchive(archive: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fromBuffer(
      archive,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error) return reject(invalidArchive());
        let settled = false;
        let content: Buffer | undefined;
        let activeStream: Readable | undefined;
        const fail = () => {
          if (settled) return;
          settled = true;
          activeStream?.destroy();
          zip.close();
          reject(invalidArchive());
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (settled) return;
          if (!content) return fail();
          settled = true;
          zip.close();
          resolve(content);
        });
        zip.on("entry", (entry: Entry) => {
          if (settled) return;
          if (zip.entryCount !== 1 || content || !validReportEntry(entry)) return fail();
          zip.openReadStream(entry, (streamError, stream) => {
            if (settled) {
              stream?.destroy();
              return;
            }
            if (streamError) return fail();
            activeStream = stream;
            const chunks: Buffer[] = [];
            let size = 0;
            let checksum = 0;
            stream.on("error", fail);
            stream.on("data", (chunk: Buffer) => {
              if (settled) return;
              size += chunk.length;
              if (size > maximumReportBytes || size > entry.uncompressedSize) return fail();
              checksum = crc32(chunk, checksum);
              chunks.push(chunk);
            });
            stream.on("end", () => {
              if (settled) return;
              if (size !== entry.uncompressedSize || size === 0 || checksum !== entry.crc32)
                return fail();
              content = Buffer.concat(chunks, size);
              activeStream = undefined;
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
