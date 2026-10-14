import { toast } from "sonner";

export type ExportFormat = "csv" | "xlsx";

const encodeCsv = (text: string, encoding: string) => {
  switch (encoding.toUpperCase()) {
    case "UTF-8":
      // Excel detects UTF-8 reliably when the file starts with a BOM.
      return new Blob([new TextEncoder().encode(`\uFEFF${text}`)], {
        type: "text/csv;charset=utf-8",
      });
    case "UTF-16":
    case "UTF-16LE": {
      const bytes = new Uint8Array(2 + text.length * 2);
      const view = new DataView(bytes.buffer);
      view.setUint16(0, 0xfeff, true);
      for (let i = 0; i < text.length; i++) {
        view.setUint16(2 + i * 2, text.charCodeAt(i), true);
      }
      return new Blob([bytes], { type: "text/csv;charset=utf-16le" });
    }
    case "ASCII":
    case "ISO-8859-1": {
      const limit = encoding.toUpperCase() === "ASCII" ? 0x7f : 0xff;
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code > limit) {
          throw new RangeError(
            `${encoding} cannot represent all exported characters. Choose UTF-8 or UTF-16 LE in Settings.`,
          );
        }
        bytes[i] = code;
      }
      return new Blob([bytes], {
        type: `text/csv;charset=${limit === 0x7f ? "us-ascii" : "iso-8859-1"}`,
      });
    }
    default:
      throw new RangeError(
        `Unsupported CSV encoding: ${encoding}. Choose an encoding in Settings.`,
      );
  }
};

const formatCellValue = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
};

const escapeCsvCell = (value: unknown) => {
  const text = String(formatCellValue(value));
  const isNumber =
    (typeof value === "number" && Number.isFinite(value)) ||
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
  // Quote the protective TAB so Excel treats dangerous text as a text cell.
  if (
    !isNumber &&
    (/^[\s]*[=+\-@＝＋－＠]/u.test(text) || /^\s*[\t\r\n]/.test(text))
  ) {
    return `"\t${text.replace(/"/g, '""')}"`;
  }
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

const downloadCsv = (
  data: any[],
  columns: string[],
  filename: string,
  encoding: string,
) => {
  const rows = [
    columns.map(escapeCsvCell).join(","),
    ...data.map((row) =>
      columns.map((column) => escapeCsvCell(row[column])).join(","),
    ),
  ];
  const blob = encodeCsv(rows.join("\r\n"), encoding);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const exportData = async (
  data: any[],
  columns: string[],
  format: ExportFormat,
  filename: string,
  encoding: string = "UTF-8",
) => {
  if (!data || data.length === 0) {
    console.warn("No data to export");
    return;
  }

  if (format === "csv") {
    try {
      downloadCsv(data, columns, filename, encoding);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      toast.error(error.message);
    }
    return;
  }

  const formattedData = data.map((row) => {
    const newRow: any = {};
    columns.forEach((col) => {
      newRow[col] = formatCellValue(row[col]);
    });
    return newRow;
  });

  const XLSX = await import("xlsx");

  const worksheet = XLSX.utils.json_to_sheet(formattedData);

  const colWidths = columns.map((col) => {
    const maxDataLength = Math.max(
      ...formattedData.map((row) => String(row[col] || "").length),
    );
    const headerLength = col.length;
    return { wch: Math.min(Math.max(maxDataLength, headerLength) + 2, 50) };
  });
  worksheet["!cols"] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Data");

  XLSX.writeFile(workbook, `${filename}.xlsx`);
};
