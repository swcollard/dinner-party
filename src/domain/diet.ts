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

/** Reads the checkboxes ("allergen:eggs") and free text of NeedFields, ignoring anything unknown. */
export function parseNeeds(checked: string[], other: string): Need[] {
  const known: Need[] = [
    ...ALLERGENS.map((label) => ({ kind: "allergen" as const, label })),
    ...DIETS.map((label) => ({ kind: "diet" as const, label })),
  ];
  const needs = known.filter((n) => checked.includes(`${n.kind}:${n.label}`));
  const text = other.trim().slice(0, 200);
  return text ? [...needs, { kind: "other", label: text }] : needs;
}

export function describeNeed(need: Need): string {
  return need.kind === "allergen" ? `${need.label} allergy` : need.label;
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
