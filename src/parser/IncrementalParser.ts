import * as vscode from 'vscode';
import { ParserService } from './ParserService';
import { toTreeEdit } from './treeEdit';

interface CacheEntry {
  tree: any;
  version: number;
}

/**
 * Maintains an up-to-date Tree-sitter tree per open Python document.
 *
 * On every text change we translate VS Code's `TextDocumentContentChangeEvent`s
 * into Tree-sitter edits, apply them to the cached tree, and re-parse using that
 * edited tree as a base. Tree-sitter then reuses unchanged subtrees, so the cost
 * of a keystroke scales with the size of the edit, not the size of the file.
 *
 * This is the parse source for the on-type indentation provider, which runs on
 * every newline / colon / closing bracket. VS Code fires `onDidChangeTextDocument`
 * BEFORE it invokes on-type formatting, so by the time the provider asks for a
 * tree via `getTree()`, the cached tree already reflects the just-typed character.
 *
 * Correctness never depends on the incremental path: `getTree()` validates the
 * cached version against the document and falls back to a full parse on any
 * mismatch (e.g. a dropped or out-of-order event).
 */
export class IncrementalParser {
  private readonly cache = new Map<string, CacheEntry>();

  /** Seed the cache for documents already open at activation. */
  public seed(documents: readonly vscode.TextDocument[]): void {
    for (const doc of documents) {
      if (isPython(doc)) {
        this.fullParse(doc);
      }
    }
  }

  public onOpen(document: vscode.TextDocument): void {
    if (isPython(document)) {
      this.fullParse(document);
    }
  }

  public onChange(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    if (!isPython(document)) {
      return;
    }

    const key = document.uri.toString();
    const entry = this.cache.get(key);

    // No usable base tree → full parse of the new text.
    if (!entry) {
      this.fullParse(document);
      return;
    }

    // A content-free change (e.g. a dirty-flag flip) leaves the tree valid;
    // just keep the version in sync so getTree() doesn't needlessly re-parse.
    if (event.contentChanges.length === 0) {
      entry.version = document.version;
      return;
    }

    try {
      // Apply edits high-offset-first so each edit's original-document offsets
      // stay valid as the tree mutates — correct regardless of the order VS Code
      // delivers multiple changes (e.g. multi-cursor edits, find/replace-all).
      const changes = [...event.contentChanges].sort(
        (a, b) => b.rangeOffset - a.rangeOffset
      );
      for (const change of changes) {
        entry.tree.edit(toTreeEdit(change));
      }

      const next = ParserService.parse(document.getText(), entry.tree);
      if (!next) {
        // Parser returned no tree (should not happen without a cancel option);
        // drop the stale entry so the next getTree() does a clean full parse.
        entry.tree.delete?.();
        this.cache.delete(key);
        return;
      }
      if (next !== entry.tree) {
        entry.tree.delete?.();
      }
      this.cache.set(key, { tree: next, version: document.version });
    } catch {
      // Never serve a half-applied or corrupt incremental tree: discard it and
      // fall back to a clean full parse.
      entry.tree.delete?.();
      this.cache.delete(key);
      this.fullParse(document);
    }
  }

  public onClose(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const entry = this.cache.get(key);
    if (entry) {
      entry.tree.delete?.();
      this.cache.delete(key);
    }
  }

  /**
   * Return an up-to-date tree for the document. Uses the cached incremental tree
   * when it matches the document's current version; otherwise (missing/stale)
   * does a full parse and refreshes the cache. May return null only if the
   * parser itself returns no tree.
   */
  public getTree(document: vscode.TextDocument): any {
    const key = document.uri.toString();
    const entry = this.cache.get(key);
    if (entry && entry.version === document.version) {
      return entry.tree;
    }
    return this.fullParse(document);
  }

  /** Release every cached tree. Call from the extension's deactivate(). */
  public dispose(): void {
    for (const entry of this.cache.values()) {
      entry.tree.delete?.();
    }
    this.cache.clear();
  }

  private fullParse(document: vscode.TextDocument): any {
    const key = document.uri.toString();
    const previous = this.cache.get(key);
    const tree = ParserService.parse(document.getText());
    if (previous && previous.tree !== tree) {
      previous.tree.delete?.();
    }
    if (tree) {
      this.cache.set(key, { tree, version: document.version });
    } else {
      this.cache.delete(key);
    }
    return tree;
  }
}

function isPython(document: vscode.TextDocument): boolean {
  return document.languageId === 'python';
}
