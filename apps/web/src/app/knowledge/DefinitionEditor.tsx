/** @file DefinitionEditor.tsx @description Reviewed schema bindings, metrics, rules and composite logical joins. */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Field, Input, Select } from "./controls";
import type { Binding, Definition, DefinitionData, LogicalJoin } from "./types";

import { DefinitionForms } from "./DefinitionForms";
import { BindingPicker, ColumnSelect } from "./BindingPicker";
const blankDefinition = (): Definition => ({
  kind: "concept",
  name: "",
  description: "",
  aliases: [],
  formula: "",
  grain: "",
  timeColumn: "",
  timezone: "",
  filters: "",
  sql: "",
  dialect: "",
  verified: false,
});
const label = (b: Binding) =>
  `${b.schemaName}.${b.tableName}${b.columnName ? "." + b.columnName : ""}`;
export function DefinitionEditor({
  databaseId,
  data,
  onChange,
}: {
  databaseId: string;
  data: DefinitionData;
  onChange: (data: DefinitionData) => void;
}) {
  const [joinSource, setJoinSource] = useState<Binding>();
  const [joinTarget, setJoinTarget] = useState<Binding>();
  const changeDefinition = (index: number, patch: Partial<Definition>) =>
    onChange({
      ...data,
      definitions: data.definitions.map((d, i) =>
        i === index ? { ...d, ...patch } : d,
      ),
    });
  const changeJoin = (index: number, patch: Partial<LogicalJoin>) =>
    onChange({
      ...data,
      joins: data.joins.map((j, i) => (i === index ? { ...j, ...patch } : j)),
    });
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-semibold">Liên kết schema</h3>
        <p className="text-sm text-muted-foreground">
          Chọn đối tượng thật từ connection. Khi DROP/rename, cần sửa và xuất
          bản lại.
        </p>
        <BindingPicker
          databaseId={databaseId}
          onAdd={(b) => {
            if (!data.bindings.some((v) => label(v) === label(b)))
              onChange({ ...data, bindings: [...data.bindings, b] });
          }}
        />
        <ul className="space-y-1">
          {data.bindings.map((b, i) => (
            <li
              key={label(b)}
              className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
            >
              <code className="break-all">{label(b)}</code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...data,
                    bindings: data.bindings.filter((_, n) => n !== i),
                  })
                }
              >
                Bỏ liên kết
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Định nghĩa nghiệp vụ</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...data,
                definitions: [...data.definitions, blankDefinition()],
              })
            }
          >
            Thêm định nghĩa
          </Button>
        </div>
        <DefinitionForms
          definitions={data.definitions}
          onChange={changeDefinition}
          onRemove={(i) =>
            onChange({
              ...data,
              definitions: data.definitions.filter((_, n) => n !== i),
            })
          }
        />
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Logical JOIN đã duyệt</h3>
        <p className="text-sm text-muted-foreground">
          Khai báo cặp cột đúng thứ tự, role và cardinality. Composite key phải
          có đủ cặp.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm">
              Bảng nguồn: {joinSource && label(joinSource)}
            </p>
            <BindingPicker
              databaseId={databaseId}
              columns={false}
              onAdd={setJoinSource}
            />
          </div>
          <div>
            <p className="mb-2 text-sm">
              Bảng đích: {joinTarget && label(joinTarget)}
            </p>
            <BindingPicker
              databaseId={databaseId}
              columns={false}
              onAdd={setJoinTarget}
            />
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!joinSource || !joinTarget}
          onClick={() => {
            if (joinSource && joinTarget)
              onChange({
                ...data,
                joins: [
                  ...data.joins,
                  {
                    source: joinSource,
                    target: joinTarget,
                    columnPairs: [["", ""]],
                    role: "",
                    cardinality: "unknown",
                    confirmed: false,
                  },
                ],
              });
          }}
        >
          Thêm JOIN
        </Button>
        {data.joins.map((j, i) => (
          <fieldset key={i} className="space-y-3 rounded-lg border p-3">
            <legend className="max-w-full break-all px-1 text-sm">
              {label(j.source)} → {label(j.target)}
            </legend>
            {j.columnPairs.map(([left, right], n) => (
              <div key={n} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="Cột nguồn">
                  <ColumnSelect
                    databaseId={databaseId}
                    binding={j.source}
                    value={left}
                    onChange={(e) =>
                      changeJoin(i, {
                        confirmed: false,
                        columnPairs: j.columnPairs.map((p, k) =>
                          k === n ? [e.target.value, p[1]] : p,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Cột đích">
                  <ColumnSelect
                    databaseId={databaseId}
                    binding={j.target}
                    value={right}
                    onChange={(e) =>
                      changeJoin(i, {
                        confirmed: false,
                        columnPairs: j.columnPairs.map((p, k) =>
                          k === n ? [p[0], e.target.value] : p,
                        ),
                      })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={j.columnPairs.length === 1}
                  onClick={() =>
                    changeJoin(i, {
                      confirmed: false,
                      columnPairs: j.columnPairs.filter((_, k) => k !== n),
                    })
                  }
                >
                  Bỏ cặp
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                changeJoin(i, {
                  confirmed: false,
                  columnPairs: [...j.columnPairs, ["", ""]],
                })
              }
            >
              Thêm cặp cột
            </Button>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role">
                <Input
                  value={j.role}
                  onChange={(e) =>
                    changeJoin(i, { role: e.target.value, confirmed: false })
                  }
                />
              </Field>
              <Field label="Cardinality">
                <Select
                  value={j.cardinality}
                  onChange={(e) =>
                    changeJoin(i, {
                      cardinality: e.target.value as LogicalJoin["cardinality"],
                      confirmed: false,
                    })
                  }
                >
                  {[
                    "unknown",
                    "one-to-one",
                    "many-to-one",
                    "one-to-many",
                    "many-to-many",
                  ].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Label className="flex items-center gap-2 text-sm" htmlFor={`knowledge-join-confirmed-${i}`}>
              <Checkbox
                id={`knowledge-join-confirmed-${i}`}
                checked={j.confirmed}
                onCheckedChange={(checked) => changeJoin(i, { confirmed: checked === true })}
              />
              Tôi xác nhận các cặp cột và ý nghĩa JOIN.
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  ...data,
                  joins: data.joins.filter((_, n) => n !== i),
                })
              }
            >
              Xoá JOIN
            </Button>
          </fieldset>
        ))}
      </section>
    </div>
  );
}
