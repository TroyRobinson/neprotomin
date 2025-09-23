interface SelectOption {
  value: string;
  label: string;
}

interface SelectOptions<T extends string> {
  id?: string;
  value: T;
  options: SelectOption[];
  onChange: (value: T) => void;
  className?: string;
}

export interface SelectController<T extends string> {
  element: HTMLElement;
  setValue: (value: T) => void;
  destroy: () => void;
}

export const createSelect = <T extends string>({
  id,
  value,
  options,
  onChange,
  className = "",
}: SelectOptions<T>): SelectController<T> => {
  let currentValue: T = value;

  // Create wrapper for custom styling
  const wrapper = document.createElement("div");
  wrapper.className = "relative";

  const select = document.createElement("select");
  if (id) select.id = id;
  
  const baseClasses = "h-6 w-full rounded border border-slate-300 bg-white pl-2 pr-6 text-xs text-slate-700 shadow-sm transition appearance-none focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50";
  select.className = className ? `${baseClasses} ${className}` : baseClasses;

  // Create custom dropdown arrow
  const arrow = document.createElement("div");
  arrow.className = "absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 pointer-events-none text-slate-400 dark:text-slate-500";
  arrow.innerHTML = `
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
    </svg>
  `;

  select.style.appearance = "none";
  select.style.webkitAppearance = "none";
  select.style.mozAppearance = "none";

  options.forEach((option) => {
    const optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    select.appendChild(optionElement);
  });

  select.value = currentValue;

  const handleChange = () => {
    const nextValue = select.value as T;
    if (nextValue === currentValue) return;
    currentValue = nextValue;
    onChange(currentValue);
  };

  select.addEventListener("change", handleChange);

  // Assemble the wrapper
  wrapper.appendChild(select);
  wrapper.appendChild(arrow);

  const setValue = (newValue: T) => {
    if (newValue === currentValue) return;
    currentValue = newValue;
    select.value = newValue;
  };

  return {
    element: wrapper,
    setValue,
    destroy: () => {
      select.removeEventListener("change", handleChange);
    },
  };
};
