import { z } from "zod";

export const newsletterFormSchema = z.object({
  email: z.email("Please enter a valid email address"),
});

export type NewsletterFormData = z.infer<typeof newsletterFormSchema>;

/**
 * A hand-rolled react-hook-form resolver, in place of `@hookform/resolvers`.
 *
 * That package would be hoisted to the repo root, where a bare `import "zod"`
 * resolves to the CLI workspace's zod 3 rather than this app's zod 4, and the
 * two disagree about the shape of a schema. One field does not justify pinning
 * two workspaces to one major version of a validator they otherwise share
 * nothing with.
 */
export const newsletterResolver = (values: NewsletterFormData) => {
  const parsed = newsletterFormSchema.safeParse(values);

  if (parsed.success) {
    return { errors: {}, values: parsed.data };
  }

  return {
    errors: Object.fromEntries(
      parsed.error.issues.map((issue) => [
        String(issue.path[0] ?? "root"),
        { message: issue.message, type: issue.code },
      ]),
    ),
    values: {},
  };
};
