/**
 * @file api-client.ts
 * @description API client for connecting to the FastAPI backend.
 */

import axios from "axios";
import { useAuth } from "../hooks/use-auth";
import { getApiBaseUrl, isTauriRuntime } from "./runtime-api";

export interface SqlExecutionConfirmation {
  confirmationToken: string;
  expiresAt: string;
  risk: "write" | "destructive" | "unknown";
  reason: string;
}

export interface QueryHistoryItem {
  id: string;
  sql: string;
  status: string;
  executionTime?: number | null;
  errorMessage?: string | null;
  databaseId?: string | null;
  executedAt?: string | null;
  created_on?: string | null;
  database: { databaseName?: string };
}

export interface QueryHistoryPage {
  items: QueryHistoryItem[];
  hasMore: boolean;
  nextOffset: number | null;
  legacy?: boolean;
}

export const authNavigation = {
  navigate: (url: string) => {
    if (typeof window !== "undefined") {
      window.location.href = url;
    }
  },
};

export class SqlConfirmationRequiredError extends Error {
  constructor(public readonly confirmation: SqlExecutionConfirmation) {
    super(confirmation.reason);
    this.name = "SqlConfirmationRequiredError";
  }
}

export const api = axios.create({
  withCredentials: true,
});

// Request interceptor to add platform header and auth token
api.interceptors.request.use((config) => {
    config.baseURL = getApiBaseUrl();
    if (isTauriRuntime()) {
        config.headers["X-App-Platform"] = "tauri";
    }
    const token = useAuth.getState().token;
    if (token) {
        config.headers["Authorization"] = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor for error handling and token management
api.interceptors.response.use(
  (response: any) => {
    return response.data;
  },
  (error: any) => {
    // Check for 401 Unauthorized
    if (error.response?.status === 401) {
      const isLoginRequest = error.config?.url?.includes("auth/login");
      const isDatabaseTestRequest = error.config?.url?.includes("database/test");
      const isAlreadyOnLoginPage = typeof window !== "undefined" && window.location.pathname.includes("/auth/login");

      if (!isLoginRequest && !isDatabaseTestRequest && !isAlreadyOnLoginPage) {
        // Clear auth state and redirect to login
        console.warn("API 401: Unauthorized. Logging out.");
        useAuth.getState().logout();
        authNavigation.navigate("/auth/login");
      }
    }

    const confirmation = error.response?.data?.detail;
    if (
      error.response?.status === 409 &&
      confirmation?.code === "sql_confirmation_required"
    ) {
      return Promise.reject(new SqlConfirmationRequiredError(confirmation));
    }

    // Standardize error format
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.response?.data?.detail ||
      error.message ||
      "An unknown error occurred";
      
    if (error.message === "Network Error") {
       try {
         console.error("API Network Error: Check if backend is running at", getApiBaseUrl());
       } catch {
         console.error("API Network Error: Desktop backend URL is not configured");
       }
    }
    
    const err = new Error(message);
    (err as any).status = error.response?.status;
    (err as any).response = error.response;
    return Promise.reject(err);
  },
);

// Utility to cast response
const req = (promise: Promise<any>) => promise as Promise<any>;

export const databaseApi = {
  list: () => req(api.get("database/list")),
  health: () => req(api.get("health")),
  create: (data: any) => req(api.post("database/create", data)),
  update: (data: any) => req(api.post("database/update", data)),
  delete: (id: string) => req(api.post("database/delete", { id })),
  test: (data: any) => req(api.post("database/test", data)),
  connectLocal: (data: { path: string; type: 'sqlite' | 'duckdb'; name?: string }) => 
    req(api.post("database/connect-local", data)),

  // Metadata
  getSchemas: (databaseId: string) =>
    req(api.get("database/schemas", { params: { databaseId } })),
  getTables: (databaseId: string, schema?: string) =>
    req(api.get("database/tables", { params: { databaseId, schema } })),
  getViews: (databaseId: string, schema?: string) =>
    req(api.get("database/views", { params: { databaseId, schema } })),
  getFunctions: (databaseId: string, schema?: string) =>
    req(api.get("database/functions", { params: { databaseId, schema } })),
  getProcedures: (databaseId: string, schema?: string) =>
    req(api.get("database/procedures", { params: { databaseId, schema } })),
  getTriggers: (databaseId: string, schema?: string) =>
    req(api.get("database/triggers", { params: { databaseId, schema } })),
  getEvents: (databaseId: string, schema?: string) =>
    req(api.get("database/events", { params: { databaseId, schema } })),
  getMaterializedViews: (databaseId: string, schema?: string) =>
    req(api.get("database/materialized-views", { params: { databaseId, schema } })),
  getSequences: (databaseId: string, schema?: string) =>
    req(api.get("database/sequences", { params: { databaseId, schema } })),
  getPartitions: (databaseId: string, schema?: string) =>
    req(api.get("database/partitions", { params: { databaseId, schema } })),
  getRoles: (databaseId: string) =>
    req(api.get("database/roles", { params: { databaseId } })),
  getGrants: (databaseId: string, schema?: string) =>
    req(api.get("database/grants", { params: { databaseId, schema } })),
  getTablespaces: (databaseId: string) =>
    req(api.get("database/tablespaces", { params: { databaseId } })),
  getExtensions: (databaseId: string, schema?: string) =>
    req(api.get("database/extensions", { params: { databaseId, schema } })),
  getSynonyms: (databaseId: string, schema?: string) =>
    req(api.get("database/synonyms", { params: { databaseId, schema } })),
  getJobs: (databaseId: string, schema?: string) =>
    req(api.get("database/jobs", { params: { databaseId, schema } })),
  runAdminAction: (data: {
    databaseId: string;
    objectType: string;
    objectName: string;
    action: string;
    schemaName?: string;
    options?: Record<string, any>;
    execute?: boolean;
    confirmation?: string;
  }) => req(api.post("database/admin-action", data)),
  getColumns: (databaseId: string, table: string, schema?: string) =>
    req(api.get("database/columns", { params: { databaseId, table, schema } })),
  getIndexes: (databaseId: string, table: string, schema?: string) =>
    req(api.get("database/indexes", { params: { databaseId, table, schema } })),
  getForeignKeys: (databaseId: string, table: string, schema?: string) =>
    req(
      api.get("database/foreign-keys", {
        params: { databaseId, table, schema },
      }),
    ),
  getTableInfo: (databaseId: string, table: string, schema?: string) =>
    req(
      api.get("database/table-info", {
        params: { databaseId, table, schema },
      }),
    ),
  getDDL: (databaseId: string, table: string, schema?: string) =>
    req(api.get("database/ddl", { params: { databaseId, table, schema } })),
  getAllColumns: (databaseId: string, schema?: string) =>
    req(api.get("database/all-columns", { params: { databaseId, schema } })),
  getAllForeignKeys: (databaseId: string, schema?: string) =>
    req(api.get("database/all-foreign-keys", { params: { databaseId, schema } })),
  getDiagnostics: (databaseId: string, table: string) =>
    req(api.get("database/diagnostics", { params: { databaseId, table } })),

  // Execution
  execute: (
    databaseId: string,
    sql: string,
    autoCommit: boolean = true,
    limit?: number,
    confirmationToken?: string,
  ) =>
    req(api.post("database/execute", {
      databaseId,
      sql,
      autoCommit,
      limit,
      ...(confirmationToken ? { confirmationToken } : {}),
    })),
  getExplainPlan: (databaseId: string, sql: string) =>
    req(api.post("database/explain", { databaseId, sql })),
  saveQuery: (data: any) => req(api.post("database/save-query", data)),
  getHistory: (databaseId?: string) =>
    req(api.get("database/history", { params: { databaseId } })),
  getHistoryPage: async (
    databaseId: string,
    { q = "", limit = 50, offset = 0 }: {
      q?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<QueryHistoryPage> => {
    const response: QueryHistoryPage | QueryHistoryItem[] = await req(
      api.get("database/history", {
        params: { databaseId, q, limit, offset, paginated: true },
      }),
    );
    if (!Array.isArray(response)) return response;
    const search = q.trim().toLowerCase();
    return {
      items: response.filter(
        (item) =>
          item.sql.toLowerCase().includes(search) ||
          (item.database.databaseName || "").toLowerCase().includes(search),
      ),
      hasMore: false,
      nextOffset: null,
      legacy: true,
    };
  },
  deleteHistory: (databaseId: string): Promise<{ deletedCount: number }> => {
    if (!databaseId.trim()) {
      return Promise.reject(new Error("Select a database before deleting history."));
    }
    return req(api.delete("database/history", { params: { databaseId } }));
  },
  listSavedQueries: (databaseId?: string, userId?: string) =>
    req(api.get("database/saved-queries", { params: { databaseId, userId } })),
  getSavedQueries: (databaseId: string, userId: string) =>
    req(api.get("database/saved-queries", { params: { databaseId, userId } })),

  // Import
  import: (formData: FormData) => req(api.post("database/import", formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })),
  getImportStatus: (jobId: string) => req(api.get(`database/import/status/${jobId}`)),
};

export const authApi = {
  login: (data: any) => req(api.post("auth/login", data)),
  register: (data: any) => req(api.post("auth/register", data)),
  logout: () => req(api.post("auth/logout")),
};

export const userApi = {
  getMe: () => req(api.get("user/me")),
  getSettings: () => req(api.get("user/settings")),
  updateSettings: (data: any) => req(api.post("user/settings", data)),
  updateProfile: (data: { name?: string; avatarUrl?: string; bio?: string }) => req(api.post("user/profile", data)),
  changePassword: (data: any) => req(api.post("user/change-password", data)),
};

export const aiApi = {
  getAIStatus: () => req(api.get("ai/status")),
  getModels: () => req(api.get("ai/models")),
  addModel: (data: any) => req(api.post("ai/models", data)),
  getTaskCatalog: () => req(api.get("ai/task-catalog")),
  getTaskAssignments: (params?: { databaseId?: string }) => req(api.get("ai/task-assignments", { params })),
  saveTaskAssignments: (assignments: any[]) => req(api.put("ai/task-assignments", { assignments })),
  getRouterTerms: () => req(api.get("ai/router-terms")),
  createRouterTerm: (data: any) => req(api.post("ai/router-terms", data)),
  updateRouterTerm: (id: string, data: any) => req(api.put(`ai/router-terms/${id}`, data)),
  deleteRouterTerm: (id: string) => req(api.delete(`ai/router-terms/${id}`)),
  getAIConfig: (reveal: boolean = false, provider?: string) => req(api.get("ai-config/get", { params: { reveal, provider } })),
  saveAIConfig: (data: any) => req(api.post("ai-config/save", data)),
  generateSQL: (data: any) => req(api.post("ai/generate-sql", data)),
  explainSQL: (data: any) => req(api.post("ai/explain-sql", data)),
  optimizeSQL: (data: any) => req(api.post("ai/optimize-sql", data)),
  explainPlan: (data: any) => req(api.post("ai/explain-plan", data)),
  fixSQL: (data: any) => req(api.post("ai/fix-sql", data)),
  validateSQL: (data: { sql: string; databaseId?: string; dialect?: string; allowWrite?: boolean; maxPreviewRows?: number }) =>
    req(api.post("ai/validate-sql", data)),
  completeSql: (data: { databaseId: string, schema_name: string, prefix: string, suffix: string, modelId?: string }, signal?: AbortSignal) => req(api.post("ai/complete", data, { signal })),
  executeAgent: (data: any) => req(api.post("ai/agent", data)),
  getDiagnostics: (params?: { databaseId?: string; limit?: number }) => req(api.get("ai/diagnostics", { params })),
  deleteModel: (id: string) => req(api.delete(`ai/models/${id}`)),
  getHistory: (databaseId?: string) => req(api.get("ai/history", { params: { databaseId } })),
  getConversations: (databaseId?: string) => req(api.get("ai/conversations", { params: { databaseId } })),
  getConversationMessages: (id: string) => req(api.get(`ai/conversations/${id}`)),
  updateConversation: (id: string, data: any) => req(api.put(`ai/conversations/${id}`, data)),
  deleteConversation: (id: string) => req(api.delete(`ai/conversations/${id}`)),
  getRagStatus: () => req(api.get("rag/status")),
  getRagPipelineStatus: () => req(api.get("rag/pipeline/status")),
  planRagPipeline: (data: {
    query: string;
    databaseId?: string;
    schema_name?: string;
    history?: Array<Record<string, string>>;
  }) => req(api.post("rag/pipeline/plan", data)),
  syncRagDatabase: (databaseId: string, data?: {
    schema_name?: string;
    includeSavedQueries?: boolean;
    includeQueryHistory?: boolean;
    includeFailedHistory?: boolean;
    queryHistoryLimit?: number;
  }) => req(api.post(`rag/pipeline/sync/database/${databaseId}`, data || {})),
  evaluateRag: (data: {
    cases: Array<{
      name: string;
      query: string;
      expectedCitations: string[];
      databaseId?: string;
      sourceTypes?: string[];
      topK?: number;
      maxLatencyMs?: number;
    }>;
  }) => req(api.post("rag/evaluate", data)),
  getRagSources: (params?: { databaseId?: string; sourceType?: string }) => req(api.get("rag/sources", { params })),
  getRagSource: (id: string) => req(api.get(`rag/sources/${id}`)),
  deleteRagSource: (id: string) => req(api.delete(`rag/sources/${id}`)),
  indexRagDatabase: (databaseId: string, schema: string = "public") =>
    req(api.post(`rag/index/database/${databaseId}`, null, { params: { schema } })),
  indexRagSavedQueries: (databaseId: string) => req(api.post("rag/index/saved-queries", { databaseId })),
  indexRagQueryHistory: (data: { databaseId: string; includeFailed?: boolean; limit?: number }) =>
    req(api.post("rag/index/query-history", data)),
  indexRagSource: (data: {
    title: string;
    content: string;
    sourceType?: string;
    databaseId?: string;
    uri?: string;
    sourceId?: string;
    accessScope?: string;
  }) => req(api.post("rag/index/source", data)),
  ingestRagUrl: (data: {
    url: string;
    title?: string;
    databaseId?: string;
    sourceId?: string;
    accessScope?: string;
  }) => req(api.post("rag/ingest/url", data)),
  ingestRagFile: (data: {
    file: File;
    title?: string;
    databaseId?: string;
    sourceId?: string;
    accessScope?: string;
  }) => {
    const formData = new FormData();
    formData.append("file", data.file);
    if (data.title) formData.append("title", data.title);
    if (data.databaseId) formData.append("databaseId", data.databaseId);
    if (data.sourceId) formData.append("sourceId", data.sourceId);
    if (data.accessScope) formData.append("accessScope", data.accessScope);
    return req(api.post("rag/ingest/file", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }));
  },
  streamChat: async (
    data: any,
    onChunk: (chunk: any, event?: string) => void,
    onHeaders?: (headers: Headers) => void,
    signal?: AbortSignal,
  ) => {
    await streamSSE("ai/stream", data, onChunk, onHeaders, signal);
  },
  streamAction: async (
    action: "explain" | "optimize",
    data: Record<string, unknown>,
    onChunk: (chunk: any, event?: string) => void,
    onHeaders?: (headers: Headers) => void,
    signal?: AbortSignal,
  ) => {
    const endpoint = action === "explain" ? "ai/explain-sql/stream" : "ai/optimize-sql/stream";
    await streamSSE(endpoint, data, onChunk, onHeaders, signal);
  },
  submitFeedback: (data: { messageId: string; rating: 1 | -1; correction?: string; conversationId?: string }) =>
    req(api.post("ai/feedback", data)),
};

async function streamSSE(
  endpoint: string,
  data: any,
  onChunk: (chunk: any, event?: string) => void,
  onHeaders?: (headers: Headers) => void,
  signal?: AbortSignal,
) {
    const token = useAuth.getState().token;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    if (isTauriRuntime()) {
      headers["X-App-Platform"] = "tauri";
    }

    const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(data),
      signal,
    });


    if (onHeaders) {
        onHeaders(response.headers);
    }

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Streaming failed" }));
        throw new Error(err.error || "Streaming failed");
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return;

    const abortReader = () => {
      void reader.cancel();
    };
    signal?.addEventListener("abort", abortReader, { once: true });

    let buffer = "";
    let currentEvent = "message";

    const processPart = (part: string) => {
      const lines = part.split("\n");
      let hasSseData = false;
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith("data: ")) {
          hasSseData = true;
          let content = line.substring(6);
          if (content === "[DONE]") return;
          
          try {
            content = JSON.parse(content);
          } catch (e) { /* fallback */ }
          
          onChunk(content, currentEvent); 
        }
      }

      if (!hasSseData && part.trim()) {
        onChunk(part, currentEvent);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            processPart(buffer);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          processPart(part);
          currentEvent = "message"; // Reset to default after each full event block
        }
      }
    } finally {
      signal?.removeEventListener("abort", abortReader);
    }
}

export const resolveUrl = (path: string | null | undefined) => {
  if (!path) return "";
  if (path.startsWith("http") || path.startsWith("data:")) return path;
  // Remove /api/ from end of baseURL and append path
  const base = getApiBaseUrl().replace(/\/api\/$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
};

