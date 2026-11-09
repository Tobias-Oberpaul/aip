import { Button } from '@/design-system/components/ui/button';
import { ProductHeader } from '@/design-system/product-header';

export function DashboardHeader({ title, documentation = false, onNavigate, actions, notification }) {
  return <div className="shrink-0">
    {notification}
    <ProductHeader className="dashboard-header border-b bg-background"
      brand={documentation
        ? <span className="shell-home text-base font-semibold tracking-tight">{title}</span>
        : <h1 className="shell-home text-base font-semibold tracking-tight">{title}</h1>}
      navigation={<>
        <Button type="button" variant={documentation ? 'ghost' : 'secondary'} aria-current={documentation ? undefined : 'page'}
          onClick={documentation ? onNavigate : undefined}>Dashboard</Button>
        <Button type="button" variant={documentation ? 'secondary' : 'ghost'} aria-current={documentation ? 'page' : undefined}
          aria-haspopup={documentation ? undefined : 'dialog'} onClick={documentation ? undefined : onNavigate}>Documentation</Button>
      </>}
      actions={actions}/>
  </div>;
}
