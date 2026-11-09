import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { createContentTransition, createGrowTransition, createPresenceMotion } from '@tobiasoberpaul/mdk';
import { Button } from '@/design-system/components/ui/button';
import { badgeVariants } from '@/design-system/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/design-system/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/design-system/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/design-system/components/ui/tooltip';
import { ChevronRight, Info, X } from 'lucide-react';
import { ProjectDocumentation } from './project-documentation';
import { DashboardHeader } from './dashboard-header';

const formatter = new Intl.NumberFormat('en-GB');
const dateClock = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
function WorkTime({ item }) {
  if (!Number.isFinite(item.startedAt)) return null;
  const start = new Date(item.startedAt);
  const end = new Date(item.endedAt);
  const label = !Number.isFinite(item.endedAt) || end < start ? dateClock.format(start)
    : dateClock.formatRange(start, end);
  return <span className="mt-1 block text-xs font-normal text-muted-foreground">{label}</span>;
}
const number = (value) => Number.isFinite(value) ? formatter.format(value) : '–';
const contextPercent = value => Number.isFinite(value) ? `${number(Math.round(value))}%` : 'Unknown';
const storyPointScale = [1, 2, 3, 5, 8, 13, 20];
const storyPointOptions = items => [...new Set([
  ...storyPointScale, ...items.map(item => item.points).filter(Number.isFinite),
])].sort((a, b) => a - b);
const duration = (item) => {
  if (item.workSeconds === null) return item.minutes == null ? '–' : `${number(item.minutes)} min to acceptance`;
  const minutes = Math.floor(item.workSeconds / 60);
  const seconds = item.workSeconds% 60;
  return minutes ? `${number(minutes)} min ${number(seconds)} sec` : `${number(seconds)} sec`;
};
const stepTypes = { implementation: 'Implementation', feedback: 'Feedback', handoff: 'Handoff' };
const epicColors = [
  'border-sky-400/30 bg-sky-400/10 text-sky-300',
  'border-violet-400/30 bg-violet-400/10 text-violet-300',
  'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  'border-amber-400/30 bg-amber-400/10 text-amber-300',
  'border-rose-400/30 bg-rose-400/10 text-rose-300',
];

function EpicTag({ epic }) {
  if (!epic) return null;
  const hash = Array.from(epic).reduce((value, char) => (Math.imul(value, 31) + char.codePointAt(0)) >>> 0, 0);
  return <span className={badgeVariants({ variant: 'outline', className: epicColors[hash % epicColors.length] })}>{epic}</span>;
}

const scoreBand = score => !Number.isFinite(score) ? 3 : score >= 110 ? 0 : score >= 90 ? 1 : 2;

function DetailTooltip({ children, content, container }) {
  return <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent container={container}>{content}</TooltipContent>
  </Tooltip>;
}

const detailFocus = 'rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring';

