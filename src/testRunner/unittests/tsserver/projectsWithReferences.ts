import * as ts from "../../_namespaces/ts";

describe("unittests:: tsserver:: projects with references: invoking when references are already built", () => {
    it("on sample project", () => {
        const coreConfig = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "core/tsconfig.json");
        const coreIndex = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "core/index.ts");
        const coreAnotherModule = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "core/anotherModule.ts");
        const coreSomeDecl = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "core/some_decl.d.ts");
        const logicConfig = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "logic/tsconfig.json");
        const logicIndex = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "logic/index.ts");
        const testsConfig = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "tests/tsconfig.json");
        const testsIndex = ts.TestFSWithWatch.getTsBuildProjectFile("sample1", "tests/index.ts");
        const host = ts.projectSystem.createServerHost([ts.projectSystem.libFile, coreConfig, coreIndex, coreAnotherModule, coreSomeDecl, logicConfig, logicIndex, testsConfig, testsIndex]);
        const logger = ts.projectSystem.createLoggerWithInMemoryLogs(host);
        const service = ts.projectSystem.createProjectService(host, { logger });
        service.openClientFile(testsIndex.path);

        // local edit in ts file
        host.appendFile(logicIndex.path, `function foo() {}`);
        host.checkTimeoutQueueLengthAndRun(2);

        // non local edit in ts file
        host.appendFile(logicIndex.path, `export function gfoo() {}`);
        host.checkTimeoutQueueLengthAndRun(2);

        // change in project reference config file
        host.writeFile(logicConfig.path, JSON.stringify({
            compilerOptions: { composite: true, declaration: true, declarationDir: "decls" },
            references: [{ path: "../core" }]
        }));
        host.checkTimeoutQueueLengthAndRun(2);
        ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "sample project", service);
    });

    describe("on transitive references in different folders", () => {
        function createService() {
            const aConfig: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/a/tsconfig.json`,
                content: JSON.stringify({
                    compilerOptions: { composite: true },
                    files: ["index.ts"]
                }),
            };
            const bConfig: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/b/tsconfig.json`,
                content: JSON.stringify({
                    compilerOptions: { composite: true, baseUrl: "./", paths: { "@ref/*": ["../*"] } },
                    files: ["index.ts"],
                    references: [{ path: `../a` }]
                }),
            };
            const cConfig: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/c/tsconfig.json`,
                content: JSON.stringify({
                    compilerOptions: { baseUrl: "./", paths: { "@ref/*": ["../refs/*"] } },
                    files: ["index.ts"],
                    references: [{ path: `../b` }]
                }),
            };
            const aTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/a/index.ts`,
                content: `export class A {}`,
            };
            const bTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/b/index.ts`,
                content: `import {A} from '@ref/a';
export const b = new A();`,
            };
            const cTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/c/index.ts`,
                content: `import {b} from '../b';
import {X} from "@ref/a";
b;
X;`,
            };
            const refsTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/refs/a.d.ts`,
                content: `export class X {}
export class A {}`
            };
            const host = ts.projectSystem.createServerHost([ts.projectSystem.libFile, aConfig, bConfig, cConfig, aTs, bTs, cTs, refsTs]);
            const service = ts.projectSystem.createProjectService(host, { logger: ts.projectSystem.createLoggerWithInMemoryLogs(host) });
            service.openClientFile(cTs.path);
            return { host, service, aConfig, bConfig, cConfig, aTs, bTs, cTs, refsTs };
        }

        it("non local edit", () => {
            const { host, service, bTs } = createService();
            ts.projectSystem.checkNumberOfProjects(service, { configuredProjects: 1 });

            // non local edit
            host.appendFile(bTs.path, `export function gFoo() { }`);
            host.checkTimeoutQueueLengthAndRun(2);
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "transitive references with non local edit", service);
        });

        it("edit on config file", () => {
            const { host, service, cConfig, refsTs } = createService();
            const nRefsTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/nrefs/a.d.ts`,
                content: refsTs.content
            };
            const cTsConfigJson = JSON.parse(cConfig.content);
            host.ensureFileOrFolder(nRefsTs);
            cTsConfigJson.compilerOptions.paths = { "@ref/*": ["../nrefs/*"] };
            host.writeFile(cConfig.path, JSON.stringify(cTsConfigJson));
            host.checkTimeoutQueueLengthAndRun(2);

            // revert the edit on config file
            host.writeFile(cConfig.path, cConfig.content);
            host.checkTimeoutQueueLengthAndRun(2);
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "transitive references with edit on config file", service);
        });

        it("edit in referenced config file", () => {
            const { host, service, bConfig, refsTs } = createService();
            const nRefsTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/nrefs/a.d.ts`,
                content: refsTs.content
            };
            const bTsConfigJson = JSON.parse(bConfig.content);
            host.ensureFileOrFolder(nRefsTs);
            bTsConfigJson.compilerOptions.paths = { "@ref/*": ["../nrefs/*"] };
            host.writeFile(bConfig.path, JSON.stringify(bTsConfigJson));
            host.checkTimeoutQueueLengthAndRun(2);

            // revert the edit on config file
            host.writeFile(bConfig.path, bConfig.content);
            host.checkTimeoutQueueLengthAndRun(2);
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "transitive references with edit in referenced config file", service);
        });

        it("deleting referenced config file", () => {
            const { host, service, bConfig } = createService();
            host.deleteFile(bConfig.path);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation

            // revert
            host.writeFile(bConfig.path, bConfig.content);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "transitive references with deleting referenced config file", service);
        });

        it("deleting transitively referenced config file", () => {
            const { host, service, aConfig } = createService();
            host.deleteFile(aConfig.path);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation

            // revert
            host.writeFile(aConfig.path, aConfig.content);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "transitive references with deleting transitively referenced config file", service);
        });
    });

    describe("on transitive references in different folders without files", () => {
        function createService() {
            const aConfig: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/a/tsconfig.json`,
                content: JSON.stringify({ compilerOptions: { composite: true } }),
            };
            const bConfig: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/b/tsconfig.json`,
                content: JSON.stringify({
                    compilerOptions: { composite: true, baseUrl: "./", paths: { "@ref/*": ["../*"] } },
                    references: [{ path: `../a` }]
                }),
            };
            const cConfig: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/c/tsconfig.json`,
                content: JSON.stringify({
                    compilerOptions: { baseUrl: "./", paths: { "@ref/*": ["../refs/*"] } },
                    references: [{ path: `../b` }]
                }),
            };
            const aTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/a/index.ts`,
                content: `export class A {}`,
            };
            const bTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/b/index.ts`,
                content: `import {A} from '@ref/a';
export const b = new A();`,
            };
            const cTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/c/index.ts`,
                content: `import {b} from '../b';
