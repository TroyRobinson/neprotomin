import type { Category } from "./organization";

export interface Stat {
  id: string;
  name: string;
  category: Category;
  goodIfUp?: boolean;
  featured?: boolean;
}
