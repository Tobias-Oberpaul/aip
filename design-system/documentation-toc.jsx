import {useEffect,useRef,useState} from 'react';
import {createGrowTransition} from '@tobiasoberpaul/mdk';
import {ArrowLeft,ChevronRight} from 'lucide-react';
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from '@/design-system/components/ui/tooltip';
function createTocMarker(element){
 let motion,from='idle',to='idle',target='idle';
 return {
   set(next){
     if(next===target)return;
     target=next;
     if(motion&&next===from){motion.close();return;}
     if(motion&&next===to){motion.open();return;}
     const style=getComputedStyle(element);
     const width=style.width,color=style.color;
     const source=element.dataset.length??'idle';
     // A retargeted frame may be between sizes, so only reuse settled endpoints.
     from=motion&&(motion.state==='opening'||motion.state==='closing')?undefined:source;
     motion?.destroy();
     to=next;
     element.style.width=width;
     element.style.color=color;
     motion=createGrowTransition({
       content:element,trigger:element,axis:'width',
       onStateChange(state){
         if(state==='opening'){
           element.dataset.length=to;
           element.style.removeProperty('width');
           element.style.removeProperty('color');
         }
         if(state==='closed')element.dataset.length=source;
       },
     });
     motion.open();
   },
   destroy(){
     motion?.destroy();
     delete element.dataset.length;
   },
 };
}

