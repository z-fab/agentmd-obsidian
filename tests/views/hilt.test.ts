import { describe, it, expect } from "vitest";
import { pendingFromSSE, pendingFromResponse, buildRespondBody } from "../../src/views/hilt";

describe("pendingFromSSE", () => {
  it("builds a PendingRequest from an interrupt event payload", () => {
    const p = pendingFromSSE({
      request_id: "r1", kind: "confirm", message: "Approve file_delete?",
      tool_name: "file_delete", tool_args: { path: "/x" },
    });
    expect(p).toEqual({
      request_id: "r1", kind: "confirm", message: "Approve file_delete?",
      tool_name: "file_delete", tool_args: { path: "/x" }, options: undefined, multi: false,
    });
  });
  it("returns null when request_id is missing", () => {
    expect(pendingFromSSE({ message: "x" })).toBeNull();
  });
  it("defaults an unknown kind to input", () => {
    expect(pendingFromSSE({ request_id: "r", kind: "weird", message: "?" })!.kind).toBe("input");
  });
});

describe("pendingFromResponse", () => {
  it("maps the GET /pending shape to a PendingRequest", () => {
    const p = pendingFromResponse({
      execution_id: 5, request_id: "r2", kind: "choice", message: "Pick",
      options: ["a", "b"], multi: true, created_at: "2026-06-05T00:00:00Z",
    });
    expect(p).toEqual({
      request_id: "r2", kind: "choice", message: "Pick",
      tool_name: undefined, tool_args: undefined, options: ["a", "b"], multi: true,
    });
  });
});

describe("buildRespondBody", () => {
  it("confirm approve", () => {
    expect(buildRespondBody("confirm", { approved: true })).toEqual({ approved: true, reason: undefined });
  });
  it("confirm deny with reason", () => {
    expect(buildRespondBody("confirm", { approved: false, reason: "no" })).toEqual({ approved: false, reason: "no" });
  });
  it("input", () => {
    expect(buildRespondBody("input", { text: "notes.txt" })).toEqual({ text: "notes.txt" });
  });
  it("choice", () => {
    expect(buildRespondBody("choice", { selected: ["banana"] })).toEqual({ selected: ["banana"] });
  });
});
