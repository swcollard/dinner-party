import { z } from "zod";
import { type Need, parseNeeds } from "../domain/diet";

/** Form fields of NeedFields, to include in any schema that reads them. */
export const needFields = {
  need: z
    .union([z.string(), z.array(z.string())])
    .default([])
    .transform((value) => [value].flat()),
  other: z.string().default(""),
};

export const needsForm = z.object(needFields);

export function toNeeds(data: z.infer<typeof needsForm>): Need[] {
  return parseNeeds(data.need, data.other);
}
