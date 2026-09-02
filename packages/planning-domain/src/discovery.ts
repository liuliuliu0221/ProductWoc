import {
  clarificationAnswerSchema,
  discoveryAnalysisSchema,
  type ClarificationAnswer,
  type DecisionLogEntry,
  type DiscoveryAnalysis,
  type RequirementUnderstanding,
} from "@product-woc/planning-contracts";

import { contentHash } from "./canonical-json.js";

export function analyzeDiscovery(
  understanding: RequirementUnderstanding,
): DiscoveryAnalysis {
  if (understanding.support.level !== "supported") {
    return discoveryAnalysisSchema.parse({
      understanding,
      questions: [],
      outcome: "needs_user_action",
    });
  }

  const questions = understanding.uncertainties
    .filter((uncertainty) => uncertainty.blocking)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 3);

  return discoveryAnalysisSchema.parse({
    understanding,
    questions,
    outcome: questions.length > 0 ? "awaiting_clarification" : "ready_for_spec",
  });
}

export interface ClarificationResolution {
  complete: boolean;
  decisions: readonly DecisionLogEntry[];
  unresolvedQuestionIds: readonly string[];
}

export interface ClarificationResolutionMetadata {
  actorId: string;
  recordedAt: string;
}

export function resolveClarifications(
  analysis: DiscoveryAnalysis,
  answers: readonly ClarificationAnswer[],
  metadata: ClarificationResolutionMetadata,
): ClarificationResolution {
  const parsedAnswers = answers.map((answer) => clarificationAnswerSchema.parse(answer));
  const answersByQuestion = new Map<string, ClarificationAnswer>();
  for (const answer of parsedAnswers) {
    if (answersByQuestion.has(answer.questionId)) {
      throw new Error(`Duplicate clarification answer: ${answer.questionId}`);
    }
    answersByQuestion.set(answer.questionId, answer);
  }

  const validQuestionIds = new Set(analysis.questions.map(({ id }) => id));
  for (const questionId of answersByQuestion.keys()) {
    if (!validQuestionIds.has(questionId)) {
      throw new Error(`Unknown clarification question: ${questionId}`);
    }
  }

  const decisions: DecisionLogEntry[] = [];
  const unresolvedQuestionIds: string[] = [];
  for (const question of analysis.questions) {
    const answer = answersByQuestion.get(question.id);
    if (!answer) {
      unresolvedQuestionIds.push(question.id);
      continue;
    }

    const value = answer.useRecommendedDefault
      ? question.recommendedDefault
      : (answer.answer as string);
    const kind = answer.useRecommendedDefault
      ? "adopted_default"
      : "clarification_answer";
    decisions.push({
      decisionId: `decision:${contentHash([
        question.id,
        metadata.actorId,
        value,
      ]).slice(0, 48)}`,
      kind,
      topic: question.topic,
      value,
      sourceQuestionId: question.id,
      recordedBy: metadata.actorId,
      recordedAt: metadata.recordedAt,
    });
  }

  return {
    complete: unresolvedQuestionIds.length === 0,
    decisions,
    unresolvedQuestionIds,
  };
}

export function applyClarificationResolution(
  analysis: DiscoveryAnalysis,
  resolution: ClarificationResolution,
): DiscoveryAnalysis {
  if (analysis.understanding.support.level !== "supported") {
    return analysis;
  }

  const unresolved = new Set(resolution.unresolvedQuestionIds);
  const questions = analysis.questions.filter(({ id }) => unresolved.has(id));
  return discoveryAnalysisSchema.parse({
    ...analysis,
    questions,
    outcome: resolution.complete ? "ready_for_spec" : "awaiting_clarification",
  });
}
