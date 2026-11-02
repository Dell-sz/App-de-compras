import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  ArrowLeft,
  CircleAlert,
  ClipboardCheck,
  ChevronDown,
  CircleHelp,
  House,
  History,
  ListChecks,
  Moon,
  Package,
  Plus,
  ReceiptText,
  Settings,
  ShoppingBasket,
  ShoppingCart,
  Sun,
  Tag,
  X
} from 'lucide-react'
import './assets/main.css'
import ProductsPage from './components/ProductsPage'
import ArchivedProductsPanel from './components/ArchivedProductsPanel'
import { SpendingBarChart, type SpendingBucket } from './components/DataCharts'
import PriceHistoryPage from './components/PriceHistoryPage'
import PurchasesPage from './components/PurchasesPage'
import ShoppingListPage from './components/ShoppingListPage'

type Page =
  | 'Dashboard'
  | 'Lista de compras'
  | 'Compras'
  | 'Histórico de compras'
  | 'Estoque'
  | 'Preços'
  | 'Configurações'
  | 'Itens arquivados'
type Theme = 'light' | 'dark'

type MenuItem = {
  label: Page
  icon: LucideIcon
}

type HelpPreviewKind = 'stock' | 'shopping' | 'purchase' | 'prices' | 'settings'

type HelpStep = {
  title: string
  description: string
  icon: LucideIcon
  preview: HelpPreviewKind
  links: { label: string; page: Page }[]
}

const helpSteps: HelpStep[] = [
  {
    title: 'Organize seu estoque',
    description:
      'Cadastre seus produtos, unidades e quantidades mínimas. Atualize a contagem real quando quiser conferir o que tem em casa; produtos também podem ser editados ou arquivados.',
    icon: Package,
    preview: 'stock',
    links: [{ label: 'Abrir estoque', page: 'Estoque' }]
  },
  {
    title: 'Prepare a lista de compras',
    description:
      'A lista sugere itens com base no estoque atual e no mínimo definido. Revise as quantidades, edite a lista e gere um PDF para levar ao mercado.',
    icon: ListChecks,
    preview: 'shopping',
    links: [{ label: 'Abrir lista', page: 'Lista de compras' }]
  },
  {
    title: 'Registre cada compra',
    description:
      'Informe a data, o estabelecimento e os produtos comprados. O registro atualiza o estoque e alimenta o histórico de preços.',
    icon: ShoppingCart,
    preview: 'purchase',
    links: [{ label: 'Registrar compra', page: 'Compras' }]
  },
  {
    title: 'Consulte preços e histórico',
    description:
      'Compare os preços registrados para acompanhar suas compras. No histórico, consulte compras anteriores e gerencie itens na lixeira.',
    icon: Tag,
    preview: 'prices',
    links: [
      { label: 'Ver preços', page: 'Preços' },
      { label: 'Ver histórico', page: 'Histórico de compras' }
    ]
  },
  {
    title: 'Personalize o app',
    description:
      'Em Configurações, escolha o tema claro ou escuro e defina se as alterações de quantidade no estoque serão salvas automaticamente.',
    icon: Settings,
    preview: 'settings',
    links: [{ label: 'Abrir configurações', page: 'Configurações' }]
  }
]

