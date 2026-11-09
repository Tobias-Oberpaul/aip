import {Card} from '@/design-system/components/ui/card';
import {Button} from '@/design-system/components/ui/button';
import {useLayoutEffect,useRef} from 'react';


import {DocumentationToc} from '@/design-system/documentation-toc';

export function Documentation({sections,html,sourceUrl,header}){
 const root=useRef(null);
 const article=useRef(null);
 useLayoutEffect(()=>{
   const content=document.createRange().createContextualFragment(html);
   const nodes=[...content.childNodes];
   article.current.prepend(content);
   return()=>nodes.forEach(node=>node.remove());
 },[html]);
 return <div className="documentation" ref={root}>
 <DocumentationToc sections={sections} root={root} article={article} header={header}/>
 <article ref={article}>
 <footer className="docs-download" aria-labelledby="docs-download-title">
   <Card className="docs-download-card">
     <h2 id="docs-download-title">Start tracking your project</h2>
     <p>Set up AI Performance in your own clone and choose which tools to record.</p>
     <Button asChild><a href={sourceUrl}>Open the repository</a></Button>
   </Card>
 </footer>
 </article></div>;
}
