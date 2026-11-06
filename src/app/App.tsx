import { AlertTriangle, Loader2 } from 'lucide-react';
import { lazy, Suspense, useEffect } from 'react';
import { goHome, openProjectSession, refreshCustomLibrary, useRouteStore, useSessionStore } from '@/app/services';
import { Button, TooltipProvider } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { HomeScreen } from './home/HomeScreen';

/** The shell, its registrations and every feature, loaded the first time a project is opened. */
const EditorShell = lazy(() => import('./editorEntry'));

function Spinner() {
  return (
    <div className="grid h-full place-items-center text-ink-muted" aria-busy="true">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function EditorRoute({ projectId }: { projectId: string }) {
  const project = useProjectStore((s) => s.project);
  const { loading, error, errorDetails } = useSessionStore();
  useEffect(() => {
    void openProjectSession(projectId);
  }, [projectId]);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div role="alert" className="max-w-md rounded-lg border border-line bg-panel p-5">
          <div className="mb-2 flex items-center gap-2 text-ink">
            <AlertTriangle className="size-4 text-warn" />
            <h1 className="text-[15px] font-semibold">This project could not be opened</h1>
          </div>
          <p className="text-[13px] text-ink-muted">{error}</p>
          {errorDetails.length > 0 && (
            <ul className="num mt-2 list-disc pl-5 text-2xs text-ink-faint">
              {errorDetails.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-muted">You can restore an earlier backup from the project list.</p>
          <Button className="mt-4" variant="primary" onClick={() => void goHome()}>
            Back to projects
          </Button>
        </div>
      </div>
    );
  }
  if (loading || !project || project.id !== projectId) return <Spinner />;
  return (
    <Suspense fallback={<Spinner />}>
      <EditorShell />
    </Suspense>
  );
}

export function App() {
  const route = useRouteStore((s) => s.route);
  useEffect(() => {
    void refreshCustomLibrary();
  }, []);
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
      {route.screen === 'editor' ? <EditorRoute projectId={route.projectId} /> : <HomeScreen />}
    </TooltipProvider>
  );
}
