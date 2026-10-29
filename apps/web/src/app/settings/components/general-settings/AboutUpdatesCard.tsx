/**
 * @file AboutUpdatesCard.tsx
 * @description Desktop-only Settings card with the installed version, a manual update check
 * and the automatic update check switch.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, CircleArrowUp, Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatReleaseDate } from "@/components/update-indicator";
import { getInstalledVersion, openReleasePage, type UpdateErrorCode } from "@/lib/desktop-update";
import { isTauriRuntime } from "@/lib/runtime-api";
import { useUpdateStore } from "@/stores/use-update-store";

const ERROR_MESSAGES: Record<UpdateErrorCode, string> = {
  network: "Could not reach GitHub. Check your internet connection and try again.",
  rateLimited: "GitHub limited update checks for now. Try again in an hour.",
  notFound: "Could not check for updates right now. Try again later.",
  serverError: "GitHub is not responding right now. Try again later.",
  invalidResponse: "Could not check for updates right now. Try again later.",
};

interface AboutUpdatesCardProps {
  autoCheckUpdates: boolean;
  onAutoCheckChange: (enabled: boolean) => void;
}

export function AboutUpdatesCard(props: AboutUpdatesCardProps) {
  if (!isTauriRuntime()) return null;
  return <DesktopAboutUpdatesCard {...props} />;
}

function DesktopAboutUpdatesCard({ autoCheckUpdates, onAutoCheckChange }: AboutUpdatesCardProps) {
  const { status, result, error, lastCheckedAt, check } = useUpdateStore();
  const [installedVersion, setInstalledVersion] = React.useState<string>();
  // Errors from background checks stay silent; only a check started here explains a failure.
  const [checkedManually, setCheckedManually] = React.useState(false);

  React.useEffect(() => {
    getInstalledVersion()
      .then(setInstalledVersion)
      .catch(() => setInstalledVersion("Unknown"));
  }, []);

  const checking = status === "checking";

  const handleCheck = () => {
    if (checking) return;
    setCheckedManually(true);
    void check();
  };

  const handleDownload = (version: string) => {
    openReleasePage(version).catch(() => toast.error("Could not open the release page"));
  };
  const releaseDate = result ? formatReleaseDate(result.publishedAt) : null;

  return (
    <Card className="border-none shadow-premium overflow-hidden bg-card/50 backdrop-blur-sm group/card">
      <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-sky-500 to-indigo-600 transition-all group-hover/card:w-1.5" />
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-sky-500/10 shadow-sm border border-sky-500/20 group-hover/card:scale-110 transition-transform">
            <CircleArrowUp className="h-5 w-5 text-sky-500" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              About and updates
            </CardTitle>
            <CardDescription>Version and update checks for this desktop app.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-3xl bg-muted/20 border border-border/40">
            <div className="text-xs text-muted-foreground">Installed version</div>
            <div className="mt-1 font-mono text-sm font-bold">{installedVersion ?? "…"}</div>
          </div>
          <div className="p-4 rounded-3xl bg-muted/20 border border-border/40">
            <div className="text-xs text-muted-foreground">Last checked</div>
            <div className="mt-1 text-sm font-bold">
              {lastCheckedAt
                ? new Date(lastCheckedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
                : "Not checked yet"}
            </div>
          </div>
        </div>

        {/* One live region that always exists, so screen readers announce each new result. */}
        <div role="status" aria-live="polite" className="empty:absolute">
          {result?.available ? (
            <div className="p-4 rounded-3xl border border-primary/40 bg-primary/10 flex flex-wrap items-center gap-4">
              <CircleArrowUp className="h-5 w-5 text-primary" aria-hidden="true" />
              <div className="flex-1 min-w-48">
                <div className="text-sm font-bold">QurioDB {result.latest} is available</div>
                {releaseDate && <div className="text-xs text-muted-foreground">Released {releaseDate}</div>}
              </div>
              <Button size="sm" className="gap-1.5" onClick={() => handleDownload(result.latest)}>
                <Download className="size-4" aria-hidden="true" />
                Download from GitHub
              </Button>
            </div>
          ) : checkedManually && status === "error" && error ? (
            <div className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-amber-500" aria-hidden="true" />
              {ERROR_MESSAGES[error]}
            </div>
          ) : result && status !== "error" ? (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              You are on the latest version ({result.current}).
            </div>
          ) : null}
        </div>

        <div className="p-4 rounded-3xl bg-muted/20 border border-border/40 flex items-center justify-between gap-4">
          <div>
            <div id="auto-check-updates-label" className="text-sm font-bold tracking-tight">
              Check for updates automatically
            </div>
            <div className="text-[11px] text-muted-foreground">
              Once a day, QurioDB asks GitHub for the latest release. No other data is sent.
            </div>
          </div>
          <Switch
            aria-labelledby="auto-check-updates-label"
            checked={autoCheckUpdates}
            onCheckedChange={(checked: boolean) => onAutoCheckChange(!!checked)}
          />
        </div>

        {/* aria-disabled instead of disabled keeps keyboard focus on the button during a check. */}
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5", checking && "opacity-50 cursor-not-allowed")}
          onClick={handleCheck}
          aria-disabled={checking}
        >
          {checking ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-4" aria-hidden="true" />
          )}
          Check for updates
        </Button>
      </CardContent>
    </Card>
  );
}
