import { api } from "./client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TreeNode = {
  name: string;
  path: string;
  type: "object" | "document" | "folder" | "file" | "database" | "report";
  icon?: string;
  defaultView?: "table" | "kanban";
  children?: TreeNode[];
  virtual?: boolean;
};

export type WorkspaceTreeResponse = {
  tree: TreeNode[];
  exists: boolean;
  workspaceRoot: string | null;
  openclawDir: string;
};

export type ObjectField = {
  id: string;
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum_values?: string[];
  enum_colors?: Record<string, string>;
  enum_multiple?: boolean;
  related_object_id?: string;
  related_object_name?: string;
  relationship_type?: string;
  sort_order?: number;
};

export type ObjectStatus = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
  is_default?: boolean;
};

export type ObjectInfo = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  default_view?: string;
  display_field?: string;
  immutable?: boolean;
};

export type ObjectResponse = {
  object: ObjectInfo;
  fields: ObjectField[];
  statuses: ObjectStatus[];
  entries: Record<string, unknown>[];
  relationLabels: Record<string, Record<string, string>>;
  reverseRelations: unknown[];
  effectiveDisplayField: string;
  savedViews: unknown[];
  activeView?: string;
};

export type EntryResponse = {
  object: ObjectInfo;
  fields: ObjectField[];
  entry: Record<string, unknown>;
  relationLabels: Record<string, Record<string, string>>;
  reverseRelations: unknown[];
  effectiveDisplayField: string;
};

export type SearchIndexItem = {
  id: string;
  label: string;
  sublabel?: string;
  kind: "file" | "object" | "entry";
  icon?: string;
  objectName?: string;
  entryId?: string;
  fields?: Record<string, string>;
  path?: string;
  nodeType?: string;
};

export type TableInfo = {
  table_name: string;
  column_count: number;
  estimated_row_count: number;
  columns: Array<{ name: string; type: string; is_nullable: boolean }>;
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const workspaceApi = {
  // Tree & browse
  getTree: () => api.get<WorkspaceTreeResponse>("/workspace/tree"),
  browse: (dir?: string) => {
    const params = dir ? `?dir=${encodeURIComponent(dir)}` : "";
    return api.get<{ entries: unknown[]; currentDir: string; parentDir: string | null }>(`/workspace/browse${params}`);
  },

  // File operations
  getFile: (path: string) =>
    api.get<{ content: string; type: string }>(`/workspace/file?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, content: string) =>
    api.put<{ ok: boolean }>("/workspace/file", { path, content }),
  deleteFile: (path: string) =>
    api.delete<{ ok: boolean }>("/workspace/file"),

  // DB operations
  dbQuery: (path: string, sql: string) =>
    api.post<{ rows: Record<string, unknown>[]; sql: string }>("/workspace/db/query", { path, sql }),
  dbIntrospect: (path: string) =>
    api.get<{ tables: TableInfo[]; path: string }>(`/workspace/db/introspect?path=${encodeURIComponent(path)}`),

  // Objects
  getObject: (name: string, params?: { page?: number; pageSize?: number; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.pageSize) searchParams.set("pageSize", String(params.pageSize));
    if (params?.search) searchParams.set("search", params.search);
    const qs = searchParams.toString();
    return api.get<ObjectResponse>(`/workspace/objects/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`);
  },

  // Entries
  createEntry: (objectName: string, fields?: Record<string, string>) =>
    api.post<{ entryId: string; ok: boolean }>(`/workspace/objects/${encodeURIComponent(objectName)}/entries`, { fields }),
  getEntry: (objectName: string, entryId: string) =>
    api.get<EntryResponse>(`/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`),
  updateEntry: (objectName: string, entryId: string, fields: Record<string, string>) =>
    api.patch<{ ok: boolean }>(`/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`, { fields }),
  deleteEntry: (objectName: string, entryId: string) =>
    api.delete<{ ok: boolean }>(`/workspace/objects/${encodeURIComponent(objectName)}/entries/${encodeURIComponent(entryId)}`),

  // Fields
  renameField: (objectName: string, fieldId: string, newName: string) =>
    api.patch<{ ok: boolean }>(`/workspace/objects/${encodeURIComponent(objectName)}/fields/${encodeURIComponent(fieldId)}`, { name: newName }),

  // Views
  getViews: (objectName: string) =>
    api.get<{ views: unknown[]; activeView?: string }>(`/workspace/objects/${encodeURIComponent(objectName)}/views`),
  saveViews: (objectName: string, views: unknown[], activeView?: string) =>
    api.put<{ ok: boolean }>(`/workspace/objects/${encodeURIComponent(objectName)}/views`, { views, activeView }),

  // Search
  getSearchIndex: () =>
    api.get<{ items: SearchIndexItem[] }>("/workspace/search-index"),

  // Reports
  executeReport: (sql: string) =>
    api.post<{ rows: Record<string, unknown>[]; sql: string }>("/workspace/reports/execute", { sql }),
};
