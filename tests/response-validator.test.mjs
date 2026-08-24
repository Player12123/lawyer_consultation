import assert from "node:assert/strict";
import test from "node:test";

import { validateLawyerResponse, validatedDelivery } from "../backend/response-validator.mjs";

test("validator cleans harmless formatting and accepts a concise lawyer answer", () => {
  const result = validateLawyerResponse({
    response: "原则上可以。\n\n\n应先固定对方解除通知。\u0000",
    taskPlan: {}, toolResults: {}, citations: [],
  });

  assert.equal(result.pass, true);
  assert.equal(result.response, "原则上可以。\n\n应先固定对方解除通知。");
  assert.equal(typeof result.durationMs, "number");
});

test("validator blocks internal task and product-name leakage", () => {
  const result = validateLawyerResponse({
    response: "LAW类型答复建议：根据上游智能体分析，口袋智能律师建议继续处理。",
    taskPlan: {}, toolResults: {}, citations: [],
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.issues.map((item) => item.code), ["INTERNAL_LABEL_LEAK", "INTERNAL_SYSTEM_INFO_LEAK", "INTERNAL_PRODUCT_NAME_LEAK"]);
});

test("validator blocks raw structured output, tool errors, and unknown citations", () => {
  const result = validateLawyerResponse({
    response: '{"task_type":"LAW","answer":"Error: ECONNREFUSED"}',
    taskPlan: {},
    toolResults: { cases: [{ id: "case-1" }], laws: [{ id: "law-1" }] },
    citations: [{ type: "case", sourceId: "missing-case" }],
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.issues.map((item) => item.code), ["INTERNAL_LABEL_LEAK", "RAW_STRUCTURED_OUTPUT", "TOOL_ERROR_LEAK", "INVALID_CITATION"]);
});

test("validator rejects empty, meaningless, and runaway responses", () => {
  for (const response of ["", "好的", "甲".repeat(16001)]) {
    const result = validateLawyerResponse({ response, taskPlan: {}, toolResults: {}, citations: [] });
    assert.equal(result.pass, false);
  }
});

test("validator replaces blocked output with the uniform business fallback", () => {
  const delivery = validatedDelivery({
    response: "根据系统要求，当前任务：LAW",
    taskPlan: {}, toolResults: {}, citations: [],
  });

  assert.equal(delivery.response, "当前回复生成异常，请稍后重试。");
  assert.equal(delivery.validation.pass, false);
});
