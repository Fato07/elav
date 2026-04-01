import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, normalize, relative } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Saved view types (subset of object-filters)
// ---------------------------------------------------------------------------

export type SavedView = {
  name: string;
  filters?: unknown;
  sort?: unknown;
  columns?: string[];
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Workspace root resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the workspace directory, checking in order:
 * 1. ELAV_WORKSPACE env var
 * 2. OPENCLAW_WORKSPACE env var
 * 3. ~/.openclaw/workspace/
 */
export function resolveWorkspaceRoot(): string | null {
  const candidates = [
    process.env.ELAV_WORKSPACE,
    process.env.OPENCLAW_WORKSPACE,
    join(homedir(), ".elav", "workspace"),
    join(homedir(), ".openclaw", "workspace"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hierarchical DuckDB discovery
// ---------------------------------------------------------------------------

/**
 * Recursively discover all workspace.duckdb files under `root`.
 * Returns absolute paths sorted by depth (shallowest first).
 */
export function discoverDuckDBPaths(root?: string): string[] {
  const wsRoot = root ?? resolveWorkspaceRoot();
  if (!wsRoot) return [];

  const results: Array<{ path: string; depth: number }> = [];

  function walk(dir: string, depth: number) {
    const dbFile = join(dir, "workspace.duckdb");
    if (existsSync(dbFile)) {
      results.push({ path: dbFile, depth });
    }
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        if (entry.name === "tmp" || entry.name === "exports" || entry.name === "node_modules") continue;
        walk(join(dir, entry.name), depth + 1);
      }
    } catch {
      // unreadable directory
    }
  }

  walk(wsRoot, 0);
  results.sort((a, b) => a.depth - b.depth);
  return results.map((r) => r.path);
}

/**
 * Path to the primary DuckDB database file.
 */
export function duckdbPath(): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) return null;

  const rootDb = join(root, "workspace.duckdb");
  if (existsSync(rootDb)) return rootDb;

  const all = discoverDuckDBPaths(root);
  return all.length > 0 ? all[0] : null;
}

// ---------------------------------------------------------------------------
// DuckDB CLI binary resolution
// ---------------------------------------------------------------------------

export function resolveDuckdbBin(): string | null {
  const home = homedir();
  const candidates = [
    join(home, ".duckdb", "cli", "latest", "duckdb"),
    join(home, ".local", "bin", "duckdb"),
    "/opt/homebrew/bin/duckdb",
    "/usr/local/bin/duckdb",
    "/usr/bin/duckdb",
  ];

  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }

  try {
    execSync("which duckdb", { encoding: "utf-8", timeout: 2000 });
    return "duckdb";
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DuckDB query helpers (async preferred for Express handlers)
// ---------------------------------------------------------------------------

export async function duckdbQueryAsync<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const db = duckdbPath();
  if (!db) return [];

  const bin = resolveDuckdbBin();
  if (!bin) return [];

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(`'${bin}' -json '${db}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/sh",
    });

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

export async function duckdbQueryAllAsync<T = Record<string, unknown>>(
  sql: string,
  dedupeKey?: keyof T,
): Promise<T[]> {
  const dbPaths = discoverDuckDBPaths();
  if (dbPaths.length === 0) return [];

  const bin = resolveDuckdbBin();
  if (!bin) return [];

  const seen = new Set<unknown>();
  const merged: T[] = [];

  for (const db of dbPaths) {
    try {
      const escapedSql = sql.replace(/'/g, "'\\''");
      const { stdout } = await execAsync(`'${bin}' -json '${db}' '${escapedSql}'`, {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 10 * 1024 * 1024,
        shell: "/bin/sh",
      });
      const trimmed = stdout.trim();
      if (!trimmed || trimmed === "[]") continue;
      const rows = JSON.parse(trimmed) as T[];
      for (const row of rows) {
        if (dedupeKey) {
          const key = row[dedupeKey];
          if (seen.has(key)) continue;
          seen.add(key);
        }
        merged.push(row);
      }
    } catch {
      // skip failing DBs
    }
  }

  return merged;
}

/**
 * Find the DuckDB file that contains a specific object by name.
 */
export function findDuckDBForObject(objectName: string): string | null {
  const dbPaths = discoverDuckDBPaths();
  if (dbPaths.length === 0) return null;

  const bin = resolveDuckdbBin();
  if (!bin) return null;

  const sql = `SELECT id FROM objects WHERE name = '${objectName.replace(/'/g, "''")}' LIMIT 1`;
  const escapedSql = sql.replace(/'/g, "'\\''");

  for (const db of dbPaths) {
    try {
      const result = execSync(
        `'${bin}' -json '${db}' '${escapedSql}'`,
        { encoding: "utf-8", timeout: 5_000, maxBuffer: 1024 * 1024, shell: "/bin/sh" },
      );
      const trimmed = result.trim();
      if (trimmed && trimmed !== "[]") return db;
    } catch {
      // continue to next DB
    }
  }

  return null;
}