function HelpPreview({
  icon: Icon,
  kind
}: {
  icon: LucideIcon
  kind: HelpPreviewKind
}): React.JSX.Element {
  return (
    <div className={`help-preview help-preview-${kind}`} aria-hidden="true">
      <div className="help-preview-toolbar">
        <span className="help-preview-app-icon">
          <Icon size={11} />
        </span>
        <span className="help-preview-title" />
        <span className="help-preview-menu">
          <i />
          <i />
          <i />
        </span>
      </div>
      {kind === 'prices' ? (
        <div className="help-preview-chart">
          {[30, 48, 38, 67, 52, 82, 61].map((height, index) => (
            <span key={index} style={{ height: `${height}%` }} />
          ))}
        </div>
      ) : kind === 'settings' ? (
        <div className="help-preview-settings">
          <span>
            <i />
            <b />
          </span>
          <span>
            <i />
            <b />
          </span>
          <span>
            <i />
            <b />
          </span>
        </div>
      ) : (
        <div className={`help-preview-rows help-preview-rows-${kind}`}>
          {[0, 1, 2].map((row) => (
            <span key={row}>
              <i />
              <b />
              <em />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const menuItems: MenuItem[] = [
  { label: 'Dashboard', icon: House },
  { label: 'Lista de compras', icon: ListChecks },
  { label: 'Compras', icon: ShoppingCart },
  { label: 'Histórico de compras', icon: History },
  { label: 'Estoque', icon: Package },
  { label: 'Preços', icon: Tag }
]

function App(): React.JSX.Element {
  const [activePage, setActivePage] = useState<Page>('Dashboard')
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null)
  const [dashboardProducts, setDashboardProducts] = useState<Product[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsLoadError, setProductsLoadError] = useState('')
  const [dashboardPurchases, setDashboardPurchases] = useState<PurchaseSummary[]>([])
  const [dashboardMonth, setDashboardMonth] = useState(() => new Date().getMonth() + 1)
  const [dashboardYear, setDashboardYear] = useState(() => new Date().getFullYear())
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState('')
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem('compras-theme') === 'dark' ? 'dark' : 'light'
  )
  const [dataRevision, setDataRevision] = useState(0)
  const [settings, setSettings] = useState<AppSettings>({
    saveStockCheckHistory: true,
    autoSaveStockQuantities: true
  })
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsLoadError, setSettingsLoadError] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const stockNavigationGuard = useRef<(() => Promise<boolean>) | null>(null)

  const registerStockNavigationGuard = useCallback(
    (guard: (() => Promise<boolean>) | null): void => {
      stockNavigationGuard.current = guard
    },
    []
  )

  async function navigateToPage(page: Page): Promise<void> {
    if (page === activePage) return
    if (activePage === 'Estoque' && stockNavigationGuard.current) {
      const canLeave = await stockNavigationGuard.current()
      if (!canLeave) return
    }
    setActivePage(page)
  }

  const closeHelp = useCallback((): void => {
    setShowHelp(false)
    helpButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    window.api.settings
      .get()
      .then(setSettings)
      .catch((error: unknown) =>
        setSettingsLoadError(
          error instanceof Error ? error.message : 'Não foi possível carregar as configurações.'
        )
      )
      .finally(() => setSettingsLoading(false))
  }, [])

  useEffect(() => {
    if (!showHelp) return

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeHelp()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeHelp, showHelp])

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

    Promise.all([window.api.dashboard.getSummary(), window.api.purchases.list()])
      .then(([summary, purchases]) => {
        if (!isCurrent) return
        setDashboardSummary(summary)
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

  useEffect(() => {
    let isCurrent = true
    window.api.products
      .list()
      .then((products) => {
        if (!isCurrent) return
        setDashboardProducts(products)
        setProductsLoadError('')
      })
      .catch((error: unknown) => {
        if (!isCurrent) return
        setProductsLoadError(
          error instanceof Error ? error.message : 'Não foi possível carregar o estoque.'
        )
      })
      .finally(() => {
        if (isCurrent) setProductsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [dataRevision])

  const formatMoney = (cents: number): string =>
    (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const formatDate = (date: string): string =>
    new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')

  async function handleAutoSaveSettingChange(): Promise<void> {
    if (settingsSaving || settingsLoading || settingsLoadError) return
    setSettingsError('')
    const previousValue = settings.autoSaveStockQuantities
    const nextValue = !previousValue
    setSettings((current) => ({ ...current, autoSaveStockQuantities: nextValue }))
    setSettingsSaving(true)
    try {
      const updatedSettings = await window.api.settings.update({
        ...settings,
        autoSaveStockQuantities: nextValue
      })
      setSettings(updatedSettings)
    } catch (error) {
      setSettings((current) => ({ ...current, autoSaveStockQuantities: previousValue }))
      setSettingsError(
        error instanceof Error ? error.message : 'Não foi possível salvar a configuração.'
      )
    } finally {
      setSettingsSaving(false)
    }
  }

  const lowStockProducts = dashboardProducts
    .filter((product) => product.quantity <= product.minimumQuantity)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'pt-BR'))
  const dashboardPeriodKey = `${dashboardYear}-${String(dashboardMonth).padStart(2, '0')}`
  const periodPurchases = dashboardPurchases.filter((purchase) =>
    purchase.purchaseDate.startsWith(dashboardPeriodKey)
  )
  const periodSpendCents = periodPurchases.reduce(
    (total, purchase) => total + purchase.totalCents,
    0
  )
  const periodLabel = new Date(dashboardYear, dashboardMonth - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric'
  })
  const yearPurchases = dashboardPurchases.filter((purchase) =>
    purchase.purchaseDate.startsWith(String(dashboardYear))
  )
  const monthlySpending = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1
    const key = `${dashboardYear}-${String(month).padStart(2, '0')}`
    const monthPurchases = yearPurchases.filter((purchase) => purchase.purchaseDate.startsWith(key))
    return {
      key,
      label: new Date(dashboardYear, index, 1).toLocaleDateString('pt-BR', {
        month: 'short'
      }),
      valueCents: monthPurchases.reduce((total, purchase) => total + purchase.totalCents, 0),
      highlighted: month === dashboardMonth
    }
  })
  const dashboardSpendingBuckets: SpendingBucket[] = yearPurchases.length > 0 ? monthlySpending : []
  const purchaseYears = [
    ...new Set(
      [
        new Date().getFullYear(),
        ...dashboardPurchases.map((purchase) => Number(purchase.purchaseDate.slice(0, 4)))
      ].filter(Number.isInteger)
    )
  ].sort((a, b) => b - a)

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
              className={`nav-item ${
                activePage === label || (label === 'Estoque' && activePage === 'Itens arquivados')
                  ? 'active'
                  : ''
              }`}
              key={label}
              title={label}
              aria-current={
                activePage === label || (label === 'Estoque' && activePage === 'Itens arquivados')
                  ? 'page'
                  : undefined
              }
              onClick={() => void navigateToPage(label)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {label === 'Histórico de compras' && (
                <span className="nav-count">{dashboardPurchases.length}</span>
              )}
              {label === 'Lista de compras' && lowStockProducts.length > 0 && (
                <CircleAlert
                  className="nav-alert-icon"
                  size={18}
                  aria-label="Há produtos para repor"
                />
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <button
            ref={helpButtonRef}
            className="nav-item"
            aria-haspopup="dialog"
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={19} />
            <span>Ajuda</span>
          </button>
          <button
            className={`nav-item ${activePage === 'Configurações' ? 'active' : ''}`}
            title="Configurações"
            aria-current={activePage === 'Configurações' ? 'page' : undefined}
            onClick={() => void navigateToPage('Configurações')}
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
          <button className="icon-button" aria-label="Notificações">
            <Bell size={19} />
            <span className="notification-dot" />
          </button>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <h1>{activePage}</h1>
            </div>
            {activePage !== 'Estoque' &&
              activePage !== 'Compras' &&
              activePage !== 'Histórico de compras' &&
              activePage !== 'Lista de compras' &&
              activePage !== 'Configurações' &&
              (activePage === 'Itens arquivados' ? (
                <button className="secondary-button" onClick={() => void navigateToPage('Estoque')}>
                  <ArrowLeft size={16} />
                  Voltar ao Estoque
                </button>
              ) : (
                <button className="primary-button" onClick={() => void navigateToPage('Compras')}>
                  <Plus size={18} />
                  Nova compra
                </button>
              ))}
          </div>

          {activePage === 'Dashboard' ? (
            <>
              {(dashboardError || productsLoadError) && (
                <div className="error-message">{dashboardError || productsLoadError}</div>
              )}
              <div className="dashboard-period" aria-label="Período do Dashboard">
                <label className="dashboard-period-field">
                  <span>Mês</span>
                  <select
                    value={dashboardMonth}
                    onChange={(event) => setDashboardMonth(Number(event.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, index) => {
                      const month = index + 1
                      return (
                        <option key={month} value={month}>
                          {new Date(2000, index, 1).toLocaleDateString('pt-BR', {
                            month: 'long'
                          })}
                        </option>
                      )
                    })}
                  </select>
                </label>
                <label className="dashboard-period-field">
                  <span>Ano</span>
                  <select
                    value={dashboardYear}
                    onChange={(event) => setDashboardYear(Number(event.target.value))}
                  >
                    {purchaseYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <section className="summary-grid">
                <button
                  type="button"
                  className="summary-card summary-card-button"
                  onClick={() => void navigateToPage('Histórico de compras')}
                  aria-label={`Ver histórico de compras de ${periodLabel}`}
                >
                  <div className="card-topline">
                    <span>Gasto no período</span>
                    <span className="metric-icon green">
                      <ShoppingCart size={18} />
                    </span>
                  </div>
                  <strong className="metric-value">
                    {dashboardLoading ? '—' : formatMoney(periodSpendCents)}
                  </strong>
                  <div className="metric-note">
                    <span>total registrado no período</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="summary-card summary-card-button"
                  onClick={() => void navigateToPage('Estoque')}
                  aria-label="Ver produtos cadastrados no estoque"
                >
                  <div className="card-topline">
                    <span>Itens no estoque</span>
                    <span className="metric-icon blue">
                      <Package size={18} />
                    </span>
                  </div>
                  <strong className="metric-value">
                    {dashboardSummary?.productCount ?? '—'} <small>produtos</small>
                  </strong>
                  <div className="metric-note">
                    <span>cadastrados no estoque</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="summary-card summary-card-button"
                  onClick={() => void navigateToPage('Lista de compras')}
                  aria-label="Ver produtos que precisam ser repostos"
                >
                  <div className="card-topline">
                    <span>Precisam ser repostos</span>
                    <span className="metric-icon orange">
                      <ShoppingBasket size={18} />
                    </span>
                  </div>
                  <strong className="metric-value">
                    {dashboardSummary?.lowStockCount ?? '—'} <small>produtos</small>
                  </strong>
                  <div className="metric-note">
                    <span className="trend warning">Atenção</span>
                    <span>estoque baixo</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="summary-card summary-card-button"
                  onClick={() => void navigateToPage('Histórico de compras')}
                  aria-label={`Ver compras de ${periodLabel}`}
                >
                  <div className="card-topline">
                    <span>Compras no período</span>
                    <span className="metric-icon red">
                      <ShoppingCart size={18} />
                    </span>
                  </div>
                  <strong className="metric-value">
                    {dashboardLoading ? '—' : periodPurchases.length} <small>compras</small>
                  </strong>
                  <div className="metric-note">
                    <span>registradas no período</span>
                  </div>
                </button>
              </section>

              <SpendingBarChart
                title="Gastos por mês"
                description={`Totais registrados em ${dashboardYear}; ${periodLabel} está destacado.`}
                buckets={dashboardSpendingBuckets}
                loading={dashboardLoading}
              />

              <section className="content-grid">
                <article className="panel purchases-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Compras de {periodLabel}</h2>
                      <p>Compras mais recentes no período selecionado</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => void navigateToPage('Histórico de compras')}
                    >
                      Ver histórico
                    </button>
                  </div>

                  {dashboardLoading || productsLoading ? (
                    <p className="recent-empty">Carregando compras...</p>
                  ) : periodPurchases.length === 0 ? (
                    <p className="recent-empty">Nenhuma compra registrada neste período.</p>
                  ) : (
                    <div className="purchase-list">
                      {periodPurchases.slice(0, 3).map((purchase) => (
                        <div className="purchase-row" key={purchase.id}>
                          <div className="product-icon">
                            <ReceiptText size={18} />
                          </div>
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
                  <button
                    className="add-item-button"
                    onClick={() => void navigateToPage('Lista de compras')}
                  >
                    <ListChecks size={16} /> Ver lista de reposição
                  </button>
                </article>
              </section>
            </>
          ) : activePage === 'Compras' ? (
            <PurchasesPage view="register" />
          ) : activePage === 'Histórico de compras' ? (
            <PurchasesPage view="history" />
          ) : activePage === 'Estoque' ? (
            <ProductsPage
              onNavigationGuardChange={registerStockNavigationGuard}
              onOpenArchivedProducts={() => void navigateToPage('Itens arquivados')}
            />
          ) : activePage === 'Lista de compras' ? (
            <ShoppingListPage onRegisterPurchase={() => void navigateToPage('Compras')} />
          ) : activePage === 'Configurações' ? (
            <section className="settings-page">
              <div className="settings-intro">
                <h2>Aparência</h2>
                <p>
                  Escolha como o app será exibido. Sua preferência fica salva neste dispositivo.
                </p>
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
              <div className="settings-intro stock-check-settings-intro">
                <h2>Estoque</h2>
                <p>Defina se as quantidades reais serão salvas automaticamente.</p>
              </div>
              {(settingsLoadError || settingsError) && (
                <div className="error-message">{settingsLoadError || settingsError}</div>
              )}
              <div className="panel theme-setting-card">
                <div className="theme-setting-copy">
                  <span className="theme-setting-icon">
                    <ClipboardCheck size={19} />
                  </span>
                  <div>
                    <strong>Salvar alterações de quantidade automaticamente</strong>
                    <p>
                      {settings.autoSaveStockQuantities
                        ? 'A quantidade real editada no Estoque será salva ao confirmar o campo ou sair da tela.'
                        : 'As quantidades digitadas não serão salvas automaticamente; você poderá confirmar cada conferência.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className={`theme-switch ${settings.autoSaveStockQuantities ? 'enabled' : ''}`}
                  role="switch"
                  aria-checked={settings.autoSaveStockQuantities}
                  aria-label="Salvar alterações de quantidade automaticamente"
                  disabled={settingsLoading || Boolean(settingsLoadError) || settingsSaving}
                  onClick={() => void handleAutoSaveSettingChange()}
                >
                  <span />
                </button>
              </div>
            </section>
          ) : activePage === 'Itens arquivados' ? (
            <ArchivedProductsPanel />
          ) : activePage === 'Preços' ? (
            <PriceHistoryPage />
          ) : (
            <section className="panel placeholder-panel">
              <div className="placeholder-icon">{activePage === 'Preços' && <Tag size={25} />}</div>
              <h2>{activePage} será construída aqui</h2>
              <p>O menu já está funcionando. Vamos desenvolver esta área em etapas.</p>
            </section>
          )}
        </div>
      </main>
      {showHelp && (
        <div
          className="modal-backdrop help-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeHelp()
          }}
        >
          <section
            className="product-modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            aria-describedby="help-description"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2 id="help-title">Como usar o Compras da Casa</h2>
                <p id="help-description">
                  Um guia rápido para organizar sua despensa e acompanhar as compras.
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Fechar tutorial"
                autoFocus
                onClick={closeHelp}
              >
                <X size={17} />
              </button>
            </div>
            <ol className="help-steps">
              {helpSteps.map(({ title, description, icon, preview, links }, index) => (
                <li className="help-step" key={title}>
                  <span className="help-step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div className="help-step-content">
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <div className="help-step-links">
                      {links.map(({ label, page }) => (
                        <button
                          type="button"
                          className="secondary-button"
                          key={page}
                          onClick={() => {
                            closeHelp()
                            void navigateToPage(page)
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <HelpPreview icon={icon} kind={preview} />
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
