import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Database,
  File,
  FileText,
  Folder,
  FolderOpen,
  Table2,
  Kanban,
  Plus,
  Search,
  Trash2,
  X,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import {
  workspaceApi,
  type TreeNode,
  type ObjectResponse,
  type ObjectField,
  type EntryResponse,
} from "@/api/workspace";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const wsKeys = {
  tree: ["workspace", "tree"] as const,
  object: (name: string, search?: string) => ["workspace", "object", name, search ?? ""] as const,
  entry: (objectName: string, entryId: string) => ["workspace", "entry", objectName, entryId] as const,
};

// ---------------------------------------------------------------------------
// Tree sidebar
// ---------------------------------------------------------------------------

function TreeItem({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onSelect: (node: TreeNode) => void;
  onToggle: (path: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const isObject = node.type === "object";
  const isFolder = node.type === "folder";
  const isDatabase = node.type === "database";
  const isDocument = node.type === "document";
  const isReport = node.type === "report";

  function getIcon() {
    if (node.icon) {
      return <span className="text-xs leading-none shrink-0">{node.icon}</span>;
    }
    if (isObject) {
      return node.defaultView === "kanban"
        ? <Kanban className="h-3.5 w-3.5 shrink-0 text-purple-500" />
        : <Table2 className="h-3.5 w-3.5 shrink-0 text-blue-500" />;
    }
    if (isDatabase) return <Database className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
    if (isReport) return <BarChart3 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
    if (isDocument) return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
    if (isFolder) {
      return isExpanded
        ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        : <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
    }
    return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }

  return (
    <>
      <button
        className={`flex items-center gap-1.5 w-full text-left py-1 px-2 text-[13px] rounded-sm transition-colors hover:bg-accent/50 ${
          isSelected ? "bg-accent text-accent-foreground" : "text-foreground/80"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (hasChildren) onToggle(node.path);
          onSelect(node);
        }}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {getIcon()}
        <span className="truncate">{node.name.replace(/\.md$/, "")}</span>
      </button>
      {hasChildren && isExpanded && node.children!.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function WorkspaceTree({
  selectedPath,
  onSelect,
}: {
  selectedPath: string | null;
  onSelect: (node: TreeNode) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: wsKeys.tree,
    queryFn: () => workspaceApi.getTree(),
  });

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Auto-expand objects on first load
  useEffect(() => {
    if (data?.tree) {
      const toExpand = new Set<string>();
      for (const node of data.tree) {
        if (node.type === "object" || node.type === "folder") {
          toExpand.add(node.path);
        }
      }
      setExpandedPaths(toExpand);
    }
  }, [data?.tree]);

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (isLoading) {
    return (
      <div className="p-3 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }

  if (!data?.exists) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p>No workspace found.</p>
        <p className="mt-1 text-xs">Set <code className="bg-muted px-1 rounded">ELAV_WORKSPACE</code> env var or create <code className="bg-muted px-1 rounded">~/.openclaw/workspace/</code></p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {data.tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onSelect={onSelect}
          onToggle={handleToggle}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry detail modal
// ---------------------------------------------------------------------------

function EntryDetailModal({
  objectName,
  entryId,
  open,
  onClose,
  onDeleted,
}: {
  objectName: string;
  entryId: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: wsKeys.entry(objectName, entryId),
    queryFn: () => workspaceApi.getEntry(objectName, entryId),
    enabled: open && !!entryId,
  });

  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const updateMutation = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) =>
      workspaceApi.updateEntry(objectName, entryId, { [field]: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wsKeys.entry(objectName, entryId) });
      queryClient.invalidateQueries({ queryKey: ["workspace", "object", objectName] });
      setEditingField(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => workspaceApi.deleteEntry(objectName, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", "object", objectName] });
      onDeleted();
    },
  });

  function renderFieldValue(field: ObjectField, value: unknown) {
    if (value == null || value === "") return <span className="text-muted-foreground italic">Empty</span>;

    if (field.type === "enum") {
      const colors = (field.enum_colors as Record<string, string> | undefined) ?? {};
      const color = colors[String(value)];
      return (
        <Badge variant="outline" style={color ? { borderColor: color, color } : undefined}>
          {String(value)}
        </Badge>
      );
    }

    if (field.type === "boolean") {
      return <Badge variant={value === "true" ? "default" : "outline"}>{value === "true" ? "Yes" : "No"}</Badge>;
    }

    if (field.type === "relation" && data?.relationLabels?.[field.name]) {
      const labels = data.relationLabels[field.name];
      const ids = String(value).startsWith("[")
        ? (() => { try { return JSON.parse(String(value)); } catch { return [String(value)]; } })()
        : [String(value)];
      return (
        <div className="flex flex-wrap gap-1">
          {ids.map((id: string) => (
            <Badge key={id} variant="secondary" className="text-xs">{labels[id] || id}</Badge>
          ))}
        </div>
      );
    }

    const strVal = String(value);
    if (strVal.length > 200) return <span className="text-sm">{strVal.slice(0, 200)}...</span>;
    return <span className="text-sm">{strVal}</span>;
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {data?.object?.icon && <span>{data.object.icon}</span>}
            {data ? (
              String(data.entry[data.effectiveDisplayField] || `${objectName} entry`)
            ) : (
              "Loading..."
            )}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : data ? (
          <div className="space-y-4 py-2">
            {data.fields.map((field) => {
              const value = data.entry[field.name];
              const isEditing = editingField === field.name;

              return (
                <div key={field.id} className="grid grid-cols-3 gap-3 items-start">
                  <div className="text-sm font-medium text-muted-foreground pt-1">
                    {field.name}
                    <span className="ml-1 text-xs text-muted-foreground/60">({field.type})</span>
                  </div>
                  <div className="col-span-2">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateMutation.mutate({ field: field.name, value: editValue });
                            if (e.key === "Escape") setEditingField(null);
                          }}
                        />
                        <Button size="sm" variant="ghost" onClick={() => setEditingField(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        className="text-left w-full hover:bg-accent/30 rounded px-2 py-1 -mx-2 -my-1 transition-colors"
                        onClick={() => {
                          setEditingField(field.name);
                          setEditValue(value != null ? String(value) : "");
                        }}
                      >
                        {renderFieldValue(field, value)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Reverse relations */}
            {data.reverseRelations && (data.reverseRelations as Array<{ fieldName: string; sourceObjectName: string; links: Array<{ id: string; label: string }> }>).length > 0 && (
              <div className="border-t pt-4 mt-4">
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Referenced by</h4>
                {(data.reverseRelations as Array<{ fieldName: string; sourceObjectName: string; links: Array<{ id: string; label: string }> }>).map((rr, i) => (
                  <div key={i} className="mb-2">
                    <span className="text-xs text-muted-foreground">{rr.sourceObjectName}.{rr.fieldName}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rr.links.map((link) => (
                        <Badge key={link.id} variant="secondary" className="text-xs">{link.label}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t pt-4 mt-4 flex justify-between items-center">
              <div className="text-xs text-muted-foreground">
                ID: {String(data.entry.entry_id)}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (window.confirm("Delete this entry?")) deleteMutation.mutate();
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Object data table
// ---------------------------------------------------------------------------

function ObjectDataTable({
  objectName,
}: {
  objectName: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: wsKeys.object(objectName, search),
    queryFn: () => workspaceApi.getObject(objectName, { search: search || undefined }),
  });

  const createMutation = useMutation({
    mutationFn: () => workspaceApi.createEntry(objectName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", "object", objectName] });
    },
  });

  const fields = data?.fields ?? [];
  const entries = data?.entries ?? [];
  const displayField = data?.effectiveDisplayField ?? "id";
  const statuses = data?.statuses ?? [];

  // Visible columns: display field first, then up to 5 more
  const visibleFields = useMemo(() => {
    const display = fields.find((f) => f.name === displayField);
    const others = fields.filter((f) => f.name !== displayField && f.type !== "richtext").slice(0, 5);
    return display ? [display, ...others] : others.slice(0, 6);
  }, [fields, displayField]);

  function renderCell(field: ObjectField, value: unknown) {
    if (value == null || value === "") return <span className="text-muted-foreground">-</span>;

    if (field.type === "enum") {
      const colors = (field.enum_colors as Record<string, string> | undefined) ?? {};
      const color = colors[String(value)];
      return (
        <Badge variant="outline" className="text-[11px]" style={color ? { borderColor: color, color } : undefined}>
          {String(value)}
        </Badge>
      );
    }

    if (field.type === "boolean") {
      return <span className="text-xs">{value === "true" ? "Yes" : "No"}</span>;
    }

    if (field.type === "relation" && data?.relationLabels?.[field.name]) {
      const labels = data.relationLabels[field.name];
      const ids = String(value).startsWith("[")
        ? (() => { try { return JSON.parse(String(value)); } catch { return [String(value)]; } })()
        : [String(value)];
      return (
        <span className="text-xs">{ids.map((id: string) => labels[id] || id).join(", ")}</span>
      );
    }

    const strVal = String(value);
    return <span className="text-sm truncate max-w-[200px] block">{strVal.length > 80 ? strVal.slice(0, 80) + "..." : strVal}</span>;
  }

  // Kanban view
  const showKanban = data?.object?.default_view === "kanban" && statuses.length > 0;

  if (showKanban) {
    const statusField = fields.find((f) => f.type === "enum" && f.name.toLowerCase().includes("status"));
    const groupField = statusField?.name ?? statuses.length > 0 ? "status" : null;

    // Group entries by status
    const columns = new Map<string, Record<string, unknown>[]>();
    for (const s of statuses) columns.set(s.name, []);
    columns.set("(none)", []);

    for (const entry of entries) {
      const statusVal = groupField ? String(entry[groupField] ?? "") : "";
      const col = columns.get(statusVal) ?? columns.get("(none)")!;
      col.push(entry);
    }

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            {data?.object?.icon && <span className="text-lg">{data.object.icon}</span>}
            <h2 className="text-lg font-semibold">{objectName}</h2>
            <Badge variant="secondary" className="text-xs">{entries.length} entries</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New
          </Button>
        </div>
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 min-h-0" style={{ minWidth: `${columns.size * 280}px` }}>
            {Array.from(columns.entries()).map(([statusName, items]) => {
              if (items.length === 0 && statusName === "(none)") return null;
              const statusDef = statuses.find((s) => s.name === statusName);
              return (
                <div key={statusName} className="flex flex-col w-[260px] shrink-0">
                  <div className="flex items-center gap-2 px-2 py-1.5 mb-2">
                    {statusDef?.color && <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: statusDef.color }} />}
                    <span className="text-sm font-medium">{statusName}</span>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    {items.map((entry) => {
                      const entryId = String(entry.entry_id ?? entry.id ?? "");
                      const title = String(entry[displayField] ?? "(untitled)");
                      return (
                        <button
                          key={entryId}
                          className="text-left p-3 bg-card border border-border rounded-lg hover:border-foreground/20 transition-colors"
                          onClick={() => setSelectedEntryId(entryId)}
                        >
                          <div className="text-sm font-medium truncate">{title}</div>
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {fields.filter((f) => f.name !== displayField && f.name !== groupField && f.type !== "richtext" && f.type !== "relation").slice(0, 2).map((f) => {
                              const val = entry[f.name];
                              if (val == null || val === "") return null;
                              return (
                                <span key={f.name} className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                                  {String(val)}
                                </span>
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {selectedEntryId && (
          <EntryDetailModal
            objectName={objectName}
            entryId={selectedEntryId}
            open={!!selectedEntryId}
            onClose={() => setSelectedEntryId(null)}
            onDeleted={() => setSelectedEntryId(null)}
          />
        )}
      </div>
    );
  }

  // Table view (default)
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          {data?.object?.icon && <span className="text-lg">{data.object.icon}</span>}
          <h2 className="text-lg font-semibold">{objectName}</h2>
          <Badge variant="secondary" className="text-xs">{entries.length} entries</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 pl-8 text-sm"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Table2 className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">No entries yet</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => createMutation.mutate()}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Create first entry
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background border-b">
              <tr>
                {visibleFields.map((field) => (
                  <th key={field.id} className="text-left px-4 py-2 font-medium text-muted-foreground text-xs whitespace-nowrap">
                    {field.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const entryId = String(entry.entry_id ?? entry.id ?? "");
                return (
                  <tr
                    key={entryId}
                    className="border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedEntryId(entryId)}
                  >
                    {visibleFields.map((field) => (
                      <td key={field.id} className="px-4 py-2 max-w-[250px]">
                        {renderCell(field, entry[field.name])}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedEntryId && (
        <EntryDetailModal
          objectName={objectName}
          entryId={selectedEntryId}
          open={!!selectedEntryId}
          onClose={() => setSelectedEntryId(null)}
          onDeleted={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File viewer (simple)
// ---------------------------------------------------------------------------

function FileViewer({ path }: { path: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["workspace", "file", path],
    queryFn: () => workspaceApi.getFile(path),
    enabled: !!path,
  });

  if (isLoading) return <div className="p-4"><Skeleton className="h-40 w-full" /></div>;
  if (!data) return <div className="p-4 text-muted-foreground text-sm">File not found</div>;

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">{path.split("/").pop()}</h2>
      <pre className="text-sm bg-muted/30 border border-border rounded-lg p-4 overflow-auto max-h-[70vh] whitespace-pre-wrap">
        {data.content}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function WorkspaceEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <Database className="h-12 w-12 mb-4 opacity-20" />
      <p className="text-sm">Select an object or file from the tree</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Workspace page
// ---------------------------------------------------------------------------

export function Workspace() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Workspace" }]);
  }, [setBreadcrumbs]);

  const handleSelect = useCallback((node: TreeNode) => {
    setSelectedNode(node);
  }, []);

  function renderMainContent() {
    if (!selectedNode) return <WorkspaceEmptyState />;

    if (selectedNode.type === "object") {
      return <ObjectDataTable objectName={selectedNode.name} />;
    }

    if (selectedNode.type === "document" || selectedNode.type === "file") {
      if (selectedNode.virtual) {
        return (
          <div className="p-4 text-sm text-muted-foreground">
            Virtual files cannot be displayed here.
          </div>
        );
      }
      return <FileViewer path={selectedNode.path} />;
    }

    if (selectedNode.type === "folder") {
      return (
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-2">{selectedNode.name}</h2>
          <p className="text-sm text-muted-foreground">
            Folder with {selectedNode.children?.length ?? 0} items
          </p>
        </div>
      );
    }

    if (selectedNode.type === "database") {
      return (
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-2">{selectedNode.name}</h2>
          <p className="text-sm text-muted-foreground">Database file</p>
        </div>
      );
    }

    return <WorkspaceEmptyState />;
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel: tree */}
      <div className="w-56 shrink-0 border-r border-border overflow-y-auto">
        <div className="px-3 py-2 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Workspace</span>
        </div>
        <ScrollArea className="h-[calc(100%-36px)]">
          <WorkspaceTree
            selectedPath={selectedNode?.path ?? null}
            onSelect={handleSelect}
          />
        </ScrollArea>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {renderMainContent()}
      </div>
    </div>
  );
}
