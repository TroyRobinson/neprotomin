import type { Category } from "./organization";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "food", label: "Food" },
  // { id: "health", label: "Health" },
  // { id: "education", label: "Education" },
  // { id: "justice", label: "Justice" },
  // { id: "economy", label: "Economy" },
];

export const getCategoryLabel = (id: Category): string => {
  const found = CATEGORIES.find((c) => c.id === id);
  return found ? found.label : id;
};
