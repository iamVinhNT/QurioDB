/**
 * @file TabularResultView.tsx
 * @description Reusable tabular presentation component for query results across relational and NoSQL views.
 */

"use client";

import React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const ROW_INDEX_COLUMN_WIDTH_PX = 48;
const MIN_DATA_COLUMN_WIDTH_PX = 88;
const CELL_CHROME_WIDTH_PX = 44;
const MONOSPACE_CHAR_WIDTH_PX = 8;

/**
 * Column widths are estimates; scanning a bounded row sample keeps the
 * main-thread cost of width calculation independent of result-set size.
 */
export const COLUMN_WIDTH_SAMPLE_ROWS = 100;

export interface TabularVirtualRow {
  index: number;
  start: number;
  size: number;
  end?: number;
  key?: React.Key;
}

export interface TabularResultViewProps {
  columns: string[];
  data: Record<string, any>[];
  virtualRows?: TabularVirtualRow[];
  totalSize?: number;
  scrollRef?: React.Ref<HTMLDivElement>;
  columnWidths?: number[];
  tableWidth?: number;
  getRowIndex?: (virtualIndex: number) => number;
  onCellClick?: (
    colName: string,
    value: any,
    row: Record<string, any>,
    rowIndex: number,
  ) => void;
  getCellClassName?: (
    colName: string,
    value: any,
    row: Record<string, any>,
    rowIndex: number,
  ) => string | undefined;
  renderCellContent?: (
    colName: string,
    value: any,
    row: Record<string, any>,
    rowIndex: number,
  ) => React.ReactNode;
  emptyContent?: React.ReactNode;
  nullText?: string;
  mini?: boolean;
  className?: string;
  tableClassName?: string;
  testId?: string;
}

function formatCellValue(value: any, nullText: string) {
  if (value === null) return nullText;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getEstimatedTextUnits(text: string) {
  let units = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    units += codePoint >= 0x2e80 ? 2 : 1;
  }
  return units;
}

export function estimateColumnWidths(
  columns: string[],
  data: any[],
  nullText: string,
) {
  const maxUnitsByColumn = columns.map((column) =>
    getEstimatedTextUnits(column),
  );

  const scanLimit = Math.min(data.length, COLUMN_WIDTH_SAMPLE_ROWS);
  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex++) {
    const row = data[rowIndex];
    columns.forEach((column, index) => {
      const value = formatCellValue(row?.[column], nullText);
      const units = getEstimatedTextUnits(value);
      if (units > maxUnitsByColumn[index]) {
        maxUnitsByColumn[index] = units;
      }
    });
  }

  return maxUnitsByColumn.map((units) =>
    Math.max(
      MIN_DATA_COLUMN_WIDTH_PX,
      Math.ceil(units * MONOSPACE_CHAR_WIDTH_PX) + CELL_CHROME_WIDTH_PX,
    ),
  );
}

export function renderCellValue(
  value: any,
  nullText: string = "null",
): React.ReactNode {
  if (value === null) {
    return (
      <span className="text-muted-foreground/40 italic font-black uppercase tracking-widest text-[9px]">
        {nullText}
      </span>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span
        className={cn(
          "text-[9px] font-black px-1.5 py-0.5 rounded-sm uppercase tracking-tighter",
          value
            ? "text-emerald-700 bg-emerald-100/50"
            : "text-red-700 bg-red-100/50",
        )}
      >
        {String(value)}
      </span>
    );
  }
  return <span className="text-foreground/90">{formatCellValue(value, nullText)}</span>;
}

