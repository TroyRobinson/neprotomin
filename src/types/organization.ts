export type Category = "health" | "education" | "justice" | "economy";

export interface Organization {
  id: string;
  name: string;
  url: string;
  latitude: number;
  longitude: number;
  category: Category;
}

export const TULSA_CENTER = {
  latitude: 36.1539,
  longitude: -95.9928,
};
