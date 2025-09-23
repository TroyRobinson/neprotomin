export type AreaType = "ZIP";

export interface Area {
  id: string;
  key: string; // e.g., ZIP code
  type: AreaType;
  population: number; // total population
  avgAge: number; // average age (years)
  marriedPercent: number; // percent in [0, 100]
}

