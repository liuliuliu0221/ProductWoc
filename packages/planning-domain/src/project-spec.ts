import {
  projectSpecContentSchema,
  projectSpecRevisionPatchSchema,
  type ProjectSpecContent,
  type ProjectSpecRevisionPatch,
} from "@product-woc/planning-contracts";

export function applyProjectSpecRevision(
  current: ProjectSpecContent,
  patch: ProjectSpecRevisionPatch,
): ProjectSpecContent {
  const validCurrent = projectSpecContentSchema.parse(current);
  const validPatch = projectSpecRevisionPatchSchema.parse(patch);
  return projectSpecContentSchema.parse({
    ...validCurrent,
    ...validPatch,
  });
}
