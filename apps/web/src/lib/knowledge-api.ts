/** @file knowledge-api.ts @description Typed knowledge requests using the shared dynamic desktop API client. */
import { api } from "./api-client";
import type {
  KnowledgeBase,
  KnowledgeDocument,
  Revision,
  Job,
  Page,
  GraphResult,
  ContextPreview,
} from "@/app/knowledge/types";
const response = <T>(request: Promise<unknown>) => request as Promise<T>;
export const knowledgeApi = {
  bases: (params: Record<string, unknown> = {}) =>
    response<Page<KnowledgeBase>>(api.get("knowledge-bases", { params })),
  createBase: (data: Omit<KnowledgeBase, "id">) =>
    response<KnowledgeBase>(api.post("knowledge-bases", data)),
  base: (id: string) =>
    response<KnowledgeBase>(api.get(`knowledge-bases/${id}`)),
  patchBase: (id: string, data: Partial<KnowledgeBase>) =>
    response<KnowledgeBase>(api.patch(`knowledge-bases/${id}`, data)),
  archiveBase: (id: string) =>
    response<unknown>(api.delete(`knowledge-bases/${id}`)),
  documents: (id: string, params: Record<string, unknown> = {}) =>
    response<Page<KnowledgeDocument>>(
      api.get(`knowledge-bases/${id}/documents`, { params }),
    ),
  createDocument: (
    id: string,
    data: Pick<
      KnowledgeDocument,
      "title" | "kind" | "bodyMarkdown" | "definitionData"
    >,
  ) =>
    response<KnowledgeDocument>(
      api.post(`knowledge-bases/${id}/documents`, data),
    ),
  document: (id: string) =>
    response<KnowledgeDocument>(api.get(`knowledge-documents/${id}`)),
  save: (doc: KnowledgeDocument) =>
    response<KnowledgeDocument>(
      api.patch(`knowledge-documents/${doc.id}`, {
        title: doc.title,
        kind: doc.kind,
        bodyMarkdown: doc.bodyMarkdown,
        definitionData: doc.definitionData,
        expectedVersion: doc.version,
      }),
    ),
  publish: (doc: KnowledgeDocument, lexicalOnly: boolean) =>
    response<Job>(
      api.post(`knowledge-documents/${doc.id}/publish`, {
        expectedVersion: doc.version,
        lexicalOnly,
      }),
    ),
  remove: (id: string, archive = false) =>
    response<unknown>(
      archive
        ? api.delete(`knowledge-documents/${id}`)
        : api.post(`knowledge-documents/${id}/unpublish`),
    ),
  revisions: (id: string) =>
    response<Revision[]>(api.get(`knowledge-documents/${id}/revisions`)),
  revision: (doc: string, rev: string) =>
    response<Revision>(api.get(`knowledge-documents/${doc}/revisions/${rev}`)),
  job: (id: string) => response<Job>(api.get(`knowledge-jobs/${id}`)),
  graph: (
    databaseId: string,
    knowledgeBaseId: string,
    params: Record<string, unknown> = {},
  ) =>
    response<GraphResult>(
      api.get("rag/graph", {
        params: { databaseId, knowledgeBaseId, ...params },
      }),
    ),
  sync: (id: string, schemaName: string) =>
    response<unknown>(
      api.post(`knowledge-bases/${id}/sync-schema`, { schemaName }),
    ),
  preview: (id: string, query: string, schemaName: string) =>
    response<ContextPreview>(
      api.post(`knowledge-bases/${id}/preview-context`, { query, schemaName }),
    ),
  importLegacy: (id: string, sourceId: string) =>
    response<KnowledgeDocument>(
      api.post(`knowledge-bases/${id}/import-legacy`, { sourceId }),
    ),
};