/**
 * Execute a DuckDB query against an arbitrary database file.
 */
export function duckdbQueryOnFile<T = Record<string, unknown>>(
  dbFilePath: string,
  sql: string,
): T[] {
  const bin = resolveDuckdbBin();
  if (!bin) return [];

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    const result = execSync(`'${bin}' -json '${dbFilePath}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/sh",
    });

    const trimmed = result.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

export async function duckdbQueryOnFileAsync<T = Record<string, unknown>>(
  dbFilePath: string,
  sql: string,
): Promise<T[]> {
  const bin = resolveDuckdbBin();
  if (!bin) return [];

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(`'${bin}' -json '${dbFilePath}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 15_000,
      maxBuffer: 10 * 1024 * 1024,
      shell: "/bin/sh",
    });

    const trimmed = stdout.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as T[];
  } catch {
    return [];
  }
}

/**
 * Execute a DuckDB statement (no JSON output).
 */
export function duckdbExecOnFile(dbFilePath: string, sql: string): boolean {
  const bin = resolveDuckdbBin();
  if (!bin) return false;

  try {
    const escapedSql = sql.replace(/'/g, "'\\''");
    execSync(`'${bin}' '${dbFilePath}' '${escapedSql}'`, {
      encoding: "utf-8",
      timeout: 10_000,
      shell: "/bin/sh",
    });
    return true;
  } catch {
    return false;
  }
}

export function duckdbExec(sql: string): boolean {
  const db = duckdbPath();
  if (!db) return false;
  return duckdbExecOnFile(db, sql);
}

// ---------------------------------------------------------------------------
// Relation parsing
// ---------------------------------------------------------------------------

export function parseRelationValue(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // not valid JSON array
    }
  }

  return [trimmed];
}

// ---------------------------------------------------------------------------
// Database file extensions
// ---------------------------------------------------------------------------

export const DB_EXTENSIONS = new Set(["duckdb", "sqlite", "sqlite3", "db", "postgres"]);

export function isDatabaseFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? DB_EXTENSIONS.has(ext) : false;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

export function safeResolvePath(relativePath: string): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) return null;

  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) return null;

  const absolute = resolve(root, normalized);
  if (!absolute.startsWith(resolve(root))) return null;
  if (!existsSync(absolute)) return null;

  return absolute;
}

export function safeResolveNewPath(relativePath: string): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) return null;

  const normalized = normalize(relativePath);
  if (normalized.startsWith("..") || normalized.includes("/../")) return null;

  const absolute = resolve(root, normalized);
  if (!absolute.startsWith(resolve(root))) return null;

  return absolute;
}

// ---------------------------------------------------------------------------
// System file protection
// ---------------------------------------------------------------------------

const ALWAYS_SYSTEM_PATTERNS = [/^\.object\.yaml$/, /\.wal$/, /\.tmp$/];
const ROOT_ONLY_SYSTEM_PATTERNS = [/^workspace\.duckdb/, /^workspace_context\.yaml$/];

