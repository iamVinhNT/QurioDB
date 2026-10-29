/**
 * @file GeneralSettings.tsx
 * @description Immersive General settings with premium visual theme selection and accessibility features.
 */

import { Palette, Eye, Sparkle, Wind, Layers, Info, Sun, Moon, Monitor, Dna } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { 
  Tooltip, 
  TooltipContent, 
  TooltipTrigger, 
  TooltipProvider 
} from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ThemeCard } from "./general-settings/ThemeCard";
import { AboutUpdatesCard } from "./general-settings/AboutUpdatesCard";

interface GeneralSettingsProps {
  theme: string;
  settings: any;
  updateGeneral: (settings: any) => void;
  onThemeChange: (theme: string | null) => void;
}

export function GeneralSettings({
  theme,
  settings,
  updateGeneral,
  onThemeChange,
}: GeneralSettingsProps) {
  return (
    <TooltipProvider delay={200}>
      <div className="max-h-[calc(100vh-175px)] overflow-y-auto custom-scrollbar pr-6 pt-1">
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-8">
          
          <Card className="border-none shadow-premium overflow-hidden bg-card/50 backdrop-blur-sm group/card">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-indigo-500 to-purple-600 transition-all group-hover/card:w-1.5" />
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10 shadow-sm border border-indigo-500/20 group-hover/card:scale-110 transition-transform">
                  <Palette className="h-5 w-5 text-indigo-500" />
                </div>
                <div>
                  <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                    App Aesthetics
                  </CardTitle>
                  <CardDescription>
                    Choose the visual soul of your workspace.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-8 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <ThemeCard 
                  value="light" 
                  label="Light" 
                  icon={Sun} 
                  description="Classic Day" 
                  active={theme === "light"} 
                  onThemeChange={onThemeChange}
                />
                <ThemeCard 
                  value="dark" 
                  label="Dark" 
                  icon={Moon} 
                  description="Immersive Night" 
                  active={theme === "dark"} 
                  onThemeChange={onThemeChange}
                />
                <ThemeCard 
                  value="system" 
                  label="System" 
                  icon={Monitor} 
                  description="Auto-Adapter" 
                  active={theme === "system"} 
                  onThemeChange={onThemeChange}
                />
              </div>

              <div className="p-4 rounded-3xl bg-muted/20 border border-border/40 flex items-center justify-between group/item hover:bg-indigo-500/5 transition-all">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-xl bg-background border border-border/40 shadow-sm transition-transform group-hover/item:scale-105">
                    <Sparkle className="h-4 w-4 text-indigo-500" />
                  </div>
                  <div>
                    <div className="text-sm font-bold tracking-tight">Dynamic Color Injection</div>
                    <div className="text-[11px] text-muted-foreground">Adjust app accent colors based on your system.</div>
                  </div>
                </div>
                <Switch 
                  checked={settings.dynamicColorInjection} 
                  onCheckedChange={(c: boolean) => updateGeneral({ dynamicColorInjection: !!c })} 
                />
              </div>
            </CardContent>
          </Card>


          <Card className="border-none shadow-premium overflow-hidden bg-card/50 backdrop-blur-sm group/card">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-rose-500 to-orange-600 transition-all group-hover/card:w-1.5" />
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-rose-500/10 shadow-sm border border-rose-500/20 group-hover/card:scale-110 transition-transform">
                  <Eye className="h-5 w-5 text-rose-500" />
                </div>
                <div>
                  <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                    Visual Comfort & Performance
                  </CardTitle>
                  <CardDescription>
                    Optimize the interface for accessibility and hardware compatibility.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-3xl bg-muted/20 border border-border/40 flex items-center justify-between transition-all hover:bg-rose-500/5 group/access">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-xl bg-background border border-border/40 shadow-sm transition-transform group-hover/access:scale-110">
                      <Wind className="h-4 w-4 text-rose-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold tracking-tight flex items-center gap-2">
                        Reduced Motion
                        <Tooltip>
                          <TooltipTrigger render={<Info className="h-3 w-3 text-muted-foreground cursor-help" />} />
                          <TooltipContent>Disables heavy animations like parallax and bouncing.</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none mt-1">
                        ACCESSIBILITY A11Y
                      </div>
                    </div>
                  </div>
                  <Switch 
                    checked={settings.reducedMotion} 
                    onCheckedChange={(c: boolean) => updateGeneral({ reducedMotion: !!c })} 
                  />
                </div>

                <div className="p-4 rounded-3xl bg-muted/20 border border-border/40 flex items-center justify-between transition-all hover:bg-rose-500/5 group/access">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-xl bg-background border border-border/40 shadow-sm transition-transform group-hover/access:scale-110">
                      <Layers className="h-4 w-4 text-rose-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold tracking-tight">Enable Blur Effects</div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest leading-none mt-1 text-emerald-500">
                        PREMIUM GLASS
                      </div>
                    </div>
                  </div>
                  <Switch 
                    checked={settings.enableBlurEffects} 
                    onCheckedChange={(c: boolean) => updateGeneral({ enableBlurEffects: !!c })} 
                  />
                </div>
              </div>

              <div className="p-4 rounded-3xl border-2 border-dashed border-border/30 bg-muted/5 flex items-center justify-center gap-4 text-xs text-muted-foreground group hover:border-rose-500/30 transition-all opacity-70">
                <Dna className="h-4 w-4 opacity-40 group-hover:rotate-180 transition-transform duration-1000" />
                <span>AI is currently optimizing your interface density based on your display resolution.</span>
                <Select disabled defaultValue="relaxed">
                  <SelectTrigger className="w-32 h-8 rounded-full border-none bg-background/50 shadow-sm text-[10px] font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compact">Compact</SelectItem>
                    <SelectItem value="relaxed">Relaxed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <AboutUpdatesCard
            autoCheckUpdates={settings.autoCheckUpdates}
            onAutoCheckChange={(enabled) => updateGeneral({ autoCheckUpdates: enabled })}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
