/**
 * MSW server instance for vitest test files.
 * The server lifecycle (listen/resetHandlers/close) is managed by vitest.setup.ts.
 * Individual tests can call server.use(...) to override handlers per-test.
 */
export { server } from "../../vitest.setup";
