import { describe, expect, it } from "vitest";
import { findingFiltersSchema, statusChangeSchema } from "@/lib/findings/schemas";

const ID = "11111111-1111-4111-8111-111111111111";

describe("findingFiltersSchema", () => {
  it("acepta filtros válidos", () => {
    expect(
      findingFiltersSchema.parse({ severity: "critical", status: "active", project: ID, type: "aws_access_key", page: "3" }),
    ).toEqual({ severity: "critical", status: "active", project: ID, type: "aws_access_key", page: 3 });
  });

  it("descarta en silencio valores inválidos (la URL la puede editar cualquiera)", () => {
    expect(
      findingFiltersSchema.parse({ severity: "urgente", status: "", project: "no-uuid", type: "'; drop table--", page: "-4" }),
    ).toEqual({ severity: undefined, status: undefined, project: undefined, type: undefined, page: 1 });
  });

  it("usa el primer valor si un parámetro viene repetido", () => {
    expect(findingFiltersSchema.parse({ severity: ["high", "low"], page: ["2", "9"] })).toMatchObject({
      severity: "high",
      page: 2,
    });
  });

  it("página 1 por defecto", () => {
    expect(findingFiltersSchema.parse({}).page).toBe(1);
  });
});

describe("statusChangeSchema", () => {
  it("acepta un cambio con nota", () => {
    expect(statusChangeSchema.parse({ id: ID, status: "resolved", note: "  Rotada en AWS  " })).toEqual({
      id: ID,
      status: "resolved",
      note: "Rotada en AWS",
    });
  });

  it("permite saltos de línea en la nota pero no otros caracteres de control", () => {
    expect(statusChangeSchema.safeParse({ id: ID, status: "ignored", note: "línea 1\nlínea 2" }).success).toBe(true);
    expect(statusChangeSchema.safeParse({ id: ID, status: "ignored", note: "a\u0007b" }).success).toBe(false);
  });

  it.each([
    [{ id: "x", status: "resolved", note: "" }],
    [{ id: ID, status: "deleted", note: "" }],
    [{ id: ID, status: "resolved", note: "x".repeat(501) }],
  ])("rechaza %j", (input) => {
    expect(statusChangeSchema.safeParse(input).success).toBe(false);
  });
});
