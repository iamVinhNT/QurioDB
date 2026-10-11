/**
 * @file SQLBlock.tsx
 * @description Syntax-highlighted SQL code block with interactive tools for copy, data preview, explain, and optimize actions.
 */

import React from "react";
import { Copy, Check, Sparkles, FileSearch, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SQLBlockProps {
  sql: string;
  isDark: boolean;
  onCopy: () => void;
  copied: boolean;
  onExplain: (sql: string) => void;
  onOptimize: (sql: string) => void;
  queryLanguage?: string;
}

export const SQLBlock = React.memo(({
  sql,
  isDark,
  onCopy,
  copied,
  onExplain,
  onOptimize,
  queryLanguage,
}: SQLBlockProps) => {
  return (
    <div className={cn(
      "w-full rounded-xl border shadow-lg overflow-hidden group/sql transition-all hover:border-primary/30",
      isDark ? "bg-[#0d1117] border-white/10" : "bg-white border-slate-200"
    )}>
      <div className={cn(
        "flex items-center justify-between px-2.5 py-1.5 border-b",
        isDark ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-200"
      )}>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className={cn(
            "text-[9px] font-black uppercase tracking-widest",
            isDark ? "text-slate-400" : "text-slate-500"
          )}>{queryLanguage === "mongodb" ? "MongoDB Query" : "Synthesized SQL"}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6 transition-colors rounded-lg",
            isDark ? "text-slate-500 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-900 hover:bg-slate-200"
          )}
          onClick={onCopy}
          title={copied ? "Copied" : "Copy query"}
          aria-label={copied ? "Copied query" : "Copy query"}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className={cn(
        "overflow-x-auto min-h-10 border-t-0",
        isDark ? "bg-[#0d1117]" : "bg-white"
      )}>
        <pre
          className={cn(
            "m-0 min-h-10 overflow-x-auto whitespace-pre rounded-none bg-transparent p-2.5 font-mono text-[11px] leading-[1.45]",
            isDark ? "text-slate-100" : "text-slate-900",
          )}
        >
          <code>{sql}</code>
        </pre>
      </div>

      <div className={cn(
        "p-1.5 flex flex-col gap-1.5",
        isDark ? "bg-slate-900/40" : "bg-slate-50/50"
      )}>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Button
            variant="ghost"
            className="h-7 text-[11px] font-bold uppercase tracking-widest transition-all text-slate-600 dark:text-slate-300 hover:text-primary hover:bg-primary/5 rounded-lg"
            onClick={() => onExplain(sql)}
          >
            <FileSearch className="h-3.5 w-3.5 mr-1.5" />
            Explain
          </Button>
          <Button
            variant="outline"
            className={cn(
              "h-7 text-[9px] font-bold uppercase tracking-widest transition-all rounded-lg",
              isDark
                ? "border-white/10 bg-white/5 hover:bg-transparent text-slate-300 hover:text-white hover:border-primary/50"
                : "border-slate-200 bg-white hover:bg-transparent hover:border-primary/40 text-slate-600 hover:text-slate-900"
            )}
            onClick={() => onOptimize(sql)}
          >
            <Wand2 className="h-3.5 w-3.5 mr-1.5 text-primary/70" />
            Optimize
          </Button>
        </div>

      </div>
    </div>
  );
});