import {X} from "@ref/a";
b;
X;`,
            };
            const refsTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/refs/a.d.ts`,
                content: `export class X {}
export class A {}`
            };
            const host = ts.projectSystem.createServerHost([ts.projectSystem.libFile, aConfig, bConfig, cConfig, aTs, bTs, cTs, refsTs]);
            const service = ts.projectSystem.createProjectService(host, { logger: ts.projectSystem.createLoggerWithInMemoryLogs(host) });
            service.openClientFile(cTs.path);
            return { host, service, aConfig, bConfig, cConfig, aTs, bTs, cTs, refsTs };
        }

        it("non local edit", () => {
            const { host, service, bTs } = createService();

            // non local edit
            host.appendFile(bTs.path, `export function gFoo() { }`);
            host.checkTimeoutQueueLengthAndRun(2);
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "trasitive references without files with non local edit", service);
        });

        it("edit on config file", () => {
            const { host, service, cConfig, refsTs } = createService();
            const nRefsTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/nrefs/a.d.ts`,
                content: refsTs.content
            };
            const cTsConfigJson = JSON.parse(cConfig.content);
            host.ensureFileOrFolder(nRefsTs);
            cTsConfigJson.compilerOptions.paths = { "@ref/*": ["../nrefs/*"] };
            host.writeFile(cConfig.path, JSON.stringify(cTsConfigJson));
            host.checkTimeoutQueueLengthAndRun(2);

            // revert the edit on config file
            host.writeFile(cConfig.path, cConfig.content);
            host.checkTimeoutQueueLengthAndRun(2);
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "trasitive references without files with edit on config file", service);
        });

        it("edit in referenced config file", () => {
            const { host, service, bConfig, refsTs } = createService();
            const nRefsTs: ts.projectSystem.File = {
                path: `${ts.tscWatch.projectRoot}/nrefs/a.d.ts`,
                content: refsTs.content
            };
            const bTsConfigJson = JSON.parse(bConfig.content);
            host.ensureFileOrFolder(nRefsTs);
            bTsConfigJson.compilerOptions.paths = { "@ref/*": ["../nrefs/*"] };
            host.writeFile(bConfig.path, JSON.stringify(bTsConfigJson));
            host.checkTimeoutQueueLengthAndRun(2);

            // revert the edit on config file
            host.writeFile(bConfig.path, bConfig.content);
            host.checkTimeoutQueueLengthAndRun(2);
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "trasitive references without files with edit in referenced config file", service);
        });

        it("deleting referenced config file", () => {
            const { host, service, bConfig } = createService();
            host.deleteFile(bConfig.path);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation

            // revert
            host.writeFile(bConfig.path, bConfig.content);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "trasitive references without files with deleting referenced config file", service);
        });

        it("deleting transitively referenced config file", () => {
            const { host, service, aConfig } = createService();
            host.deleteFile(aConfig.path);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation

            // revert
            host.writeFile(aConfig.path, aConfig.content);
            host.checkTimeoutQueueLengthAndRun(3); // Schedules failed lookup invalidation
            ts.projectSystem.baselineTsserverLogs("projectsWithReferences", "trasitive references without files with deleting transitively referenced config file", service);
        });
    });
});