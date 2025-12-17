import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode, Dispatch, SetStateAction } from "react";
import type { ImportQueueItem } from "../types/censusImport";

interface CensusImportQueueContextValue {
  queueItems: ImportQueueItem[];
  setQueueItems: Dispatch<SetStateAction<ImportQueueItem[]>>;
  isRunning: boolean;
  setIsRunning: Dispatch<SetStateAction<boolean>>;
  currentItemId: string | null;
  setCurrentItemId: Dispatch<SetStateAction<string | null>>;
  currentYearProcessing: number | null;
  setCurrentYearProcessing: Dispatch<SetStateAction<number | null>>;
  derivedStatusLabel: string | null;
  setDerivedStatusLabel: Dispatch<SetStateAction<string | null>>;
  isDropdownOpen: boolean;
  setIsDropdownOpen: Dispatch<SetStateAction<boolean>>;
  openDropdown: () => void;
  closeDropdown: () => void;
  toggleDropdown: () => void;
}

const CensusImportQueueContext = createContext<CensusImportQueueContextValue | null>(null);

export const CensusImportQueueProvider = ({ children }: { children: ReactNode }) => {
  const [queueItems, setQueueItems] = useState<ImportQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentItemId, setCurrentItemId] = useState<string | null>(null);
  const [currentYearProcessing, setCurrentYearProcessing] = useState<number | null>(null);
  const [derivedStatusLabel, setDerivedStatusLabel] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const value = useMemo(
    () => ({
      queueItems,
      setQueueItems,
      isRunning,
      setIsRunning,
      currentItemId,
      setCurrentItemId,
      currentYearProcessing,
      setCurrentYearProcessing,
      derivedStatusLabel,
      setDerivedStatusLabel,
      isDropdownOpen,
      setIsDropdownOpen,
      openDropdown: () => setIsDropdownOpen(true),
      closeDropdown: () => setIsDropdownOpen(false),
      toggleDropdown: () => setIsDropdownOpen((prev) => !prev),
    }),
    [currentItemId, currentYearProcessing, derivedStatusLabel, isDropdownOpen, isRunning, queueItems],
  );

  return <CensusImportQueueContext.Provider value={value}>{children}</CensusImportQueueContext.Provider>;
};

export const useCensusImportQueue = () => {
  const ctx = useContext(CensusImportQueueContext);
  if (!ctx) {
    throw new Error("useCensusImportQueue must be used within CensusImportQueueProvider");
  }
  return ctx;
};
