/**
 * @file NoSQLResults.tsx
 * @description Component for displaying NoSQL query results (e.g., MongoDB, Redis) as expandable JSON documents or scannable tables with search and toolbar controls.
 */

"use client";

import React, { useState, useMemo, useTransition } from "react";
import {
  Search,
  X,
  FolderTree,
  TableProperties,
  ChevronsUpDown,
  ChevronsDownUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NoSQLDocumentNode } from "./datatable/NoSQLDocumentNode";
import { NoSQLTableView } from "./datatable/NoSQLTableView";

interface NoSQLResultsProps {
  data: any[];
}

export function NoSQLResults({ data }: NoSQLResultsProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "table">("tree");
  const [bulkAction, setBulkAction] = useState<{
    type: "initial" | "expand" | "collapse";
    version: number;
  }>({
    type: "initial",
    version: 0,
  });
  const [, startTransition] = useTransition();

  const handleExpandAll = () => {
    startTransition(() => {
      setBulkAction((prev) => ({
        type: "expand",
        version: prev.version + 1,
      }));
    });
  };

  const handleCollapseAll = () => {
    startTransition(() => {
      setBulkAction((prev) => ({
        type: "collapse",
        version: prev.version + 1,
      }));
    });
  };

  const filteredData = useMemo(() => {
    if (!searchTerm) return data;
    const term = searchTerm.toLowerCase();
    return data.filter((doc) => {
      const str = JSON.stringify(doc).toLowerCase();
      return str.includes(term);
    });
  }, [data, searchTerm]);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground/50 italic text-xs font-mono">
        No documents found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden font-mono text-xs">
      {/* Toolbar */}
      <div className="p-2.5 px-3 border-b border-border bg-muted/30 flex flex-wrap items-center gap-2.5">
        {/* View Mode Toggle */}
        <div
          className="inline-flex items-center rounded-md border border-border bg-muted/40 p-0.5 h-7"
          role="group"
          aria-label="Result display mode"
        >
          <button
            type="button"
            aria-label="Tree view"
            aria-pressed={viewMode === "tree"}
            onClick={() => setViewMode("tree")}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium leading-none transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer",
              viewMode === "tree"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            <FolderTree className="h-3.5 w-3.5 shrink-0" />
            <span>Tree</span>
          </button>
          <button
            type="button"
            aria-label="Table view"
            aria-pressed={viewMode === "table"}
            onClick={() => setViewMode("table")}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium leading-none transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer",
              viewMode === "table"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            <TableProperties className="h-3.5 w-3.5 shrink-0" />
            <span>Table</span>
          </button>
        </div>

        {/* Tree Expansion Controls */}
        {viewMode === "tree" && (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              aria-label="Expand all"
              title="Expand all documents"
              onClick={handleExpandAll}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium leading-none border border-border bg-background hover:bg-muted/60 text-foreground/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer shrink-0"
            >
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>Expand all</span>
            </button>
            <button
              type="button"
              aria-label="Collapse all"
              title="Collapse all documents"
              onClick={handleCollapseAll}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium leading-none border border-border bg-background hover:bg-muted/60 text-foreground/80 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer shrink-0"
            >
              <ChevronsDownUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>Collapse all</span>
            </button>
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] group flex items-center">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40 group-focus-within:text-primary transition-colors shrink-0 pointer-events-none" />
          <input
            type="text"
            aria-label="Search documents"
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-7 pl-8 pr-7 bg-muted/50 border border-border rounded-md text-xs leading-none text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 focus:bg-muted transition-all font-mono"
          />
          {searchTerm && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchTerm("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 hover:text-foreground text-muted-foreground/60 p-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer shrink-0 inline-flex items-center justify-center"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        </div>

        {/* Counter */}
        <div className="text-[10px] font-mono font-medium text-muted-foreground whitespace-nowrap leading-none inline-flex items-center h-7">
          {filteredData.length} of {data.length} docs
        </div>
      </div>

      {/* Content */}
      {viewMode === "tree" ? (
        <div
          className="flex-1 overflow-auto p-4 custom-scrollbar font-mono text-xs select-text"
          data-testid="nosql-tree-view"
        >
          {filteredData.length > 0 ? (
            filteredData.map((doc, idx) => (
              <NoSQLDocumentNode
                key={`${bulkAction.version}-${doc._id ?? idx}`}
                data={doc}
                index={idx}
                isRoot
                searchTerm={searchTerm}
                defaultExpanded={
                  bulkAction.type === "expand"
                    ? true
                    : bulkAction.type === "collapse"
                      ? false
                      : undefined
                }
                bulkVersion={bulkAction.version}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground/30">
              <Search className="h-8 w-8 mb-3 opacity-20 shrink-0" />
              <p className="text-xs font-mono uppercase font-bold tracking-wider">
                No matches found
              </p>
            </div>
          )}
        </div>
      ) : (
        <NoSQLTableView data={filteredData} />
      )}
    </div>
  );
}
