/**
 * Pure (VS Code-free) translation of a document content change into a
 * Tree-sitter edit. Kept separate from IncrementalParser so the edit math can be
 * exercised by the Node test runner without a VS Code host.
 *
 * Indices and Point columns are UTF-16 code units on both the VS Code side and
 * the @vscode/tree-sitter-wasm side (verified empirically), so no byte
 * conversion is needed.
 */

export interface Point {
  row: number;
  column: number;
}

export interface TreeEdit {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: Point;
  oldEndPosition: Point;
  newEndPosition: Point;
}

/**
 * The structural subset of `vscode.TextDocumentContentChangeEvent` we need.
 * VS Code's event is assignable to this, so callers can pass it directly.
 */
export interface ContentChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/** Translate a single content change into a Tree-sitter edit. */
export function toTreeEdit(change: ContentChange): TreeEdit {
  const startPosition: Point = {
    row: change.range.start.line,
    column: change.range.start.character,
  };
  return {
    startIndex: change.rangeOffset,
    oldEndIndex: change.rangeOffset + change.rangeLength,
    newEndIndex: change.rangeOffset + change.text.length,
    startPosition,
    oldEndPosition: {
      row: change.range.end.line,
      column: change.range.end.character,
    },
    newEndPosition: advancePoint(startPosition, change.text),
  };
}

/**
 * The point reached by writing `text` starting at `start`.
 * EOL-agnostic: handles \r\n, \r, and \n line terminators.
 */
export function advancePoint(start: Point, text: string): Point {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length === 1) {
    return { row: start.row, column: start.column + lines[0].length };
  }
  return {
    row: start.row + lines.length - 1,
    column: lines[lines.length - 1].length,
  };
}