export function TabularResultView({
  columns,
  data,
  virtualRows,
  totalSize,
  scrollRef,
  columnWidths,
  tableWidth,
  getRowIndex,
  onCellClick,
  getCellClassName,
  renderCellContent,
  emptyContent,
  nullText = "null",
  mini,
  className,
  tableClassName,
  testId,
}: TabularResultViewProps) {
  const isVirtualized = Array.isArray(virtualRows);

  const renderRow = (
    rowIndex: number,
    originalIndex: number,
    doc: Record<string, any> | undefined,
    rowHeight?: number,
    rowKey?: React.Key,
  ) => (
    <tr
      key={rowKey ?? rowIndex}
      data-index={rowIndex}
      className="hover:bg-primary/4 group transition-all duration-75 odd:bg-muted/5"
      style={rowHeight === undefined ? undefined : { height: `${rowHeight}px` }}
    >
      <td className="border-r p-1.5 text-[10px] text-muted-foreground/60 font-black text-center sticky left-0 bg-background group-hover:bg-background/80 z-1 transition-colors">
        {rowIndex + 1}
      </td>
      {columns.map((col, columnIndex) => {
        const value = doc?.[col];
        const cellTitle = formatCellValue(value, nullText);
        return (
          <td
            key={`${col}-${columnIndex}`}
            title={cellTitle}
            className={cn(
              "border-r p-2 text-[11px] font-medium whitespace-nowrap border-border/20 transition-all select-text relative",
              mini ? "p-1.5" : "p-2.5",
              getCellClassName?.(col, value, doc ?? {}, originalIndex),
            )}
            onClick={
              onCellClick
                ? () => onCellClick(col, value, doc ?? {}, originalIndex)
                : undefined
            }
          >
            {renderCellContent ? (
              renderCellContent(col, value, doc ?? {}, originalIndex)
            ) : (
              <div>{renderCellValue(value, nullText)}</div>
            )}
          </td>
        );
      })}
    </tr>
  );

  if (columns.length === 0) {
    return (
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-auto custom-scrollbar p-3 select-text flex items-center justify-center",
          className,
        )}
        data-testid={testId}
      >
        <div className="text-muted-foreground/50 italic text-xs font-mono">
          No columns to display
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 relative overflow-auto scrollbar-thin bg-background",
        className,
      )}
      data-testid={testId}
    >
      <table
        className={cn(
          "min-w-full text-sm border-collapse table-fixed font-mono",
          tableClassName,
        )}
        style={tableWidth ? { width: `${tableWidth}px` } : undefined}
      >
        {columnWidths && (
          <colgroup>
            <col style={{ width: `${ROW_INDEX_COLUMN_WIDTH_PX}px` }} />
            {columns.map((col, index) => (
              <col
                key={`${col}-${index}`}
                style={{ width: `${columnWidths[index]}px` }}
              />
            ))}
          </colgroup>
        )}
        <thead className="sticky top-0 bg-background/95 backdrop-blur-md shadow-sm z-50">
          <tr>
            <th className="border-b border-r p-1 text-[9px] text-muted-foreground font-black w-12 text-center bg-muted/20 sticky left-0 z-51 uppercase tracking-tighter">
              #
            </th>
            {columns.map((col, index) => (
              <th
                key={`${col}-${index}`}
                className={cn(
                  "border-b border-r pt-3 pb-2 px-3 text-left font-black text-[11px] bg-muted/5 transition-colors hover:bg-muted/10 group select-text uppercase tracking-tighter whitespace-nowrap",
                  mini ? "px-2" : "px-3",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{col}</span>
                  <ChevronDown className="h-3 w-3 opacity-0 group-hover:opacity-30 shrink-0" />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {isVirtualized ? (
            <>
              {virtualRows.length > 0 && virtualRows[0].start > 0 && (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    style={{ height: `${virtualRows[0].start}px` }}
                  />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const rowIndex = virtualRow.index;
                const originalIndex = getRowIndex
                  ? getRowIndex(rowIndex)
                  : rowIndex;
                return renderRow(
                  rowIndex,
                  originalIndex,
                  data[originalIndex],
                  virtualRow.size,
                  virtualRow.key,
                );
              })}
              {virtualRows.length > 0 &&
                totalSize !== undefined &&
                (() => {
                  const lastRow = virtualRows[virtualRows.length - 1];
                  const lastEnd = lastRow.end ?? lastRow.start + lastRow.size;
                  const remaining = totalSize - lastEnd;
                  return remaining > 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length + 1}
                        style={{ height: `${remaining}px` }}
                      />
                    </tr>
                  ) : null;
                })()}
            </>
          ) : (
            data.map((doc, rowIndex) =>
              renderRow(
                rowIndex,
                getRowIndex ? getRowIndex(rowIndex) : rowIndex,
                doc,
              ),
            )
          )}
        </tbody>
      </table>
      {emptyContent}
    </div>
  );
}
