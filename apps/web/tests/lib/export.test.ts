import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextDecoder, TextEncoder } from "node:util";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { exportData } from "@/lib/export";

vi.mock("xlsx", () => ({
  utils: {
    json_to_sheet: vi.fn().mockReturnValue({}),
    book_new: vi.fn().mockReturnValue({}),
    book_append_sheet: vi.fn(),
  },
  writeFile: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const exportedBytes = async () => {
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
};

const exportedText = async () =>
  new TextDecoder().decode(await exportedBytes());

describe("Utility: exportData", () => {
  const MOCK_DATA = [{ id: 1, name: "Admin" }];
  const MOCK_COLUMNS = ["id", "name"];

  beforeEach(() => {
    vi.stubGlobal("TextEncoder", TextEncoder);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads CSV without using XLSX", async () => {
    const click = vi.fn();
    const anchor = document.createElement("a");
    anchor.click = click;
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor);

    await exportData(MOCK_DATA, MOCK_COLUMNS, "csv", "test-file");

    expect(XLSX.utils.json_to_sheet).not.toHaveBeenCalled();
    expect(XLSX.writeFile).not.toHaveBeenCalled();
    expect(anchor.download).toBe("test-file.csv");
    expect(anchor.href).toBe("blob:mock-url");
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    createElementSpy.mockRestore();
  });

  it("handles empty data by logging a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await exportData([], MOCK_COLUMNS, "csv", "empty-file");

    expect(warnSpy).toHaveBeenCalledWith("No data to export");
    warnSpy.mockRestore();
  });

  it("stringifies nested values in CSV output", async () => {
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob.type).toBe("text/csv;charset=utf-8");
      return "blob:complex-url";
    });
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });

    const anchor = document.createElement("a");
    anchor.click = vi.fn();
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockReturnValue(anchor);

    await exportData(
      [{ id: 1, meta: { active: true }, tags: ["a", "b"] }],
      ["id", "meta", "tags"],
      "csv",
      "complex-export",
    );

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchor.download).toBe("complex-export.csv");

    createElementSpy.mockRestore();
  });

  it("handles auto-width for xlsx export", async () => {
    const data = [{ id: 1, name: "Long name that takes space" }];
    const cols = ["id", "name"];

    await exportData(data, cols, "xlsx", "test-file");

    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith([
      { id: 1, name: "Long name that takes space" },
    ]);
    expect(XLSX.writeFile).toHaveBeenCalledWith(
      expect.any(Object),
      "test-file.xlsx",
    );
  });

  it("exports Vietnamese as UTF-8 bytes with exactly one Excel BOM", async () => {
    await exportData([{ text: "Tiếng Việt: Đặng 😀" }], ["text"], "csv", "vi");
    const bytes = await exportedBytes();
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...bytes.slice(3)]).toEqual([
      ...new TextEncoder().encode("text\r\nTiếng Việt: Đặng 😀"),
    ]);
    expect(await exportedText()).toBe("text\r\nTiếng Việt: Đặng 😀");
  });

  it.each(["UTF-16", "UTF-16LE", "utf-16"])(
    "honors %s using little-endian bytes, a BOM and Vietnamese round-trip",
    async (encoding) => {
      await exportData([{ text: "Đặng 😀" }], ["text"], "csv", "vi", encoding);
      const bytes = await exportedBytes();
      expect([...bytes.slice(0, 6)]).toEqual([0xff, 0xfe, 0x74, 0, 0x65, 0]);
      expect(new TextDecoder("utf-16le").decode(bytes)).toBe("text\r\nĐặng 😀");
      const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
      expect(blob.type).toBe("text/csv;charset=utf-16le");
    },
  );

  it("honors ASCII using exact single-byte output without a BOM", async () => {
    await exportData([{ x: "AZ" }], ["x"], "csv", "ascii", "ASCII");
    expect([...(await exportedBytes())]).toEqual([
      0x78, 0x0d, 0x0a, 0x41, 0x5a,
    ]);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=us-ascii");
  });

  it("honors ISO-8859-1 using Latin-1 bytes rather than UTF-8 or Windows-1252", async () => {
    await exportData([{ x: "café ÿ" }], ["x"], "csv", "latin", "ISO-8859-1");
    expect([...(await exportedBytes())]).toEqual([
      0x78, 0x0d, 0x0a, 0x63, 0x61, 0x66, 0xe9, 0x20, 0xff,
    ]);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=iso-8859-1");
  });

  it.each([
    ["ASCII", "Tiếng Việt"],
    ["ISO-8859-1", "Tiếng Việt"],
    ["ASCII", "é"],
    ["ISO-8859-1", "€"],
    ["ISO-8859-1", "😀"],
  ])(
    "rejects %s text %s without downloading lossy bytes",
    async (encoding, text) => {
      await exportData([{ x: text }], ["x"], "csv", "invalid", encoding);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        `${encoding} cannot represent all exported characters. Choose UTF-8 or UTF-16 LE in Settings.`,
      );
    },
  );

  it("rejects an unrepresentable header too", async () => {
    await exportData([{ Đ: 1 }], ["Đ"], "csv", "invalid", "ASCII");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("rejects an unknown encoding without mislabelling UTF-8 bytes", async () => {
    await exportData(MOCK_DATA, MOCK_COLUMNS, "csv", "invalid", "Shift-JIS");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Unsupported CSV encoding: Shift-JIS. Choose an encoding in Settings.",
    );
  });

  it.each([
    "=1+1",
    "+SUM(1)",
    "-SUM(1)",
    "@SUM(1)",
    "\tplain",
    "\rplain",
    "\nplain",
  ])("protects injection prefix %j with a quoted TAB", async (text) => {
    await exportData([{ x: text }], ["x"], "csv", "safe");
    expect(await exportedText()).toBe(`x\r\n"\t${text}"`);
  });

  it.each([
    "=1+1",
    "+SUM(1)",
    "-SUM(1)",
    "@SUM(1)",
    "\tplain",
    "\rplain",
    "\nplain",
    "＝1",
    "＋SUM(1)",
    "－SUM(1)",
    "＠SUM(1)",
  ])("protects whitespace before injection prefix %j", async (text) => {
    const value = ` \u00a0${text}`;
    await exportData([{ x: value }], ["x"], "csv", "safe");
    expect(await exportedText()).toBe(`x\r\n"\t${value}"`);
  });

  it("protects column headers", async () => {
    await exportData([{ " =1+1": 1 }], [" =1+1"], "csv", "safe");
    expect(await exportedText()).toBe('"\t =1+1"\r\n1');
  });

  it.each([-42, -0.5, 0, 42, "-42", "+42", "-.5", "-1.25e-3", "+1E+2"])(
    "preserves legitimate number %j without a TAB prefix",
    async (value) => {
      await exportData([{ x: value }], ["x"], "csv", "numbers");
      expect(await exportedText()).toBe(`x\r\n${value}`);
    },
  );

  it.each(["-1+2", "+1/2", "-Infinity", "+0x1", " -42"])(
    "does not exempt suspicious numeric-looking text %j",
    async (value) => {
      await exportData([{ x: value }], ["x"], "csv", "safe");
      expect(await exportedText()).toBe(`x\r\n"\t${value}"`);
    },
  );

  it("preserves CSV quoting, CRLF, nulls and nested values", async () => {
    await exportData(
      [
        {
          'a,"b': 'hello,"world"\r\nnext',
          empty: null,
          meta: { active: true },
          tags: ["a", "b"],
        },
      ],
      ['a,"b', "empty", "meta", "tags"],
      "csv",
      "quoted",
    );
    expect(await exportedText()).toBe(
      '"a,""b",empty,meta,tags\r\n"hello,""world""\r\nnext",,"{""active"":true}","[""a"",""b""]"',
    );
  });

  it("keeps injected delimiters and quotes inside one protected CSV field", async () => {
    await exportData(
      [{ x: '=1+2",=HYPERLINK("bad")' }],
      ["x"],
      "csv",
      "quoted",
    );
    expect(await exportedText()).toBe('x\r\n"\t=1+2"",=HYPERLINK(""bad"")"');
  });

  it("leaves XLSX values and encoding behavior unchanged", async () => {
    const data = [{ text: "=1+1", amount: -42, vi: "Tiếng Việt" }];
    await exportData(data, ["text", "amount", "vi"], "xlsx", "xlsx", "ASCII");
    expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(data);
    expect(toast.error).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
