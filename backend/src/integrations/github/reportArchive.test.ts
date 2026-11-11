import { describe, expect, it } from "vitest";
import { readReportArchive } from "./reportArchive.js";
import { patchZipCentralDirectory, reportZip } from "../../test/archive.js";

const entry = (name = "report.json", content = Buffer.from('{"version":1}')) => ({ name, content });

describe("readReportArchive", () => {
  it("returns the single report as bytes without interpreting JSON", async () => {
    const content = Buffer.from("fixture bytes");
    await expect(
      readReportArchive(await reportZip([entry("report.json", content)])),
    ).resolves.toEqual(content);
  });
  it("accepts exactly 64 KiB of uncompressed report bytes", async () => {
    const content = Buffer.alloc(65536, 65);
    await expect(
      readReportArchive(await reportZip([entry("report.json", content)])),
    ).resolves.toEqual(content);
  });
  it("accepts DOS file attributes without a Unix file type", async () => {
    const archive = patchZipCentralDirectory(await reportZip(), (buffer, offset) => {
      buffer.writeUInt16LE(20, offset + 4);
      buffer.writeUInt32LE(0x20, offset + 38);
    });
    await expect(readReportArchive(archive)).resolves.toEqual(Buffer.from('{"version":1}'));
  });
  it.each(["other.json", "dir/report.json", "report.json/"])(
    "rejects unexpected filename %s",
    async (name) => {
      await expect(readReportArchive(await reportZip([entry(name)]))).rejects.toMatchObject({
        reason: "invalid_response",
      });
    },
  );
  it("rejects empty archives", async () => {
    await expect(readReportArchive(await reportZip([]))).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });
  it("rejects empty report files", async () => {
    await expect(
      readReportArchive(await reportZip([entry("report.json", Buffer.alloc(0))])),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("rejects additional entries even when the first report is valid", async () => {
    await expect(
      readReportArchive(await reportZip([entry(), entry("extra.txt")])),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("rejects duplicate report entries", async () => {
    await expect(readReportArchive(await reportZip([entry(), entry()]))).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });
  it("rejects symlinks", async () => {
    await expect(
      readReportArchive(await reportZip([{ ...entry(), mode: 0o120777 }])),
    ).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("rejects directory attributes even without a filename slash", async () => {
    const archive = patchZipCentralDirectory(await reportZip(), (buffer, offset) =>
      buffer.writeUInt32LE(0x10, offset + 38),
    );
    await expect(readReportArchive(archive)).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("rejects encrypted entries", async () => {
    const archive = patchZipCentralDirectory(await reportZip(), (buffer, offset) =>
      buffer.writeUInt16LE(buffer.readUInt16LE(offset + 8) | 1, offset + 8),
    );
    await expect(readReportArchive(archive)).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("rejects compressed expansion over 64 KiB", async () => {
    const archive = await reportZip([entry("report.json", Buffer.alloc(65537, 65))]);
    expect(archive.length).toBeLessThan(1024);
    await expect(readReportArchive(archive)).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("rejects understated uncompressed sizes during streaming", async () => {
    const archive = patchZipCentralDirectory(
      await reportZip([entry("report.json", Buffer.alloc(65537, 65))]),
      (buffer, offset) => buffer.writeUInt32LE(65536, offset + 24),
    );
    await expect(readReportArchive(archive)).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it("rejects a corrupted CRC even when decompression succeeds", async () => {
    const archive = patchZipCentralDirectory(await reportZip(), (buffer, offset) =>
      buffer.writeUInt32LE(0, offset + 16),
    );
    await expect(readReportArchive(archive)).rejects.toMatchObject({ reason: "invalid_response" });
  });
  it.each(["../bad.json", "C:/bad.json", "\\\\bad.json"])(
    "rejects unsafe entry paths %s",
    async (name) => {
      const archive = patchZipCentralDirectory(await reportZip(), (buffer, offset) => {
        Buffer.from(name.padEnd(11, "x")).copy(buffer, offset + 46);
      });
      await expect(readReportArchive(archive)).rejects.toMatchObject({
        reason: "invalid_response",
      });
    },
  );
  it.each([Buffer.from("not a zip: /remote/path secret"), Buffer.alloc(0)])(
    "sanitizes malformed archive errors",
    async (archive) => {
      const error = await readReportArchive(archive).catch((error: unknown) => error);
      expect(error).toMatchObject({ reason: "invalid_response" });
      expect(String(error)).not.toMatch(/remote|secret|central directory/);
    },
  );
});
