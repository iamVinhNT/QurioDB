/** @file routes.ts @description Canonical routes for the Settings-hosted knowledge workspace. */

export const knowledgeLibraryPath = () => "/settings/ai/knowledge";

export const knowledgeBasePath = (knowledgeBaseId: string) =>
  `${knowledgeLibraryPath()}/${encodeURIComponent(knowledgeBaseId)}`;

export const knowledgeDocumentPath = (
  knowledgeBaseId: string,
  documentId: string,
  citation?: { revisionId?: string | null; section?: string | null },
) => {
  const path = `${knowledgeBasePath(knowledgeBaseId)}/documents/${encodeURIComponent(documentId)}`;
  if (!citation?.revisionId) return path;
  return `${path}?revision=${encodeURIComponent(citation.revisionId)}${citation.section ? `#${encodeURIComponent(citation.section)}` : ""}`;
};
