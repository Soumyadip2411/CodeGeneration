/**
 * CodeViewSection - browse generated code from Blob storage.
 *
 * Shows:
 * - Folder tree (left panel)
 * - File content viewer (right panel, read-only with syntax detection)
 * - Export ZIP button
 */
import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  Folder, File, Download, Loader2, Code2, ChevronRight, ChevronDown, Copy,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { getArtifactTree, getArtifactFile, exportZip } from '../../api/codegen';
import { useToast } from '../../contexts/ToastContext';

/** Map file extension to Monaco language ID */
function getLanguageFromPath(filePath) {
  if (!filePath) return 'plaintext';
  const name = filePath.split('/').pop();
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const map = {
    py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown', html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less', xml: 'xml', sql: 'sql',
    sh: 'shell', bash: 'shell', bat: 'bat', ps1: 'powershell',
    toml: 'ini', ini: 'ini', cfg: 'ini', txt: 'plaintext',
    dockerfile: 'dockerfile', graphql: 'graphql', r: 'r',
  };
  if (name.toLowerCase() === 'dockerfile') return 'dockerfile';
  if (name.toLowerCase() === 'makefile') return 'plaintext';
  return map[ext] || 'plaintext';
}

/** Build a nested tree structure from flat paths */
function buildTree(paths) {
  const root = { name: '', children: {}, files: [] };
  for (const item of paths) {
    const parts = item.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) {
        node.children[parts[i]] = { name: parts[i], children: {}, files: [] };
      }
      node = node.children[parts[i]];
    }
    node.files.push({ name: parts[parts.length - 1], path: item.path });
  }
  return root;
}

/** Wrapper that renders a folder header + children */
function FolderNode({ name, node, depth, selectedPath, onSelect }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const dirs = Object.entries(node.children).sort(([a], [b]) => a.localeCompare(b));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-xs hover:bg-secondary/70 rounded transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Folder size={12} className="text-primary/70" />
        <span className="text-foreground/80">{name}</span>
      </button>
      {expanded && (
        <div>
          {dirs.map(([childName, child]) => (
            <FolderNode key={childName} name={childName} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
          ))}
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => onSelect(f.path)}
              className={cn(
                'flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded transition-colors',
                selectedPath === f.path ? 'bg-primary/20 text-primary' : 'hover:bg-secondary/70 text-muted-foreground'
              )}
              style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}
            >
              <File size={11} />
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RootTree({ treeData, selectedPath, onSelect }) {
  const dirs = Object.entries(treeData.children).sort(([a], [b]) => a.localeCompare(b));
  const files = [...treeData.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      {dirs.map(([name, child]) => (
        <FolderNode key={name} name={name} node={child} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
      ))}
      {files.map((f) => (
        <button
          key={f.path}
          onClick={() => onSelect(f.path)}
          className={cn(
            'flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded transition-colors',
            selectedPath === f.path ? 'bg-primary/20 text-primary' : 'hover:bg-secondary/70 text-muted-foreground'
          )}
          style={{ paddingLeft: '20px' }}
        >
          <File size={11} />
          <span className="truncate">{f.name}</span>
        </button>
      ))}
    </div>
  );
}

export default function CodeViewSection({ workflow }) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const runId = workflow.latest_run_id;
  const isCompleted = workflow.status === 'completed';
  const isCancelled = workflow.status === 'cancelled';
  const isFailed = workflow.status === 'failed';

  useEffect(() => {
    if (!runId || !isCompleted) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getArtifactTree(runId)
      .then((t) => { setTree(t); if (t.length > 0) setSelectedPath(t[0].path); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [runId, isCompleted]);

  useEffect(() => {
    if (!selectedPath || !runId) return;
    setFileLoading(true);
    getArtifactFile(runId, selectedPath)
      .then(setFileContent)
      .catch(() => setFileContent('// Failed to load file'))
      .finally(() => setFileLoading(false));
  }, [selectedPath, runId]);

  const handleExport = async () => {
    if (!runId) return;
    setExporting(true);
    try {
      const blob = await exportZip(runId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codegen-${runId.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('ZIP downloaded');
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Code2 className="w-10 h-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Generated Code</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Start a code generation run to see generated files here.
        </p>
      </div>
    );
  }

  if (isCancelled || isFailed) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Code2 className="w-10 h-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">
          Run {isCancelled ? 'Cancelled' : 'Failed'}
        </h3>
        <p className="text-sm text-muted-foreground mt-2">
          {isCancelled
            ? 'The run was cancelled. Re-run code generation to produce files.'
            : 'The run failed. Check the Progress tab for details and re-run.'}
        </p>
      </div>
    );
  }

  if (!isCompleted) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <h3 className="text-lg font-medium text-foreground">Fetching Generated Code...</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Code generation is in progress. Files will appear here once the run completes.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Code2 className="w-10 h-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Files Generated</h3>
        <p className="text-sm text-muted-foreground mt-2">
          The run completed but no output files were produced.
        </p>
      </div>
    );
  }

  const treeData = buildTree(tree);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{tree.length} file{tree.length !== 1 ? 's' : ''} generated</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              exporting && 'opacity-50 cursor-wait'
            )}
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Export ZIP
          </button>
        </div>
      </div>

      {/* Split view */}
      <div className="flex rounded-xl border border-border overflow-hidden" style={{ height: '500px' }}>
        {/* Tree panel */}
        <div className="w-64 flex-shrink-0 border-r border-border bg-card overflow-y-auto py-2">
          <RootTree treeData={treeData} selectedPath={selectedPath} onSelect={setSelectedPath} />
        </div>

        {/* Content panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {fileLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="text-primary animate-spin" />
            </div>
          ) : selectedPath ? (
            <>
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0">
                <File size={12} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-mono flex-1 truncate">{selectedPath}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(fileContent);
                    toast.success('Copied to clipboard');
                  }}
                  className="p-1 rounded hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors"
                  title="Copy file content"
                >
                  <Copy size={12} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                <Editor
                  value={fileContent}
                  language={getLanguageFromPath(selectedPath)}
                  theme="vs-dark"
                  loading={<div className="flex items-center justify-center h-full"><Loader2 size={20} className="text-primary animate-spin" /></div>}
                  options={{
                    readOnly: true,
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    fontSize: 13,
                    wordWrap: 'on',
                    lineNumbers: 'on',
                    renderLineHighlight: 'none',
                    contextmenu: false,
                    domReadOnly: true,
                    padding: { top: 12 },
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Select a file to view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}