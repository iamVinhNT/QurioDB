/** @file Library.tsx @description Searchable knowledge library and explicit connection-scoped creation. */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus } from "lucide-react";
import { databaseApi } from "@/lib/api-client";
import { knowledgeApi } from "@/lib/knowledge-api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Field, Input, Select, Textarea, ErrorMessage } from "./controls";
import { Pagination } from "./Pagination";
import { knowledgeBasePath } from "./routes";
export function Library() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [connection, setConnection] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [databaseId, setDatabaseId] = useState("");
  const connections = useQuery<
    { id: string; name?: string; databaseName: string }[]
  >({ queryKey: ["databases"], queryFn: () => databaseApi.list() });
  const bases = useQuery({
    queryKey: ["knowledge-bases", search, connection, page],
    queryFn: () =>
      knowledgeApi.bases({
        search,
        page,
        ...(connection ? { databaseId: connection } : {}),
      }),
  });
  const create = useMutation({
    mutationFn: () =>
      knowledgeApi.createBase({
        name,
        description,
        databaseId,
        enabledForSql: false,
      }),
    onSuccess: (b) => {
      void client.invalidateQueries({ queryKey: ["knowledge-bases"] });
      navigate(knowledgeBasePath(b.id));
    },
  });
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-2.5 shadow-sm">
            <BookOpen className="size-5 text-fuchsia-500" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Knowledge Base</h1>
            <p className="mt-1 max-w-2xl text-xs/relaxed text-muted-foreground">
              Tài liệu thiết kế, định nghĩa chỉ số và quy tắc JOIN. Soạn nháp,
              duyệt liên kết, rồi xuất bản để AI hiểu đúng dữ liệu.
            </p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 size-4" />
          Tạo kho tri thức
        </Button>
      </header>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Tạo kho tri thức</DialogTitle>
            <DialogDescription>
              Gắn kho với một connection để quản lý tài liệu và context cho AI SQL.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Tên kho">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                />
              </Field>
              <Field label="Connection">
                <Select
                  value={databaseId}
                  onChange={(e) => setDatabaseId(e.target.value)}
                  required
                >
                  <option value="">Chọn connection</option>
                  {connections.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name || d.databaseName}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Mô tả">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={4000}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Kho thuộc tài khoản hiện tại và mặc định chưa bật cho SQL.
            </p>
            <ErrorMessage error={create.error} />
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                Hủy
              </DialogClose>
              <Button disabled={create.isPending || !name.trim() || !databaseId}>
                Tạo kho
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tìm kho tri thức">
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Tên kho…"
          />
        </Field>
        <Field label="Lọc connection">
          <Select
            value={connection}
            onChange={(e) => {
              setConnection(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả connection</option>
            {connections.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name || d.databaseName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorMessage error={bases.error || connections.error} />
      {bases.isPending && <p role="status">Đang tải kho tri thức…</p>}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-background/50">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kho tri thức</TableHead>
              <TableHead>Connection</TableHead>
              <TableHead>SQL</TableHead>
              <TableHead className="text-right">Mô tả</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bases.data?.items.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium">
                  <Link className="flex items-center gap-2 hover:text-primary" to={knowledgeBasePath(b.id)}>
                    <BookOpen className="size-4 text-muted-foreground" />
                    <span className="break-words">{b.name}</span>
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {connections.data?.find((d) => d.id === b.databaseId)?.databaseName || b.databaseId}
                </TableCell>
                <TableCell>
                  <span className="rounded-md border px-2 py-1 text-[11px]">
                    {b.enabledForSql ? "Bật" : "Tắt"}
                  </span>
                </TableCell>
                <TableCell className="max-w-xs truncate text-right text-muted-foreground">
                  {b.description || "Chưa có mô tả"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {bases.data?.total === 0 && (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <BookOpen className="mx-auto mb-4 size-8 text-muted-foreground" />
          <p className="font-medium">Chưa có kho tri thức phù hợp</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Tạo kho và bắt đầu bằng một tài liệu thiết kế Markdown.
          </p>
        </div>
      )}
      <Pagination
        page={page}
        total={bases.data?.total || 0}
        onChange={setPage}
      />
    </div>
  );
}
