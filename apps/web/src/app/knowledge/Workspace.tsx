/** @file Workspace.tsx @description Owner-scoped knowledge library and Markdown authoring workspace for SQL GraphRAG. */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, FileText, Network, Search, Plus, ArrowLeft } from "lucide-react";
import { aiApi } from "@/lib/api-client";
import { knowledgeApi } from "@/lib/knowledge-api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, Input, Select, Textarea, ErrorMessage } from "./controls";
import { DocumentEditor } from "./DocumentEditor";
import { Relations } from "./Relations";
import { ContextPreview } from "./ContextPreview";
import { templates } from "./templates";
import {
  emptyDefinitions,
  type DocumentKind,
  type KnowledgeBase,
} from "./types";

import { Pagination } from "./Pagination";
import { knowledgeBasePath, knowledgeDocumentPath, knowledgeLibraryPath } from "./routes";
export function Workspace({
  baseId,
  documentId,
}: {
  baseId: string;
  documentId?: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState("documents");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [template, setTemplate] = useState<DocumentKind>("design");
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyId, setLegacyId] = useState("");
  const [editingBase, setEditingBase] = useState(false);
  const base = useQuery({
    queryKey: ["knowledge-base", baseId],
    queryFn: () => knowledgeApi.base(baseId),
  });
  const docs = useQuery({
    queryKey: ["knowledge-documents", baseId, search, kind, state, page],
    queryFn: () =>
      knowledgeApi.documents(baseId, {
        search,
        page,
        ...(kind ? { kind } : {}),
        ...(state ? { state } : {}),
      }),
    enabled: !!base.data,
  });
  const legacy = useQuery<{ id: string; title: string; sourceType: string }[]>({
    queryKey: ["knowledge-legacy", baseId],
    queryFn: async () => {
      const r = await aiApi.getRagSources({
        databaseId: base.data!.databaseId,
      });
      return Array.isArray(r) ? r : r.sources || [];
    },
    enabled: showLegacy && !!base.data,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["knowledge-base", baseId] });
    void client.invalidateQueries({ queryKey: ["knowledge-bases"] });
    void client.invalidateQueries({ queryKey: ["knowledge-documents"] });
  };
  const patch = useMutation({
    mutationFn: (data: Partial<KnowledgeBase>) =>
      knowledgeApi.patchBase(baseId, data),
    onMutate: (data) => {
      const previous = client.getQueryData<KnowledgeBase>([
        "knowledge-base",
        baseId,
      ]);
      client.setQueryData(["knowledge-base", baseId], { ...previous, ...data });
      return previous;
    },
    onError: (_, __, previous) => {
      if (previous) client.setQueryData(["knowledge-base", baseId], previous);
    },
    onSettled: refresh,
  });
  const create = useMutation({
    mutationFn: () =>
      knowledgeApi.createDocument(baseId, {
        title: `${template === "design" ? "Thiết kế dữ liệu" : template}`,
        kind: template,
        bodyMarkdown: templates[template],
        definitionData: emptyDefinitions(),
      }),
    onSuccess: (d) => {
      refresh();
      navigate(knowledgeDocumentPath(baseId, d.id));
    },
  });
  const importLegacy = useMutation({
    mutationFn: () => knowledgeApi.importLegacy(baseId, legacyId),
    onSuccess: (d) => {
      refresh();
      navigate(knowledgeDocumentPath(baseId, d.id));
    },
  });
  const archive = useMutation({
    mutationFn: () => knowledgeApi.archiveBase(baseId),
    onSuccess: () => {
      refresh();
      navigate(knowledgeLibraryPath());
    },
  });
  if (base.isPending) return <p role="status">Đang tải kho…</p>;
  if (base.error) return <ErrorMessage error={base.error} />;
  const b = base.data;
  return (
    <div className="space-y-5">
      <Link
        to={knowledgeLibraryPath()}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Tất cả kho tri thức
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-2.5 shadow-sm">
            <BookOpen className="size-5 text-fuchsia-500" />
          </div>
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold">{b.name}</h1>
            <p className="mt-1 max-w-3xl text-xs/relaxed text-muted-foreground">
              {b.description}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="flex items-center gap-2 text-sm" htmlFor="knowledge-enabled-for-sql">
            <Checkbox
              id="knowledge-enabled-for-sql"
              checked={b.enabledForSql}
              disabled={patch.isPending}
              onCheckedChange={(checked) =>
                patch.mutate({ enabledForSql: checked === true })
              }
            />
            Bật cho AI SQL
          </Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingBase(!editingBase)}
          >
            Sửa kho
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={archive.isPending}
            onClick={() => {
              if (window.confirm("Lưu trữ kho và gỡ mọi tài liệu khỏi AI?"))
                archive.mutate();
            }}
          >
            Lưu trữ kho
          </Button>
        </div>
      </header>
      <ErrorMessage error={patch.error || archive.error} />
      {editingBase && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            patch.mutate(
              {
                name: String(form.get("name")),
                description: String(form.get("description")),
              },
              { onSuccess: () => setEditingBase(false) },
            );
          }}
        >
          <Field label="Tên kho">
            <Input name="name" defaultValue={b.name} required maxLength={200} />
          </Field>
          <Field label="Mô tả">
            <Textarea name="description" defaultValue={b.description} />
          </Field>
          <Button disabled={patch.isPending}>Lưu thay đổi</Button>
        </form>
      )}
      {documentId ? (
        <div className="space-y-4">
          <Link className="text-sm underline" to={knowledgeBasePath(baseId)}>
            Danh sách tài liệu
          </Link>
          <DocumentEditor
            knowledgeBaseId={baseId}
            documentId={documentId}
            databaseId={b.databaseId}
            onArchived={() => navigate(knowledgeBasePath(baseId))}
          />
        </div>
      ) : (
        <>
          <nav
            aria-label="Kho tri thức"
            className="flex gap-1 overflow-x-auto border-b pb-2"
          >
            {[
              ["documents", "Tài liệu", FileText],
              ["relations", "Quan hệ", Network],
              ["context", "Thử context", Search],
            ].map(([id, label, Icon]) => {
              const Symbol = Icon as typeof FileText;
              return (
                <Button
                  key={String(id)}
                  size="sm"
                  variant={tab === id ? "secondary" : "ghost"}
                  onClick={() => setTab(String(id))}
                >
                  <Symbol className="mr-2 size-4" />
                  {String(label)}
                </Button>
              );
            })}
          </nav>
          {tab === "relations" && <Relations base={b} />}{" "}
          {tab === "context" && <ContextPreview base={b} />}
          {tab === "documents" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Mẫu tài liệu">
                  <Select
                    value={template}
                    onChange={(e) =>
                      setTemplate(e.target.value as DocumentKind)
                    }
                  >
                    {Object.keys(templates).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </Select>
                </Field>
                <Button
                  disabled={create.isPending}
                  onClick={() => create.mutate()}
                >
                  <Plus className="mr-2 size-4" />
                  Tạo tài liệu nháp
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowLegacy(!showLegacy)}
                >
                  Chuyển source cũ thành nháp
                </Button>
              </div>
              <ErrorMessage error={create.error || importLegacy.error} />
              {showLegacy && (
                <div className="flex flex-wrap items-end gap-2 rounded border p-3">
                  <Field label="Source cũ cần duyệt lại">
                    <Select
                      value={legacyId}
                      onChange={(e) => setLegacyId(e.target.value)}
                    >
                      <option value="">Chọn tài liệu</option>
                      {legacy.data
                        ?.filter((s) =>
                          ["document", "web_page"].includes(s.sourceType),
                        )
                        .map((s) => (
                          <option value={s.id} key={s.id}>
                            {s.title}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Button
                    disabled={!legacyId || importLegacy.isPending}
                    onClick={() => importLegacy.mutate()}
                  >
                    Tạo nháp từ source
                  </Button>
                  <ErrorMessage error={legacy.error} />
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Tìm tài liệu">
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    type="search"
                  />
                </Field>
                <Field label="Loại">
                  <Select
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Tất cả</option>
                    {Object.keys(templates).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Trạng thái">
                  <Select
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Tất cả</option>
                    <option value="draft">Nháp</option>
                    <option value="published">Có bản xuất bản</option>
                  </Select>
                </Field>
              </div>
              <ErrorMessage error={docs.error} />
              {docs.isPending && <p role="status">Đang tải tài liệu…</p>}
              <div className="overflow-hidden rounded-xl border border-border/60 bg-background/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tài liệu</TableHead>
                      <TableHead>Loại</TableHead>
                      <TableHead>Phiên bản</TableHead>
                      <TableHead>Trạng thái</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {docs.data?.items.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          <Link className="hover:text-primary" to={knowledgeDocumentPath(baseId, d.id)}>
                            {d.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{d.kind}</TableCell>
                        <TableCell className="text-muted-foreground">v{d.version}</TableCell>
                        <TableCell>
                          <span className="rounded-md border px-2 py-1 text-[11px]">
                            {d.activeRevisionId ? "Có bản xuất bản" : "Chỉ nháp"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {docs.data?.total === 0 && (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    Chưa có tài liệu phù hợp. Chọn mẫu để tạo bản nháp đầu tiên.
                  </p>
                )}
              </div>
              <Pagination
                page={page}
                total={docs.data?.total || 0}
                onChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
