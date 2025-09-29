import type { Category } from "../types/organization";

export interface StatSeed {
  name: string;
  category: Category;
  goodIfUp: boolean;
}

export const statsSeedData: StatSeed[] = [
  // Demographic baseline
  { name: "Population", category: "economy", goodIfUp: true },
  { name: "Chronic Absenteeism", category: "education", goodIfUp: false },
  { name: "3rd Grade Reading Percent Proficient", category: "education", goodIfUp: true },
  { name: "High School Graduation Percent", category: "education", goodIfUp: true },
  // Health
  { name: "ER Visits Percent", category: "health", goodIfUp: false },
  { name: "Life Expectancy", category: "health", goodIfUp: true },
  { name: "Obesity Percent", category: "health", goodIfUp: false },
  // Justice
  { name: "Juvenile Arrest Percent", category: "justice", goodIfUp: false },
  { name: "Incarceration Percent", category: "justice", goodIfUp: false },
  { name: "Recidivism Percent", category: "justice", goodIfUp: false },
  // Economy
  { name: "Unemployment Percent", category: "economy", goodIfUp: false },
  { name: "Median Household Income", category: "economy", goodIfUp: true },
];
