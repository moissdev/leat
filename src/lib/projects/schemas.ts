import { z } from "zod";
import { parseGithubRepoUrl } from "../ingest/github-url";

/** Formulario de proyecto: nombre y, opcionalmente, su repositorio público de GitHub. */
export const projectFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Escribe un nombre.")
      .max(80, "El nombre admite hasta 80 caracteres.")
      .regex(/^[^\u0000-\u001f\u007f]+$/, "El nombre tiene caracteres no válidos."),
    repo_url: z.string().trim().max(200),
  })
  .transform((value, ctx) => {
    if (value.repo_url === "") return { name: value.name, github: null };
    const ref = parseGithubRepoUrl(value.repo_url);
    if (!ref) {
      ctx.addIssue({
        code: "custom",
        path: ["repo_url"],
        message: "Usa una URL de la forma https://github.com/usuario/repositorio.",
      });
      return z.NEVER;
    }
    return { name: value.name, github: { owner: ref.owner, repo: ref.repo } };
  });

export type ProjectFormInput = z.infer<typeof projectFormSchema>;

export const projectIdSchema = z.uuid();
