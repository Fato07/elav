import { Router } from "express";
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, statSync, type Dirent } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import type { Db } from "@paperclipai/db";
import { assertBoard } from "./authz.js";
import {
  resolveWorkspaceRoot,
  discoverDuckDBPaths,
  duckdbPath,
  duckdbQueryOnFile,
  duckdbQueryOnFileAsync,
  duckdbExecOnFile,
  duckdbQueryAsync,
  duckdbQueryAllAsync,
  findDuckDBForObject,
  resolveDuckdbBin,
  parseRelationValue,
  parseSimpleYaml,
  isDatabaseFile,
  safeResolvePath,
  safeResolveNewPath,
  isSystemFile,
  readWorkspaceFile,
  getObjectViews,
  saveObjectViews,
  type SavedView,
} from "../workspace/lib.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type ObjectRow = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  default_view?: string;
  display_field?: string;
  immutable?: boolean;
  created_at?: string;
  updated_at?: string;
};

type FieldRow = {
  id: string;
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum_values?: string;
  enum_colors?: string;
  enum_multiple?: boolean;
  related_object_id?: string;
  relationship_type?: string;
  sort_order?: number;
};

type StatusRow = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
  is_default?: boolean;
};

type EavRow = {
  entry_id: string;
  created_at: string;
  updated_at: string;
  field_name: string;
  value: string | null;
};

type TreeNode = {
  name: string;
  path: string;
  type: "object" | "document" | "folder" | "file" | "database" | "report";
  icon?: string;
  defaultView?: "table" | "kanban";
  children?: TreeNode[];
  virtual?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function q<T = Record<string, unknown>>(dbFile: string, sql: string): T[] {
  return duckdbQueryOnFile<T>(dbFile, sql);
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function dbStr(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val as string | number | boolean);
}

function resolveDisplayField(obj: ObjectRow, fields: FieldRow[]): string {
  if (obj.display_field) return obj.display_field;
  const nameField = fields.find((f) => /\bname\b/i.test(f.name) || /\btitle\b/i.test(f.name));
  if (nameField) return nameField.name;
  const textField = fields.find((f) => f.type === "text");
  if (textField) return textField.name;
  return fields[0]?.name ?? "id";
}

function pivotEavRows(rows: EavRow[]): Record<string, unknown>[] {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    let entry = grouped.get(row.entry_id);
    if (!entry) {
      entry = { entry_id: row.entry_id, created_at: row.created_at, updated_at: row.updated_at };
      grouped.set(row.entry_id, entry);
    }
    if (row.field_name) entry[row.field_name] = row.value;
  }
  return Array.from(grouped.values());
}

// Schema migration (idempotent)
const migratedDbs = new Set<string>();
function ensureDisplayFieldColumn(dbFile: string) {
  if (migratedDbs.has(dbFile)) return;
  const bin = resolveDuckdbBin();
  if (!bin) return;
  try {
    execSync(
      `'${bin}' '${dbFile}' 'ALTER TABLE objects ADD COLUMN IF NOT EXISTS display_field VARCHAR'`,
      { encoding: "utf-8", timeout: 5_000, shell: "/bin/sh" },
    );
  } catch { /* skip */ }
  migratedDbs.add(dbFile);
}

function resolveRelationLabels(
  dbFile: string,
  fields: FieldRow[],
  entries: Record<string, unknown>[],
): { labels: Record<string, Record<string, string>>; relatedObjectNames: Record<string, string> } {
  const labels: Record<string, Record<string, string>> = {};
  const relatedObjectNames: Record<string, string> = {};
  const relationFields = fields.filter((f) => f.type === "relation" && f.related_object_id);

  for (const rf of relationFields) {
    const relatedObjs = q<ObjectRow>(dbFile, `SELECT * FROM objects WHERE id = '${sqlEscape(rf.related_object_id!)}' LIMIT 1`);
    if (relatedObjs.length === 0) continue;
    const relObj = relatedObjs[0];
    relatedObjectNames[rf.name] = relObj.name;

    const relFields = q<FieldRow>(dbFile, `SELECT * FROM fields WHERE object_id = '${sqlEscape(relObj.id)}' ORDER BY sort_order`);
    const displayFieldName = resolveDisplayField(relObj, relFields);

    const entryIds = new Set<string>();
    for (const entry of entries) {
      const val = entry[rf.name];
      if (val == null || val === "") continue;
      const valStr = typeof val === "object" && val !== null ? JSON.stringify(val) : typeof val === "string" ? val : String(val);
      for (const id of parseRelationValue(valStr)) entryIds.add(id);
    }

    if (entryIds.size === 0) { labels[rf.name] = {}; continue; }

    const idList = Array.from(entryIds).map((id) => `'${sqlEscape(id)}'`).join(",");
    const displayRows = q<{ entry_id: string; value: string }>(dbFile,
      `SELECT e.id as entry_id, ef.value FROM entries e JOIN entry_fields ef ON ef.entry_id = e.id JOIN fields f ON f.id = ef.field_id WHERE e.id IN (${idList}) AND f.object_id = '${sqlEscape(relObj.id)}' AND f.name = '${sqlEscape(displayFieldName)}'`);

    const labelMap: Record<string, string> = {};
    for (const row of displayRows) labelMap[row.entry_id] = row.value || row.entry_id;
    for (const id of entryIds) { if (!labelMap[id]) labelMap[id] = id; }
    labels[rf.name] = labelMap;
  }

  return { labels, relatedObjectNames };
}

type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  entries: Record<string, Array<{ id: string; label: string }>>;
};

