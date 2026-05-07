import { setupServer } from "msw/node";
import { handlers } from "./src/mocks/handlers.js";
import { afterAll, afterEach, beforeAll } from "vitest";
import "@testing-library/jest-dom/vitest";

export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
