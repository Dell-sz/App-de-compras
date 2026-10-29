import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  ArrowLeft,
  Archive,
  ChevronDown,
  CircleHelp,
  ListChecks,
  LayoutDashboard,
  Moon,
  Package,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShoppingBasket,
  ShoppingCart,
  Sun,
  Tag,
} from 'lucide-react'
import './assets/main.css'
import ProductsPage from './components/ProductsPage'
import ArchivedProductsPanel from './components/ArchivedProductsPanel'
import PriceHistoryPage from './components/PriceHistoryPage'
import PurchasesPage from './components/PurchasesPage'
import ShoppingListPage from './components/ShoppingListPage'

type Page =
  | 'Dashboard'
  | 'Lista de compras'
  | 'Compras'
  | 'Estoque'
  | 'Preços'
  | 'Configurações'
  | 'Itens arquivados'
type Theme = 'light' | 'dark'

type MenuItem = {
  label: Page
  icon: LucideIcon
}

const menuItems: MenuItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Lista de compras', icon: ListChecks },
  { label: 'Compras', icon: ShoppingCart },
  { label: 'Estoque', icon: Package },
  { label: 'Preços', icon: Tag },
]

function App(): React.JSX.Element {
  const [activePage, setActivePage] = useState<Page>('Dashboard')
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null)
  const [dashboardProducts, setDashboardProducts] = useState<Product[]>([])
  const [dashboardPurchases, setDashboardPurchases] = useState<PurchaseSummary[]>([])
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem('compras-theme') === 'dark' ? 'dark' : 'light'
  )
  const [dataRevision, setDataRevision] = useState(0)

  useEffect(() => {
    window.localStorage.setItem('compras-theme', theme)
  }, [theme])

  useEffect(() => {
    const refreshDashboard = (): void => setDataRevision((revision) => revision + 1)
    window.addEventListener('app:data-changed', refreshDashboard)
    return () => window.removeEventListener('app:data-changed', refreshDashboard)
  }, [])

  useEffect(() => {
    if (activePage !== 'Dashboard') return

    let isCurrent = true

    Promise.all([
      window.api.dashboard.getSummary(),
      window.api.products.list(),
      window.api.purchases.list()
    ])
      .then(([summary, products, purchases]) => {
        if (!isCurrent) return
        setDashboardSummary(summary)
        setDashboardProducts(products)
        setDashboardPurchases(purchases)
        setDashboardError('')
      })
      .catch(() => {
        if (isCurrent) setDashboardError('Não foi possível carregar os dados do Dashboard.')
      })
      .finally(() => {
        if (isCurrent) setDashboardLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [activePage, dataRevision])

  const formatMoney = (cents: number): string =>
    (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const formatDate = (date: string): string =>
    new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')

  const lowStockProducts = dashboardProducts
    .filter((product) => product.quantity <= product.minimumQuantity)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'pt-BR'))

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShoppingBasket size={21} strokeWidth={2.2} />
          </div>
          <div>
            <strong>Compras da Casa</strong>
            <span>Organização simples</span>
          </div>
        </div>

        <div className="menu-label">MENU PRINCIPAL</div>
        <nav className="nav-menu">
          {menuItems.map(({ label, icon: Icon }) => (
            <button
              className={`nav-item ${activePage === label ? 'active' : ''}`}
              key={label}
              onClick={() => setActivePage(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === 'Compras' && (
                <span className="nav-count">{dashboardPurchases.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item">
            <CircleHelp size={19} />
            <span>Ajuda</span>
          </button>
          <button
            className={`nav-item ${activePage === 'Configurações' ? 'active' : ''}`}
            onClick={() => setActivePage('Configurações')}
          >
            <Settings size={19} />
            <span>Configurações</span>
          </button>
          <div className="profile">
            <div className="avatar">D</div>
            <div className="profile-text">
              <strong>Minha casa</strong>
              <span>Uso pessoal</span>
            </div>
            <ChevronDown size={16} />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="search-box">
            <Search size={18} />
            <input aria-label="Buscar" placeholder="Buscar produtos..." />
            <kbd>Ctrl K</kbd>
          </div>
          <button className="icon-button" aria-label="Notificações">
            <Bell size={19} />
            <span className="notification-dot" />
          </button>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">VISÃO GERAL</div>
              <h1>{activePage}</h1>
              <p>
                {activePage === 'Dashboard'
                  ? 'Acompanhe suas compras e sua despensa em um só lugar.'
                  : activePage === 'Configurações'
                    ? 'Personalize a aparência do aplicativo.'
                    : activePage === 'Itens arquivados'
                      ? 'Consulte e restaure produtos arquivados.'
                      : activePage === 'Preços'
                        ? 'Compare preços de compras por produto, mercado e período.'
                    : `Aqui ficará a área de ${activePage.toLowerCase()}.`}
              </p>
            </div>
            {activePage !== 'Estoque' &&
              activePage !== 'Compras' &&
              activePage !== 'Lista de compras' &&
              activePage !== 'Configurações' && (
              activePage === 'Itens arquivados' ? (
                <button className="secondary-button" onClick={() => setActivePage('Configurações')}>
                  <ArrowLeft size={16} />
                  Voltar às Configurações
                </button>
              ) : (
                <button className="primary-button" onClick={() => setActivePage('Compras')}>
                  <Plus size={18} />
                  Nova compra
                </button>
              )
            )}
          </div>

          {activePage === 'Dashboard' ? (
            <>
              {dashboardError && <div className="error-message">{dashboardError}</div>}
              <section className="summary-grid">
                <article className="summary-card">
                  <div className="card-topline">
                    <span>Gasto neste mês</span>
                    <span className="metric-icon green"><ShoppingCart size={18} /></span>
                  </div>
                  <strong className="metric-value">
                    {dashboardSummary ? formatMoney(dashboardSummary.monthlySpendCents) : '—'}
                  </strong>
                  <div className="metric-note">
                    <span>total registrado no mês</span>
                  </div>
                </article>

                <article className="summary-card">
                  <div className="card-topline">
                    <span>Itens no estoque</span>
                    <span className="metric-icon blue"><Package size={18} /></span>
                  </div>
                  <strong className="metric-value">
                    {dashboardSummary?.productCount ?? '—'} <small>produtos</small>
                  </strong>
                  <div className="metric-note">
                    <span>cadastrados no estoque</span>
                  </div>
                </article>

                <article className="summary-card">
                  <div className="card-topline">
                    <span>Precisam ser repostos</span>
                    <span className="metric-icon orange"><ShoppingBasket size={18} /></span>
                  </div>
                  <strong className="metric-value">
                    {dashboardSummary?.lowStockCount ?? '—'} <small>produtos</small>
                  </strong>
                  <div className="metric-note">
                    <span className="trend warning">Atenção</span>
                    <span>estoque baixo</span>
                  </div>
                </article>

                <article className="summary-card">
                  <div className="card-topline">
                    <span>Compras neste mês</span>
                    <span className="metric-icon red"><ShoppingCart size={18} /></span>
                  </div>
                  <strong className="metric-value">
                    {dashboardSummary?.monthlyPurchaseCount ?? '—'} <small>compras</small>
                  </strong>
                  <div className="metric-note">
                    <span>registradas neste mês</span>
                  </div>
                </article>
              </section>

              <section className="content-grid">
                <article className="panel purchases-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Compras recentes</h2>
                      <p>Últimas compras registradas</p>
                    </div>
                    <button className="text-button" onClick={() => setActivePage('Compras')}>
                      Ver histórico
                    </button>
                  </div>

                  {dashboardLoading ? (
                    <p className="recent-empty">Carregando compras...</p>
                  ) : dashboardPurchases.length === 0 ? (
                    <p className="recent-empty">Nenhuma compra registrada ainda.</p>
                  ) : (
                    <div className="purchase-list">
                      {dashboardPurchases.slice(0, 3).map((purchase) => (
                        <div className="purchase-row" key={purchase.id}>
                          <div className="product-icon"><ReceiptText size={18} /></div>
                          <div className="product-info">
                            <strong>{purchase.storeName}</strong>
                            <span>
                              {formatDate(purchase.purchaseDate)} · {purchase.itemCount}{' '}
                              {purchase.itemCount === 1 ? 'item' : 'itens'}
                            </span>
                          </div>
                          <div className="product-price">
                            <strong>{formatMoney(purchase.totalCents)}</strong>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </article>

                <article className="panel list-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Lista de compras</h2>
                      <p>O que está faltando em casa</p>
                    </div>
                    <span className="list-badge">
                      {lowStockProducts.length}{' '}
                      {lowStockProducts.length === 1 ? 'produto' : 'produtos'}
                    </span>
                  </div>
                  {dashboardLoading ? (
                    <p className="recent-empty">Analisando o estoque...</p>
                  ) : lowStockProducts.length === 0 ? (
                    <p className="recent-empty">Nenhum produto precisa ser reposto.</p>
                  ) : (
                    <div className="dashboard-stock-list">
                      {lowStockProducts.slice(0, 3).map((product) => (
                        <div className="dashboard-stock-item" key={product.id}>
                          <span>{product.name}</span>
                          <small>
                            {product.quantity.toLocaleString('pt-BR')} {product.unit}
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="add-item-button" onClick={() => setActivePage('Lista de compras')}>
                    <ListChecks size={16} /> Ver lista de reposição
                  </button>
                </article>
              </section>

            </>

          
          ) : activePage === 'Compras' ? (
            <PurchasesPage />
          ) : activePage === 'Estoque' ? (
            <ProductsPage />
          ) : activePage === 'Lista de compras' ? (
            <ShoppingListPage onRegisterPurchase={() => setActivePage('Compras')} />
          ) : activePage === 'Configurações' ? (
            <section className="settings-page">
              <div className="settings-intro">
                <h2>Aparência</h2>
                <p>Escolha como o app será exibido. Sua preferência fica salva neste dispositivo.</p>
              </div>
              <div className="panel theme-setting-card">
                <div className="theme-setting-copy">
                  <span className="theme-setting-icon">
                    {theme === 'dark' ? <Moon size={19} /> : <Sun size={19} />}
                  </span>
                  <div>
                    <strong>Tema escuro</strong>
                    <p>Ative uma aparência escura em todas as telas.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`theme-switch ${theme === 'dark' ? 'enabled' : ''}`}
                  role="switch"
                  aria-checked={theme === 'dark'}
                  aria-label="Ativar tema escuro"
                  onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
                >
                  <span />
                </button>
              </div>
              <div className="panel theme-setting-card archived-setting-card">
                <div className="theme-setting-copy">
                  <span className="theme-setting-icon">
                    <Archive size={19} />
                  </span>
                  <div>
                    <strong>Itens arquivados</strong>
                    <p>Visualize e restaure produtos removidos do estoque ativo.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setActivePage('Itens arquivados')}
                >
                  Visualizar itens arquivados
                </button>
              </div>
            </section>
          ) : activePage === 'Itens arquivados' ? (
            <ArchivedProductsPanel />
          ) : activePage === 'Preços' ? (
            <PriceHistoryPage />
          ) : (
            <section className="panel placeholder-panel">
              <div className="placeholder-icon">
                {activePage === 'Preços' && <Tag size={25} />}
              </div>
              <h2>{activePage} será construída aqui</h2>
              <p>O menu já está funcionando. Vamos desenvolver esta área em etapas.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default App