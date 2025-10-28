/**
 * Utility functions for formatting stat values with appropriate symbols
 */

export const formatStatValue = (value: number, type: string): string => {
  if (!isFinite(value)) return "";
  
  switch (type) {
    case "percent":
      // Accept values stored as fractions (0–1) or whole percentages (0–100)
      {
        const percentValue = value <= 1 ? value * 100 : value;
        return `${Math.round(percentValue * 10) / 10}%`;
      }
    case "currency":
      return new Intl.NumberFormat("en-US", { 
        style: "currency", 
        currency: "USD", 
        maximumFractionDigits: 0 
      }).format(Math.round(value));
    case "years":
    case "rate":
      return (Math.round(value * 10) / 10).toLocaleString("en-US");
    case "count":
    default:
      return Math.round(value).toLocaleString("en-US");
  }
};

/**
 * Format stat value for compact display (used in map pills)
 * Handles large numbers with k/M suffixes and adds appropriate symbols
 */
export const formatStatValueCompact = (value: number, type: string): string => {
  if (!isFinite(value)) return "";
  
  switch (type) {
    case "percent":
      {
        const percentValue = value <= 1 ? value * 100 : value;
        if (percentValue >= 100) {
          return `${Math.round(percentValue)}%`;
        }
        return `${Math.round(percentValue * 10) / 10}%`;
      }
    case "currency":
      if (value >= 1000000) {
        return `$${(value / 1000000).toFixed(1)}M`;
      }
      if (value >= 1000) {
        return `$${(value / 1000).toFixed(0)}k`;
      }
      return `$${Math.round(value)}`;
    case "years":
    case "rate":
      if (value >= 1000) {
        return `${(value / 1000).toFixed(0)}k`;
      }
      return `${Math.round(value * 10) / 10}`;
    case "count":
    default:
      if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
      }
      if (value >= 1000) {
        return `${(value / 1000).toFixed(0)}k`;
      }
      return `${Math.round(value)}`;
  }
};
