import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

/**
 * Shared token subjects for FitHub.
 *
 * All three workers (auth, api, web) must import from this module to ensure
 * the token subject shape is agreed upon at compile time. Divergence causes
 * silent verify() failures.
 */
export const subjects = createSubjects({
  user: object({
    id: string(),
  }),
});
