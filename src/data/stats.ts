import type { Category } from "../types/organization";

export interface StatSeed {
  name: string;
  category: Category;
}

export const statsSeedData: StatSeed[] = [
  // Demographic baseline
  { name: "Population", category: "economy" },
  { name: "Chronic Absenteeism", category: "education" },
  { name: "3rd Grade Reading Percent Proficient", category: "education" },
  { name: "High School Graduation Percent", category: "education" },
  // Health
  { name: "ER Visits Percent", category: "health" },
  { name: "Life Expectancy", category: "health" },
  { name: "Obesity Percent", category: "health" },
  // Justice
  { name: "Juvenile Arrest Percent", category: "justice" },
  { name: "Incarceration Percent", category: "justice" },
  { name: "Recidivism Percent", category: "justice" },
  // Economy
  { name: "Unemployment Percent", category: "economy" },
  { name: "Median Household Income", category: "economy" },
];
