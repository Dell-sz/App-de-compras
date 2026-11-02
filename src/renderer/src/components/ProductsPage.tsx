import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Archive, ClipboardCheck, Package, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'

type UndoAction =
  | {
      kind: 'stock-check'
      undoToken: string
      previousQuantities: StockCheckResult['previousQuantities']
    }
  | {
      kind: 'quantity-update'
      productId: number
      expectedQuantity: number
      previousQuantity: number
    }
  | { kind: 'archive'; product: Product }

const emptyForm = (): NewProduct => ({
  name: '',
  category: '',
  unit: 'un',
  quantity: 0,
  minimumQuantity: 0,
  pricingMode: 'item_total'
})

type ProductsPageProps = {
  onNavigationGuardChange: (guard: (() => Promise<boolean>) | null) => void
  onOpenArchivedProducts: () => void
}

function ProductsPage({
  onNavigationGuardChange,
  onOpenArchivedProducts
}: ProductsPageProps): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [unitFilter, setUnitFilter] = useState('')
  const [currentStockFilter, setCurrentStockFilter] = useState('')
  const [quantitySortOrder, setQuantitySortOrder] = useState<'desc' | 'asc'>('desc')
  const [countedQuantities, setCountedQuantities] = useState<Record<number, string>>({})
  const [form, setForm] = useState<NewProduct>(emptyForm())
  const [showForm, setShowForm] = useState(false)
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [saveStockCheckHistory, setSaveStockCheckHistory] = useState(true)
  const [autoSaveStockQuantities, setAutoSaveStockQuantities] = useState(true)
  const [saving, setSaving] = useState(false)
  const [archivingProductId, setArchivingProductId] = useState<number | null>(null)
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([])
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)
  const [deletingProducts, setDeletingProducts] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null)
  const savedQuantities = useRef(new Map<number, number>())
  const quantitySavePromises = useRef(new Map<number, Promise<boolean>>())
  const categories = [
    ...new Set(products.map((product) => product.category.trim()).filter(Boolean))
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const units = [...new Set(products.map((product) => product.unit.trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR')
  )
  const currentStock = currentStockFilter.trim() ? Number(currentStockFilter) : null
  const getCurrentQuantity = (product: Product): number => {
    const rawQuantity = countedQuantities[product.id] ?? String(product.quantity)
    const quantity = Number(rawQuantity)
    return rawQuantity.trim() !== '' && Number.isFinite(quantity) && quantity >= 0
      ? quantity
      : product.quantity
  }
  const visibleProducts = products
    .filter((product) => {
      const quantity = getCurrentQuantity(product)
      if (categoryFilter && product.category !== categoryFilter) return false
      if (unitFilter && product.unit !== unitFilter) return false
      if (currentStock !== null && Number.isFinite(currentStock) && quantity !== currentStock)
        return false
      return true
    })
    .sort((a, b) => {
      const difference = getCurrentQuantity(a) - getCurrentQuantity(b)
      return (
        (quantitySortOrder === 'desc' ? -difference : difference) ||
        a.name.localeCompare(b.name, 'pt-BR')
      )
    })

  useEffect(() => {
    Promise.all([window.api.products.list(), window.api.settings.get()])
      .then(([productList, settings]) => {
        setProducts(productList)
        setSaveStockCheckHistory(settings.saveStockCheckHistory)
        setAutoSaveStockQuantities(settings.autoSaveStockQuantities)
        setSettingsLoaded(true)
        savedQuantities.current = new Map(
          productList.map((product) => [product.id, product.quantity])
        )
        setCountedQuantities(
          Object.fromEntries(productList.map((product) => [product.id, String(product.quantity)]))
        )
      })
      .catch(() => setError('Não foi possível carregar os produtos.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleStockCheck(): Promise<void> {
    setError('')

    const items = products.map((product) => ({
      productId: product.id,
      countedQuantity: Number(countedQuantities[product.id])
    }))

    if (
      items.some(
        (item) =>
          countedQuantities[item.productId]?.trim() === '' ||
          !Number.isFinite(item.countedQuantity) ||
          item.countedQuantity < 0
      )
    ) {
      setError('Informe uma quantidade válida, igual ou maior que zero, para cada produto.')
      return
    }

    if (
      !saveStockCheckHistory &&
      !window.confirm(
        'A conferência atualizará as quantidades do estoque, mas não será salva no histórico. Deseja concluir?'
      )
    ) {
      return
    }

    setSuccess('')
    setUndoAction(null)
    setSaving(true)
    try {
      const result = await window.api.stockChecks.record(items)
      setSaveStockCheckHistory(result.historySaved)
      for (const item of items) {
        savedQuantities.current.set(item.productId, item.countedQuantity)
      }
      setProducts((current) =>
        current.map((product) => ({
          ...product,
          quantity: Number(countedQuantities[product.id])
        }))
      )
      setSuccess(
        result.historySaved
          ? 'Conferência salva no histórico e estoque atualizado.'
          : 'Conferência não salva no histórico; estoque atualizado.'
      )
      setUndoAction({
        kind: 'stock-check',
        undoToken: result.undoToken,
        previousQuantities: result.previousQuantities
      })
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível registrar a conferência.')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchiveProduct(product: Product): Promise<void> {
    const confirmed = window.confirm(
      `Remover ${product.name} do estoque ativo? O histórico de compras e preços será preservado.`
    )
    if (!confirmed) return

    setError('')
    setSuccess('')
    setUndoAction(null)
    setArchivingProductId(product.id)
    try {
      await window.api.products.archive(product.id)
      setProducts((current) => current.filter((item) => item.id !== product.id))
      setSelectedProductIds((current) => current.filter((id) => id !== product.id))
      savedQuantities.current.delete(product.id)
      setCountedQuantities((current) => {
        const next = { ...current }
        delete next[product.id]
        return next
      })
      setSuccess('Produto arquivado. O histórico foi preservado.')
      setUndoAction({ kind: 'archive', product })
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível arquivar o produto.')
    } finally {
      setArchivingProductId(null)
    }
  }

  async function handleUndo(): Promise<void> {
    if (!undoAction) return
    setError('')
    setSaving(true)
    try {
      if (undoAction.kind === 'archive') {
        await window.api.products.restore(undoAction.product.id)
        setProducts((current) =>
          [...current, undoAction.product].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        )
        savedQuantities.current.set(undoAction.product.id, undoAction.product.quantity)
        setCountedQuantities((current) => ({
          ...current,
          [undoAction.product.id]: String(undoAction.product.quantity)
        }))
        setSuccess('Arquivamento desfeito. O produto voltou ao estoque ativo.')
      } else if (undoAction.kind === 'quantity-update') {
        await window.api.products.undoQuantityUpdate(
          undoAction.productId,
          undoAction.expectedQuantity,
          undoAction.previousQuantity
        )
        setProducts((current) =>
          current.map((product) =>
            product.id === undoAction.productId
              ? { ...product, quantity: undoAction.previousQuantity }
              : product
          )
        )
        savedQuantities.current.set(undoAction.productId, undoAction.previousQuantity)
        setCountedQuantities((current) => ({
          ...current,
          [undoAction.productId]: String(undoAction.previousQuantity)
        }))
        setSuccess('Alteração do estoque desfeita.')
      } else {
        await window.api.stockChecks.undo(undoAction.undoToken)
        const previousQuantities = new Map(
          undoAction.previousQuantities.map((item) => [item.productId, item.countedQuantity])
        )
        setProducts((current) =>
          current.map((product) => ({
            ...product,
            quantity: previousQuantities.get(product.id) ?? product.quantity
          }))
        )
        for (const item of undoAction.previousQuantities) {
          savedQuantities.current.set(item.productId, item.countedQuantity)
        }
        setCountedQuantities((current) => ({
          ...current,
          ...Object.fromEntries(
            undoAction.previousQuantities.map((item) => [
              item.productId,
              String(item.countedQuantity)
            ])
          )
        }))
        setSuccess('Conferência desfeita e quantidades anteriores restauradas.')
      }
      setUndoAction(null)
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível desfazer esta ação.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError('')
    setSuccess('')
    setUndoAction(null)
    setSaving(true)

    try {
      const previousProduct =
        editingProductId === null
          ? undefined
          : products.find((product) => product.id === editingProductId)
      const savedProduct =
        editingProductId === null
          ? await window.api.products.add(form)
          : await window.api.products.update(editingProductId, form)
      setProducts((current) => {
        const next =
          editingProductId === null
            ? [...current, savedProduct]
            : current.map((product) => (product.id === savedProduct.id ? savedProduct : product))
        return next.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      })
      savedQuantities.current.set(savedProduct.id, savedProduct.quantity)
      setCountedQuantities((current) => ({
        ...current,
        [savedProduct.id]: String(savedProduct.quantity)
      }))
      setForm(emptyForm())
      setShowForm(false)
      setEditingProductId(null)
      if (previousProduct && previousProduct.quantity !== savedProduct.quantity) {
        setSuccess('Estoque atualizado.')
        setUndoAction({
          kind: 'quantity-update',
          productId: savedProduct.id,
          expectedQuantity: savedProduct.quantity,
          previousQuantity: previousProduct.quantity
        })
      }
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o produto.')
    } finally {
      setSaving(false)
    }
  }

  const saveQuantity = useCallback(async (product: Product, rawValue: string): Promise<boolean> => {
    if (rawValue.trim() === '' || !Number.isFinite(Number(rawValue)) || Number(rawValue) < 0) {
      setError(`Informe uma quantidade válida para ${product.name} antes de sair do campo.`)
      return false
    }

    const waitingSave = quantitySavePromises.current.get(product.id)
    if (waitingSave && !(await waitingSave)) return false

    const quantity = Number(rawValue)
    const previousQuantity = savedQuantities.current.get(product.id) ?? product.quantity
    if (quantity === previousQuantity) {
      setCountedQuantities((current) => ({ ...current, [product.id]: String(quantity) }))
      return true
    }

    setError('')
    const operation = (async () => {
      setSaving(true)
      try {
        const savedProduct = await window.api.products.update(product.id, {
          name: product.name,
          category: product.category,
          unit: product.unit,
          quantity,
          minimumQuantity: product.minimumQuantity,
          pricingMode: product.pricingMode
        })
        savedQuantities.current.set(product.id, savedProduct.quantity)
        setProducts((current) =>
          current.map((item) => (item.id === product.id ? savedProduct : item))
        )
        setCountedQuantities((current) => ({
          ...current,
          [product.id]: String(savedProduct.quantity)
        }))
        setSuccess(`${product.name}: estoque atualizado.`)
        setUndoAction({
          kind: 'quantity-update',
          productId: product.id,
          expectedQuantity: savedProduct.quantity,
          previousQuantity
        })
        window.dispatchEvent(new Event('app:data-changed'))
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : `Não foi possível salvar ${product.name}.`)
        return false
      } finally {
        setSaving(false)
      }
    })()
    quantitySavePromises.current.set(product.id, operation)
    const saved = await operation
    if (quantitySavePromises.current.get(product.id) === operation) {
      quantitySavePromises.current.delete(product.id)
    }
    return saved
  }, [])

  const prepareToLeave = useCallback(async (): Promise<boolean> => {
    if (!settingsLoaded) return true
    if (saving && quantitySavePromises.current.size === 0) {
      setError('Aguarde a operação atual terminar antes de sair do Estoque.')
      return false
    }

    const currentSaves = [...quantitySavePromises.current.values()]
    if (currentSaves.length > 0) {
      const results = await Promise.all(currentSaves)
      if (results.some((result) => !result)) return false
    }

    const pendingEdits = products.filter((product) => {
      const rawValue = countedQuantities[product.id] ?? ''
      return (
        rawValue.trim() === '' ||
        !Number.isFinite(Number(rawValue)) ||
        Number(rawValue) < 0 ||
        Number(rawValue) !== (savedQuantities.current.get(product.id) ?? product.quantity)
      )
    })
    if (pendingEdits.length === 0) return true

    if (!autoSaveStockQuantities) {
      return window.confirm(
        'Há alterações de quantidade ainda não salvas. Como o salvamento automático está desativado, elas não serão salvas. Deseja sair do Estoque sem salvar?'
      )
    }

    const hasInvalidEdit = pendingEdits.some((product) => {
      const rawValue = countedQuantities[product.id] ?? ''
      return rawValue.trim() === '' || !Number.isFinite(Number(rawValue)) || Number(rawValue) < 0
    })
    if (hasInvalidEdit) {
      setError('Há uma quantidade incompleta ou inválida. Corrija-a antes de sair do Estoque.')
      return false
    }

    for (const product of pendingEdits) {
      if (!(await saveQuantity(product, countedQuantities[product.id]))) return false
    }
    return true
  }, [autoSaveStockQuantities, countedQuantities, products, saveQuantity, saving, settingsLoaded])

  useEffect(() => {
    onNavigationGuardChange(prepareToLeave)
    return () => onNavigationGuardChange(null)
  }, [onNavigationGuardChange, prepareToLeave])

  function handleQuantityBlur(product: Product, value: string): void {
    if (autoSaveStockQuantities) void saveQuantity(product, value)
  }

  function handleProductSelection(productId: number, selected: boolean): void {
    setSelectedProductIds((current) =>
      selected
        ? current.includes(productId)
          ? current
          : [...current, productId]
        : current.filter((id) => id !== productId)
    )
  }

  async function handleDeleteSelectedProducts(): Promise<void> {
    const productIds = products
      .filter((product) => selectedProductIds.includes(product.id))
      .map((product) => product.id)
    if (productIds.length === 0) return

    setError('')
    setDeletingProducts(true)
    try {
      if (typeof window.api.products.deletePermanently !== 'function') {
        throw new Error('A API de exclusão ainda não foi carregada. Feche e reabra o aplicativo.')
      }
      await window.api.products.deletePermanently(productIds)
      const deletedIds = new Set(productIds)
      setProducts((current) => current.filter((product) => !deletedIds.has(product.id)))
      for (const productId of productIds) savedQuantities.current.delete(productId)
      setCountedQuantities((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([productId]) => !deletedIds.has(Number(productId)))
        )
      )
      setSelectedProductIds([])
      setShowDeleteConfirmation(false)
      setUndoAction(null)
      setSuccess(
        `${productIds.length} ${productIds.length === 1 ? 'produto excluído' : 'produtos excluídos'} permanentemente.`
      )
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir os produtos.')
    } finally {
      setDeletingProducts(false)
    }
  }

  function handleEditProduct(product: Product): void {
    setEditingProductId(product.id)
    setForm({
      name: product.name,
      category: product.category,
      unit: product.unit,
      quantity: product.quantity,
      minimumQuantity: product.minimumQuantity,
      pricingMode: product.pricingMode
    })
    setShowForm(true)
  }

  function closeForm(): void {
    setShowForm(false)
    setEditingProductId(null)
    setForm(emptyForm())
  }

  return (
    <section className="products-section">
      <div className="products-toolbar">
        <div>
          <h2>Produtos cadastrados</h2>
          <p>
            {products.length}{' '}
            {products.length === 1 ? 'produto ativo cadastrado' : 'produtos ativos cadastrados'}.
            Edite as quantidades atuais na tabela; o salvamento segue a configuração escolhida.
          </p>
        </div>
        <div className="products-toolbar-actions">
          <button type="button" className="secondary-button" onClick={onOpenArchivedProducts}>
            <Archive size={16} /> Itens arquivados
          </button>
          <button
            type="button"
            className="permanent-delete-trigger"
            disabled={
              selectedProductIds.length === 0 ||
              loading ||
              saving ||
              deletingProducts ||
              archivingProductId !== null
            }
            onClick={() => {
              setError('')
              setSuccess('')
              setShowDeleteConfirmation(true)
            }}
          >
            <Trash2 size={16} />
            Apagar selecionados
            {selectedProductIds.length > 0 ? ` (${selectedProductIds.length})` : ''}
          </button>
          <button
            className="secondary-button"
            onClick={handleStockCheck}
            disabled={
              loading || !settingsLoaded || saving || deletingProducts || products.length === 0
            }
          >
            <ClipboardCheck size={17} />
            {saving ? 'Salvando...' : 'Atualizar estoque'}
          </button>
          <button
            className="primary-button"
            onClick={() => setShowForm(true)}
            disabled={saving || deletingProducts}
          >
            <Plus size={18} />
            Novo produto
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && (
        <div className="success-message">
          {success}
          {undoAction && (
            <button
              type="button"
              className="undo-action-button"
              onClick={handleUndo}
              disabled={saving}
            >
              <Undo2 size={14} /> Desfazer
            </button>
          )}
        </div>
      )}

      <div className="panel products-panel">
        {!loading && products.length > 0 && (
          <div className="products-filters">
            <label className="form-field">
              Filtrar por categoria
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="">Todas as categorias</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Filtrar por unidade
              <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)}>
                <option value="">Todas as unidades</option>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Filtrar por estoque atual
              <input
                type="number"
                min="0"
                step="0.01"
                value={currentStockFilter}
                onChange={(event) => setCurrentStockFilter(event.target.value)}
                placeholder="Todas as quantidades"
              />
            </label>
            <label className="form-field">
              Ordenar quantidade atual
              <select
                value={quantitySortOrder}
                onChange={(event) =>
                  setQuantitySortOrder(event.target.value === 'asc' ? 'asc' : 'desc')
                }
              >
                <option value="desc">Maior para menor</option>
                <option value="asc">Menor para maior</option>
              </select>
            </label>
            <span>
              Exibindo {visibleProducts.length} de {products.length} produtos
            </span>
          </div>
        )}
        {loading ? (
          <p className="empty-state">Carregando produtos...</p>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <div className="placeholder-icon">
              <Package size={24} />
            </div>
            <strong>Nenhum produto cadastrado ainda</strong>
            <span>Adicione os produtos que você costuma manter em casa.</span>
          </div>
        ) : visibleProducts.length === 0 ? (
          <p className="empty-state">Nenhum produto encontrado com esses filtros.</p>
        ) : (
          <div className="table-scroll">
            <table className="products-table stock-products-table">
              <thead>
                <tr>
                  <th>
                    <label className="product-selection-checkbox">
                      <span className="visually-hidden">Selecionar todos os produtos</span>
                      <input
                        type="checkbox"
                        checked={
                          visibleProducts.length > 0 &&
                          visibleProducts.every((product) =>
                            selectedProductIds.includes(product.id)
                          )
                        }
                        disabled={saving || deletingProducts}
                        onChange={(event) =>
                          setSelectedProductIds(
                            event.target.checked
                              ? [
                                  ...new Set([
                                    ...selectedProductIds,
                                    ...visibleProducts.map((product) => product.id)
                                  ])
                                ]
                              : selectedProductIds.filter(
                                  (id) => !visibleProducts.some((product) => product.id === id)
                                )
                          )
                        }
                      />
                    </label>
                  </th>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Estoque atual</th>
                  <th>Estoque mínimo</th>
                  <th>Precificação</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {visibleProducts.map((product) => {
                  const quantity = getCurrentQuantity(product)
                  const outOfStock = quantity === 0
                  const lowStock = quantity > 0 && quantity <= product.minimumQuantity
                  const status = outOfStock ? 'Esgotado' : lowStock ? 'Repor' : 'Disponível'

                  return (
                    <tr key={product.id}>
                      <td>
                        <label className="product-selection-checkbox">
                          <span className="visually-hidden">Selecionar {product.name}</span>
                          <input
                            type="checkbox"
                            checked={selectedProductIds.includes(product.id)}
                            disabled={saving || deletingProducts}
                            onChange={(event) =>
                              handleProductSelection(product.id, event.target.checked)
                            }
                          />
                        </label>
                      </td>
                      <td
                        className="table-product-name"
                        data-label="Produto"
                        aria-label={`Produto: ${product.name}`}
                      >
                        {product.name}
                      </td>
                      <td data-label="Categoria" aria-label={`Categoria: ${product.category}`}>
                        {product.category}
                      </td>
                      <td
                        data-label="Estoque atual"
                        aria-label={`Estoque atual de ${product.name}`}
                      >
                        <label className="stock-count-field">
                          <span className="visually-hidden">Estoque atual de {product.name}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            aria-label={`Estoque atual de ${product.name}`}
                            value={countedQuantities[product.id] ?? ''}
                            disabled={saving || deletingProducts || !settingsLoaded}
                            onChange={(event) =>
                              setCountedQuantities((current) => ({
                                ...current,
                                [product.id]: event.target.value
                              }))
                            }
                            onBlur={(event) => handleQuantityBlur(product, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                event.currentTarget.blur()
                              }
                            }}
                          />
                          <span>{product.unit}</span>
                        </label>
                      </td>
                      <td
                        data-label="Estoque mínimo"
                        aria-label={`Estoque mínimo: ${product.minimumQuantity} ${product.unit}`}
                      >
                        {product.minimumQuantity.toLocaleString('pt-BR')} {product.unit}
                      </td>
                      <td
                        data-label="Precificação"
                        aria-label={`Precificação: ${
                          product.pricingMode === 'item_total'
                            ? 'Valor total do item'
                            : 'Preço por unidade de medida'
                        }`}
                      >
                        {product.pricingMode === 'item_total'
                          ? 'Valor total do item'
                          : 'Preço por unidade de medida'}
                      </td>
                      <td data-label="Situação" aria-label={`Situação: ${status}`}>
                        <span
                          className={`stock-status ${
                            outOfStock ? 'out' : lowStock ? 'low' : 'available'
                          }`}
                        >
                          {status}
                        </span>
                      </td>
                      <td data-label="Ações" aria-label={`Ações para ${product.name}`}>
                        <button
                          type="button"
                          className="edit-product-button"
                          aria-label={`Editar ${product.name}`}
                          title="Editar produto"
                          disabled={saving || deletingProducts || archivingProductId !== null}
                          onClick={() => handleEditProduct(product)}
                        >
                          <Pencil size={15} />
                          Editar
                        </button>
                        <button
                          type="button"
                          className="archive-product-button"
                          aria-label={`Arquivar ${product.name}`}
                          title="Remover do estoque ativo"
                          disabled={saving || deletingProducts || archivingProductId !== null}
                          onClick={() => handleArchiveProduct(product)}
                        >
                          <Archive size={15} />
                          Arquivar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="modal-backdrop" onMouseDown={closeForm}>
          <section
            className="product-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-form-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2 id="product-form-title">
                  {editingProductId === null ? 'Novo produto' : 'Editar produto'}
                </h2>
                <p>
                  {editingProductId === null
                    ? 'Cadastre um item para acompanhar no estoque.'
                    : 'Atualize os dados e a forma de precificação do produto.'}
                </p>
              </div>
              <button className="close-button" onClick={closeForm} aria-label="Fechar">
                <X size={19} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <label className="form-field">
                Nome do produto
                <input
                  autoFocus
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Ex.: Arroz"
                />
              </label>

              <div className="form-row">
                <label className="form-field">
                  Categoria
                  <input
                    value={form.category}
                    onChange={(event) => setForm({ ...form, category: event.target.value })}
                    placeholder="Ex.: Mercearia"
                  />
                </label>
                <label className="form-field unit-field">
                  Unidade
                  <select
                    value={form.unit}
                    onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  >
                    <option value="un">un</option>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="unidade">unidade</option>
                  </select>
                </label>
              </div>

              <div className="form-row">
                <label className="form-field">
                  Quantidade atual
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.quantity}
                    onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })}
                  />
                </label>
                <label className="form-field">
                  Avisar quando chegar a
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.minimumQuantity}
                    onChange={(event) =>
                      setForm({ ...form, minimumQuantity: Number(event.target.value) })
                    }
                  />
                </label>
              </div>

              <label className="form-field">
                Forma de precificação
                <select
                  value={form.pricingMode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      pricingMode: event.target.value as PricingMode
                    })
                  }
                >
                  <option value="item_total">Valor total do item</option>
                  <option value="unit_measure">Preço por unidade de medida</option>
                </select>
                <span className="form-hint">
                  {form.pricingMode === 'item_total'
                    ? 'O valor informado na compra será o total pago pela quantidade.'
                    : 'O valor informado será por kg, litro ou unidade.'}
                </span>
              </label>

              <div className="modal-actions">
                <button type="button" className="cancel-button" onClick={closeForm}>
                  Cancelar
                </button>
                <button type="submit" className="primary-button" disabled={saving}>
                  {saving
                    ? 'Salvando...'
                    : editingProductId === null
                      ? 'Salvar produto'
                      : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showDeleteConfirmation && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!deletingProducts) setShowDeleteConfirmation(false)
          }}
        >
          <section
            className="product-modal permanent-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-products-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2 id="delete-products-title">Excluir produtos permanentemente?</h2>
                <p>
                  Você selecionou {selectedProductIds.length}{' '}
                  {selectedProductIds.length === 1 ? 'produto' : 'produtos'}.
                </p>
              </div>
              <button
                className="close-button"
                onClick={() => setShowDeleteConfirmation(false)}
                aria-label="Fechar confirmação"
                disabled={deletingProducts}
              >
                <X size={19} />
              </button>
            </div>
            <div className="permanent-delete-warning">
              <strong>Esta ação é permanente e não pode ser desfeita.</strong>
              <p>
                Os produtos selecionados, o histórico de preços, os itens correspondentes nas
                compras e os registros de conferência serão apagados. As compras continuarão
                registradas com seus totais, mas esses produtos deixarão de aparecer nos detalhes.
              </p>
              <ul>
                {products
                  .filter((product) => selectedProductIds.includes(product.id))
                  .map((product) => (
                    <li key={product.id}>{product.name}</li>
                  ))}
              </ul>
              <p>Tem certeza de que deseja continuar?</p>
            </div>
            {error && <div className="error-message">{error}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                onClick={() => setShowDeleteConfirmation(false)}
                disabled={deletingProducts}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="confirm-delete-button"
                onClick={() => void handleDeleteSelectedProducts()}
                disabled={deletingProducts}
              >
                <Trash2 size={16} />
                {deletingProducts ? 'Apagando...' : 'Excluir permanentemente'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default ProductsPage
