/**
 * @file update-indicator.tsx
 * @description Desktop header icon that announces a newer QurioDB release, with a popover
 * to download or skip it and a once-per-version toast.
 */

import * as React from "react";
import { Link } from "react-router-dom";
import { CircleArrowUp, Download, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { openReleasePage, type UpdateCheck } from "@/lib/desktop-update";
import { isTauriRuntime } from "@/lib/runtime-api";
import { useSettingsStore } from "@/stores/use-settings-store";
import { selectVisibleUpdate, useUpdateStore } from "@/stores/use-update-store";

const FIRST_CHECK_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_TOAST_ID = "desktop-update";

export function formatReleaseDate(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const date = new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function UpdateIndicator() {
  if (!isTauriRuntime()) return null;
  return <DesktopUpdateIndicator />;
}

function DesktopUpdateIndicator() {
  const autoCheckUpdates = useSettingsStore((state) => state.autoCheckUpdates);
  const check = useUpdateStore((state) => state.check);
  const update = useUpdateStore(selectVisibleUpdate);
  const notifiedVersion = useUpdateStore((state) => state.notifiedVersion);
  const markNotified = useUpdateStore((state) => state.markNotified);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!autoCheckUpdates) return;
    // Wait a moment after startup so the check never competes with the first render.
    const firstCheck = window.setTimeout(check, FIRST_CHECK_DELAY_MS);
    const dailyCheck = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(dailyCheck);
    };
  }, [autoCheckUpdates, check]);

  React.useEffect(() => {
    if (!update || update.latest === notifiedVersion) return;
    markNotified(update.latest);
    toast(`QurioDB ${update.latest} is available`, {
      id: UPDATE_TOAST_ID,
      description: `You have ${update.current}.`,
      duration: Infinity,
      action: { label: "View update", onClick: () => setOpen(true) },
      cancel: { label: "Later", onClick: () => undefined },
    });
  }, [update, notifiedVersion, markNotified]);

  if (!update) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            className="relative"
            aria-label={`Update available: ${update.latest}`}
          />
        }
      >
        <CircleArrowUp className="h-[1.2rem] w-[1.2rem]" aria-hidden="true" />
        <span
          className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px]">
        <UpdatePopoverBody update={update} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function UpdatePopoverBody({ update, onClose }: { update: UpdateCheck; onClose: () => void }) {
  const skip = useUpdateStore((state) => state.skip);
  const releaseDate = formatReleaseDate(update.publishedAt);

  const handleDownload = () => {
    openReleasePage(update.latest).catch(() => {
      toast.error("Could not open the release page");
    });
    onClose();
  };

  const handleSkip = () => {
    skip(update.latest);
    toast.dismiss(UPDATE_TOAST_ID);
    onClose();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <CircleArrowUp className="size-[18px]" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <PopoverTitle>Update available</PopoverTitle>
          <span className="text-xs text-muted-foreground">
            QurioDB {update.latest}
            {releaseDate && ` · released ${releaseDate}`}
          </span>
        </div>
        <PopoverClose
          render={<Button variant="ghost" size="icon" className="size-8" aria-label="Close" />}
        >
          <X className="size-4" aria-hidden="true" />
        </PopoverClose>
      </div>
      <PopoverDescription className="text-[13px] leading-relaxed">
        You have {update.current}. Download the installer from GitHub and run it. Your connections,
        saved queries and settings stay on this machine.
      </PopoverDescription>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 gap-1.5" onClick={handleDownload}>
          <Download className="size-4" aria-hidden="true" />
          Download from GitHub
        </Button>
        <Button size="sm" variant="outline" onClick={handleSkip}>
          Skip this version
        </Button>
      </div>
      <div className="border-t pt-2.5 text-xs">
        <Link to="/settings?tab=general" onClick={onClose} className="text-primary hover:underline">
          Update settings
        </Link>
      </div>
    </div>
  );
}
