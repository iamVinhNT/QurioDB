/**
 * @file ReasoningSection.tsx
 * @description Renders the AI's internal reasoning steps and thought process in a collapsible section.
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import { BrainCircuit, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AIStep } from "./types";

interface ReasoningSectionProps {
  thought?: string;
  steps?: AIStep[];
  showThought: boolean;
  onToggle: () => void;
  isDark: boolean;
  isGeneratingSQL: boolean;
}

export const ReasoningSection = React.memo(({
  thought,
  steps,
  showThought,
  onToggle,
  isDark,
  isGeneratingSQL
}: ReasoningSectionProps) => {
  // Fallback to old thought string if steps are not provided
  const hasSteps = steps && steps.length > 0;

  return (
    <div className="w-full mb-1">
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "group/thought flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isDark
            ? "bg-[#111419]/50 border-white/10 text-slate-400 hover:border-primary/40 hover:text-primary"
            : "bg-white border-slate-200 text-slate-500 hover:border-primary/30 hover:text-primary"
        )}
        aria-expanded={showThought}
      >
        <div className={cn(
          "p-0.5 rounded-md transition-all duration-500",
          showThought ? "text-primary" : "text-muted-foreground group-hover/thought:text-primary"
        )}>
          {showThought ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>
        <span className="text-[10.5px] font-black uppercase tracking-widest group-hover/thought:text-primary transition-colors">
          {showThought ? "Ẩn hoạt động trợ lý" : "Xem hoạt động trợ lý"}
        </span>
        {isGeneratingSQL && (
          <div className="ml-1 flex items-center gap-1">
            <div className="w-1 h-1 bg-primary rounded-full animate-bounce delay-0" />
            <div className="w-1 h-1 bg-primary rounded-full animate-bounce delay-150" />
            <div className="w-1 h-1 bg-primary rounded-full animate-bounce delay-300" />
          </div>
        )}
      </button>

      <div className={cn(
        "grid transition-all duration-500 ease-in-out overflow-hidden",
        showThought ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="min-h-0">
          {!showThought ? null : hasSteps ? (
            <div className="relative ml-3 pl-5 pr-1 py-1 border-l border-primary/20 flex flex-col gap-2">
              {steps.map((step, idx) => {
                const isActiveStep = step.status === "active" || (idx === steps.length - 1 && isGeneratingSQL);

                return (
                  <div key={idx} className="relative group/step animate-in fade-in slide-in-from-left-2 duration-500">
                    {/* Step Dot/Icon */}
                    <div className={cn(
                      "absolute -left-[31px] top-0.5 w-2.5 h-2.5 rounded-full border-2 bg-background transition-all group-hover/step:scale-125",
                      "border-primary/40",
                      isActiveStep && "border-primary"
                    )}>
                      {isActiveStep && (
                        <div className="absolute inset-0 rounded-full bg-primary animate-ping opacity-75" />
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        {isActiveStep ? <Loader2 className="h-3 w-3 text-primary/70 animate-spin" /> : <BrainCircuit className="h-3 w-3 text-primary/60" />}
                        <span className={cn(
                          "text-[9px] font-bold uppercase tracking-tighter",
                          "text-primary/70"
                        )}>
                          Đang suy luận
                        </span>
                      </div>

                      <div className={cn(
                        "py-1 px-2 rounded-lg text-[9px] leading-relaxed font-medium border transition-colors prose prose-sm dark:prose-invert max-w-none",
                        isDark
                          ? "bg-[#111419]/40 border-white/5 text-slate-300 group-hover/step:border-white/10"
                          : "bg-white border-slate-100 text-slate-600 shadow-sm group-hover/step:border-slate-200"
                      )}>
                        <ReactMarkdown>
                          {step.content.replace(/<thinking>|<\/thinking>/gi, '').trim()}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )
              })}

              {!isGeneratingSQL && (
                <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-500/70 uppercase tracking-tighter">
                  <CheckCircle2 className="h-3 w-3" /> Phân tích hoàn tất
                </div>
              )}
            </div>
          ) : (
            <div className={cn(
              "p-2.5 rounded-xl text-[11.5px] leading-relaxed font-mono ml-1 border",
              isDark ? "bg-[#111419]/80 border-white/5 text-muted-foreground" : "bg-slate-50 border-slate-200 text-slate-600 shadow-inner"
            )}>
              {thought}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
