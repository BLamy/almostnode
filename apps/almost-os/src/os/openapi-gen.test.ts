import { describe, expect, it } from "vitest";
import { generateOpenApi, inferSchema, type CapturedRequest } from "./openapi-gen";

describe("inferSchema", () => {
  it("infers primitive + integer vs number", () => {
    expect(inferSchema("x")).toEqual({ type: "string" });
    expect(inferSchema(3)).toEqual({ type: "integer" });
    expect(inferSchema(3.5)).toEqual({ type: "number" });
    expect(inferSchema(true)).toEqual({ type: "boolean" });
    expect(inferSchema(null)).toEqual({ type: "null" });
  });

  it("infers nested objects and arrays", () => {
    expect(inferSchema({ id: 1, tags: ["a"], user: { name: "x" } })).toEqual({
      type: "object",
      properties: {
        id: { type: "integer" },
        tags: { type: "array", items: { type: "string" } },
        user: { type: "object", properties: { name: { type: "string" } } },
      },
    });
  });
});

describe("generateOpenApi", () => {
  const samples: CapturedRequest[] = [
    {
      method: "GET",
      url: "https://api.example.com/users/42?verbose=true",
      status: 200,
      responseBody: { id: 42, name: "Ada" },
    },
    {
      method: "GET",
      url: "https://api.example.com/users/99",
      status: 200,
      responseBody: { id: 99, name: "Alan" },
    },
    {
      method: "POST",
      url: "https://api.example.com/users",
      status: 201,
      requestBody: { name: "Grace" },
      responseBody: { id: 7, name: "Grace" },
    },
  ];

  it("collapses id-like segments into a templated path param", () => {
    const doc = generateOpenApi(samples);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
    // /users/42 and /users/99 collapse to one templated path.
    expect(doc.paths["/users/{id}"]).toBeDefined();
    const get = doc.paths["/users/{id}"].get;
    expect(get.parameters).toContainEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
    });
    expect(get.parameters).toContainEqual({
      name: "verbose",
      in: "query",
      required: false,
      schema: { type: "string" },
    });
    expect(get.responses["200"]).toMatchObject({
      content: { "application/json": { schema: { type: "object" } } },
    });
  });

  it("captures request + response bodies for POST", () => {
    const doc = generateOpenApi(samples);
    const post = doc.paths["/users"].post;
    expect(post.requestBody).toMatchObject({
      content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } },
    });
    expect(post.responses["201"]).toBeDefined();
    expect(post.operationId).toBe("post_users");
  });

  it("skips unparseable URLs", () => {
    const doc = generateOpenApi([{ method: "GET", url: "not a url" }]);
    expect(doc.paths).toEqual({});
    expect(doc.servers).toEqual([]);
  });
});