function findReverseRelations(objectId: string): ReverseRelation[] {
  const dbPaths = discoverDuckDBPaths();
  const result: ReverseRelation[] = [];

  for (const db of dbPaths) {
    const reverseFields = q<FieldRow & { source_object_id: string; source_object_name: string }>(db,
      `SELECT f.*, f.object_id as source_object_id, o.name as source_object_name FROM fields f JOIN objects o ON o.id = f.object_id WHERE f.type = 'relation' AND f.related_object_id = '${sqlEscape(objectId)}'`);

    for (const rrf of reverseFields) {
      const sourceObjs = q<ObjectRow>(db, `SELECT * FROM objects WHERE id = '${sqlEscape(rrf.source_object_id)}' LIMIT 1`);
      if (sourceObjs.length === 0) continue;

      const sourceFields = q<FieldRow>(db, `SELECT * FROM fields WHERE object_id = '${sqlEscape(rrf.source_object_id)}' ORDER BY sort_order`);
      const displayFieldName = resolveDisplayField(sourceObjs[0], sourceFields);

      const refRows = q<{ source_entry_id: string; target_value: string }>(db,
        `SELECT ef.entry_id as source_entry_id, ef.value as target_value FROM entry_fields ef WHERE ef.field_id = '${sqlEscape(rrf.id)}' AND ef.value IS NOT NULL AND ef.value != ''`);
      if (refRows.length === 0) continue;

      const sourceEntryIds = [...new Set(refRows.map((r) => r.source_entry_id))];
      const idList = sourceEntryIds.map((id) => `'${sqlEscape(id)}'`).join(",");
      const displayRows = q<{ entry_id: string; value: string }>(db,
        `SELECT ef.entry_id, ef.value FROM entry_fields ef JOIN fields f ON f.id = ef.field_id WHERE ef.entry_id IN (${idList}) AND f.name = '${sqlEscape(displayFieldName)}' AND f.object_id = '${sqlEscape(rrf.source_object_id)}'`);

      const displayMap: Record<string, string> = {};
      for (const row of displayRows) displayMap[row.entry_id] = row.value || row.entry_id;

      const entriesMap: Record<string, Array<{ id: string; label: string }>> = {};
      for (const row of refRows) {
        const targetIds = parseRelationValue(row.target_value);
        for (const targetId of targetIds) {
          if (!entriesMap[targetId]) entriesMap[targetId] = [];
          entriesMap[targetId].push({ id: row.source_entry_id, label: displayMap[row.source_entry_id] || row.source_entry_id });
        }
      }

      result.push({ fieldName: rrf.name, sourceObjectName: rrf.source_object_name, sourceObjectId: rrf.source_object_id, displayField: displayFieldName, entries: entriesMap });
    }
  }

  return result;
}

type EntryReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  links: Array<{ id: string; label: string }>;
};

