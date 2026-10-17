/**
 * @file vector-store-overview.ts
 * @description Derives Vector Store overview figures (source totals, database coverage, freshness) from RAG API data.
 */

import type { RagSource } from "./vector-store-map-graph";

export interface VectorStoreDatabaseOption {
  id: string;
  label: string;
}

export interface VectorStoreDatabaseCoverage {
  databaseId: string;
  label: string;
  sourceCount: number;
  notIndexedCount: number;
  schemas: string[];
  lastIndexedOn: Date | null;
  isConnected: boolean;
}

export interface VectorStoreOverview {
  totalSources: number;
  indexedSources: number;
  notIndexedSources: number;
  sourceTypeCount: number;
  globalSources: number;
  lastIndexedOn: Date | null;
  oldestIndexedOn: Date | null;
  databases: VectorStoreDatabaseCoverage[];
}

const SCHEMA_SOURCE_PREFIX = "database_schema:";

/**
 * Parses an API timestamp. The API stores naive UTC datetimes, so a value
 * without an explicit offset is read as UTC instead of local time.
 */
export function parseServerTimestamp(value?: string | null): Date | null {
  if (!value) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = new Date(hasOffset ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Returns the schema name encoded in a `database_schema:<db>:<schema>` source id. */
export function schemaFromSourceId(source: RagSource): string | null {
  if (source.sourceType !== "database_schema" || !source.id.startsWith(SCHEMA_SOURCE_PREFIX)) {
    return null;
  }
  const remainder = source.id.slice(SCHEMA_SOURCE_PREFIX.length);
  const prefix = source.databaseId ? `${source.databaseId}:` : "";
  if (prefix && remainder.startsWith(prefix)) {
    return remainder.slice(prefix.length) || null;
  }
  const separator = remainder.lastIndexOf(":");
  return separator >= 0 ? remainder.slice(separator + 1) || null : null;
}

export function buildVectorStoreOverview(
  sources: RagSource[],
  databases: VectorStoreDatabaseOption[],
): VectorStoreOverview {
  const indexedDates = sources
    .map((source) => parseServerTimestamp(source.indexed_on))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());
  const indexedSources = sources.filter((source) => source.status === "indexed").length;

  const coverage = new Map<string, VectorStoreDatabaseCoverage>(
    databases.map((database) => [database.id, emptyCoverage(database.id, database.label, true)]),
  );

  sources.forEach((source) => {
    if (!source.databaseId) return;
    const entry = coverage.get(source.databaseId)
      || emptyCoverage(source.databaseId, source.databaseId, false);
    coverage.set(source.databaseId, entry);

    entry.sourceCount += 1;
    if (source.status !== "indexed") entry.notIndexedCount += 1;
    const schema = schemaFromSourceId(source);
    if (schema && !entry.schemas.includes(schema)) entry.schemas.push(schema);
    const indexedOn = parseServerTimestamp(source.indexed_on);
    if (indexedOn && (!entry.lastIndexedOn || indexedOn > entry.lastIndexedOn)) {
      entry.lastIndexedOn = indexedOn;
    }
  });

  const databaseCoverage = [...coverage.values()].sort((left, right) => {
    if (left.isConnected !== right.isConnected) return left.isConnected ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
  databaseCoverage.forEach((entry) => entry.schemas.sort());

  return {
    totalSources: sources.length,
    indexedSources,
    notIndexedSources: sources.length - indexedSources,
    sourceTypeCount: new Set(sources.map((source) => source.sourceType)).size,
    globalSources: sources.filter((source) => !source.databaseId).length,
    lastIndexedOn: indexedDates.at(-1) || null,
    oldestIndexedOn: indexedDates[0] || null,
    databases: databaseCoverage,
  };
}

function emptyCoverage(databaseId: string, label: string, isConnected: boolean): VectorStoreDatabaseCoverage {
  return {
    databaseId,
    label,
    sourceCount: 0,
    notIndexedCount: 0,
    schemas: [],
    lastIndexedOn: null,
    isConnected,
  };
}
