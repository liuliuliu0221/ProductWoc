import { describe, expect, it } from "vitest";

import {
  agentRunStatusSchema,
  developmentRunStatusSchema,
  phaseRunStatusSchema,
  taskRunStatusSchema,
} from "@product-woc/development-contracts";

import {
  allowedAgentRunTransitions,
  allowedDevelopmentRunTransitions,
  allowedPhaseRunTransitions,
  allowedTaskRunTransitions,
  canTransitionAgentRun,
  canTransitionDevelopmentRun,
  canTransitionPhaseRun,
  canTransitionTaskRun,
} from "../src/index.js";

describe("development state machines", () => {
  it("covers every legal and illegal DevelopmentRun transition", () => {
    for (const from of developmentRunStatusSchema.options) {
      const allowed = allowedDevelopmentRunTransitions(from);
      for (const to of developmentRunStatusSchema.options) {
        expect(canTransitionDevelopmentRun(from, to)).toBe(allowed.includes(to));
      }
    }
    expect(allowedDevelopmentRunTransitions("failed")).toEqual([]);
    expect(allowedDevelopmentRunTransitions("cancelled")).toEqual([]);
  });

  it("covers every legal and illegal PhaseRun transition", () => {
    for (const from of phaseRunStatusSchema.options) {
      const allowed = allowedPhaseRunTransitions(from);
      for (const to of phaseRunStatusSchema.options) {
        expect(canTransitionPhaseRun(from, to)).toBe(allowed.includes(to));
      }
    }
    expect(allowedPhaseRunTransitions("cancelled")).toEqual([]);
  });

  it("covers every legal and illegal TaskRun transition", () => {
    for (const from of taskRunStatusSchema.options) {
      const allowed = allowedTaskRunTransitions(from);
      for (const to of taskRunStatusSchema.options) {
        expect(canTransitionTaskRun(from, to)).toBe(allowed.includes(to));
      }
    }
    expect(allowedTaskRunTransitions("cancelled")).toEqual([]);
  });

  it("covers every legal and illegal AgentRun transition", () => {
    for (const from of agentRunStatusSchema.options) {
      const allowed = allowedAgentRunTransitions(from);
      for (const to of agentRunStatusSchema.options) {
        expect(canTransitionAgentRun(from, to)).toBe(allowed.includes(to));
      }
    }
    expect(allowedAgentRunTransitions("failed")).toEqual([]);
    expect(allowedAgentRunTransitions("cancelled")).toEqual([]);
    expect(allowedAgentRunTransitions("stale")).toEqual([]);
  });
});
