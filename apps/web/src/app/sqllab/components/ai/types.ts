/**
 * @file types.ts
 * @description Common type definitions for the AI Assistant components.
 */

export interface AIStep {
  type: "thinking";
  content: string;
  name?: string;
  args?: any;
  status?: "active" | "complete";
}

export interface AICitation {
  id: string;
  sourceType: string;
  title: string;
  objectName?: string;
  schemaName?: string;
  score?: number;
  documentId?: string;
  revisionId?: string;
  knowledgeBaseId?: string;
  section?: string;
  matchedTerms?: string[];
  reasons?: string[];
}

export interface AISuggestion {
  label: string;
  prompt: string;
  intent?: "drilldown" | "compare" | "filter" | "explain" | "optimize" | "fix" | "visualize" | "other";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  action?: "explain" | "optimize";
  sql?: string;
  queryLanguage?: string;
  queryText?: string;
  explanation?: string;
  thought?: string;
  analysis?: string;
  confidence?: number;
  columns?: string[];
  data?: any[];
  isActionable?: boolean;
  suggestions?: AISuggestion[];
  citations?: AICitation[];
  retrievalTrace?: Record<string, any>;
  warnings?: string[];
  steps?: AIStep[];
  isStreaming?: boolean;
}

export interface AIProviderStatus {
  hasApiKey: boolean;
}

export interface AIRuntimeStatus {
  langchain: boolean;
  langgraph: boolean;
  langsmith: boolean;
  anthropic?: boolean;
  hasApiKey: boolean;
  tracingEnabled: boolean;
  project?: string;
  providers?: Record<string, AIProviderStatus>;
}
