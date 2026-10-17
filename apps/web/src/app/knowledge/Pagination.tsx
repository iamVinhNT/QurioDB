/** @file Pagination.tsx @description Shared pagination controls for knowledge lists. */
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
      <Button
        size="icon"
        variant="outline"
        className="size-9"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Trang trước"
        title="Trang trước"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="text-sm text-muted-foreground">
        Trang {page} · {total} mục
      </span>
      <Button
        size="icon"
        variant="outline"
        className="size-9"
        disabled={page * 30 >= total}
        onClick={() => onChange(page + 1)}
        aria-label="Trang sau"
        title="Trang sau"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
