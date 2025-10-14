import { useState } from "react";

interface Command {
  title: string;
  command: string;
  description: string;
}

const commands: Command[] = [
  {
    title: "Clean Synthetic Data",
    command: "npm run ne:clean:synthetic",
    description: "Remove old synthetic/demo data (run this first if you see random data)",
  },
  {
    title: "Clean Unnamed Stats",
    command: "npm run ne:clean:unnamed",
    description: "Remove stats with placeholder names like 'Stat eRGj2qGP' (no proper title from NE)",
  },
  {
    title: "Preview Data Import",
    command: "npm run ne:etl:preview:staging",
    description: "Preview 10 stats from Neighborhood Explorer (no database writes)",
  },
  {
    title: "Quick Bulk Import",
    command: "npm run ne:bulk:zip:import:staging -- --limit=10 --years=3",
    description: "Import 10 recent stats with 3 years of ZIP-level data",
  },
  {
    title: "Import Single Stat",
    command: "npm run ne:geo:series:staging -- --stat=<HASH_ID> --geometry=zip --start=2020-01-01 --end=2024-12-31",
    description: "Import all years for a specific stat (replace <HASH_ID> with actual NE stat ID)",
  },
  {
    title: "Migrate Timestamps",
    command: "npm run ne:migrate:timestamps",
    description: "Backfill createdOn, lastUpdated, and statTitle for existing records (run once after schema update)",
  },
];

export const DataScreen = () => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    });
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Data Import Commands
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Use these terminal commands to import statistics from Neighborhood Explorer into your database.
        </p>
      </div>

      <div className="space-y-4">
        {commands.map((cmd, index) => (
          <div
            key={index}
            className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-white">
                  {cmd.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  {cmd.description}
                </p>
              </div>
            </div>

            <div className="relative">
              <pre className="overflow-x-auto rounded-md bg-slate-50 p-3 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                <code>{cmd.command}</code>
              </pre>
              <button
                onClick={() => copyToClipboard(cmd.command, index)}
                className="absolute right-2 top-2 rounded-md bg-white px-2 py-1 text-xs text-slate-600 shadow-sm hover:bg-slate-100 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                title="Copy to clipboard"
              >
                {copiedIndex === index ? "✓ Copied" : "Copy"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950">
        <h3 className="font-semibold text-blue-900 dark:text-blue-100">
          📚 Documentation
        </h3>
        <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">
          For complete documentation, see:
        </p>
        <ul className="mt-2 space-y-1 text-sm text-blue-800 dark:text-blue-200">
          <li>• <code className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">ETL_USER_GUIDE.md</code> - Complete user guide with step-by-step instructions</li>
          <li>• <code className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">TROUBLESHOOTING_SYNTHETIC_DATA.md</code> - Fix synthetic data issues</li>
          <li>• <code className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900">ETL_terminal_tools.md</code> - Technical reference</li>
        </ul>
      </div>

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
        <h3 className="font-semibold text-amber-900 dark:text-amber-100">
          ⚠️ Important Notes
        </h3>
        <ul className="mt-2 space-y-2 text-sm text-amber-800 dark:text-amber-200">
          <li>
            <strong>First time setup?</strong> Run <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">npm run ne:clean:synthetic</code> to remove demo data before importing real data.
          </li>
          <li>
            <strong>All imports are idempotent</strong> - safe to run multiple times, won't create duplicates.
          </li>
          <li>
            <strong>Test with dry runs</strong> - Add <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">:dry</code> to command names to preview changes (e.g., <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">npm run ne:clean:synthetic:dry</code>).
          </li>
          <li>
            <strong>Environment required</strong> - Ensure your <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">.env</code> file has <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">VITE_INSTANT_APP_ID</code> and <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900">INSTANT_APP_ADMIN_TOKEN</code>.
          </li>
        </ul>
      </div>
    </div>
  );
};

export default DataScreen;
