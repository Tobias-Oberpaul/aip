import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { DocumentationToc } from '@/design-system/documentation-toc';

export function ProjectDoc({ note, onOpen, onBack, backRef, container }) {
  const [content, setContent] = useState(null);
  const [documentPath, setDocumentPath] = useState(note);
  const [error, setError] = useState('');
  const [sections, setSections] = useState([]);
  const [linkedNotes, setLinkedNotes] = useState([]);
  const scroller = useRef(null);
  const article = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/project-doc?' + new URLSearchParams({ note }), {
          signal: controller.signal,
        });
        if (!response.ok) {
          const details = await response.json().catch(() => null);
          if (controller.signal.aborted) return;
          setError(details?.error ?? (response.status === 404
            ? 'This dashboard server does not have the documentation endpoint. Restart it with npm start and reload this page.'
            : 'Could not load this document.'));
          return;
        }
        const markdown = await response.text();
        if (!controller.signal.aborted) {
          setDocumentPath(response.headers.get('X-AIP-Document-Path') ?? 'docs/context/' + note);
          setContent(markdown);
        }
      } catch {
        if (!controller.signal.aborted) setError('Could not connect to the dashboard server.');
      }
    }
    load();
    return () => controller.abort();
  }, [note]);

  useLayoutEffect(() => {
    if (content === null) return;
    const headings = [...article.current.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter(heading => heading.textContent.trim());
    const entries = headings.map((heading, index) => {
      heading.id = `aip-doc-section-${index + 1}`;
      heading.tabIndex = -1;
      return { id: heading.id, title: heading.textContent.trim() };
    });
    setSections(entries);
    const linked = new Map();
    for (const link of article.current.querySelectorAll('[data-project-note]')) {
      const title = link.textContent.trim();
      if (title && !linked.has(link.dataset.projectNote)) linked.set(link.dataset.projectNote, title);
    }
    setLinkedNotes([...linked].map(([path, title]) => ({ path, title })));
  }, [content]);

  const jumpTo = useCallback(id => {
    const heading = article.current.querySelector('#' + id);
    const viewport = scroller.current;
    heading.focus({ preventScroll: true });
    const inset = parseFloat(getComputedStyle(viewport).scrollPaddingTop) || 0;
    viewport.scrollTop += heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top - inset;
  }, []);

  const DocLink = useCallback(function DocLink({ href, children }) {
    if (href && /^https?:\/\//i.test(href)) {
      return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">{children}</a>;
    }
    if (!href || /^(?:[#/]|[\w+.-]+:)/.test(href)) return <>{children}</>;
    const root = new URL('/', window.location.origin);
    const target = new URL(href, new URL(documentPath, root));
    if (target.origin === root.origin && target.pathname.toLowerCase().endsWith('.md')) {
      const path = target.pathname.slice(1);
      return <button type="button" data-project-note={path} className="inline text-left underline underline-offset-4"
        onClick={event => onOpen(path, event.currentTarget.textContent.trim() || path)}>
        {children}
      </button>;
    }
    return <>{children}</>;
  }, [documentPath, onOpen]);

  return <div ref={scroller} className="project-doc-reader min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
    <DocumentationToc sections={sections} linkedNotes={linkedNotes} root={scroller} article={article}
      container={container.current} onNavigate={jumpTo} onOpenNote={onOpen} onBack={onBack} backRef={backRef}/>
      <article ref={article} className="mx-auto max-w-3xl space-y-4 break-words pb-8 leading-relaxed
        [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1
        [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:pt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-semibold
        [&_ol]:list-decimal [&_ol]:ps-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted
        [&_pre]:p-3 [&_ul]:list-disc [&_ul]:ps-5">
        <p className="text-xs text-muted-foreground"><code>{documentPath}</code></p>
        {error ? <p role="alert">{error}</p>
          : content === null ? <p role="status">Loading documentation…</p>
            : <Markdown skipHtml disallowedElements={['img']} components={{ a: DocLink }}>{content}</Markdown>}
      </article>
  </div>;
}