export function isSystemFile(relativePath: string): boolean {
  const base = relativePath.split("/").pop() ?? "";
  if (ALWAYS_SYSTEM_PATTERNS.some((p) => p.test(base))) return true;
  const isRoot = !relativePath.includes("/");
  return isRoot && ROOT_ONLY_SYSTEM_PATTERNS.some((p) => p.test(base));
}

// ---------------------------------------------------------------------------
// YAML parsing helpers
// ---------------------------------------------------------------------------

export function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    if (line.trim().startsWith("#") || !line.trim()) continue;

    const match = line.match(/^(\w[\w_-]*)\s*:\s*(.+)/);
    if (match) {
      const key = match[1];
      let value: unknown = match[2].trim();

      if (
        typeof value === "string" &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = (value as string).slice(1, -1);
      }

      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null") value = null;
      else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
        value = Number(value);
      }

      result[key] = value;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// .object.yaml support
// ---------------------------------------------------------------------------

export type ObjectYamlConfig = {
  icon?: string;
  default_view?: string;
  views?: SavedView[];
  active_view?: string;
  [key: string]: unknown;
};

export function parseObjectYaml(content: string): ObjectYamlConfig {
  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ObjectYamlConfig;
  } catch {
    return parseSimpleYaml(content) as ObjectYamlConfig;
  }
}

export function readObjectYaml(objectDir: string): ObjectYamlConfig | null {
  const yamlPath = join(objectDir, ".object.yaml");
  if (!existsSync(yamlPath)) return null;
  const raw = readFileSync(yamlPath, "utf-8");
  return parseObjectYaml(raw);
}

export function writeObjectYaml(objectDir: string, config: ObjectYamlConfig): void {
  const yamlPath = join(objectDir, ".object.yaml");

  let existing: ObjectYamlConfig = {};
  if (existsSync(yamlPath)) {
    try {
      existing = parseObjectYaml(readFileSync(yamlPath, "utf-8"));
    } catch {
      existing = {};
    }
  }

  const merged = { ...existing, ...config };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }

  const yamlStr = YAML.stringify(merged, { indent: 2, lineWidth: 0 });
  writeFileSync(yamlPath, yamlStr, "utf-8");
}

export function findObjectDir(objectName: string): string | null {
  const root = resolveWorkspaceRoot();
  if (!root) return null;

  const direct = join(root, objectName);
  if (existsSync(direct) && existsSync(join(direct, ".object.yaml"))) {
    return direct;
  }

  try {
    const entries = readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = join(root, entry.name);
      if (entry.name === objectName && existsSync(join(subDir, ".object.yaml"))) {
        return subDir;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export function getObjectViews(objectName: string): {
  views: SavedView[];
  activeView: string | undefined;
} {
  const dir = findObjectDir(objectName);
  if (!dir) return { views: [], activeView: undefined };

  const config = readObjectYaml(dir);
  if (!config) return { views: [], activeView: undefined };

  return {
    views: config.views ?? [],
    activeView: config.active_view,
  };
}

export function saveObjectViews(
  objectName: string,
  views: SavedView[],
  activeView?: string,
): boolean {
  const dir = findObjectDir(objectName);
  if (!dir) return false;

  writeObjectYaml(dir, {
    views: views.length > 0 ? views : undefined,
    active_view: activeView,
  });
  return true;
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

export function readWorkspaceFile(
  relativePath: string,
): { content: string; type: "markdown" | "yaml" | "text" } | null {
  const absolute = safeResolvePath(relativePath);
  if (!absolute) return null;

  try {
    const content = readFileSync(absolute, "utf-8");
    const ext = relativePath.split(".").pop()?.toLowerCase();

    let type: "markdown" | "yaml" | "text" = "text";
    if (ext === "md" || ext === "mdx") type = "markdown";
    else if (ext === "yaml" || ext === "yml") type = "yaml";

    return { content, type };
  } catch {
    return null;
  }
}