export function DocumentationToc({sections,linkedNotes=[],root,article,header,container,onNavigate,onOpenNote,onBack,backRef}){
 const nav=useRef(null),[active,setActive]=useState({current:undefined,visible:[]});
 const hasBack=Boolean(onBack);
 useEffect(()=>{
   const scroller=root.current;
   if(!sections.length&&!linkedNotes.length&&!hasBack)return;
   const toc=nav.current;
   const headerElement=header?.current;
   const compact=matchMedia('(max-width:1279.98px)');
   const links=[...toc.querySelectorAll('a.docs-toc-section')];
   const targets=links.map(link=>article.current.querySelector('#'+CSS.escape(link.hash.slice(1))));
   let markers=[];
   let frame=0;
   function update(){
     frame=0;
     scroller.dataset.scrollable=String(scroller.scrollHeight>scroller.clientHeight+1);
     const rail=toc.getBoundingClientRect();
     scroller.style.setProperty('--docs-toc-height',rail.height+'px');
     const viewport=scroller.getBoundingClientRect();
     const anchorInset=parseFloat(getComputedStyle(scroller).scrollPaddingTop)||0;
     const visibleTop=Math.max(viewport.top,headerElement?.getBoundingClientRect().bottom??0,compact.matches?rail.bottom:0);
     const top=Math.max(viewport.top+anchorInset,visibleTop);
     const atEnd=scroller.scrollTop>0&&scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop<=1;
     const limit=atEnd?viewport.bottom:top+1;
     const visible=targets.flatMap((target,index)=>{
       if(!target)return [];
       const rect=target.getBoundingClientRect();
       return rect.bottom>visibleTop&&rect.top<viewport.bottom?[{index,id:target.id,top:rect.top}]:[];
     });
     const current=visible.reduce((selected,section)=>section.top<limit?section:selected,visible[0]);
     const ids=visible.map(section=>section.id);
     markers.forEach((marker,index)=>{
       const isVisible=offset=>ids.includes(targets[index+offset]?.id);
       marker.set(isVisible(0)?'active':isVisible(-1)||isVisible(1)?'nearby':'idle');
     });
     setActive(previous=>previous.current===current?.id&&previous.visible.length===ids.length&&
       ids.every((id,index)=>id===previous.visible[index])?previous:{current:current?.id,visible:ids});
     if(!current)return;
     // Only move the TOC rail so tracking never scrolls the article back.
     const link=links[current.index].getBoundingClientRect();
     const gutter=compact.matches?parseFloat(getComputedStyle(toc).paddingLeft):0;
     const left=rail.left+toc.clientLeft+gutter,topEdge=rail.top+toc.clientTop;
     const backBounds=backRef?.current?.getBoundingClientRect();
     const visibleLeft=compact.matches?Math.max(left,backBounds?.right??left):left;
     const visibleTopEdge=compact.matches?topEdge:Math.max(topEdge,backBounds?.bottom??topEdge);
     toc.scrollLeft+=Math.min(0,link.left-visibleLeft)+Math.max(0,link.right-left-toc.clientWidth+2*gutter);
     toc.scrollTop+=Math.min(0,link.top-visibleTopEdge)+Math.max(0,link.bottom-topEdge-toc.clientHeight);
   }
   function schedule(){if(!frame)frame=requestAnimationFrame(update);}
   function configureMarkers(){
     markers.forEach(marker=>marker.destroy());
     markers=compact.matches?[]:links.map(link=>createTocMarker(link.querySelector('.docs-toc-marker')));
     schedule();
   }
   compact.addEventListener('change',configureMarkers);
   configureMarkers();
   scroller.addEventListener('scroll',schedule,{passive:true});
   const resize=new ResizeObserver(schedule);resize.observe(scroller);resize.observe(article.current);resize.observe(toc);if(headerElement)resize.observe(headerElement);
   update();
   const initial=!onNavigate&&targets.find(target=>target&&'#'+target.id===location.hash);
   const anchorFrame=requestAnimationFrame(()=>{if(initial)scroller.scrollTop+=initial.getBoundingClientRect().top-scroller.getBoundingClientRect().top-(parseFloat(getComputedStyle(scroller).scrollPaddingTop)||0);});
   return()=>{cancelAnimationFrame(anchorFrame);scroller.removeEventListener('scroll',schedule);resize.disconnect();cancelAnimationFrame(frame);compact.removeEventListener('change',configureMarkers);markers.forEach(marker=>marker.destroy());};
 },[sections,linkedNotes.length,root,article,header,onNavigate,hasBack,backRef]);
 if(!sections.length&&!linkedNotes.length&&!hasBack)return null;
 return <nav ref={nav} className="docs-toc" aria-label={linkedNotes.length?'Documentation contents':'Documentation sections'}>

   <TooltipProvider>
     {onBack&&<Tooltip>
       <TooltipTrigger asChild><button ref={backRef} type="button" className="docs-toc-section docs-toc-page docs-toc-back"
         aria-label="Back" onClick={onBack}>
         <ArrowLeft className="docs-toc-page-icon" aria-hidden="true"/>
         <span className="docs-toc-label">Back</span>
       </button></TooltipTrigger>
       <TooltipContent container={container} side="right" className="docs-toc-tooltip">Back</TooltipContent>
     </Tooltip>}
     {sections.map(({title,id})=>{
       return <Tooltip key={id}>
         <TooltipTrigger asChild><a className="docs-toc-section" href={'#'+id} onClick={onNavigate ? event=>{event.preventDefault();onNavigate(id);} : undefined} aria-label={title} aria-current={active.current===id?'location':undefined} data-active={active.visible.includes(id)}>
           <span className="docs-toc-marker" aria-hidden="true"/>
           <span className="docs-toc-label">{title}</span>
         </a></TooltipTrigger>
         <TooltipContent container={container} side="right" className="docs-toc-tooltip">{title}</TooltipContent>
       </Tooltip>;
     })}
     {linkedNotes.map(({path,title},index)=><Tooltip key={path}>
       <TooltipTrigger asChild><button type="button" className="docs-toc-section docs-toc-page"
         data-first-linked-note={index===0} aria-label={title} onClick={()=>onOpenNote(path,title)}>
         <ChevronRight className="docs-toc-page-icon" aria-hidden="true"/>
         <span className="docs-toc-label">{title}</span>
       </button></TooltipTrigger>
       <TooltipContent container={container} side="right" className="docs-toc-tooltip">{title}</TooltipContent>
     </Tooltip>)}
   </TooltipProvider>
 </nav>;
}
