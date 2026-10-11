/**
 * @file ProviderConfig.tsx
 * @description AI Provider and API key configuration sub-component.
 */

import { Eye, EyeOff, Key, Globe, Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";

interface ProviderConfigProps {
  apiKey: string;
  setApiKey: (val: string) => void;
  provider: string;
  setProvider: (val: string) => void;
  baseUrl: string;
  setBaseUrl: (val: string) => void;
  onSave: () => void;
  onReveal: () => void;
  isSaving: boolean;
  isRevealing?: boolean;
}

// Providers that route through an OpenAI-compatible gateway and accept a custom base URL.
const BASE_URL_PROVIDERS: Record<string, string> = {
  custom: "",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  deepseek: "https://api.deepseek.com",
};

export function ProviderConfig({
  apiKey,
  setApiKey,
  provider,
  setProvider,
  baseUrl,
  setBaseUrl,
  onSave,
  onReveal,
  isSaving,
  isRevealing = false
}: ProviderConfigProps) {
  const [showKey, setShowKey] = useState(false);
  const normalizedProvider = provider.trim().toLowerCase();
  const supportsBaseUrl = normalizedProvider === "openai" || normalizedProvider in BASE_URL_PROVIDERS;
  const defaultBaseUrl = BASE_URL_PROVIDERS[normalizedProvider] ?? "";

  const handleToggleReveal = () => {
    if (!showKey && apiKey === "********") {
      onReveal();
    }
    setShowKey(!showKey);
  };

  return (
    <Card className="border-none shadow-premium overflow-hidden bg-card/50 backdrop-blur-sm group/card relative">
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-blue-500 to-indigo-600 transition-all group-hover/card:w-1.5" />
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 transition-transform">
            <Globe className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold">AI Gateway</CardTitle>
            <CardDescription>
              Configure your primary AI provider and secure authentication keys.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-8 pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground ml-1">Preferred Provider</label>
            <Select value={provider} onValueChange={(v) => v && setProvider(v)}>
              <SelectTrigger className="w-full rounded-xl border-border/40 bg-muted/20 h-12 focus:ring-primary/20 transition-all hover:bg-muted/30">
                <SelectValue placeholder="Select Provider" />
              </SelectTrigger>
              <SelectContent side="bottom" alignItemWithTrigger={false} className="rounded-xl border-border/50">
                <SelectItem value="OpenAI" className="py-2.5">OpenAI</SelectItem>
                <SelectItem value="Google" className="py-2.5">Google Gemini</SelectItem>
                <SelectItem value="Anthropic" className="py-2.5">Anthropic Claude</SelectItem>
                <SelectItem value="Qwen" className="py-2.5">Qwen</SelectItem>
                <SelectItem value="DeepSeek" className="py-2.5">DeepSeek</SelectItem>
                <SelectItem value="Custom" className="py-2.5">Custom Provider (OpenAI-compatible)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground ml-1">Authentication Key</label>
            <div className="relative group/input">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key"
                className="rounded-xl border-border/40 bg-muted/20 h-12 pr-12 focus-visible:ring-primary/20 transition-all hover:bg-muted/30"
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-xl hover:bg-background h-10 w-10 transition-colors"
                onClick={handleToggleReveal}
                disabled={isRevealing}
              >
                {isRevealing ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : showKey ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {supportsBaseUrl && (
          <div className="space-y-3">
            <label htmlFor="ai-provider-base-url" className="text-sm font-semibold text-foreground ml-1">Base URL {normalizedProvider === "custom" ? "(required)" : "(optional)"}</label>
            <div className="relative">
              <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
              <Input
                id="ai-provider-base-url"
                required={normalizedProvider === "custom"}
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={normalizedProvider === "custom" ? "https://your-provider.example/v1" : defaultBaseUrl || "https://api.openai.com/v1"}
                className="rounded-xl border-border/40 bg-muted/20 h-12 pl-11 font-mono text-sm focus-visible:ring-primary/20 transition-all hover:bg-muted/30"
              />
            </div>
            {defaultBaseUrl && (
              <p className="text-xs text-muted-foreground/70 ml-1">
                Leave blank to use the default endpoint <span className="font-mono">{defaultBaseUrl}</span>.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between p-4 rounded-2xl bg-muted/10 border border-dashed border-border/60">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-xs text-muted-foreground/80 font-medium">
              Keys are AES-256 encrypted before persistence to infrastructure.
            </span>
          </div>
          <Button 
            onClick={onSave} 
            disabled={isSaving} 
            className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-700 hover:opacity-90 shadow-lg shadow-blue-500/20 px-6 font-bold"
          >
            {isSaving ? "Syncing..." : "Update Configuration"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
