/** @file RevisionPanel.tsx @description Immutable publication excerpts with stable section anchors. */
import type { UseQueryResult } from "@tanstack/react-query";
import type { Revision } from "./types";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "./controls";
import { Markdown } from "./Markdown";
export function RevisionPanel({
  revision,
  onBack,
}: {
  revision: UseQueryResult<Revision, Error>;
  onBack: () => void;
}) {
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Bản xuất bản bất biến</h3>
        <Button variant="outline" size="sm" onClick={() => onBack()}>
          Quay lại nháp
        </Button>
      </div>
      <ErrorMessage error={revision.error} />
      {revision.isPending && <p role="status">Đang tải phiên bản…</p>}
      {revision.data && (
        <>
          <p className="text-sm text-muted-foreground">
            v{revision.data.version} ·{" "}
            {revision.data.active ? "Đang dùng" : "Không còn là bản đang dùng"}
          </p>
          {revision.data.sections.map((s) => (
            <article
              key={s.id}
              id={s.id}
              className="scroll-mt-16 rounded border p-3"
            >
              <p className="mb-2 text-xs text-muted-foreground">
                {s.id} · {s.heading}
              </p>
              <Markdown body={s.content} />
            </article>
          ))}
          <details>
            <summary>Markdown gốc</summary>
            <Markdown body={revision.data.bodyMarkdown} />
          </details>
        </>
      )}
    </section>
  );
}
