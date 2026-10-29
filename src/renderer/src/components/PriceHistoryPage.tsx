import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ListChecks, Search, Tag, X } from 'lucide-react'
type ComparisonProduct = Pick<Product, 'id' | 'name' | 'unit'>
type ComparablePriceHistoryEntry = PriceHistoryEntry & { comparableUnitPriceCents: number }

function toLocalDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDefaultPeriod(): { start: string; end: string } {
  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 29)
  return { start: toLocalDateInput(startDate), end: toLocalDateInput(endDate) }
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR')
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function getComparableUnit(unit: string): string {
  const normalizedUnit = unit.trim().toLocaleLowerCase('pt-BR')
  if (normalizedUnit === 'g' || normalizedUnit === 'kg') return 'kg'
  if (normalizedUnit === 'ml' || normalizedUnit === 'l') return 'L'
  return unit.trim() || 'un'
}

function getComparableUnitKey(unit: string): string {
  const normalizedUnit = unit.trim().toLocaleLowerCase('pt-BR')
  if (normalizedUnit === 'g' || normalizedUnit === 'kg') return 'kg'
  if (normalizedUnit === 'ml' || normalizedUnit === 'l') return 'l'
  return normalizedUnit || 'un'
}

function compareEntriesNewestFirst(a: PriceHistoryEntry, b: PriceHistoryEntry): number {
  return b.purchaseDate.localeCompare(a.purchaseDate) || b.id - a.id
}

function hasComparablePrice(
  entry: PriceHistoryEntry
): entry is ComparablePriceHistoryEntry {
  return (
    typeof entry.comparableUnitPriceCents === 'number' &&
    Number.isFinite(entry.comparableUnitPriceCents) &&
    entry.comparableUnitPriceCents >= 0
  )
}

