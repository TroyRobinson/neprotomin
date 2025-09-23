import type { Category } from "../types/organization";

export interface StatSeed {
  name: string;
  category: Category;
}

export const statsSeedData: StatSeed[] = [
  { name: "Chronic Absenteeism", category: "education" },
  { name: "3rd Grade Reading Percent Proficient", category: "education" },
  // Health
  { name: "ER Visits Rate", category: "health" },
  { name: "Life Expectancy", category: "health" },
  // Justice
  { name: "Juvenile Arrest Rate", category: "justice" },
  { name: "Incarceration Rate", category: "justice" },
  // Economy
  { name: "Unemployment Rate", category: "economy" },
  { name: "Median Household Income", category: "economy" },
];