function findReverseRelationsForEntry(objectId: string, entryId: string): EntryReverseRelation[] {
  const dbPaths = discoverDuckDBPaths();
  const result: EntryReverseRelation[] = [];

  for (const db of dbPaths) {
    const reverseFields = q<{ id: string; name: string; object_id: string; source_object_name: string }>(db,
      `SELECT f.id, f.name, f.object_id, o.name as source_object_name FROM fields f JOIN objects o ON o.id = f.object_id WHERE f.type = 'relation' AND f.related_object_id = '${sqlEscape(objectId)}'`);

    for (const rrf of reverseFields) {
      const refRows = q<{ source_entry_id: string; target_value: string }>(db,
        `SELECT ef.entry_id as source_entry_id, ef.value as target_value FROM entry_fields ef WHERE ef.field_id = '${sqlEscape(rrf.id)}' AND ef.value IS NOT NULL AND ef.value != ''`);

      const matchingSourceIds: string[] = [];
      for (const row of refRows) {
        const targetIds = parseRelationValue(row.target_value);
        if (targetIds.includes(entryId)) matchingSourceIds.push(row.source_entry_id);
      }
      if (matchingSourceIds.length === 0) continue;

      const sourceObj = q<ObjectRow>(db, `SELECT * FROM objects WHERE id = '${sqlEscape(rrf.object_id)}' LIMIT 1`);
      if (sourceObj.length === 0) continue;

      const sourceFields = q<FieldRow>(db, `SELECT * FROM fields WHERE object_id = '${sqlEscape(rrf.object_id)}' ORDER BY sort_order`);
      const displayFieldName = resolveDisplayField(sourceObj[0], sourceFields);

      const idList = matchingSourceIds.map((i) => `'${sqlEscape(i)}'`).join(",");
      const displayRows = q<{ entry_id: string; value: string }>(db,
        `SELECT ef.entry_id, ef.value FROM entry_fields ef JOIN fields f ON f.id = ef.field_id WHERE ef.entry_id IN (${idList}) AND f.name = '${sqlEscape(displayFieldName)}' AND f.object_id = '${sqlEscape(rrf.object_id)}'`);

      const displayMap: Record<string, string> = {};
      for (const row of displayRows) displayMap[row.entry_id] = row.value || row.entry_id;

      const links = matchingSourceIds.map((sid) => ({ id: sid, label: displayMap[sid] || sid }));
      result.push({ fieldName: rrf.name, sourceObjectName: rrf.source_object_name, sourceObjectId: rrf.object_id, displayField: displayFieldName, links });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tree building
// ---------------------------------------------------------------------------

function readObjectMeta(dirPath: string): { icon?: string; defaultView?: string } | null {
  const yamlPath = join(dirPath, ".object.yaml");
  if (!existsSync(yamlPath)) return null;
  try {
    const content = readFileSync(yamlPath, "utf-8");
    const parsed = parseSimpleYaml(content);
    return { icon: parsed.icon as string | undefined, defaultView: parsed.default_view as string | undefined };
  } catch { return null; }
}

function loadDbObjects(): Map<string, { name: string; icon?: string; default_view?: string }> {
  const map = new Map<string, { name: string; icon?: string; default_view?: string }>();
  const dbPaths = discoverDuckDBPaths();
  const bin = resolveDuckdbBin();
  if (!bin || dbPaths.length === 0) return map;

  for (const db of dbPaths) {
    try {
      const escapedSql = "SELECT name, icon, default_view FROM objects".replace(/'/g, "'\\''");
      const result = execSync(`'${bin}' -json '${db}' '${escapedSql}'`, {
        encoding: "utf-8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024, shell: "/bin/sh",
      });
      const trimmed = result.trim();
      if (!trimmed || trimmed === "[]") continue;
      const rows = JSON.parse(trimmed) as Array<{ name: string; icon?: string; default_view?: string }>;
      for (const row of rows) {
        if (!map.has(row.name)) map.set(row.name, row);
      }
    } catch { /* skip */ }
  }
  return map;
}

function buildTree(
  absDir: string,
  relativeBase: string,
  dbObjects: Map<string, { name: string; icon?: string; default_view?: string }>,
): TreeNode[] {
  const nodes: TreeNode[] = [];
  let entries: Dirent[];
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return nodes; }

  const sorted = entries
    .filter((e) => !e.name.startsWith(".") || e.name === ".object.yaml")
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    if (entry.name === ".object.yaml" || entry.name.startsWith(".")) continue;

    const absPath = join(absDir, entry.name);
    const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const objectMeta = readObjectMeta(absPath);
      const dbObject = dbObjects.get(entry.name);
      const children = buildTree(absPath, relPath, dbObjects);

      if (objectMeta || dbObject) {
        nodes.push({
          name: entry.name, path: relPath, type: "object",
          icon: objectMeta?.icon ?? dbObject?.icon,
          defaultView: ((objectMeta?.defaultView ?? dbObject?.default_view) as "table" | "kanban") ?? "table",
          children: children.length > 0 ? children : undefined,
        });
      } else {
        nodes.push({ name: entry.name, path: relPath, type: "folder", children: children.length > 0 ? children : undefined });
      }
    } else if (entry.isFile()) {
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const isReport = entry.name.endsWith(".report.json");
      const isDocument = ext === "md" || ext === "mdx";
      const isDatabase = isDatabaseFile(entry.name);
      nodes.push({ name: entry.name, path: relPath, type: isReport ? "report" : isDatabase ? "database" : isDocument ? "document" : "file" });
    }
  }

  return nodes;
}

function parseSkillFrontmatter(content: string): { name?: string; emoji?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (kv) result[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { name: result.name, emoji: result.emoji };
}

function buildSkillsVirtualFolder(): TreeNode | null {
  const home = homedir();
  const dir = join(home, ".openclaw", "skills");
  if (!existsSync(dir)) return null;

  const children: TreeNode[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillMdPath)) continue;

      let displayName = entry.name;
      try {
        const content = readFileSync(skillMdPath, "utf-8");
        const meta = parseSkillFrontmatter(content);
        if (meta.name) displayName = meta.name;
        if (meta.emoji) displayName = `${meta.emoji} ${displayName}`;
      } catch { /* skip */ }

      children.push({ name: displayName, path: `~skills/${entry.name}/SKILL.md`, type: "document", virtual: true });
    }
  } catch { return null; }

  if (children.length === 0) return null;
  children.sort((a, b) => a.name.localeCompare(b.name));
  return { name: "Skills", path: "~skills", type: "folder", virtual: true, children };
}

// ---------------------------------------------------------------------------
// Search index helpers
// ---------------------------------------------------------------------------

type SearchIndexItem = {
  id: string;
  label: string;
  sublabel?: string;
  kind: "file" | "object" | "entry";
  icon?: string;
  objectName?: string;
  entryId?: string;
  fields?: Record<string, string>;
  path?: string;
  nodeType?: "document" | "folder" | "file" | "report" | "database";
};

function flattenTree(
  absDir: string,
  relBase: string,
  dbObjects: Map<string, ObjectRow>,
  items: SearchIndexItem[],
) {
  let entries: Dirent[];
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absPath = join(absDir, entry.name);
    const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const dbObj = dbObjects.get(entry.name);
      const yamlPath = join(absPath, ".object.yaml");
      const hasYaml = existsSync(yamlPath);
      if (dbObj || hasYaml) {
        let icon: string | undefined;
        if (hasYaml) {
          try { icon = (parseSimpleYaml(readFileSync(yamlPath, "utf-8")).icon as string | undefined); } catch { /* ignore */ }
        }
        items.push({ id: relPath, label: entry.name, sublabel: relPath, kind: "object", icon: icon ?? dbObj?.icon, path: relPath });
      }
      flattenTree(absPath, relPath, dbObjects, items);
    } else if (entry.isFile()) {
      const isReport = entry.name.endsWith(".report.json");
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const isDocument = ext === "md" || ext === "mdx";
      const isDatabase = isDatabaseFile(entry.name);
      items.push({
        id: relPath, label: entry.name.replace(/\.md$/, ""), sublabel: relPath, kind: "file", path: relPath,
        nodeType: isReport ? "report" : isDatabase ? "database" : isDocument ? "document" : "file",
      });
    }
  }
}

