import { describe, expect, it } from "vitest";
import { describeError, errorResponse } from "./api-error";

describe("describeError", () => {
  it("surfaces the exact MySQL error instead of a generic message", () => {
    const mysqlError = Object.assign(new Error("Table 'tradenaya.automation_x' doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
      sqlState: "42S02",
      sqlMessage: "Table 'tradenaya.automation_x' doesn't exist",
      sql: "SELECT * FROM automation_x",
    });
    const { message, details } = describeError(mysqlError);
    expect(message).toBe("Database error (ER_NO_SUCH_TABLE): Table 'tradenaya.automation_x' doesn't exist");
    expect(details.code).toBe("ER_NO_SUCH_TABLE");
    expect(details.errno).toBe(1146);
    expect(details.sql).toBe("SELECT * FROM automation_x");
  });

  it("keeps network error codes and nested causes", () => {
    const err = new Error("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" }) });
    const { details } = describeError(err);
    expect(details.causes).toEqual(["ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:3306"]);
  });
});

describe("errorResponse", () => {
  it("returns the readable message plus technical details", async () => {
    const res = errorResponse(new Error("Unknown column 'foo' in 'field list'"), 500, "Failed to load", "/api/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe("Unknown column 'foo' in 'field list'");
    expect(body.error).toMatchObject({ endpoint: "/api/test", status: 500, name: "Error" });
  });
});
