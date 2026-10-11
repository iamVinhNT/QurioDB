/**
 * @file DataTablePreview.tsx
 * @description Renders bounded query results, including MongoDB nested values.
 */

import React from "react";
import { Sparkles } from "lucide-react";

interface DataTablePreviewProps {
  columns: string[];
  data: any[];
}

/**
 * DataTablePreview Component
 * Displays the bounded dataset returned by the server.
 */
export const DataTablePreview = React.memo(({ columns, data }: DataTablePreviewProps) => {
  const visibleColumns = React.useMemo(() => columns, [columns]);
  const visibleRows = React.useMemo(() => data, [data]);

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-slate-200/70 bg-white/80 p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-sm dark:border-white/10 dark:bg-card/70 dark:shadow-[0_10px_30px_-18px_rgba(0,0,0,0.65)]">
      <div className="flex items-center gap-1.5 mb-1.5 px-1 text-[10px] font-black uppercase tracking-widest text-primary/70">
        <Sparkles className="h-3 w-3" />
        Kết quả truy vấn
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              {visibleColumns.map(col => (
                <th key={col} className="p-1 text-[9px] font-bold text-muted-foreground border-b border-border/50 truncate max-w-25">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, idx) => (
              <tr key={idx} className="hover:bg-primary/5 transition-colors">
                {visibleColumns.map(col => (
                  <td key={col} className="p-1 text-[10px] text-muted-foreground/80 truncate max-w-25 border-b border-border/20">{row[col] == null ? "NULL" : typeof row[col] === "object" ? JSON.stringify(row[col]) : String(row[col])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 text-[8px] text-muted-foreground/60 italic px-1">
        {data.length} dòng trong kết quả giới hạn.
      </div>
    </div>
  );
});
