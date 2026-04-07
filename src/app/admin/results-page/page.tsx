import { loadRallyConfig } from "@/lib/rally/config-file";
import { ResultsPageForm } from "../_components/results-page-form";

export default async function AdminResultsPagePage() {
  const config = await loadRallyConfig();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Results page</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Controls what visitors see on the public homepage: headings, status
          chip, featured rally, and footer note.
        </p>
      </div>
      <ResultsPageForm
        site={config.site}
        events={config.events.map((e) => ({ id: e.id, name: e.name }))}
      />
    </div>
  );
}
