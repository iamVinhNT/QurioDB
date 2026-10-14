/**
 * @file ExportGovernanceCard.tsx
 * @description Card for configuring data export formats and safety guardrails.
 */

import { Download, Info, FileSpreadsheet, Globe, ShieldCheck } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";

interface ExportGovernanceCardProps {
  settings: any;
  updateData: (data: any) => void;
}

export function ExportGovernanceCard({ settings, updateData }: ExportGovernanceCardProps) {
  return (
    <Card className="border-none shadow-premium overflow-hidden bg-card/50 backdrop-blur-sm group/card">
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-emerald-500 to-teal-600 transition-all group-hover/card:w-1.5" />
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/10 shadow-sm border border-emerald-500/20 group-hover/card:scale-110 transition-transform">
            <Download className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              Extract & Export
            </CardTitle>
            <CardDescription>
              Configure advanced extraction formats and safety guardrails.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8 pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <Label className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-500/70" />
              CSV & Raw Formats
              <Tooltip>
                <TooltipTrigger render={<Info className="h-3.5 w-3.5 text-muted-foreground" />} />
                <TooltipContent>The character used to separate fields in your exported files.</TooltipContent>
              </Tooltip>
            </Label>
            <Select
              value={settings.csvDelimiter}
              onValueChange={(val: any) => val && updateData({ csvDelimiter: val })}
            >
              <SelectTrigger className="bg-muted/20 border-border/40 focus:bg-background h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value=",">Comma ( , )</SelectItem>
                <SelectItem value=";">Semicolon ( ; )</SelectItem>
                <SelectItem value="tab">Tab Character ( \t )</SelectItem>
                <SelectItem value="|">Pipe ( | )</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-semibold flex items-center gap-2">
              <Globe className="h-4 w-4 text-emerald-500/70" />
              Result Encoding
            </Label>
            <Select 
              value={settings.resultEncoding}
              onValueChange={(val) => val && updateData({ resultEncoding: val })}
            >
              <SelectTrigger className="bg-muted/20 border-border/40 focus:bg-background h-10 transition-all focus:ring-1 focus:ring-emerald-500/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UTF-8">UTF-8 (International / Recommended)</SelectItem>
                <SelectItem value="UTF-16">UTF-16 LE (Windows)</SelectItem>
                <SelectItem value="ASCII">US-ASCII</SelectItem>
                <SelectItem value="ISO-8859-1">ISO-8859-1</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground pt-1">
              UTF-8 and UTF-16 LE CSV exports include a BOM for Excel.
              ASCII and ISO-8859-1 exports require representable characters;
              use UTF-8 or UTF-16 LE for Vietnamese text.
            </p>
          </div>
        </div>

        <Separator className="opacity-50" />

        <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/5 to-transparent border border-emerald-500/10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-500 ring-4 ring-emerald-500/5">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-foreground/90">Safety & Governance</h4>
              <p className="text-[11px] text-muted-foreground">
                Mask PII (Sensitive Data) in query results automatically.
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="outline" className="text-[9px] border-emerald-500/20 text-emerald-500 font-bold tracking-widest bg-emerald-500/5">
              SOON
            </Badge>
            <Switch checked={false} disabled />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
