import { describe, expect, it } from "vitest";
import {
  compatModelIdForEndpoint,
  endpointIdFromCompatModel,
  getModelContextLimit,
  isCompatModelId,
  migrateLegacyCompatEndpoint,
  type ModelInfo,
  modelKeepsReasoning,
  resolveModel,
  type CustomEndpoint,
} from "./config";

const endpoint: CustomEndpoint = {
  id: "ab12cd34",
  name: "My LLM",
  baseURL: "https://api.example.com/v1",
  modelId: "llama-3.3-70b",
  contextLimit: 64_000,
};

describe("compat model id helpers", () => {
  it("round-trips endpoint id through the synthetic model id", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(isCompatModelId(mid)).toBe(true);
    expect(endpointIdFromCompatModel(mid)).toBe(endpoint.id);
  });

  it("treats static model ids as non-compat", () => {
    expect(isCompatModelId("deepseek-v4-pro")).toBe(false);
    expect(endpointIdFromCompatModel("deepseek-v4-pro")).toBe("");
  });
});

describe("resolveModel", () => {
  it("resolves a compat model id against its endpoint", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    const info = resolveModel(mid, [endpoint]);
    expect(info.provider).toBe("openai-compatible");
    expect(info.id).toBe(mid);
    expect(info.label).toBe(endpoint.modelId);
  });

  it("falls back to a placeholder when the endpoint is gone", () => {
    const info = resolveModel(compatModelIdForEndpoint("missing"), []);
    expect(info.provider).toBe("openai-compatible");
  });

  it("resolves a static model id from the registry", () => {
    expect(resolveModel("deepseek-v4-pro").provider).toBe("deepseek");
  });

  it("throws on an unknown static model id", () => {
    expect(() => resolveModel("nope-not-real")).toThrow();
  });
});

describe("getModelContextLimit", () => {
  it("uses the per-endpoint override for compat models", () => {
    const mid = compatModelIdForEndpoint(endpoint.id);
    expect(getModelContextLimit(mid, endpoint.contextLimit)).toBe(64_000);
  });

  it("reads the static table for known models", () => {
    expect(getModelContextLimit("deepseek-v4-pro")).toBe(1_000_000);
  });
});

describe("modelKeepsReasoning", () => {
  it("keeps reasoning for compat endpoints (freeform provider)", () => {
    const info = resolveModel(compatModelIdForEndpoint(endpoint.id), [endpoint]);
    expect(modelKeepsReasoning(info)).toBe(true);
  });

  it("drops reasoning for plain non-reasoning models", () => {
    const plainModel: ModelInfo = {
      id: "plain-deepseek",
      provider: "deepseek",
      label: "Plain DeepSeek",
      hint: "test",
      description: "Plain non-reasoning model",
      capabilities: { intelligence: 3, speed: 3, cost: 3 },
    };
    expect(modelKeepsReasoning(plainModel)).toBe(false);
  });

  it("keeps reasoning for tagged reasoning models", () => {
    expect(modelKeepsReasoning(resolveModel("deepseek-v4-pro"))).toBe(true);
  });
});

describe("migrateLegacyCompatEndpoint", () => {
  it("migrates a fully configured legacy endpoint", () => {
    const out = migrateLegacyCompatEndpoint(
      "https://api.example.com/v1",
      "llama-3.3-70b",
      32_000,
      "fixedid1",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "fixedid1",
      baseURL: "https://api.example.com/v1",
      modelId: "llama-3.3-70b",
      contextLimit: 32_000,
    });
  });

  it("skips migration when base URL or model id is missing", () => {
    expect(migrateLegacyCompatEndpoint("", "m", 1, "x")).toEqual([]);
    expect(migrateLegacyCompatEndpoint("u", "  ", 1, "x")).toEqual([]);
  });
});
