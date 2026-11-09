export function ProductHeader({ headerRef, brand, navigation, actions, ...props }) {
  return <header ref={headerRef} {...props}>
    <div className="shell-title">
      {brand}
      <nav aria-label="AI Performance pages" className="shell-view-group aip-header-navigation">
        {navigation}
      </nav>
    </div>
    <div className="shell-switches">{actions}</div>
  </header>;
}
