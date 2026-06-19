import { ParserService } from '../parser/ParserService';
import { FormatterContext } from './Context';
import { Printer } from './Printer';

export class Formatter {
  public static format(code: string, indentSize: number = 4): string {
    const tree = ParserService.parse(code);
    const ctx = new FormatterContext(indentSize);
    const printer = new Printer(ctx);

    printer.printNode(tree.rootNode);

    return ctx.getOutput();
  }
}