async function buildEntryItems(): Promise<SearchIndexItem[]> {
  const items: SearchIndexItem[] = [];
  const dbPaths = discoverDuckDBPaths();
  if (dbPaths.length === 0) return [];

  const seenNames = new Set<string>();
  const objectsWithDb: Array<{ obj: ObjectRow; dbPath: string }> = [];

  for (const dbPath of dbPaths) {
    const objs = await duckdbQueryOnFileAsync<ObjectRow>(dbPath, "SELECT * FROM objects ORDER BY name");
    for (const obj of objs) {
      if (seenNames.has(obj.name)) continue;
      seenNames.add(obj.name);
      objectsWithDb.push({ obj, dbPath });
    }
  }

  for (const { obj, dbPath } of objectsWithDb) {
    const fields = await duckdbQueryOnFileAsync<FieldRow>(dbPath,
      `SELECT * FROM fields WHERE object_id = '${sqlEscape(obj.id)}' ORDER BY sort_order`);
    const displayField = resolveDisplayField(obj, fields);
    const previewFields = fields.filter((f) => !["relation", "richtext"].includes(f.type)).slice(0, 4);

    let entries: Record<string, unknown>[] = await duckdbQueryOnFileAsync(dbPath,
      `SELECT * FROM v_${obj.name} ORDER BY created_at DESC LIMIT 500`);

    if (entries.length === 0) {
      const rawRows = await duckdbQueryOnFileAsync<EavRow>(dbPath,
        `SELECT e.id as entry_id, e.created_at, e.updated_at, f.name as field_name, ef.value FROM entries e JOIN entry_fields ef ON ef.entry_id = e.id JOIN fields f ON f.id = ef.field_id WHERE e.object_id = '${sqlEscape(obj.id)}' ORDER BY e.created_at DESC LIMIT 2500`);
      const grouped = new Map<string, Record<string, unknown>>();
      for (const row of rawRows) {
        let entry = grouped.get(row.entry_id);
        if (!entry) { entry = { entry_id: row.entry_id }; grouped.set(row.entry_id, entry); }
        if (row.field_name) entry[row.field_name] = row.value;
      }
      entries = Array.from(grouped.values());
    }

    for (const entry of entries) {
      const entryId = dbStr(entry.entry_id);
      if (!entryId) continue;
      const displayValue = dbStr(entry[displayField]);
      const fieldPreview: Record<string, string> = {};
      for (const f of previewFields) {
        const val = entry[f.name];
        if (val != null && val !== "") fieldPreview[f.name] = dbStr(val);
      }
      items.push({
        id: `entry:${obj.name}:${entryId}`, label: displayValue || `(${obj.name} entry)`, sublabel: obj.name,
        kind: "entry", icon: obj.icon, objectName: obj.name, entryId,
        fields: Object.keys(fieldPreview).length > 0 ? fieldPreview : undefined,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Browse helpers
// ---------------------------------------------------------------------------

type BrowseNode = { name: string; path: string; type: "folder" | "file" | "document" | "database"; children?: BrowseNode[] };
const SKIP_DIRS = new Set(["node_modules", ".git", ".Trash", "__pycache__", ".cache"]);

function buildBrowseTree(absDir: string, maxDepth: number, currentDepth = 0): BrowseNode[] {
  if (currentDepth >= maxDepth) return [];
  let entries: Dirent[];
  try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return []; }

  const sorted = entries
    .filter((e) => !e.name.startsWith("."))
    .filter((e) => !(e.isDirectory() && SKIP_DIRS.has(e.name)))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  const nodes: BrowseNode[] = [];
  for (const entry of sorted) {
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      const children = buildBrowseTree(absPath, maxDepth, currentDepth + 1);
      nodes.push({ name: entry.name, path: absPath, type: "folder", children: children.length > 0 ? children : undefined });
    } else if (entry.isFile()) {
      const ext = entry.name.split(".").pop()?.toLowerCase();
      const isDocument = ext === "md" || ext === "mdx";
      const isDatabase = ext === "duckdb" || ext === "sqlite" || ext === "sqlite3" || ext === "db";
      nodes.push({ name: entry.name, path: absPath, type: isDatabase ? "database" : isDocument ? "document" : "file" });
    }
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Express Router
// ---------------------------------------------------------------------------

export function workspaceRoutes(_db: Db) {
  const router = Router();

  // -----------------------------------------------------------------------
  // GET /workspace/tree
  // -----------------------------------------------------------------------
  router.get("/workspace/tree", async (req, res) => {
    assertBoard(req);
    const home = homedir();
    const openclawDir = join(home, ".openclaw");
    const root = resolveWorkspaceRoot();

    if (!root) {
      const tree: TreeNode[] = [];
      const skillsFolder = buildSkillsVirtualFolder();
      if (skillsFolder) tree.push(skillsFolder);
      res.json({ tree, exists: false, workspaceRoot: null, openclawDir });
      return;
    }

    const dbObjects = loadDbObjects();
    const tree = buildTree(root, "", dbObjects);
    const skillsFolder = buildSkillsVirtualFolder();
    if (skillsFolder) tree.push(skillsFolder);
    res.json({ tree, exists: true, workspaceRoot: root, openclawDir });
  });

  // -----------------------------------------------------------------------
  // GET /workspace/browse
  // -----------------------------------------------------------------------
  router.get("/workspace/browse", async (req, res) => {
    assertBoard(req);
    let dir = req.query.dir as string | undefined;
    if (!dir) dir = resolveWorkspaceRoot() ?? undefined;
    if (!dir) { res.json({ entries: [], currentDir: "/", parentDir: null }); return; }

    const resolved = resolve(dir);
    const entries = buildBrowseTree(resolved, 3);
    const parentDir = resolved === "/" ? null : dirname(resolved);
    res.json({ entries, currentDir: resolved, parentDir });
  });

  // -----------------------------------------------------------------------
  // GET /workspace/file
  // -----------------------------------------------------------------------
  router.get("/workspace/file", async (req, res) => {
    assertBoard(req);
    const path = req.query.path as string | undefined;
    if (!path) { res.status(400).json({ error: "Missing 'path' query parameter" }); return; }

    const file = readWorkspaceFile(path);
    if (!file) { res.status(404).json({ error: "File not found or access denied" }); return; }
    res.json(file);
  });

  // -----------------------------------------------------------------------
  // PUT /workspace/file (write)
  // -----------------------------------------------------------------------
  router.put("/workspace/file", async (req, res) => {
    assertBoard(req);
    const { path: relPath, content } = req.body as { path?: string; content?: string };
    if (!relPath || typeof relPath !== "string" || typeof content !== "string") {
      res.status(400).json({ error: "Missing 'path' and 'content' fields" }); return;
    }

    const absPath = safeResolveNewPath(relPath);
    if (!absPath) { res.status(400).json({ error: "Invalid path or path traversal rejected" }); return; }

    try {
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, "utf-8");
      res.json({ ok: true, path: relPath });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Write failed" });
    }
  });

  // -----------------------------------------------------------------------
  // DELETE /workspace/file
  // -----------------------------------------------------------------------
  router.delete("/workspace/file", async (req, res) => {
    assertBoard(req);
    const { path: relPath } = req.body as { path?: string };
    if (!relPath || typeof relPath !== "string") { res.status(400).json({ error: "Missing 'path' field" }); return; }

    if (isSystemFile(relPath)) { res.status(403).json({ error: "Cannot delete system file" }); return; }

    const absPath = safeResolvePath(relPath);
    if (!absPath) { res.status(404).json({ error: "File not found or path traversal rejected" }); return; }

    try {
      const stat = statSync(absPath);
      rmSync(absPath, { recursive: stat.isDirectory() });
      res.json({ ok: true, path: relPath });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Delete failed" });
    }
  });

  // -----------------------------------------------------------------------
  // POST /workspace/db/query
  // -----------------------------------------------------------------------
  router.post("/workspace/db/query", async (req, res) => {
    assertBoard(req);
    const { path: relPath, sql } = req.body as { path?: string; sql?: string };
    if (!relPath || !sql) { res.status(400).json({ error: "Missing required `path` and `sql` fields" }); return; }

    const trimmedSql = sql.trim().toUpperCase();
    if (!trimmedSql.startsWith("SELECT") && !trimmedSql.startsWith("PRAGMA") && !trimmedSql.startsWith("DESCRIBE") && !trimmedSql.startsWith("SHOW") && !trimmedSql.startsWith("EXPLAIN") && !trimmedSql.startsWith("WITH")) {
      res.status(403).json({ error: "Only read-only queries are allowed" }); return;
    }

    const absPath = safeResolvePath(relPath);
    if (!absPath) { res.status(404).json({ error: "File not found or path traversal rejected" }); return; }

    const rows = duckdbQueryOnFile(absPath, sql);
    res.json({ rows, sql });
  });

  // -----------------------------------------------------------------------
  // GET /workspace/db/introspect
  // -----------------------------------------------------------------------
  router.get("/workspace/db/introspect", async (req, res) => {
    assertBoard(req);
    const relPath = req.query.path as string | undefined;
    if (!relPath) { res.status(400).json({ error: "Missing required `path` query parameter" }); return; }

    const absPath = safeResolvePath(relPath);
    if (!absPath) { res.status(404).json({ error: "File not found or path traversal rejected" }); return; }

    if (!resolveDuckdbBin()) { res.json({ tables: [], path: relPath, duckdb_available: false }); return; }

    const rawTables = duckdbQueryOnFile<{ table_name: string; table_type: string }>(absPath,
      "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name");
    if (rawTables.length === 0) { res.json({ tables: [], path: relPath }); return; }

    const tables: Array<{
      table_name: string; column_count: number; estimated_row_count: number;
      columns: Array<{ name: string; type: string; is_nullable: boolean }>;
    }> = [];

    for (const t of rawTables) {
      const cols = duckdbQueryOnFile<{ column_name: string; data_type: string; is_nullable: string }>(absPath,
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'main' AND table_name = '${t.table_name.replace(/'/g, "''")}' ORDER BY ordinal_position`);
      let rowCount = 0;
      try {
        const countResult = duckdbQueryOnFile<{ cnt: number }>(absPath, `SELECT count(*) as cnt FROM "${t.table_name.replace(/"/g, '""')}"`);
        rowCount = countResult[0]?.cnt ?? 0;
      } catch { /* skip */ }
      tables.push({
        table_name: t.table_name, column_count: cols.length, estimated_row_count: rowCount,
        columns: cols.map((c) => ({ name: c.column_name, type: c.data_type, is_nullable: c.is_nullable === "YES" })),
      });
    }

    res.json({ tables, path: relPath });
  });

  // -----------------------------------------------------------------------
  // GET /workspace/objects/:name
  // -----------------------------------------------------------------------
  router.get("/workspace/objects/:name", async (req, res) => {
    assertBoard(req);
    const { name } = req.params;

    if (!resolveDuckdbBin()) { res.status(503).json({ error: "DuckDB CLI is not installed", code: "DUCKDB_NOT_INSTALLED" }); return; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) { res.status(400).json({ error: "Invalid object name" }); return; }

    const dbFile = findDuckDBForObject(name);
    if (!dbFile) {
      if (!duckdbPath()) { res.status(404).json({ error: "DuckDB database not found" }); return; }
      res.status(404).json({ error: `Object '${name}' not found` }); return;
    }

    ensureDisplayFieldColumn(dbFile);

    const objects = q<ObjectRow>(dbFile, `SELECT * FROM objects WHERE name = '${name}' LIMIT 1`);
    if (objects.length === 0) { res.status(404).json({ error: `Object '${name}' not found` }); return; }
    const obj = objects[0];

    const fields = q<FieldRow>(dbFile, `SELECT * FROM fields WHERE object_id = '${obj.id}' ORDER BY sort_order`);
    const statuses = q<StatusRow>(dbFile, `SELECT * FROM statuses WHERE object_id = '${obj.id}' ORDER BY sort_order`);

    // Pagination
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200));
    const offset = (page - 1) * pageSize;
    const searchParam = req.query.search as string | undefined;

    let whereClause = "";
    let orderByClause = " ORDER BY created_at DESC";

    // Full-text search
    if (searchParam && searchParam.trim()) {
      const textFields = fields.filter((f) => ["text", "richtext", "email"].includes(f.type));
      if (textFields.length > 0) {
        const searchConditions = textFields
          .map((f) => `LOWER(CAST("${f.name.replace(/"/g, '""')}" AS VARCHAR)) LIKE '%${sqlEscape(searchParam.toLowerCase())}%'`)
          .join(" OR ");
        whereClause = ` WHERE (${searchConditions})`;
      }
    }

    const limitClause = ` LIMIT ${pageSize} OFFSET ${offset}`;

    let entries: Record<string, unknown>[] = [];
    try {
      entries = q(dbFile, `SELECT * FROM v_${name}${whereClause}${orderByClause}${limitClause}`);
    } catch {
      const rawRows = q<EavRow>(dbFile,
        `SELECT e.id as entry_id, e.created_at, e.updated_at, f.name as field_name, ef.value FROM entries e JOIN entry_fields ef ON ef.entry_id = e.id JOIN fields f ON f.id = ef.field_id WHERE e.object_id = '${obj.id}' ORDER BY e.created_at DESC LIMIT 5000`);
      entries = pivotEavRows(rawRows);
    }

    const parsedFields = fields.map((f) => ({
      ...f,
      enum_values: f.enum_values ? tryParseJson(f.enum_values) : undefined,
      enum_colors: f.enum_colors ? tryParseJson(f.enum_colors) : undefined,
    }));

    const { labels: relationLabels, relatedObjectNames } = resolveRelationLabels(dbFile, fields, entries);
    const enrichedFields = parsedFields.map((f) => ({
      ...f,
      related_object_name: f.type === "relation" ? relatedObjectNames[f.name] : undefined,
    }));

    const reverseRelations = findReverseRelations(obj.id);
    const effectiveDisplayField = resolveDisplayField(obj, fields);
    const { views: savedViews, activeView } = getObjectViews(name);

    res.json({ object: obj, fields: enrichedFields, statuses, entries, relationLabels, reverseRelations, effectiveDisplayField, savedViews, activeView });
  });

  // -----------------------------------------------------------------------
  // POST /workspace/objects/:name/entries (create entry)
  // -----------------------------------------------------------------------
  router.post("/workspace/objects/:name/entries", async (req, res) => {
    assertBoard(req);
    const { name } = req.params;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { res.status(400).json({ error: "Invalid object name" }); return; }

    const dbFile = findDuckDBForObject(name);
    if (!dbFile) { res.status(404).json({ error: "DuckDB not found" }); return; }

    const objects = duckdbQueryOnFile<{ id: string }>(dbFile, `SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`);
    if (objects.length === 0) { res.status(404).json({ error: `Object '${name}' not found` }); return; }
    const objectId = objects[0].id;

    const idRows = duckdbQueryOnFile<{ id: string }>(dbFile, "SELECT uuid()::VARCHAR as id");
    const entryId = idRows[0]?.id;
    if (!entryId) { res.status(500).json({ error: "Failed to generate UUID" }); return; }

    const now = new Date().toISOString();
    const ok = duckdbExecOnFile(dbFile, `INSERT INTO entries (id, object_id, created_at, updated_at) VALUES ('${sqlEscape(entryId)}', '${sqlEscape(objectId)}', '${now}', '${now}')`);
    if (!ok) { res.status(500).json({ error: "Failed to create entry" }); return; }

    const bodyFields: Record<string, string> = req.body?.fields ?? {};
    if (typeof bodyFields === "object") {
      const dbFields = duckdbQueryOnFile<{ id: string; name: string }>(dbFile, `SELECT id, name FROM fields WHERE object_id = '${sqlEscape(objectId)}'`);
      const fieldMap = new Map(dbFields.map((f) => [f.name, f.id]));
      for (const [fieldName, value] of Object.entries(bodyFields)) {
        const fieldId = fieldMap.get(fieldName);
        if (!fieldId || value == null) continue;
        duckdbExecOnFile(dbFile, `INSERT INTO entry_fields (entry_id, field_id, value) VALUES ('${sqlEscape(entryId)}', '${sqlEscape(fieldId)}', '${sqlEscape(String(value))}')`);
      }
    }

    res.status(201).json({ entryId, ok: true });
  });

  // -----------------------------------------------------------------------
  // GET /workspace/objects/:name/entries/:id
  // -----------------------------------------------------------------------
  router.get("/workspace/objects/:name/entries/:id", async (req, res) => {
    assertBoard(req);
    const { name, id } = req.params;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { res.status(400).json({ error: "Invalid object name" }); return; }
    if (!id || id.length > 64) { res.status(400).json({ error: "Invalid entry ID" }); return; }

    const dbFile = findDuckDBForObject(name);
    if (!dbFile) { res.status(404).json({ error: "DuckDB not found" }); return; }

    const objects = q<ObjectRow>(dbFile, `SELECT * FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`);
    if (objects.length === 0) { res.status(404).json({ error: `Object '${name}' not found` }); return; }
    const obj = objects[0];

    const fields = q<FieldRow>(dbFile, `SELECT * FROM fields WHERE object_id = '${sqlEscape(obj.id)}' ORDER BY sort_order`);
    const entryRows = q<{ entry_id: string; created_at: string; updated_at: string; field_name: string; value: string | null }>(dbFile,
      `SELECT e.id as entry_id, e.created_at, e.updated_at, f.name as field_name, ef.value FROM entries e JOIN entry_fields ef ON ef.entry_id = e.id JOIN fields f ON f.id = ef.field_id WHERE e.id = '${sqlEscape(id)}' AND e.object_id = '${sqlEscape(obj.id)}'`);

    if (entryRows.length === 0) {
      const exists = q<{ cnt: number }>(dbFile, `SELECT COUNT(*) as cnt FROM entries WHERE id = '${sqlEscape(id)}' AND object_id = '${sqlEscape(obj.id)}'`);
      if (!exists[0] || exists[0].cnt === 0) { res.status(404).json({ error: "Entry not found" }); return; }
    }

    const entry: Record<string, unknown> = { entry_id: id };
    for (const row of entryRows) {
      entry.created_at ??= row.created_at;
      entry.updated_at ??= row.updated_at;
      if (row.field_name) entry[row.field_name] = row.value;
    }

    const parsedFields = fields.map((f) => ({
      ...f,
      enum_values: f.enum_values ? tryParseJson(f.enum_values) : undefined,
      enum_colors: f.enum_colors ? tryParseJson(f.enum_colors) : undefined,
    }));

    const relationLabels: Record<string, Record<string, string>> = {};
    const relatedObjectNames: Record<string, string> = {};
    const relationFields = fields.filter((f) => f.type === "relation" && f.related_object_id);

    for (const rf of relationFields) {
      const relatedObjs = q<ObjectRow>(dbFile, `SELECT * FROM objects WHERE id = '${sqlEscape(rf.related_object_id!)}' LIMIT 1`);
      if (relatedObjs.length === 0) continue;
      const relObj = relatedObjs[0];
      relatedObjectNames[rf.name] = relObj.name;

      const val = entry[rf.name];
      if (val == null || val === "") { relationLabels[rf.name] = {}; continue; }
      const valStr = typeof val === "object" && val !== null ? JSON.stringify(val) : typeof val === "string" ? val : String(val);
      const ids = parseRelationValue(valStr);
      if (ids.length === 0) { relationLabels[rf.name] = {}; continue; }

      const relFields = q<FieldRow>(dbFile, `SELECT * FROM fields WHERE object_id = '${sqlEscape(relObj.id)}' ORDER BY sort_order`);
      const displayFieldName = resolveDisplayField(relObj, relFields);
      const idList = ids.map((i) => `'${sqlEscape(i)}'`).join(",");
      const displayRows = q<{ entry_id: string; value: string }>(dbFile,
        `SELECT e.id as entry_id, ef.value FROM entries e JOIN entry_fields ef ON ef.entry_id = e.id JOIN fields f ON f.id = ef.field_id WHERE e.id IN (${idList}) AND f.object_id = '${sqlEscape(relObj.id)}' AND f.name = '${sqlEscape(displayFieldName)}'`);
      const labelMap: Record<string, string> = {};
      for (const row of displayRows) labelMap[row.entry_id] = row.value || row.entry_id;
      for (const i of ids) { if (!labelMap[i]) labelMap[i] = i; }
      relationLabels[rf.name] = labelMap;
    }

    const enrichedFields = parsedFields.map((f) => ({
      ...f, related_object_name: f.type === "relation" ? relatedObjectNames[f.name] : undefined,
    }));
    const reverseRelations = findReverseRelationsForEntry(obj.id, id);
    const effectiveDisplayField = resolveDisplayField(obj, fields);
    res.json({ object: obj, fields: enrichedFields, entry, relationLabels, reverseRelations, effectiveDisplayField });
  });

  // -----------------------------------------------------------------------
  // PATCH /workspace/objects/:name/entries/:id
  // -----------------------------------------------------------------------
  router.patch("/workspace/objects/:name/entries/:id", async (req, res) => {
    assertBoard(req);
    const { name, id } = req.params;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { res.status(400).json({ error: "Invalid object name" }); return; }

    const dbFile = findDuckDBForObject(name);
    if (!dbFile) { res.status(404).json({ error: "DuckDB not found" }); return; }

    const objects = q<{ id: string }>(dbFile, `SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`);
    if (objects.length === 0) { res.status(404).json({ error: `Object '${name}' not found` }); return; }
    const objectId = objects[0].id;

    const exists = q<{ cnt: number }>(dbFile, `SELECT COUNT(*) as cnt FROM entries WHERE id = '${sqlEscape(id)}' AND object_id = '${sqlEscape(objectId)}'`);
    if (!exists[0] || exists[0].cnt === 0) { res.status(404).json({ error: "Entry not found" }); return; }

    const fieldUpdates: Record<string, string> = req.body.fields ?? {};
    const dbFields = q<{ id: string; name: string }>(dbFile, `SELECT id, name FROM fields WHERE object_id = '${sqlEscape(objectId)}'`);
    const fieldMap = new Map(dbFields.map((f) => [f.name, f.id]));

    let updatedCount = 0;
    for (const [fieldName, value] of Object.entries(fieldUpdates)) {
      const fieldId = fieldMap.get(fieldName);
      if (!fieldId) continue;
      const escapedValue = value == null ? "NULL" : `'${sqlEscape(String(value))}'`;
      const existingRows = q<{ cnt: number }>(dbFile, `SELECT COUNT(*) as cnt FROM entry_fields WHERE entry_id = '${sqlEscape(id)}' AND field_id = '${sqlEscape(fieldId)}'`);
      if (existingRows[0]?.cnt > 0) {
        duckdbExecOnFile(dbFile, `UPDATE entry_fields SET value = ${escapedValue} WHERE entry_id = '${sqlEscape(id)}' AND field_id = '${sqlEscape(fieldId)}'`);
      } else {
        duckdbExecOnFile(dbFile, `INSERT INTO entry_fields (entry_id, field_id, value) VALUES ('${sqlEscape(id)}', '${sqlEscape(fieldId)}', ${escapedValue})`);
      }
      updatedCount++;
    }

    const now = new Date().toISOString();
    duckdbExecOnFile(dbFile, `UPDATE entries SET updated_at = '${now}' WHERE id = '${sqlEscape(id)}'`);
    res.json({ ok: true, updatedCount });
  });

  // -----------------------------------------------------------------------
  // DELETE /workspace/objects/:name/entries/:id
  // -----------------------------------------------------------------------
  router.delete("/workspace/objects/:name/entries/:id", async (req, res) => {
    assertBoard(req);
    const { name, id } = req.params;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { res.status(400).json({ error: "Invalid object name" }); return; }

    const dbFile = findDuckDBForObject(name);
    if (!dbFile) { res.status(404).json({ error: "DuckDB not found" }); return; }

    const objects = q<{ id: string }>(dbFile, `SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`);
    if (objects.length === 0) { res.status(404).json({ error: `Object '${name}' not found` }); return; }
    const objectId = objects[0].id;

    duckdbExecOnFile(dbFile, `DELETE FROM entry_fields WHERE entry_id = '${sqlEscape(id)}'`);
    duckdbExecOnFile(dbFile, `DELETE FROM entries WHERE id = '${sqlEscape(id)}' AND object_id = '${sqlEscape(objectId)}'`);
    res.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // PATCH /workspace/objects/:name/fields/:fieldId (rename)
  // -----------------------------------------------------------------------
  router.patch("/workspace/objects/:name/fields/:fieldId", async (req, res) => {
    assertBoard(req);
    const { name, fieldId } = req.params;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { res.status(400).json({ error: "Invalid object name" }); return; }

    const dbFile = findDuckDBForObject(name);
    if (!dbFile) { res.status(404).json({ error: "DuckDB not found" }); return; }

    const newName: string = req.body.name;
    if (!newName || typeof newName !== "string" || newName.trim().length === 0) { res.status(400).json({ error: "Name is required" }); return; }

    const objects = duckdbQueryOnFile<{ id: string }>(dbFile, `SELECT id FROM objects WHERE name = '${sqlEscape(name)}' LIMIT 1`);
    if (objects.length === 0) { res.status(404).json({ error: `Object '${name}' not found` }); return; }
    const objectId = objects[0].id;

    const fieldExists = duckdbQueryOnFile<{ cnt: number }>(dbFile, `SELECT COUNT(*) as cnt FROM fields WHERE id = '${sqlEscape(fieldId)}' AND object_id = '${sqlEscape(objectId)}'`);
    if (!fieldExists[0] || fieldExists[0].cnt === 0) { res.status(404).json({ error: "Field not found" }); return; }

    const duplicateCheck = duckdbQueryOnFile<{ cnt: number }>(dbFile,
      `SELECT COUNT(*) as cnt FROM fields WHERE object_id = '${sqlEscape(objectId)}' AND name = '${sqlEscape(newName.trim())}' AND id != '${sqlEscape(fieldId)}'`);
    if (duplicateCheck[0]?.cnt > 0) { res.status(409).json({ error: "A field with that name already exists" }); return; }

    const ok = duckdbExecOnFile(dbFile, `UPDATE fields SET name = '${sqlEscape(newName.trim())}' WHERE id = '${sqlEscape(fieldId)}'`);
    if (!ok) { res.status(500).json({ error: "Failed to rename field" }); return; }
    res.json({ ok: true });
  });

  // -----------------------------------------------------------------------
  // GET /workspace/objects/:name/views
  // -----------------------------------------------------------------------
  router.get("/workspace/objects/:name/views", async (req, res) => {
    assertBoard(req);
    const objectName = decodeURIComponent(req.params.name);
    try {
      const { views, activeView } = getObjectViews(objectName);
      res.json({ views, activeView });
    } catch (err) {
      res.status(500).json({ error: `Failed to read views: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // -----------------------------------------------------------------------
  // PUT /workspace/objects/:name/views
  // -----------------------------------------------------------------------
  router.put("/workspace/objects/:name/views", async (req, res) => {
    assertBoard(req);
    const objectName = decodeURIComponent(req.params.name);
    try {
      const views: SavedView[] = req.body.views ?? [];
      const activeView: string | undefined = req.body.activeView;
      const ok = saveObjectViews(objectName, views, activeView);
      if (!ok) { res.status(404).json({ error: "Object directory not found" }); return; }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: `Failed to save views: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // -----------------------------------------------------------------------
  // GET /workspace/search-index
  // -----------------------------------------------------------------------
  router.get("/workspace/search-index", async (req, res) => {
    assertBoard(req);
    const items: SearchIndexItem[] = [];

    const root = resolveWorkspaceRoot();
    if (root) {
      const dbObjects = new Map<string, ObjectRow>();
      const objs = await duckdbQueryAllAsync<ObjectRow & { name: string }>("SELECT * FROM objects", "name");
      for (const o of objs) dbObjects.set(o.name, o);
      flattenTree(root, "", dbObjects, items);
    }

    const dbPaths = discoverDuckDBPaths();
    if (dbPaths.length > 0) {
      items.push(...await buildEntryItems());
    }

    res.json({ items });
  });

  // -----------------------------------------------------------------------
  // POST /workspace/reports/execute
  // -----------------------------------------------------------------------
  router.post("/workspace/reports/execute", async (req, res) => {
    assertBoard(req);
    const { sql } = req.body as { sql?: string };
    if (!sql || typeof sql !== "string") { res.status(400).json({ error: "Missing 'sql' field in request body" }); return; }

    const trimmedSql = sql.trim().toUpperCase();
    if (!trimmedSql.startsWith("SELECT") && !trimmedSql.startsWith("PRAGMA") && !trimmedSql.startsWith("DESCRIBE") && !trimmedSql.startsWith("SHOW") && !trimmedSql.startsWith("EXPLAIN") && !trimmedSql.startsWith("WITH")) {
      res.status(403).json({ error: "Only read-only queries are allowed" }); return;
    }

    try {
      const rows = await duckdbQueryAsync(sql);
      res.json({ rows, sql });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Query execution failed" });
    }
  });

  return router;
}
