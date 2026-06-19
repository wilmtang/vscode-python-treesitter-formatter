import * as path from 'path';
import Mocha from 'mocha';
import glob from 'glob';

/**
 * Mocha test harness for E2E tests running inside a VS Code instance.
 * Called by @vscode/test-electron via test/runTest.ts.
 */
export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 120000  // 2 min — E2E tests need time for VS Code to format
    });

    const testsRoot = __dirname;
    const files = glob.sync('*.test.js', { cwd: testsRoot });

    for (const f of files) {
        mocha.addFile(path.resolve(testsRoot, f));
    }

    return new Promise((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} E2E tests failed.`));
            } else {
                resolve();
            }
        });
    });
}
