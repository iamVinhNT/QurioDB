/** @file DefinitionEditor.tsx @description Reviewed schema bindings, metrics, rules and composite logical joins. */
import { useState, type SelectHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { databaseApi } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, ErrorMessage } from "./controls";
import type { Binding, Definition, DefinitionData, LogicalJoin } from "./types";

export function BindingPicker({
  databaseId,
  onAdd,
  columns = true,
}: {
  databaseId: string;
  onAdd: (binding: Binding) => void;
  columns?: boolean;
}) {
  const [schema, setSchema] = useState("");
  const [table, setTable] = useState("");
  const [column, setColumn] = useState("");
  const schemas = useQuery<string[]>({
    queryKey: ["knowledge-schemas", databaseId],
    queryFn: () => databaseApi.getSchemas(databaseId),
  });
  const tables = useQuery<string[]>({
    queryKey: ["knowledge-tables", databaseId, schema],
    queryFn: () => databaseApi.getTables(databaseId, schema),
    enabled: !!schema,
  });
  const allColumns = useQuery<Record<string, { name: string }[]>>({
    queryKey: ["knowledge-columns", databaseId, schema],
    queryFn: () => databaseApi.getAllColumns(databaseId, schema),
    enabled: !!schema && columns,
  });
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Schema">
          <Select
            value={schema}
            onChange={(e) => {
              setSchema(e.target.value);
              setTable("");
              setColumn("");
            }}
          >
            <option value="">Chọn schema</option>
            {schemas.data?.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Bảng">
          <Select
            value={table}
            onChange={(e) => {
              setTable(e.target.value);
              setColumn("");
            }}
            disabled={!schema}
          >
            <option value="">Chọn bảng</option>
            {tables.data?.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        {columns && (
          <Field label="Cột (tuỳ chọn)">
            <Select
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              disabled={!table}
            >
              <option value="">Toàn bảng</option>
              {allColumns.data?.[table]?.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!schema || !table}
        onClick={() =>
          onAdd({
            schemaName: schema,
            tableName: table,
            columnName: column || null,
          })
        }
      >
        Thêm liên kết
      </Button>
      <ErrorMessage error={schemas.error || tables.error || allColumns.error} />
    </div>
  );
}

export function ColumnSelect({
  databaseId,
  binding,
  ...props
}: {
  databaseId: string;
  binding: Binding;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  const columns = useQuery<Record<string, { name: string }[]>>({
    queryKey: ["knowledge-columns", databaseId, binding.schemaName],
    queryFn: () => databaseApi.getAllColumns(databaseId, binding.schemaName),
  });
  return (
    <>
      <Select {...props}>
        <option value="">Chọn cột</option>
        {columns.data?.[binding.tableName]?.map((c) => (
          <option key={c.name}>{c.name}</option>
        ))}
      </Select>
      <ErrorMessage error={columns.error} />
    </>
  );
}
