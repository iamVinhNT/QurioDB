/** @file DefinitionForms.tsx @description Typed business definition fields reviewed before publication. */
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Field, Input, Select, Textarea } from "./controls";
import type { Definition } from "./types";
export function DefinitionForms({
  definitions,
  onChange,
  onRemove,
}: {
  definitions: Definition[];
  onChange: (index: number, patch: Partial<Definition>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <>
      {" "}
      {definitions.map((d, i) => (
        <fieldset key={i} className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-sm">Định nghĩa {i + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Loại">
              <Select
                value={d.kind}
                onChange={(e) =>
                  onChange(i, {
                    kind: e.target.value as Definition["kind"],
                  })
                }
              >
                {["concept", "metric", "rule", "example"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </Select>
            </Field>
            <Field label="Tên">
              <Input
                value={d.name}
                onChange={(e) => onChange(i, { name: e.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Mô tả / quy tắc">
            <Textarea
              value={d.description}
              onChange={(e) => onChange(i, { description: e.target.value })}
            />
          </Field>
          <Field label="Tên gọi khác (phân cách bằng dấu phẩy)">
            <Input
              value={d.aliases.join(", ")}
              onChange={(e) =>
                onChange(i, {
                  aliases: e.target.value.split(",").map((x) => x.trim()),
                })
              }
            />
          </Field>
          {d.kind === "metric" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  "formula",
                  "grain",
                  "timeColumn",
                  "timezone",
                  "filters",
                ] as const
              ).map((key) => (
                <Field key={key} label={key}>
                  <Input
                    value={d[key]}
                    onChange={(e) => onChange(i, { [key]: e.target.value })}
                    required={key === "formula" || key === "grain"}
                  />
                </Field>
              ))}
            </div>
          )}
          {d.kind === "example" && (
            <>
              <Field label="Dialect">
                <Input
                  value={d.dialect}
                  placeholder="postgresql / sqlite / mysql"
                  onChange={(e) => onChange(i, { dialect: e.target.value })}
                />
              </Field>
              <Field label="SQL đã kiểm chứng">
                <Textarea
                  rows={5}
                  value={d.sql}
                  onChange={(e) => onChange(i, { sql: e.target.value })}
                />
              </Field>
              <Label className="flex items-center gap-2 text-sm" htmlFor={`knowledge-definition-verified-${i}`}>
                <Checkbox
                  id={`knowledge-definition-verified-${i}`}
                  checked={d.verified}
                  onCheckedChange={(checked) => onChange(i, { verified: checked === true })}
                />
                Tôi đã kiểm chứng SQL và grain. Lưu không thực thi SQL.
              </Label>
            </>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onRemove(i)}
          >
            Xoá định nghĩa
          </Button>
        </fieldset>
      ))}
    </>
  );
}
