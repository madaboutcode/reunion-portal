/**
 * Committee Todo routes — mutation parsing contract.
 *
 * Regression coverage for the `add` op: optional fields (`due`, `notes`) may be
 * omitted by the client and must be treated as empty, not as a validation error.
 * The production failure was: POST /api/committee/todos/mutate with
 * {"op":"add","assignee":"X","title":"Y"} → 400 "due must be a string", because
 * the `add` branch called safeText('due', b.due, ...) and `undefined` is not a
 * string. The `edit` branch already used `b.due ?? ''`; `add` did not.
 *
 * Also locks in that `null` is treated as empty for optional fields (matches
 * the `edit` op's `?? ''`) — the fields accept "absent, null, or string".
 *
 * @module committee.routes.test
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../../env.js";
import { handleError } from "../../middleware/error.middleware.js";
import { committeeRoutes } from "../committee.routes.js";
import type { CommitteeService, CommitteeBoard, CommitteeMutation } from "../../services/committee.service.js";

const EMPTY_BOARD: CommitteeBoard = { people: [], tasks: [], thumbsBaseUrl: "" };

function makeApp() {
  const calls: CommitteeMutation[] = [];
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("committeeService", {
      getBoard: async () => EMPTY_BOARD,
      mutate: async (m: CommitteeMutation) => {
        calls.push(m);
        return EMPTY_BOARD;
      },
    } as unknown as CommitteeService);
    await next();
  });
  app.onError(handleError);
  app.route("/", committeeRoutes);
  return { app, calls };
}

function post(app: Hono<AppEnv>, body: unknown) {
  return app.request("/todos/mutate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { ENVIRONMENT: "development" });
}

describe("POST /todos/mutate — add op", () => {
  it("accepts an add with both optional fields omitted (regression: due must be a string)", async () => {
    const { app, calls } = makeApp();
    const res = await post(app, { op: "add", assignee: "Ravi", title: "All Seasons' - confirm check-in time" });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { op: "add", assignee: "Ravi", title: "All Seasons' - confirm check-in time", due: "", notes: "" },
    ]);
  });

  it("accepts an add with string due and notes and passes them through trimmed", async () => {
    const { app, calls } = makeApp();
    const res = await post(app, { op: "add", assignee: "Ravi", title: "Buy cake", due: "Aug 15", notes: "  chocolate  " });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { op: "add", assignee: "Ravi", title: "Buy cake", due: "Aug 15", notes: "chocolate" },
    ]);
  });

  it("treats a null due as empty (matches the edit op: nullish coalesce, not a 400)", async () => {
    const { app, calls } = makeApp();
    const res = await post(app, { op: "add", assignee: "Ravi", title: "Buy cake", due: null });
    expect(res.status).toBe(200);
    expect(calls).toEqual([
      { op: "add", assignee: "Ravi", title: "Buy cake", due: "", notes: "" },
    ]);
  });

  it("still rejects an add missing a required field", async () => {
    const { app } = makeApp();
    const res = await post(app, { op: "add", assignee: "Ravi" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, string> } };
    // safeText checks typeof before emptiness, so an omitted (undefined) title
    // reports "must be a string" — still a 400 rejection either way.
    expect(body.details.fieldErrors.title).toBe("title must be a string");
  });
});