function EfficiencyBadge({ score, labels, compact, tooltipContainer }) {
  if (!Number.isFinite(score)) return null;
  const rating = [
    { label: labels[0], color: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' },
    { label: 'Neutral', color: 'border-border bg-muted text-foreground' },
    { label: labels[1], color: 'border-rose-400/30 bg-rose-400/10 text-rose-300' },
  ][scoreBand(score)];
  const badge = <span className={badgeVariants({ variant: 'outline', className: `${rating.color} tabular-nums ${detailFocus}` })}
    tabIndex={compact ? undefined : 0}>
    {!compact && `${number(score)} · `}{rating.label}
  </span>;
  return <span className="mt-1 block">{compact ? badge : <DetailTooltip container={tooltipContainer}
    content="A score of 100 matches the project rate per story point. Higher scores indicate lower effort.">
    {badge}
  </DetailTooltip>}</span>;
}

const providerName = provider => ({ codex: 'Codex', kiro: 'Kiro' })[provider] ?? provider;
const effortNames = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High',
  xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
function runLabel({ provider, model, effort }) {
  return [providerName(provider), model, effort && (effortNames[effort] ?? effort)].filter(Boolean).join(' · ');
}

function RunUsage({ item }) {
  const metrics = new Map();
  for (const run of item.subtasks ?? [item]) {
    for (const { unit, value } of run.metrics ?? []) {
      const key = JSON.stringify([run.provider, unit]);
      metrics.set(key, (metrics.get(key) ?? 0) + value);
    }
  }
  const showCodex = item.provider === 'codex' || Number.isFinite(item.tokens) || !metrics.size;
  return <>{showCodex && <span className="block">{number(item.tokens)}{Number.isFinite(item.tokens) && ' tokens'}
    {item.partialUsage && <span className="text-muted-foreground"> · partial</span>}</span>}
    {[...metrics].map(([key, value]) => {
      const [provider, unit] = JSON.parse(key);
      return <span key={key} className="block">{number(value)} {unit} · {providerName(provider)}</span>;
    })}
  </>;
}

function PackageField({ label, children, className = '' }) {
  return <span className={`grid min-w-0 content-start gap-1 ${className}`}><span className="ticket-field-label text-xs text-muted-foreground">{label}</span><span>{children}</span></span>;
}

const rowLayout = 'ticket-row-layout grid w-full min-w-0 items-start justify-start gap-2 whitespace-normal break-words rounded-md p-3 pe-9 text-left text-sm';
const ticketRow = rowLayout + ' relative bg-muted/60';
const fieldLayout = 'ticket-fields grid min-w-0 gap-x-3 gap-y-2';

function TicketMetadata({ item, compact }) {
  const configurations = [...new Set([...item.subtasks, ...(item.legacyRunSettings ?? [])].map(runLabel).filter(Boolean))];
  return <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
    <EpicTag epic={item.epic}/>
    {configurations.map(label => <span key={label} className="text-xs text-muted-foreground">{label}</span>)}
    {compact ? Number.isFinite(item.startContext?.percent) &&
      <span className="text-xs text-muted-foreground">{contextPercent(item.startContext.percent)} context</span>
      : <span className="text-xs text-muted-foreground">Starting context · {contextPercent(item.startContext?.percent)}</span>}
  </span>;
}

const ticketMetricLabels = { points: 'Story points', usage: 'Usage', time: 'Work time', rework: 'Rework rounds' };

function TicketMetrics({ item, compact, tooltipContainer }) {
  return <span className={`${fieldLayout} font-normal ${compact ? 'ticket-compact-metrics' : ''}`}>
      <PackageField label={ticketMetricLabels.points}>{number(item.points)}</PackageField>
      <PackageField label={ticketMetricLabels.usage}><RunUsage item={item}/>
        {Number.isFinite(item.tokensPerPoint) && <span className="block text-xs text-muted-foreground">
          {number(Math.round(item.tokensPerPoint))} tokens / SP
        </span>}
        <EfficiencyBadge score={item.tokenScore} labels={['Low usage', 'High usage']} compact={compact} tooltipContainer={tooltipContainer}/>
      </PackageField>
      <PackageField label={ticketMetricLabels.time}>{duration(item)}
        {Number.isFinite(item.workSecondsPerPoint) && <span className="block text-xs text-muted-foreground">
          {duration({ workSeconds: Math.round(item.workSecondsPerPoint) })} / SP
        </span>}
        <EfficiencyBadge score={item.timeScore} labels={['Fast', 'Slow']} compact={compact} tooltipContainer={tooltipContainer}/>
      </PackageField>
      <PackageField label={ticketMetricLabels.rework}>{number(item.correctionRounds)}</PackageField>
  </span>;
}

function PackageItem({ item, onOpen }) {
  return <li className="min-w-0">
    <Button type="button" variant="ghost" className={ticketRow + ' h-auto'} aria-haspopup="dialog" onClick={onOpen}>
      <span className="min-w-0 font-semibold">{item.name}<WorkTime item={item}/><TicketMetadata item={item} compact/></span>
      <TicketMetrics item={item} compact/>
      <ChevronRight aria-hidden="true" className="absolute end-3.5 top-1/2 size-4 -translate-y-1/2"/>
    </Button>
  </li>;
}

function TicketDetails({ item, onClose }) {
  const drawer = useRef(null);
  const [tooltipContainer, setTooltipContainer] = useState(null);
  const motion = useRef(null);
  const pressedBackdrop = useRef(false);
  useLayoutEffect(() => {
    const dialog = drawer.current;
    setTooltipContainer(dialog);
    const controller = createPresenceMotion({
      createTransition: lifecycle => createGrowTransition({
        content: dialog, axis: 'width', resize: 'transform', backdrop: 'native',
        reveal: dialog.firstElementChild, ...lifecycle,
      }),
      setPresent: present => {
        if (present && !dialog.open) dialog.showModal();
        if (!present && dialog.open) dialog.close();
      },
    });
    motion.current = controller;
    controller.setOpen(true);
    return () => controller.destroy();
  }, []);
  const dismiss = () => motion.current.setOpen(false);
  return <dialog ref={drawer} onClose={onClose} aria-labelledby="ticket-details-title"
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onPointerDown={event => { pressedBackdrop.current = event.target === event.currentTarget; }}
    onClick={event => {
      if (pressedBackdrop.current && event.target === event.currentTarget) dismiss();
      pressedBackdrop.current = false;
    }}
    className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-2xl overflow-hidden border-l border-border bg-card text-card-foreground backdrop:bg-black/60 [--motion-scale-from:0] [--motion-scale-origin:right_center]">
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b p-4 sm:p-6">
        <div className="min-w-0 break-words">
          <p className="text-xs text-muted-foreground">{item.id} · {item.accepted ? 'Accepted' : item.completed ? 'Completed' : 'Open'}</p>
          <h2 id="ticket-details-title" className="mt-1 text-xl font-semibold">{item.name}</h2>
          <WorkTime item={item}/>
          <TicketMetadata item={item}/>
        </div>
        <DetailTooltip content="Close ticket" container={tooltipContainer}>
          <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Close ticket"
            autoFocus onClick={dismiss}><X aria-hidden="true"/></Button>
        </DetailTooltip>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain break-words p-4 text-sm [container-type:inline-size] sm:p-6">
        {item.description && <section data-motion-content-group aria-labelledby="ticket-description-title">
          <h3 id="ticket-description-title" className="mb-2 font-semibold">Description</h3>
          <p className="whitespace-pre-wrap">{item.description}</p>
        </section>}
        <section data-motion-content-group aria-labelledby="ticket-metrics-title">
          <h3 id="ticket-metrics-title" className="mb-2 font-semibold">Metrics</h3>
          <TicketMetrics item={item} tooltipContainer={tooltipContainer}/>
        </section>
        {item.subtasks.length > 0 && <section data-motion-content-group aria-labelledby="ticket-history-title">
          <h3 id="ticket-history-title" className="mb-2 font-semibold">Work history</h3>
          <ul className="space-y-2" aria-label="Subtasks">
            {item.subtasks.map(step => <li key={step.key} className="space-y-2 rounded-md bg-muted/40 p-3">
              <div className="font-medium"><span className="text-muted-foreground">{stepTypes[step.kind]} · </span>{step.name}<WorkTime item={step}/>
                <span className="mt-1 block text-xs text-muted-foreground">{runLabel(step)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PackageField label="Usage"><RunUsage item={step}/></PackageField>
                <PackageField label="Work time">{duration(step)}</PackageField>
              </div>
            </li>)}
          </ul>
        </section>}
      </div>
    </div>
  </dialog>;
}

function measureEffort(tickets, rateField, totalField) {
  const measured = tickets.filter(item => Number.isFinite(item[rateField]));
  const points = measured.reduce((sum, item) => sum + item.points, 0);
  const total = measured.reduce((sum, item) => sum + item[totalField], 0);
  return { rate: points ? total / points : null, count: measured.length };
}

function EffortPerPoint({ tickets, title, rateField, totalField, format, comparison, compareWithProject }) {
  const overall = measureEffort(tickets, rateField, totalField);
  const delta = comparison?.change ?? null;
  const better = delta !== null && delta <= -0.1;
  const worse = delta !== null && delta >= 0.1;
  const rating = better ? (compareWithProject ? 'Lower effort' : 'Improved') : worse ? 'Higher effort' : 'Neutral';
  const badge = comparison ? `${rating} · ${contextChange.format(delta)}${compareWithProject ? ' vs. project' : ''}`
    : compareWithProject ? 'Not enough data' : 'No trend';
  const color = better ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
    : worse ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-border bg-muted text-foreground';
  const showRate = rate => rate === null ? '–' : format(Math.round(rate));
  const details = <>
    <p>All-time rate · {number(overall.count)} of {number(tickets.length)} completed, estimated tickets measured.</p>
    {compareWithProject ? (comparison ? <>
      <p className="mt-1">Last measured chat · {showRate(comparison.recent.rate)} vs. {showRate(comparison.baseline.rate)} for the rest of the project.</p>
      <p>{number(comparison.recent.count)} measured tickets in this chat and {number(comparison.baseline.count)} in the reference.</p>
    </> : <p className="mt-1">The project comparison needs 5 measured tickets in the last measured chat and 5 in the rest of the project, with a reference rate above zero.</p>) : comparison ? <>
      <p className="mt-1">Latest 5 at 25% context or higher · {showRate(comparison.recent.rate)} vs. {showRate(comparison.baseline.rate)} below 25%.</p>
      <p>{number(comparison.baseline.count)} baseline tickets from the last measured chat.</p>
    </> : <p className="mt-1">A chat trend needs at least 5 measured tickets below 25% and 5 at or above it.</p>}
  </>;
  return <Card>
    <CardHeader className="p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <CardTitle className="text-sm">{title}</CardTitle>
        <DetailTooltip content={details}>
          <span tabIndex={0} className={badgeVariants({ variant: 'outline', className: `ms-auto ${color} ${detailFocus}` })}>
            {badge}
          </span>
        </DetailTooltip>
      </div>
      <strong className="block break-words text-xl sm:text-3xl">{showRate(overall.rate)}</strong>
      {overall.count < tickets.length && <p className="text-xs text-muted-foreground">
        {number(overall.count)}/{number(tickets.length)} measured
      </p>}
    </CardHeader>
  </Card>;
}

const contextBands = [0, 25, 50, 75];
const contextMetrics = {
  tokens: { label: 'Tokens / SP', benchmarkField: 'tokensPerPoint', read: item => item.tokensPerPoint,
    format: value => `${number(Math.round(value))} tokens / SP` },
  time: { label: 'Work time / SP', benchmarkField: 'workSecondsPerPoint', read: item => item.workSecondsPerPoint,
    format: value => `${duration({ workSeconds: Math.round(value) })} / SP` },
  rework: { label: 'Rework rounds', read: item => item.correctionRounds, format: number },
};
const contextChange = new Intl.NumberFormat('en-GB', {
  style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 0,
});

function contextBandStats(items, read) {
  return contextBands.map((lower, index) => {
    const upper = contextBands[index + 1] ?? Infinity;
    return { lower, upper, ...contextRangeStats(items, read, lower, upper) };
  });
}

function contextRangeStats(items, read, lower, upper) {
  const values = items.filter(item => item.startContext.percent >= lower && item.startContext.percent < upper)
    .map(read).filter(Number.isFinite).sort((a, b) => a - b);
  const median = values.length ? (values[Math.floor(values.length / 2)] + values[Math.floor((values.length - 1) / 2)]) / 2 : null;
  return { count: values.length, median };
}

const densityOpacities = [1, 0.30, 0.52, 0.76, 1];
const densityFill = count => ({
  fill: count === 0 ? 'hsl(var(--muted))' : '#39e629',
  fillOpacity: densityOpacities[Math.min(count, densityOpacities.length - 1)],
});
const heatmapRows = 10;
const contextStep = 5;
const contextColumns = 100 / contextStep;
const heatmapGutter = 'clamp(26px, 5cqw, 40px)';
const heatmapColumns = domain => contextColumns + Number(domain.maxContext > 100) + Number(domain.hasUnknown);
const compactNumber = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

function heatmapStep(scale) {
  const magnitude = 10 ** Math.floor(Math.log10(scale));
  return Math.max(1, [1, 2, 5, 10].find(step => step * magnitude >= scale) * magnitude);
}

function HeatmapTickets({ cell, format, onClose, onOpen }) {
  const dialog = useRef(null);
  useLayoutEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} onClose={onClose} aria-labelledby="heatmap-tickets-title"
    className="m-auto max-h-[80dvh] w-11/12 max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-4 text-card-foreground backdrop:bg-black/60">
    <header className="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 id="heatmap-tickets-title" className="font-semibold">Tickets in this cell</h2>
        <p className="text-sm text-muted-foreground">{cell.label}</p>
      </div>
      <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Close ticket selection"
        onClick={() => dialog.current.close()}><X aria-hidden="true"/></Button>
    </header>
    <ul className="space-y-2">
      {cell.entries.map(({ item, value }) => <li key={item.id}>
        <Button type="button" variant="outline" className="h-auto w-full justify-between whitespace-normal text-left"
          onClick={() => { dialog.current.close(); onOpen(item.id); }}>
          <span className="min-w-0 break-words">{item.name}</span>
          <span className="shrink-0 text-muted-foreground">{format(value)}</span>
        </Button>
      </li>)}
    </ul>
  </dialog>;
}

function ContextHeatmap({ measured, width, height, domain, step, metric, format, onOpen }) {
  const [cell, setCell] = useState(null);
  const aboveRange = domain.maxContext > 100;
  const columns = heatmapColumns(domain);
  const gutter = Math.min(40, Math.max(26, width * 0.05), height / 5);
  const size = Math.max(1, Math.min((width - 2 * gutter) / columns, (height - 2 * gutter) / heatmapRows));
  const frameWidth = columns * size + 2 * gutter;
  const frameHeight = heatmapRows * size + 2 * gutter;
  const frameX = (width - frameWidth) / 2;
  const frameY = (height - frameHeight) / 2;
  const left = frameX + gutter;
  const bottom = frameY + frameHeight - gutter;
  const labelSize = Math.min(11, gutter * 0.3);
  const legendY = frameY + gutter / 2;
  const swatch = Math.min(10, labelSize);
  const gap = Math.min(3, size * 0.18);
  const cells = new Map();
  for (const entry of measured) {
    const percent = entry.item.startContext?.percent;
    const column = !Number.isFinite(percent) ? columns - 1 : percent > 100 ? contextColumns
      : Math.max(0, Math.min(contextColumns - 1, Math.floor(percent / contextStep)));
    const row = Math.min(heatmapRows - 1, Math.floor(entry.value / step));
    const key = row * columns + column;
    const entries = cells.get(key) ?? [];
    entries.push(entry);
    cells.set(key, entries);
  }
  const axisLabel = value => metric === 'time' ? `${compactNumber.format(value)}s` : compactNumber.format(value);
  return <>
    <rect x={frameX + 0.5} y={frameY + 0.5} width={frameWidth - 1} height={frameHeight - 1} rx="12"
      className="fill-card stroke-border" data-heatmap-frame aria-hidden="true"/>
    <g role="img" aria-label="Tickets per cell: 0, 1, 2, 3, 4 or more" fontSize={labelSize} fill="currentColor">
      <text x={left} y={legendY} dominantBaseline="middle">Tickets per cell</text>
      {densityOpacities.map((_, index) => {
        const x = left + 8 * labelSize + 3 * index * labelSize;
        return <g key={index}>
          <rect x={x} y={legendY - swatch / 2} width={swatch} height={swatch} rx="2" {...densityFill(index)}/>
          <text x={x + swatch + 4} y={legendY} dominantBaseline="middle">{index === 4 ? '4+' : index}</text>
        </g>;
      })}
    </g>
    {Array.from({ length: heatmapRows }, (_, row) => (row % 2 === 0 || row === heatmapRows - 1) &&
      <text key={row} x={left - 6} y={bottom - (row + 0.5) * size} dominantBaseline="middle" textAnchor="end"
        fill="currentColor" fontSize={Math.min(labelSize, size * 0.95)}>{row === heatmapRows - 1 ? '≥' : ''}{axisLabel(row * step)}</text>)}
    {[0, 25, 50, 75, 100].map(percent => <text key={percent} x={left + percent / contextStep * size} y={bottom + gutter / 2}
      dominantBaseline="middle" fill="currentColor" fontSize={labelSize}
      textAnchor={percent === 0 ? 'start' : percent === 100 ? 'end' : 'middle'}>{percent}%</text>)}
    {aboveRange && <text x={left + (contextColumns + 0.5) * size} y={bottom + gutter / 2} dominantBaseline="middle"
      fill="currentColor" fontSize={labelSize} textAnchor="middle">{size >= 35 ? '>100%' : '+'}</text>}
    {domain.hasUnknown && <text x={left + (columns - 0.5) * size} y={bottom + gutter / 2} dominantBaseline="middle"
      fill="currentColor" fontSize={labelSize} textAnchor="middle">{size >= 46 ? 'Unknown' : '?'}</text>}
    {Array.from({ length: columns * heatmapRows }, (_, key) => {
      const column = key % columns, row = Math.floor(key / columns);
      const entries = cells.get(key) ?? [];
      const range = column < contextColumns ? `${column * contextStep}–${column * contextStep + contextStep}% context`
        : aboveRange && column === contextColumns ? 'Above 100% context' : 'Unknown context';
      const effort = row === heatmapRows - 1 ? `At least ${format(row * step)}`
        : metric === 'rework' ? format(row * step) : `${format(row * step)} to under ${format((row + 1) * step)}`;
      const label = `${range} · ${effort} · ${number(entries.length)} ${entries.length === 1 ? 'ticket' : 'tickets'}`;
      const geometry = { x: left + column * size + gap / 2, y: bottom - (row + 1) * size + gap / 2,
        width: size - gap, height: size - gap, rx: Math.min(3, size / 5) };
      if (!entries.length) return <rect key={key} {...geometry} {...densityFill(0)} aria-hidden="true"/>;
      const activate = event => {
        event.currentTarget.focus();
        if (entries.length === 1) onOpen(entries[0].item.id);
        else setCell({ label, entries });
      };
      return <Tooltip key={key}>
        <TooltipTrigger asChild>
          <rect {...geometry} {...densityFill(entries.length)} role="button" tabIndex={0} aria-haspopup="dialog" aria-label={label}
            className="cursor-pointer outline-none hover:stroke-primary focus-visible:stroke-primary"
            onClick={activate} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); }
            }}/>
        </TooltipTrigger>
        <TooltipContent>{label}{entries.length === 1 && <p>{entries[0].item.name} · {format(entries[0].value)}</p>}</TooltipContent>
      </Tooltip>;
    })}
    {cell && createPortal(<HeatmapTickets cell={cell} format={format} onClose={() => setCell(null)} onOpen={onOpen}/>, document.body)}
  </>;
}

