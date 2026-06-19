import * as path from 'path';

// @vscode/tree-sitter-wasm exports { Parser, Language, ... } as named exports
const treeSitter = require('@vscode/tree-sitter-wasm');

/**
 * ParserService manages the lifecycle of the Tree-sitter parser.
 *
 * It uses @vscode/tree-sitter-wasm which bundles ABI-matched tree-sitter.wasm
 * and tree-sitter-python.wasm, avoiding the version incompatibilities that
 * plague mixing web-tree-sitter with separately compiled grammar WASMs.
 */
export class ParserService {
  private static parser: any = null;
  private static isInitialized = false;

  /**
   * Initialize the Tree-sitter WASM runtime and load the Python grammar.
   *
   * @param extensionPath - When running inside VS Code, the extension root
   *   path. WASM files are resolved from `<extensionPath>/dist/wasm/`.
   *   When running outside VS Code (unit tests), omit this and WASM files
   *   are resolved from the @vscode/tree-sitter-wasm npm package.
   */
  public static async init(extensionPath?: string): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const wasmDir = extensionPath
      ? this.resolveWasmDirFromExtension(extensionPath)
      : this.resolveWasmDirFromNodeModules();

    await treeSitter.Parser.init({
      locateFile(scriptName: string) {
        return path.join(wasmDir, scriptName);
      }
    });

    this.parser = new treeSitter.Parser();
    const pythonWasm = path.join(wasmDir, 'tree-sitter-python.wasm');
    const lang = await treeSitter.Language.load(pythonWasm);
    this.parser.setLanguage(lang);
    this.isInitialized = true;
  }

  /**
   * Parse Python source code into a Tree-sitter syntax tree.
   */
  public static parse(code: string): any {
    if (!this.parser) {
      throw new Error(
        'ParserService.parse() called before init(). ' +
        'Call ParserService.init() first.'
      );
    }
    return this.parser.parse(code);
  }

  /**
   * Reset the service (useful for testing).
   */
  public static reset(): void {
    this.parser = null;
    this.isInitialized = false;
  }

  /**
   * When running as a VS Code extension, WASM files are copied to
   * `dist/wasm/` by webpack's CopyPlugin.
   */
  private static resolveWasmDirFromExtension(extensionPath: string): string {
    return path.join(extensionPath, 'dist', 'wasm');
  }

  /**
   * When running in unit tests (not inside VS Code), resolve WASM files
   * directly from the installed npm package.
   */
  private static resolveWasmDirFromNodeModules(): string {
    const pkgPath = require.resolve('@vscode/tree-sitter-wasm/package.json');
    return path.join(path.dirname(pkgPath), 'wasm');
  }
}
