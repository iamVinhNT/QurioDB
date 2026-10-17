/** @file MarkdownEditor.tsx @description UTF-8 Markdown import and safe preview before explicit draft saving. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Textarea, ErrorMessage } from "./controls";
import { Markdown } from "./Markdown";
export function MarkdownEditor({
  body,
  onChange,
}: {
  body: string;
  onChange: (body: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [fileError, setFileError] = useState<Error | null>(null);
  return (
    <>
      <ErrorMessage error={fileError} />
      {
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="cursor-pointer rounded border px-3 py-2 text-sm">
              Import Markdown
              <input
                aria-label="Import Markdown"
                type="file"
                accept=".md,.markdown"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setFileError(null);
                  if (
                    !/\.(md|markdown)$/i.test(file.name) ||
                    file.size > 2_000_000
                  ) {
                    setFileError(new Error("Chọn file Markdown tối đa 2 MB."));
                    return;
                  }
                  try {
                    onChange(
                      new TextDecoder("utf-8", { fatal: true }).decode(
                        await file.arrayBuffer(),
                      ),
                    );
                  } catch {
                    setFileError(new Error("Không đọc được file."));
                  }
                  e.target.value = "";
                }}
              />
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreview(!preview)}
            >
              {preview ? "Soạn thảo" : "Xem trước an toàn"}
            </Button>
          </div>
          {preview ? (
            <div className="min-h-80 rounded-lg border p-5">
              <Markdown body={body} />
            </div>
          ) : (
            <Field label="Nội dung Markdown">
              <Textarea
                rows={22}
                value={body}
                onChange={(e) => onChange(e.target.value)}
              />
            </Field>
          )}
          <p className="text-xs text-muted-foreground">
            Export giữ Markdown gốc. Mapping schema nằm trong kho local; import
            lại cần liên kết và duyệt lại.
          </p>
        </div>
      }
    </>
  );
}
