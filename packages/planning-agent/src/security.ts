export type SensitiveDataKind =
  | "private_key"
  | "api_credential"
  | "secret_assignment"
  | "email"
  | "phone";

export interface SensitiveDataFinding {
  kind: SensitiveDataKind;
  index: number;
}

const sensitivePatterns: readonly {
  kind: SensitiveDataKind;
  pattern: RegExp;
}[] = [
  {
    kind: "private_key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  },
  { kind: "api_credential", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  {
    kind: "secret_assignment",
    pattern: /\b(?:password|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi,
  },
  {
    kind: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    kind: "phone",
    pattern: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g,
  },
];

export function scanSensitiveText(value: string): readonly SensitiveDataFinding[] {
  const findings: SensitiveDataFinding[] = [];
  for (const { kind, pattern } of sensitivePatterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      findings.push({ kind, index: match.index });
    }
  }
  return findings.sort((left, right) => left.index - right.index);
}

export function redactSensitiveText(value: string): string {
  let result = value;
  for (const { kind, pattern } of sensitivePatterns) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${kind}]`);
  }
  return result;
}

export interface UntrustedReferenceInput {
  artifactId: string;
  summary: string;
  contentHash: string;
}

export interface PreparedUntrustedReference extends UntrustedReferenceInput {
  trust: "untrusted";
  instructionPolicy: "never_follow";
  redacted: boolean;
}

export function prepareUntrustedReferences(
  references: readonly UntrustedReferenceInput[],
): readonly PreparedUntrustedReference[] {
  return references.map((reference) => {
    const bounded = reference.summary.slice(0, 4000);
    const summary = redactSensitiveText(bounded);
    return {
      artifactId: reference.artifactId,
      contentHash: reference.contentHash,
      summary,
      trust: "untrusted",
      instructionPolicy: "never_follow",
      redacted: summary !== bounded,
    };
  });
}

export function structuredOutputContainsSensitiveData(output: unknown): boolean {
  return scanSensitiveText(JSON.stringify(output)).length > 0;
}