function PriceHistoryPage(): React.JSX.Element {
  const [history, setHistory] = useState<PriceHistoryEntry[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([])
  const [draftProductIds, setDraftProductIds] = useState<number[]>([])
  const [showProductSelector, setShowProductSelector] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [period, setPeriod] = useState(getDefaultPeriod)

  useEffect(() => {
    let isCurrent = true

    Promise.all([window.api.prices.list(), window.api.products.list()])
      .then(([priceEntries, productList]) => {
        if (!Array.isArray(priceEntries) || !Array.isArray(productList)) {
          throw new Error('A API retornou dados inválidos para comparação de preços.')
        }
        if (!isCurrent) return
        setHistory(priceEntries)
        setProducts(productList)
        setError('')
      })
      .catch((loadError: unknown) => {
        console.error('Não foi possível carregar os dados para comparação de preços.', loadError)
        if (isCurrent) setError('Não foi possível carregar os dados para comparação de preços.')
      })
      .finally(() => {
        if (isCurrent) setLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [])

  const shoppingListProducts = useMemo(
    () =>
      products
        .filter((product) => product.quantity <= product.minimumQuantity)
        .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'pt-BR')),
    [products]
  )

  const comparisonProducts = useMemo(() => {
    const available = new Map<number, ComparisonProduct>(
      products.map(({ id, name, unit }) => [id, { id, name, unit }])
    )
    for (const entry of history) {
      if (!available.has(entry.productId)) {
        available.set(entry.productId, {
          id: entry.productId,
          name: entry.productName,
          unit: entry.unit
        })
      }
    }
    return [...available.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [history, products])

  const selectedProducts = comparisonProducts.filter((product) =>
    selectedProductIds.includes(product.id)
  )
  const missingPeriod = !period.start || !period.end
  const startAfterEnd = Boolean(period.start && period.end && period.start > period.end)
  const periodHistory = history.filter(
    (entry) =>
      !missingPeriod &&
      !startAfterEnd &&
      entry.purchaseDate >= period.start &&
      entry.purchaseDate <= period.end &&
      selectedProductIds.includes(entry.productId)
  )

  const historyByProduct = new Map<number, PriceHistoryEntry[]>()
  for (const entry of periodHistory) {
    const entries = historyByProduct.get(entry.productId) ?? []
    entries.push(entry)
    historyByProduct.set(entry.productId, entries)
  }

  const filteredProducts = comparisonProducts.filter((product) =>
    product.name.toLocaleLowerCase('pt-BR').includes(productSearch.trim().toLocaleLowerCase('pt-BR'))
  )

  const selectedProductLabels = selectedProducts.slice(0, 3)
  const hiddenSelectionCount = Math.max(0, selectedProducts.length - selectedProductLabels.length)

  function openProductSelector(): void {
    setDraftProductIds(selectedProductIds)
    setProductSearch('')
    setShowProductSelector(true)
  }

  function toggleDraftProduct(productId: number): void {
    setDraftProductIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    )
  }

  function selectShoppingListProducts(): void {
    setDraftProductIds(shoppingListProducts.map((product) => product.id))
  }

  function confirmProductSelection(): void {
    setSelectedProductIds(draftProductIds)
    setShowProductSelector(false)
  }

  return (
    <section className="price-history-page">
      <div className="price-compare-intro">
        <div>
          <h2>Comparação de preços</h2>
          <p>Compare o histórico por mercado e data sem misturar total pago com preço por medida.</p>
        </div>
        <span className="price-compare-icon"><Tag size={20} /></span>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="panel price-compare-filters">
        <div className="price-compare-filter-row">
          <div className="price-selection-summary">
            <span className="price-selection-label">Produtos para comparar</span>
            <div className="price-selection-controls">
              <button
                type="button"
                className="secondary-button price-select-products-button"
                onClick={openProductSelector}
                disabled={loading || comparisonProducts.length === 0}
              >
                <Tag size={15} />
                Selecionar produtos
              </button>
              <div className="price-selected-tags" aria-live="polite">
                {selectedProducts.length === 0 ? (
                  <span className="price-selection-placeholder">Nenhum produto selecionado</span>
                ) : (
                  <>
                    {selectedProductLabels.map((product) => (
                      <span className="price-selected-tag" key={product.id}>{product.name}</span>
                    ))}
                    {hiddenSelectionCount > 0 && (
                      <span className="price-selected-tag price-selected-more">
                        +{hiddenSelectionCount}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <label className="form-field">
            <span><CalendarDays size={13} /> Data inicial</span>
            <input
              type="date"
              value={period.start}
              max={period.end || undefined}
              onChange={(event) => setPeriod((current) => ({ ...current, start: event.target.value }))}
              disabled={loading}
            />
          </label>
          <label className="form-field">
            <span><CalendarDays size={13} /> Data final</span>
            <input
              type="date"
              value={period.end}
              min={period.start || undefined}
              onChange={(event) => setPeriod((current) => ({ ...current, end: event.target.value }))}
              disabled={loading}
            />
          </label>
        </div>
      </div>

      {showProductSelector && (
        <div
          className="modal-backdrop price-selector-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowProductSelector(false)
          }}
        >
          <section
            className="product-modal price-selector-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="price-selector-title"
          >
            <div className="modal-heading">
              <div>
                <h2 id="price-selector-title">Selecionar produtos</h2>
                <p>Escolha um ou mais produtos para comparar.</p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Fechar seletor"
                onClick={() => setShowProductSelector(false)}
              >
                <X size={17} />
              </button>
            </div>

            <label className="price-selector-search">
              <Search size={16} />
              <input
                type="search"
                aria-label="Buscar produtos por nome"
                placeholder="Buscar por nome..."
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                autoFocus
              />
            </label>

            <button
              type="button"
              className="price-shopping-list-option"
              onClick={selectShoppingListProducts}
            >
              <ListChecks size={16} />
              <span>
                <strong>Selecionar itens atuais da Lista de compras</strong>
                <small>
                  {shoppingListProducts.length}{' '}
                  {shoppingListProducts.length === 1 ? 'produto' : 'produtos'}
                </small>
              </span>
            </button>

            <div className="price-selector-list" aria-label="Produtos disponíveis">
              {filteredProducts.length === 0 ? (
                <p className="price-selector-empty">Nenhum produto encontrado.</p>
              ) : (
                filteredProducts.map((product) => (
                  <label className="price-selector-product" key={product.id}>
                    <input
                      type="checkbox"
                      checked={draftProductIds.includes(product.id)}
                      onChange={() => toggleDraftProduct(product.id)}
                    />
                    <span>{product.name}</span>
                    <small>{product.unit}</small>
                  </label>
                ))
              )}
            </div>

            <div className="price-selector-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => setDraftProductIds([])}
              >
                Limpar seleção
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={confirmProductSelection}
              >
                Confirmar ({draftProductIds.length})
              </button>
            </div>
          </section>
        </div>
      )}

      {startAfterEnd && (
        <div className="error-message" role="alert">
          A data inicial deve ser anterior ou igual à data final.
        </div>
      )}
      {missingPeriod && (
        <div className="error-message" role="alert">
          Informe a data inicial e a data final do período.
        </div>
      )}

      <div className="price-comparison-results">
        {loading ? (
          <div className="panel empty-state">Carregando dados de comparação...</div>
        ) : error ? null : missingPeriod || startAfterEnd ? null : selectedProductIds.length === 0 ? (
          <div className="panel empty-state">
            <div className="placeholder-icon"><Tag size={24} /></div>
            <strong>Selecione produtos para comparar</strong>
            <span>Escolha um ou mais produtos ou compare todos da Lista de compras.</span>
          </div>
        ) : periodHistory.length === 0 ? (
          <div className="panel empty-state">
            <div className="placeholder-icon"><Tag size={24} /></div>
            <strong>Nenhuma compra encontrada neste período</strong>
            <span>Altere o período ou a seleção de produtos para ver resultados.</span>
          </div>
        ) : (
          selectedProducts.map((product) => {
            const entries = [...(historyByProduct.get(product.id) ?? [])].sort(compareEntriesNewestFirst)
            const allComparableEntries = entries.filter(hasComparablePrice)
            const newest = allComparableEntries[0]
            const comparableUnit = newest ? getComparableUnit(newest.unit) : getComparableUnit(product.unit)
            const comparableUnitKey = newest
              ? getComparableUnitKey(newest.unit)
              : getComparableUnitKey(product.unit)
            const comparableEntries = allComparableEntries.filter(
              (entry) => getComparableUnitKey(entry.unit) === comparableUnitKey
            )
            const previous = comparableEntries.find((entry) => entry.id !== newest?.id)
            const cheapest = comparableEntries.reduce<ComparablePriceHistoryEntry | undefined>(
              (lowest, entry) =>
                !lowest ||
                entry.comparableUnitPriceCents < lowest.comparableUnitPriceCents
                  ? entry
                  : lowest,
              undefined
            )
            const previousPriceCents = previous?.comparableUnitPriceCents ?? null
            const differenceCents =
              newest && previous
                ? newest.comparableUnitPriceCents - previous.comparableUnitPriceCents
                : null
            const differencePercent =
              differenceCents !== null &&
              previousPriceCents !== null &&
              previousPriceCents !== 0
                ? (differenceCents / previousPriceCents) * 100
                : null

            return (
              <article className="panel price-product-card" key={product.id}>
                <div className="price-product-heading">
                  <div>
                    <h3>{product.name}</h3>
                    <span>Comparação por {comparableUnit}</span>
                  </div>
                  <div className="price-product-insights">
                    <div className="price-insight">
                      <span>Variação recente</span>
                      {differenceCents === null ? (
                        <strong className="price-neutral">Dados insuficientes</strong>
                      ) : (
                        <strong
                          className={
                            differenceCents < 0
                              ? 'price-delta-down'
                              : differenceCents > 0
                                ? 'price-delta-up'
                                : 'price-delta-neutral'
                          }
                        >
                          {differenceCents > 0 ? '+' : ''}
                          {formatMoney(differenceCents)}
                          {differencePercent === null
                            ? ' · % indisponível'
                            : ` · ${differencePercent > 0 ? '+' : ''}${differencePercent.toLocaleString('pt-BR', {
                                maximumFractionDigits: 1
                              })}%`}
                        </strong>
                      )}
                    </div>
                    <div className="price-insight">
                      <span>Menor preço no período</span>
                      {cheapest ? (
                        <strong>
                          {cheapest.storeName} · {formatMoney(cheapest.comparableUnitPriceCents)}/{comparableUnit}
                        </strong>
                      ) : (
                        <strong className="price-delta-neutral">Sem comparação disponível</strong>
                      )}
                    </div>
                  </div>
                </div>

                {entries.length === 0 ? (
                  <p className="price-compare-hint">Nenhuma compra deste produto no período.</p>
                ) : (
                  <div className="table-scroll">
                    <table className="products-table price-comparison-table">
                      <thead>
                        <tr>
                          <th>Mercado</th>
                          <th>Data</th>
                          <th>Quantidade</th>
                          <th>Valor total pago</th>
                          <th>Preço comparável</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((entry) => {
                          const comparablePrice = hasComparablePrice(entry)
                            ? entry.comparableUnitPriceCents
                            : null
                          return (
                            <tr key={entry.id}>
                              <td>{entry.storeName}</td>
                              <td>{formatDate(entry.purchaseDate)}</td>
                              <td>{entry.quantity.toLocaleString('pt-BR')} {entry.unit}</td>
                              <td>{formatMoney(entry.totalPaidCents)}</td>
                              <td>
                                {comparablePrice !== null ? (
                                  <>{formatMoney(comparablePrice)} / {getComparableUnit(entry.unit)}</>
                                ) : (
                                  <span className="price-legacy">Sem comparação disponível</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}

export default PriceHistoryPage
