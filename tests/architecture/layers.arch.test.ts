import { filesOfProject } from 'tsarch';

// Architectural fitness functions (ArchUnit-style).
//
// ts-arch builds the dependency graph from `tsconfig.json` (which includes
// `src/**` and excludes tests) and analyses DIRECT import edges between files.
// Layers are identified by filename convention. See docs/architecture-tests.md.
//
// We assert on `.check()` (a Promise<Violation[]>) rather than ts-arch's
// `toPassAsync` matcher: it is properly awaitable and prints the offending
// edges on failure.
//
// Rules ts-arch cannot express (no direct-lib imports in the domain;
// cross-module imports only via the barrel) are enforced by ESLint instead.

// Building the TS program for the whole project can take a few seconds.
jest.setTimeout(60_000);

const TSCONFIG = 'tsconfig.json';

const PRESENTATION = '.*\\.(controller|routes)\\.ts';
const APPLICATION = '.*\\.(service|orchestrator)\\.ts';
const INFRA_MODELS = '.*\\.model\\.ts';

describe('architecture: layer dependencies', () => {
  it('has no dependency cycles', async () => {
    const violations = await filesOfProject(TSCONFIG)
      .matchingPattern('.*')
      .should()
      .beFreeOfCycles()
      .check();

    expect(violations).toEqual([]);
  });

  it('infrastructure (models) must not depend on presentation', async () => {
    const violations = await filesOfProject(TSCONFIG)
      .matchingPattern(INFRA_MODELS)
      .shouldNot()
      .dependOnFiles()
      .matchingPattern(PRESENTATION)
      .check();

    expect(violations).toEqual([]);
  });

  it('application (services / orchestrators) must not depend on presentation', async () => {
    const violations = await filesOfProject(TSCONFIG)
      .matchingPattern(APPLICATION)
      .shouldNot()
      .dependOnFiles()
      .matchingPattern(PRESENTATION)
      .check();

    expect(violations).toEqual([]);
  });

  it('application must not depend on the platform HTTP (Express) layer', async () => {
    const violations = await filesOfProject(TSCONFIG)
      .matchingPattern(APPLICATION)
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('platform/http/')
      .check();

    expect(violations).toEqual([]);
  });

  it('platform must not depend on feature modules (no inverted dependency)', async () => {
    const violations = await filesOfProject(TSCONFIG)
      .matchingPattern('platform/')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('modules/')
      .check();

    expect(violations).toEqual([]);
  });
});
