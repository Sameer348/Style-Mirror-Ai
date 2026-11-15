import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let n = 0;
URL.createObjectURL = vi.fn(() => `blob:mock/${++n}`);
URL.revokeObjectURL = vi.fn();
