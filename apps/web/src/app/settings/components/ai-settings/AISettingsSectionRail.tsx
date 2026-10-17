/**
 * @file AISettingsSectionRail.tsx
 * @description Navigation rail for switching between compact AI Assistant settings sections.
 */

import { Activity, BrainCircuit, Database, Globe, Network, Route, SearchCode } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AISettingsSectionKey = "gateway" | "models" | "routing" | "terms" | "rag" | "vector-store";

export interface AISettingsSection {
  key: AISettingsSectionKey;
  label: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
}

export const AI_SETTINGS_SECTIONS: AISettingsSection[] = [
  {
    key: "gateway",
    label: "Gateway",
    description: "Provider and key",
    icon: Globe,
    accentClass: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  },
  {
    key: "models",
    label: "Models",
    description: "Model registry",
    icon: BrainCircuit,
    accentClass: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20",
  },
  {
    key: "routing",
    label: "Task Routing",
    description: "Task to model map",
    icon: Route,
    accentClass: "text-violet-500 bg-violet-500/10 border-violet-500/20",
  },
  {
    key: "terms",
    label: "Router Terms",
    description: "Intent keywords",
    icon: SearchCode,
    accentClass: "text-sky-500 bg-sky-500/10 border-sky-500/20",
  },
  {
    key: "rag",
    label: "RAG Index",
    description: "Retrieval sources",
    icon: Database,
    accentClass: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  },
  {
    key: "vector-store",
    label: "Vector Store",
    description: "Index status and sources",
    icon: Network,
    accentClass: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  },
];

interface AISettingsSectionRailProps {
  activeSection: AISettingsSectionKey;
  onSectionChange: (section: AISettingsSectionKey) => void;
  metrics: Partial<Record<AISettingsSectionKey, string>>;
}

export function AISettingsSectionRail({
  activeSection,
  onSectionChange,
  metrics,
}: AISettingsSectionRailProps) {
  return (
    <aside className="shrink-0 rounded-lg border border-border/50 bg-card/40 p-2 shadow-premium backdrop-blur-sm lg:w-64">
      <div className="mb-2 flex items-center justify-between px-2 py-1.5">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          Sections
        </div>
        <Badge variant="outline" className="rounded-md text-[9px] font-bold uppercase tracking-widest">
          {AI_SETTINGS_SECTIONS.length}
        </Badge>
      </div>

      <div
        role="tablist"
        aria-label="AI Assistant settings sections"
        className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible"
      >
        {AI_SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.key;

          return (
            <Button
              key={section.key}
              type="button"
              variant="ghost"
              className={cn(
                "h-auto min-w-48 justify-start rounded-lg border border-transparent px-3 py-3 text-left transition-all lg:min-w-0",
                isActive
                  ? "border-border/60 bg-background shadow-sm"
                  : "text-muted-foreground hover:border-border/40 hover:bg-muted/40 hover:text-foreground",
              )}
              onClick={() => onSectionChange(section.key)}
              role="tab"
              aria-selected={isActive}
              aria-controls={`ai-settings-panel-${section.key}`}
              id={`ai-settings-tab-${section.key}`}
            >
              <span className={cn("mr-3 rounded-lg border p-2", section.accentClass)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black tracking-tight">{section.label}</span>
                <span className="block truncate text-[10px] font-semibold text-muted-foreground">
                  {section.description}
                </span>
              </span>
              {metrics[section.key] && (
                <span className="ml-2 rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground">
                  {metrics[section.key]}
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
