export type StatDataType = "count" | "percent" | "rate" | "years" | "currency";

export interface StatData {
  id: string;
  statId: string;
  name: string; // e.g., "root" or a sub-stat like "BlackPopulation"
  parentArea: string; // e.g., "Tulsa County" or state bucket
  boundaryType: string; // e.g., "ZIP"
  date: string; // e.g., "2025"
  type: StatDataType;
  data: Record<string, number>; // map of area key (e.g., ZIP code) to value
}
