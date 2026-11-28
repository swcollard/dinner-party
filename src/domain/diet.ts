export interface Need {
  kind: "allergen" | "diet" | "other";
  label: string;
}

export const ALLERGENS = [
  "dairy", "eggs", "fish", "gluten", "peanuts", "sesame", "shellfish", "soy", "tree nuts",
];
export const DIETS = [
  "vegetarian", "vegan", "pescatarian", "halal", "kosher", "no beef", "no pork", "no alcohol",
];

/**
 * Every choice in the one "Dietary restrictions" list. Allergies keep their own kind, so hosts can tell
 * them apart from preferences and dishes can be checked against them.
 */
export const RESTRICTIONS: Need[] = [
  ...DIETS.map((label) => ({ kind: "diet" as const, label })),
  ...ALLERGENS.map((label) => ({ kind: "allergen" as const, label })),
];

/** Reads the checkboxes ("allergen:eggs") and free text of NeedFields, ignoring anything unknown or text without "other" checked. */
export function parseNeeds(checked: string[], other: string): Need[] {
  const needs = RESTRICTIONS.filter((n) => checked.includes(`${n.kind}:${n.label}`));
  const text = checked.includes("other") ? other.trim().slice(0, 200) : "";
  return text ? [...needs, { kind: "other", label: text }] : needs;
}

// Labels are stored as listed above; these read better before "allergy".
const SINGULAR: Record<string, string> = { eggs: "egg", peanuts: "peanut", "tree nuts": "tree nut" };

export function describeNeed(need: Need): string {
  return need.kind === "allergen" ? `${SINGULAR[need.label] ?? need.label} allergy` : need.label;
}

/** Distinct needs with how many people have each, for readers who may not see names. */
export function anonymousSummary(everyone: Need[][]): string[] {
  const counts = new Map<string, number>();
  for (const need of everyone.flat()) {
    const text = describeNeed(need);
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts].map(([text, n]) => (n > 1 ? `${text} (${n} people)` : text));
}