function ContextOverview({ items, benchmark = {}, contextDomains = {}, onOpen }) {
  const [metric, setMetric] = useState('tokens');
  const [selectedPoints, setSelectedPoints] = useState('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [{ width: chartWidth, height: chartHeight }, setChartSize] = useState({ width: 480, height: 250 });
  const chart = useRef(null);
  const eligible = items.filter(item => item.completed && Number.isFinite(item.points) && item.points > 0);
  const sizes = storyPointOptions(eligible);
  const models = [...new Set(eligible.map(item => item.startContext?.model))].filter(Boolean).sort();
  const size = sizes.includes(Number(selectedPoints)) ? selectedPoints : 'all';
  const model = models.includes(selectedModel) ? selectedModel : 'all';
  const cohort = eligible.filter(item => (size === 'all' || String(item.points) === size) &&
    (model === 'all' || item.startContext?.model === model));
  const knownContext = cohort.filter(item => Number.isFinite(item.startContext?.percent));
  const { label, read, format, benchmarkField } = contextMetrics[metric];
  const measured = cohort.flatMap(item => {
    const value = read(item);
    return Number.isFinite(value) ? [{ item, value }] : [];
  });
  const points = measured.filter(({ item }) => Number.isFinite(item.startContext?.percent));
  const unknown = measured.filter(({ item }) => !Number.isFinite(item.startContext?.percent));
  const domain = contextDomains[benchmarkField ?? 'correctionRounds'] ?? eligible.reduce((bounds, item) => {
    const value = read(item);
    if (!Number.isFinite(value)) return bounds;
    bounds.maxValue = Math.max(bounds.maxValue, value);
    if (Number.isFinite(item.startContext?.percent)) bounds.maxContext = Math.max(bounds.maxContext, item.startContext.percent);
    else bounds.hasUnknown = true;
    return bounds;
  }, { maxValue: 0, maxContext: 100, hasUnknown: false });
  const heatmapAspect = heatmapRows / heatmapColumns(domain);
  const heatmapHeight = `calc((100cqw - 2 * ${heatmapGutter}) * ${heatmapAspect} + 2 * ${heatmapGutter})`;
  const reference = benchmark[benchmarkField];
  const effortStep = metric === 'rework' ? 1
    : heatmapStep(reference > 0 ? reference / 4 : Math.max(1, domain.maxValue) / heatmapRows);
  const hasPoints = measured.length > 0;
  useEffect(() => {
    if (!hasPoints) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width > 24 && height > 35) setChartSize(previous =>
        previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(chart.current);
    return () => observer.disconnect();
  }, [hasPoints]);
  const bands = contextBandStats(knownContext, read);
  return <div className="context-panel flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
    <header className="context-heading shrink-0 space-y-1">
      <h2 className="font-semibold">Context &amp; effort</h2>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {eligible.length > 0 ? <>
        <Button type="button" size="sm" variant="outline" className="context-filter-switch h-7 shrink-0 self-start"
          aria-expanded={showFilters} aria-controls="context-controls"
          onClick={() => setShowFilters(!showFilters)}>{showFilters ? 'Show chart' : 'Filters'}</Button>
        <div id="context-controls" data-expanded={showFilters} className="context-controls grid shrink-0 grid-cols-2 gap-2">
          <Select value={size} onValueChange={setSelectedPoints}>
            <SelectTrigger aria-label="Context story points" className="h-8 min-w-0"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All story points</SelectItem>
              {sizes.map(points => <SelectItem key={points} value={String(points)}>{number(points)} SP</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={model} onValueChange={setSelectedModel}>
            <SelectTrigger aria-label="Context starting model" className="h-8 min-w-0"><SelectValue/></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All models</SelectItem>
              {models.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger aria-label="Context outcome" className="h-8 min-w-0"><SelectValue/></SelectTrigger>
            <SelectContent>{Object.entries(contextMetrics).map(([id, option]) =>
              <SelectItem key={id} value={id}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {!hasPoints && <p className="text-sm text-muted-foreground">No measurements for these filters.</p>}
        {hasPoints && <figure data-filters-expanded={showFilters} className="context-figure flex min-h-0 flex-col gap-2">
          <figcaption className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">Median by context</span>
              <ul aria-label="Median effort by starting context band" className="flex flex-wrap gap-x-3 gap-y-1">
                {bands.map(({ lower, upper, count, median }) => {
                  const range = Number.isFinite(upper) ? `${lower}–<${upper}%` : `${lower}%+`;
                  if (!count) return <li key={lower} className="whitespace-nowrap">{range} <span aria-hidden="true">–</span><span className="sr-only">No data</span></li>;
                  const value = metric === 'time' ? `${number(Math.round(median))}s` : compactNumber.format(median);
                  return <DetailTooltip key={lower} content={<>
                    <p>Median {format(median)} · {number(count)} {count === 1 ? 'ticket' : 'tickets'}.</p>
                    {lower > 0 && bands[0].median > 0 && <p>{contextChange.format(median / bands[0].median - 1)} vs. under 25% context.</p>}
                  </>}>
                    <li tabIndex={0} className={`whitespace-nowrap ${detailFocus}`}>{range} <strong className="text-foreground">{value}</strong></li>
                  </DetailTooltip>;
                })}
              </ul>
            </div>
            <div className="ms-auto flex items-center gap-2">
              {measured.length < cohort.length && <span>{number(measured.length)}/{number(cohort.length)} measured</span>}
              <DetailTooltip content={<>
                <p>Starting context is estimated at the first recorded request.</p>
                <p>{number(points.length)} known · {number(unknown.length)} unknown.</p>
                <p>Columns cover 5 percentage points. Each row spans {format(effortStep)}. The top row includes higher values.</p>
              </>}>
                <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label="How to read the heatmap">
                  <Info aria-hidden="true"/>
                </Button>
              </DetailTooltip>
            </div>
          </figcaption>
          <svg ref={chart} viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            style={{ height: heatmapHeight }}
            className="block min-h-0 w-full text-muted-foreground"
            role="group" aria-label={label + ' by estimated starting context'}>
            <ContextHeatmap measured={measured} width={chartWidth} height={chartHeight}
              domain={domain} step={effortStep} metric={metric} format={format} onOpen={onOpen}/>
          </svg>
        </figure>}
      </> : <p className="text-sm text-muted-foreground">No completed tickets with story points.</p>}
    </div>
  </div>;
}

const ticketSorts = {
  recent: ['Recent activity'],
  tokens: ['Recorded tokens', 'tokens'],
  tokensPerPoint: ['Tokens / SP', 'tokensPerPoint'],
  time: ['Work time', 'workSeconds'],
  timePerPoint: ['Work time / SP', 'workSecondsPerPoint'],
};

function TicketList({ items, onOpen }) {
  const [page, setPage] = useState(1);
  const [pageStarts, setPageStarts] = useState([]);
  const [availableHeight, setAvailableHeight] = useState(0);
  const [epic, setEpic] = useState('all');
  const [points, setPoints] = useState('all');
  const [sort, setSort] = useState('recent');
  const scrollArea = useRef(null);
  const measureList = useRef(null);
  const visibleList = useRef(null);
  const previousPage = useRef(1);
  const epics = [...new Set(items.map(item => item.epic).filter(Boolean))].sort();
  const sizes = storyPointOptions(items);
  const selected = useMemo(() => {
    const filtered = items.filter(item =>
      (epic === 'all' || epic === (item.epic ? 'epic:' + item.epic : 'none')) &&
      (points === 'all' || points === (Number.isFinite(item.points) ? String(item.points) : 'none')));
    const sortField = ticketSorts[sort][1];
    if (sortField) {
      const value = item => Number.isFinite(item[sortField]) ? item[sortField] : -1;
      filtered.sort((a, b) => value(b) - value(a));
    }
    return filtered;
  }, [items, epic, points, sort]);
  const probeRows = useMemo(() => selected.map(item => <PackageItem key={item.id} item={item}/>), [selected]);
  const pageCount = selected.length ? Math.max(1, pageStarts.length) : 1;
  const pageNumber = Math.min(page, pageCount);
  const start = pageStarts[pageNumber - 1] ?? 0;
  const end = pageStarts[pageNumber] ?? (pageStarts.length ? selected.length : Math.min(1, selected.length));
  const middlePage = Math.max(3, Math.min(pageNumber, pageCount - 2));
  const pageNumbers = pageCount <= 5
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : [1, middlePage - 1, middlePage, middlePage + 1, pageCount];
  const change = setter => value => {
    setter(value);
    setPage(1);
  };

  useLayoutEffect(() => {
    const area = scrollArea.current;
    let previousWidth = 0;
    let previousHeight = 0;
    const measure = () => {
      if (!area.clientHeight) return;
      const style = getComputedStyle(area);
      const height = area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (area.offsetWidth === previousWidth && height === previousHeight) return;
      previousWidth = area.offsetWidth;
      previousHeight = height;
      setAvailableHeight(Math.max(0, height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const list = measureList.current;
    if (!list || !availableHeight) return;
    const measure = () => {
      if (!list.getClientRects().length) return;
      const starts = [0];
      let pageTop;
      for (const [index, row] of Array.from(list.children).entries()) {
        const { top, bottom } = row.getBoundingClientRect();
        pageTop ??= top;
        if (index > starts.at(-1) && bottom - pageTop > availableHeight) {
          starts.push(index);
          pageTop = top;
        }
      }
      setPageStarts(previous => previous.length === starts.length &&
        previous.every((start, index) => start === starts[index]) ? previous : starts);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [availableHeight, selected]);

  useLayoutEffect(() => { setPage(current => Math.min(current, pageCount)); }, [pageCount]);
  useLayoutEffect(() => { scrollArea.current.scrollTop = 0; }, [pageNumber, epic, points, sort]);
  useLayoutEffect(() => {
    if (previousPage.current === pageNumber) return;
    previousPage.current = pageNumber;
    let transition;
    const frame = requestAnimationFrame(() => {
      if (!visibleList.current) return;
      transition = createContentTransition({ content: visibleList.current, hostOwnsVisibility: true, timing: 'total' });
      transition.open();
    });
    return () => {
      cancelAnimationFrame(frame);
      transition?.destroy();
    };
  }, [pageNumber]);

  return <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden [container-type:inline-size]">
    <header className="shrink-0 space-y-2">
      <h2 className="font-semibold">Tickets</h2>
      {items.length > 0 && <div role="group" aria-label="Ticket filters and sorting" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Select value={epic} onValueChange={change(setEpic)}>
          <SelectTrigger aria-label="Ticket epic" className="h-8 min-w-0"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All epics</SelectItem>
            {items.some(item => !item.epic) && <SelectItem value="none">No epic</SelectItem>}
            {epics.map(name => <SelectItem key={name} value={'epic:' + name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={points} onValueChange={change(setPoints)}>
          <SelectTrigger aria-label="Ticket story points" className="h-8 min-w-0"><SelectValue/></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All story points</SelectItem>
            {sizes.map(size => <SelectItem key={size} value={String(size)}>{number(size)} SP</SelectItem>)}
            {items.some(item => !Number.isFinite(item.points)) && <SelectItem value="none">No estimate</SelectItem>}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={change(setSort)}>
          <SelectTrigger aria-label="Sort tickets" className="h-8 min-w-0"><SelectValue/></SelectTrigger>
          <SelectContent>{Object.entries(ticketSorts).map(([id, [label]]) =>
            <SelectItem key={id} value={id}>{label}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {items.length > 0 && <div className="grid items-center gap-2 2xl:grid-cols-[1fr_auto]">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {selected.length ? `${number(start + 1)}–${number(end)} of ${number(selected.length)} tickets` : '0 tickets'}
        </p>
        <nav className="flex items-center gap-1 overflow-x-auto py-0.5" aria-label="Ticket pagination">
          <DetailTooltip content="Previous page">
            <Button type="button" variant="outline" size="icon" className="size-7 shrink-0"
              aria-label="Previous page" disabled={pageNumber === 1} onClick={() => setPage(pageNumber - 1)}>
              <ChevronRight aria-hidden="true" className="rotate-180"/>
            </Button>
          </DetailTooltip>
          {pageNumbers.map((value, index) => <Fragment key={value}>
            {index > 0 && value - pageNumbers[index - 1] > 1 && <span aria-hidden="true" className="text-xs text-muted-foreground">…</span>}
            <Button type="button" size="sm" variant={value === pageNumber ? 'secondary' : 'outline'}
              className="h-7 min-w-7 shrink-0 px-1.5" aria-label={`Page ${number(value)}`}
              aria-current={value === pageNumber ? 'page' : undefined} onClick={() => setPage(value)}>{number(value)}</Button>
          </Fragment>)}
          <DetailTooltip content="Next page">
            <Button type="button" variant="outline" size="icon" className="size-7 shrink-0"
              aria-label="Next page" disabled={pageNumber === pageCount} onClick={() => setPage(pageNumber + 1)}>
              <ChevronRight aria-hidden="true"/>
            </Button>
          </DetailTooltip>
        </nav>
      </div>}
      {selected.length > 0 && <div aria-hidden="true" className={`ticket-column-headings ${rowLayout} py-0 text-muted-foreground`}>
        <span/>
        <span className={`${fieldLayout} text-xs`}>
          {Object.values(ticketMetricLabels).map(label => <span key={label}>{label}</span>)}
        </span>
      </div>}
    </header>
    <div ref={scrollArea} tabIndex={0} role="region" aria-label="Ticket list"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring [container-type:inline-size] [scrollbar-width:none]">
      {selected.length > 0 ? <>
        <div className="invisible h-0 overflow-hidden" aria-hidden="true">
          <ul ref={measureList} className="space-y-1.5">
            {probeRows}
          </ul>
        </div>
        <div className="grid min-h-full overflow-clip">
          <ul ref={visibleList} className="flex flex-col gap-1.5 [&>li]:flex [&>li]:flex-[1_0_auto] [&>li>button]:content-center" aria-label="Tickets">
            {selected.slice(start, end).map(item => <PackageItem key={item.id} item={item} onOpen={() => onOpen(item.id)}/>)}
          </ul>
        </div>
      </> : <p className="text-sm text-muted-foreground">{items.length ? 'No tickets match these filters.' : 'No tickets recorded.'}</p>}
    </div>
  </div>;
}

function Dashboard() {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const openTicket = data?.items.find(item => item.id === openId);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mobilePane, setMobilePane] = useState('overview');
  const [showMetrics, setShowMetrics] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    let latest;
    async function refresh() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const options = { signal: controller.signal };
        let response = await fetch('/api/performance?view=dashboard', options);
        // The running server can still use the old route after the UI hot reloads.
        if (response.status === 404) response = await fetch('/api/analytics', options);
        const body = await response.text();
        let result;
        try { result = JSON.parse(body); }
        catch {
          throw new Error(response.ok ? 'The server returned an invalid response.' : `HTTP ${response.status}.`);
        }
        if (!response.ok) throw new Error(result?.error ?? `HTTP ${response.status}.`);
        if (controller.signal.aborted) return;
        if (body !== latest) {
          latest = body;
          setData(result);
        }
        setError('');
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const title = data?.project ? `AI Performance - ${data.project}`
    : document.title === 'AI Analytics' ? 'AI Performance' : document.title;
  useEffect(() => { document.title = title; }, [title]);

  const estimated = (data?.items ?? []).filter(item => item.completed && Number.isFinite(item.points) && item.points > 0)
    .sort((a, b) => (b.completedAt ?? b.endedAt ?? 0) - (a.completedAt ?? a.endedAt ?? 0));
  const chatContext = data?.chatContext;
  const compareWithProject = chatContext?.percent < chatContext?.baselineLimit;
  const notification = (chatContext?.limitWarning || chatContext?.elevated.length > 0) &&
    <div role="status" className="border-b border-rose-400/30 bg-rose-400/10 px-[var(--dashboard-inset)] py-2 text-xs text-rose-200 sm:text-sm">
      <strong>{chatContext.percent >= 100 ? 'Context limit reached'
        : chatContext.limitWarning ? 'Context limit approaching' : 'Effort rising in the last measured chat'}</strong>
      <p>{providerName(chatContext.provider)} · {number(Math.floor(chatContext.percent))}% context · {dateClock.format(chatContext.observedAt)}.
        {chatContext.limitWarning ? ' Start a fresh chat and ticket before continuing.'
          : ` ${chatContext.elevated.map(key => `${contextChange.format(chatContext.comparisons[key].change)} ${contextMetrics[key].label}`).join(' · ')} vs. below 25% context.`}
      </p>
    </div>;
  return <main className="dashboard-shell flex h-dvh w-full flex-col gap-[var(--dashboard-gutter)] overflow-hidden [--dashboard-inset:0.75rem] sm:[--dashboard-inset:1.25rem] lg:gap-0">
    <div className="shrink-0">
      <DashboardHeader title={title} notification={!showDocumentation && notification} onNavigate={() => setShowDocumentation(true)}/>
      {loading && !data && <p className="px-[var(--dashboard-inset)] py-2 text-sm text-muted-foreground" role="status">Loading metrics…</p>}
      {error && <p className="break-words border-b px-[var(--dashboard-inset)] py-2 text-sm" role="alert">Could not load performance data. {error}</p>}
    </div>

    {data && <>
      <nav aria-label="Dashboard view" className="dashboard-content flex shrink-0 gap-2 lg:hidden">
        {[['overview', 'Overview'], ['tickets', 'Tickets']].map(([key, label]) => <Button key={key}
          type="button" size="sm" variant={mobilePane === key ? 'secondary' : 'outline'}
          aria-pressed={mobilePane === key} aria-controls={`dashboard-${key}`}
          onClick={() => setMobilePane(key)}>{label}</Button>)}
      </nav>
      <div className="dashboard-content grid min-h-0 flex-1 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        <div id="dashboard-overview" role="region" aria-label="Dashboard overview" tabIndex={0} data-show-metrics={showMetrics}
          className={`min-h-0 min-w-0 flex-col gap-3 overflow-hidden pb-[var(--dashboard-gutter)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring [container-type:inline-size] lg:pe-[var(--dashboard-gutter)] lg:pt-[var(--dashboard-gutter)] ${mobilePane === 'overview' ? 'flex' : 'hidden lg:flex'}`}>
          {!data.hasLog && <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">Usage data will appear here once the telemetry hook records it.</p>}
          {data.skipped > 0 && <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">{number(data.skipped)} invalid log entries skipped. Token scores are unavailable until the log is fixed.</p>}
          <Button type="button" size="sm" variant="outline" className="overview-kpis-toggle shrink-0 self-start"
            aria-expanded={showMetrics} aria-controls="overview-kpis" onClick={() => setShowMetrics(value => !value)}>
            {showMetrics ? 'Show chart' : 'Show key metrics'}
          </Button>
          <section id="overview-kpis" aria-label="Key metrics"
            className="overview-kpis grid shrink-0 grid-cols-2 gap-3">
            <EffortPerPoint tickets={estimated} title="Tokens / SP" rateField="tokensPerPoint" totalField="tokens" format={number}
              comparison={chatContext?.comparisons.tokens} compareWithProject={compareWithProject}/>
            <EffortPerPoint tickets={estimated} title="Work time / SP" rateField="workSecondsPerPoint" totalField="workSeconds"
              format={workSeconds => duration({ workSeconds })} comparison={chatContext?.comparisons.time}
              compareWithProject={compareWithProject}/>
          </section>

          <section aria-label="Performance analysis" className="overview-analysis flex min-h-0 flex-1 flex-col">
            <ContextOverview items={data.items} benchmark={data.benchmark} contextDomains={data.contextDomains} onOpen={setOpenId}/>
          </section>
        </div>
        <section id="dashboard-tickets" aria-label="Ticket panel"
          className={`min-h-0 min-w-0 pb-[var(--dashboard-gutter)] lg:border-s lg:border-border lg:ps-[var(--dashboard-gutter)] lg:pt-[var(--dashboard-gutter)] ${mobilePane === 'tickets' ? '' : 'hidden lg:block'}`}>
          <TicketList items={data.items} onOpen={setOpenId}/>
        </section>
      </div>
    </>}
    {openTicket && <TicketDetails item={openTicket} onClose={() => setOpenId(null)}/>}
    {showDocumentation && <ProjectDocumentation title={title} notification={notification} onClose={() => setShowDocumentation(false)}/>}
  </main>;
}

createRoot(document.getElementById('root')).render(<TooltipProvider><Dashboard /></TooltipProvider>);
