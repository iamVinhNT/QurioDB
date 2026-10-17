/** @file knowledge-workspace.test.tsx @description Regression tests for publication, source safety and immutable citation navigation. */
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import KnowledgePage from "@/app/knowledge/page";
import { Markdown } from "@/app/knowledge/Markdown";
import { knowledgeApi } from "@/lib/knowledge-api";
import { ContextSources } from "@/app/sqllab/components/ai/ContextSources";
import { emptyDefinitions } from "@/app/knowledge/types";
import { knowledgeDocumentPath } from "@/app/knowledge/routes";
vi.mock("@/lib/knowledge-api", () => ({
  knowledgeApi: {
    bases: vi.fn(),
    base: vi.fn(),
    documents: vi.fn(),
    document: vi.fn(),
    revisions: vi.fn(),
    revision: vi.fn(),
    save: vi.fn(),
    publish: vi.fn(),
    job: vi.fn(),
    patchBase: vi.fn(),
    createBase: vi.fn(),
    preview: vi.fn(),
  },
}));
vi.mock("@/lib/api-client", () => ({
  databaseApi: {
    list: vi.fn().mockResolvedValue([{ id: "db", databaseName: "Sales" }]),
  },
  aiApi: { getRagSources: vi.fn().mockResolvedValue([]) },
}));
const base = {
  id: "kb",
  name: "Sales knowledge",
  description: "Quy tắc dữ liệu",
  databaseId: "db",
  enabledForSql: false,
};
const doc = {
  id: "doc",
  knowledgeBaseId: "kb",
  title: "Revenue",
  kind: "metric" as const,
  bodyMarkdown: "# Doanh thu\nNội dung gốc.",
  definitionData: emptyDefinitions(),
  version: 1,
  activeRevisionId: null,
};
function mount(path = "/knowledge/kb/documents/doc") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route
            path="/knowledge/:knowledgeBaseId"
            element={<KnowledgePage />}
          />
          <Route
            path="/knowledge/:knowledgeBaseId/documents/:documentId"
            element={<KnowledgePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.resetAllMocks();
  vi.mocked(knowledgeApi.base).mockResolvedValue(base);
  vi.mocked(knowledgeApi.bases).mockResolvedValue({
    items: [base],
    total: 1,
    page: 1,
    pageSize: 30,
  });
  vi.mocked(knowledgeApi.documents).mockResolvedValue({
    items: [doc],
    total: 1,
    page: 1,
    pageSize: 30,
  });
  vi.mocked(knowledgeApi.document).mockResolvedValue(doc);
  vi.mocked(knowledgeApi.revisions).mockResolvedValue([]);
});
afterEach(cleanup);
describe("Knowledge workspace", () => {
  it("uses the shared settings title hierarchy for the library", async () => {
    mount("/knowledge");

    const heading = await screen.findByRole("heading", {
      name: "Knowledge Base",
    });
    expect(heading).toHaveClass("text-xl", "font-bold");
    expect(
      screen.getByText(/Tài liệu thiết kế, định nghĩa chỉ số và quy tắc JOIN/),
    ).toBeInTheDocument();
  });

  it("keeps the knowledge workspace title hierarchy consistent", async () => {
    mount("/knowledge/kb");

    const heading = await screen.findByRole("heading", { name: base.name });
    expect(heading).toHaveClass("text-xl", "font-bold");
  });

  it("keeps Markdown inert and does not fetch remote images", () => {
    const { container } = render(
      <Markdown
        body={
          "<script>window.pwned=true</script>\n\n![remote](https://tracker.example/image)\n\n[unsafe](javascript:alert(1))\n\n# Tiếng Việt"
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.getByText("Tiếng Việt")).toBeInTheDocument();
  });
  it("saves drafts without publishing and blocks publishing dirty content", async () => {
    vi.mocked(knowledgeApi.save).mockResolvedValue({
      ...doc,
      bodyMarkdown: "# Bản mới",
      version: 2,
    });
    mount();
    const editor = await screen.findByLabelText("Nội dung Markdown");
    fireEvent.change(editor, { target: { value: "# Bản mới" } });
    expect(
      screen.getByRole("button", { name: "Xuất bản cho AI" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Lưu nháp" }));
    await waitFor(() =>
      expect(knowledgeApi.save).toHaveBeenCalledWith(
        expect.objectContaining({ bodyMarkdown: "# Bản mới", version: 1 }),
      ),
    );
    expect(knowledgeApi.publish).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Xuất bản cho AI" }),
      ).toBeEnabled(),
    );
  });
  it("publishes explicitly with lexical mode and shows queued state", async () => {
    vi.mocked(knowledgeApi.publish).mockResolvedValue({
      id: "job",
      revisionId: "rev",
      status: "queued",
      mode: "lexical",
    });
    vi.mocked(knowledgeApi.job).mockResolvedValue({
      id: "job",
      revisionId: "rev",
      status: "queued",
      mode: "lexical",
    });
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Xuất bản cho AI" }),
    );
    await waitFor(() =>
      expect(knowledgeApi.publish).toHaveBeenCalledWith(doc, true),
    );
    expect(await screen.findByText(/Index: queued/)).toBeInTheDocument();
  });
  it("preserves unsaved content on 409 and offers reload", async () => {
    vi.mocked(knowledgeApi.save).mockRejectedValue(
      Object.assign(new Error("Document changed"), { status: 409 }),
    );
    mount();
    fireEvent.change(await screen.findByLabelText("Nội dung Markdown"), {
      target: { value: "Chưa lưu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(
      await screen.findByRole("button", { name: "Tải bản mới" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nội dung Markdown")).toHaveValue("Chưa lưu");
  });
  it("opens the exact immutable revision and section", async () => {
    vi.mocked(knowledgeApi.revision).mockResolvedValue({
      ...doc,
      id: "rev",
      documentId: "doc",
      created_on: "2026-10-17",
      active: false,
      sections: [
        { id: "section-0", heading: "Old", content: "Old published content" },
      ],
    });
    mount("/knowledge/kb/documents/doc?revision=rev#section-0");
    expect(
      await screen.findByText("Old published content"),
    ).toBeInTheDocument();
    expect(knowledgeApi.revision).toHaveBeenCalledWith("doc", "rev");
    expect(document.getElementById("section-0")).toBeInTheDocument();
  });
  it("keeps distinct document revisions with the same title in citations", () => {
    render(
      <ContextSources
        isDark={false}
        citations={["r1", "r2"].map((revisionId) => ({
          id: revisionId,
          title: "Revenue",
          sourceType: "knowledge_document",
          documentId: "doc",
          revisionId,
          knowledgeBaseId: "kb",
          section: "section-0",
        }))}
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getAllByRole("link")[1]).toHaveAttribute(
      "href",
      knowledgeDocumentPath("kb", "doc", { revisionId: "r2", section: "section-0" }),
    );
  });
  it("keeps new knowledge bases disabled for SQL until explicitly enabled", async () => {
    mount("/knowledge/kb");
    const toggle = await screen.findByLabelText("Bật cho AI SQL");
    expect(toggle).not.toBeChecked();
    vi.mocked(knowledgeApi.patchBase).mockResolvedValue({
      ...base,
      enabledForSql: true,
    });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(knowledgeApi.patchBase).toHaveBeenCalledWith("kb", {
        enabledForSql: true,
      }),
    );
  });
  it("previews context without executing and shows lexical fallback", async () => {
    vi.mocked(knowledgeApi.preview).mockResolvedValue({
      items: [],
      warnings: [],
      graph: { enabled: false, gaps: [] },
      embeddingProvider: "google",
      embeddingModel: "offline",
      enabledForSql: false,
      executesSql: false,
      retrievalTrace: { retrievalMode: "lexical_fallback" },
    });
    mount("/knowledge/kb");
    fireEvent.click(await screen.findByRole("button", { name: "Thử context" }));
    fireEvent.change(screen.getByLabelText("Câu hỏi SQL"), {
      target: { value: "Doanh thu" },
    });
    fireEvent.submit(screen.getByLabelText("Câu hỏi SQL").closest("form")!);
    await waitFor(() =>
      expect(knowledgeApi.preview).toHaveBeenCalledWith(
        "kb",
        "Doanh thu",
        "public",
      ),
    );
    expect(
      await screen.findByText(/Truy hồi: lexical fallback/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Chuyển câu hỏi sang SQL Lab" }),
    ).toHaveAttribute("href", "/sqllab");
  });
});
