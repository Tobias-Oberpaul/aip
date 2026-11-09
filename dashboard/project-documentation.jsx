import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { DashboardHeader } from './dashboard-header';
import { ProjectDoc } from './project-doc';

const projectIndex = { path: 'index.md', label: 'Documentation' };

export function ProjectDocumentation({ title, notification, onClose }) {
  const dialog = useRef(null);
  const back = useRef(null);
  const [notes, setNotes] = useState([projectIndex]);
  const { path } = notes.at(-1);
  const isIndex = notes.length === 1;
  const openNote = useCallback((path, label) => {
    setNotes(previous => previous.at(-1).path === path ? previous : [...previous, { path, label }]);
  }, []);

  useLayoutEffect(() => { dialog.current.showModal(); }, []);
  useLayoutEffect(() => { (back.current ?? dialog.current).focus(); }, [notes.length, path]);

  function goBack() {
    setNotes(previous => previous.slice(0, -1));
  }

  return <dialog ref={dialog} onClose={onClose} aria-labelledby="project-documentation-title"
    className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-background text-foreground">
    <div className="flex h-full flex-col">
      <h2 id="project-documentation-title" className="sr-only">Project documentation</h2>
      <DashboardHeader title={title} documentation notification={notification} onNavigate={() => dialog.current.close()}/>
      {!isIndex && <nav aria-label="Documentation path" className="project-doc-breadcrumb shrink-0 border-b text-sm">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {notes.map(({ path, label }, index) => (
            <li key={`${index}:${path}`} className="flex min-w-0 max-w-full items-center gap-2">
              {index > 0 && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true"/>}
              {index === notes.length - 1
                ? <span aria-current="page" className="min-w-0 break-words font-semibold">{label}</span>
                : <button type="button" className="min-w-0 break-words text-left text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setNotes(previous => previous.slice(0, index + 1))}>{label}</button>}
            </li>
          ))}
        </ol>
      </nav>}
      <ProjectDoc key={path} note={path} onOpen={openNote} onBack={isIndex ? undefined : goBack} backRef={back} container={dialog}/>
    </div>
  </dialog>;
}
