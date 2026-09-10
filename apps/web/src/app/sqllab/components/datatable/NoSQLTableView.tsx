/**
 * @file NoSQLTableView.tsx
 * @description Scannable tabular representation for heterogeneous NoSQL (e.g. MongoDB) query results.
 */

"use client";

import React, { useMemo } from "react";
import { useSettingsStore } from "@/stores/use-settings-store";
import {
  estimateColumnWidths,
  ROW_INDEX_COLUMN_WIDTH_PX,
  TabularResultView,
} from "./TabularResultView";

interface NoSQLTableViewProps {
  data: Record<string, any>[];
}

export function NoSQLTableView({ data }: NoSQLTableViewProps) {
  const { showNullAs } = useSettingsStore();
  const columns = useMemo(() => {
    const colSet = new Set<string>();
    let hasId = false;

    for (const doc of data) {
      if (doc && typeof doc === "object" && !Array.isArray(doc)) {
        for (const key of Object.keys(doc)) {
          if (key === "_id") {
            hasId = true;
          } else {
            colSet.add(key);
          }
        }
      }
    }

    const remaining = Array.from(colSet);
    return hasId ? ["_id", ...remaining] : remaining;
  }, [data]);
  const columnWidths = useMemo(
    () => estimateColumnWidths(columns, data, showNullAs),
    [columns, data, showNullAs],
  );
  const tableWidth = useMemo(
    () =>
      ROW_INDEX_COLUMN_WIDTH_PX +
      columnWidths.reduce((total, width) => total + width, 0),
    [columnWidths],
  );

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 italic text-xs font-mono">
        No documents to display
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 italic text-xs font-mono">
        No tabular columns found in documents
      </div>
    );
  }

  return (
    <TabularResultView
      columns={columns}
      data={data}
      columnWidths={columnWidths}
      tableWidth={tableWidth}
      nullText={showNullAs}
      testId="nosql-table-view"
    />
  );
}
