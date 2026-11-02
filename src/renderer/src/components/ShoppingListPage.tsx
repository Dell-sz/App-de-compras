import { useEffect, useState } from 'react'
import {
  ArrowRight,
  Check,
  FileDown,
  ListChecks,
  Package,
  Pencil,
  Plus,
  Trash2,
  X
} from 'lucide-react'

type Props = {
  onRegisterPurchase: () => void
}

type ShoppingListItem = {
  productId: number
  name: string
  category: string
  quantity: string
  unit: string
  source: 'suggested' | 'manual'
}

type StoredManualItem = {
  productId: number
  quantity: string
}

const manualListStorageKey = 'compras-shopping-list-manual-v1'

function isStoredManualItem(value: unknown): value is StoredManualItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    'productId' in value &&
    typeof value.productId === 'number' &&
    Number.isSafeInteger(value.productId) &&
    'quantity' in value &&
    typeof value.quantity === 'string'
  )
}

function createSuggestedItems(products: Product[]): ShoppingListItem[] {
  return products
    .filter((product) => product.quantity <= product.minimumQuantity)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'pt-BR'))
    .map((product) => ({
      productId: product.id,
      name: product.name,
      category: product.category,
      quantity: String(product.quantity),
      unit: product.unit,
      source: 'suggested' as const
    }))
}

function parseStoredManualItems(serializedItems: string | null): StoredManualItem[] {
  if (!serializedItems) return []

  const parsed: unknown = JSON.parse(serializedItems)
  if (!Array.isArray(parsed) || parsed.some((item: unknown) => !isStoredManualItem(item))) {
    throw new Error('Os dados salvos da Lista de compras estão inválidos.')
  }
  return parsed.filter(isStoredManualItem)
}

function ShoppingListPage({ onRegisterPurchase }: Props): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [listItems, setListItems] = useState<ShoppingListItem[]>([])
  const [productToAddId, setProductToAddId] = useState('')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showExportPreview, setShowExportPreview] = useState(false)
  const [error, setError] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  useEffect(() => {
    window.api.products
      .list()
      .then((productList) => {
        setProducts(productList)
        let storedManualItems: StoredManualItem[] = []
        let canPersistRestoredItems = true
        try {
          storedManualItems = parseStoredManualItems(
            window.localStorage.getItem(manualListStorageKey)
          )
        } catch (loadError) {
          console.error(
            'Não foi possível recuperar os itens manuais da Lista de compras.',
            loadError
          )
          canPersistRestoredItems = false
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Não foi possível recuperar os itens salvos da Lista de compras.'
          )
        }

        const suggestedItems = createSuggestedItems(productList)
        const suggestedIds = new Set(suggestedItems.map((item) => item.productId))
        const productsById = new Map(productList.map((product) => [product.id, product]))
        const restoredManualItems = storedManualItems.flatMap((storedItem) => {
          const product = productsById.get(storedItem.productId)
          if (!product || suggestedIds.has(product.id)) return []
          return [
            {
              productId: product.id,
              name: product.name,
              category: product.category,
              quantity: storedItem.quantity,
              unit: product.unit,
              source: 'manual' as const
            }
          ]
        })
        setListItems([...suggestedItems, ...restoredManualItems])
        if (canPersistRestoredItems) persistManualItems(restoredManualItems)
      })
      .catch(() => setError('Não foi possível carregar o estoque.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleConfirmExportPdf(): Promise<void> {
    setError('')
    setExportMessage('')
    setExporting(true)
    try {
      const saved = await window.api.shoppingList.exportPdf(
        listItems.map(({ name, category, quantity, unit }) => ({
          name,
          category,
          quantity: Number(quantity),
          unit
        }))
      )
      if (saved) {
        setExportMessage('PDF exportado com sucesso.')
        setShowExportPreview(false)
        setEditing(false)
        setProductToAddId('')
        const suggestedItems = createSuggestedItems(products)
        setListItems(suggestedItems)
        persistManualItems(suggestedItems)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível exportar a lista em PDF.')
    } finally {
      setExporting(false)
    }
  }

  function persistManualItems(items: ShoppingListItem[]): void {
    try {
      const manualItems = items
        .filter((item) => item.source === 'manual')
        .map(({ productId, quantity }) => ({ productId, quantity }))
      window.localStorage.setItem(manualListStorageKey, JSON.stringify(manualItems))
    } catch (storageError) {
      console.error('Não foi possível salvar os itens manuais da Lista de compras.', storageError)
      setError(
        storageError instanceof Error
          ? storageError.message
          : 'Não foi possível salvar a Lista de compras neste dispositivo.'
      )
    }
  }

  function updateItemQuantity(productId: number, rawQuantity: string): void {
    const updatedItems = listItems.map((item) =>
      item.productId === productId ? { ...item, quantity: rawQuantity } : item
    )
    setListItems(updatedItems)
    persistManualItems(updatedItems)
  }

  const canExport =
    listItems.length > 0 &&
    listItems.every(
      (item) =>
        item.quantity.trim() !== '' &&
        Number.isFinite(Number(item.quantity)) &&
        Number(item.quantity) >= 0
    )

  function removeItem(productId: number): void {
    const updatedItems = listItems.filter((item) => item.productId !== productId)
    setListItems(updatedItems)
    persistManualItems(updatedItems)
  }

  const availableProducts = products.filter(
    (product) => !listItems.some((item) => item.productId === product.id)
  )

  function addProduct(): void {
    const product = availableProducts.find((candidate) => candidate.id === Number(productToAddId))
    if (!product) return

    const updatedItems: ShoppingListItem[] = [
      ...listItems,
      {
        productId: product.id,
        name: product.name,
        category: product.category,
        quantity: '1',
        unit: product.unit,
        source: 'manual'
      }
    ]
    setListItems(updatedItems)
    persistManualItems(updatedItems)
    setProductToAddId('')
  }

  return (
    <section className="smart-list-page">
      <div className="smart-list-intro">
        <div>
          <h2>Itens para repor</h2>
          <p>
            A lista considera a quantidade atual e o estoque mínimo que você definiu para cada
            produto.
          </p>
        </div>

        <span className="smart-list-count">
          {listItems.length} {listItems.length === 1 ? 'produto' : 'produtos'}
        </span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {exportMessage && <div className="success-message">{exportMessage}</div>}

      {loading ? (
        <div className="panel empty-state">Analisando o estoque...</div>
      ) : (
        <>
          <div className="panel smart-list-panel">
            <div className="smart-list-heading">
              <div>
                <h3>Precisam de atenção</h3>
                <p>Ajuste os itens para o PDF; editar a lista não altera o estoque.</p>
              </div>
              <div className="smart-list-edit-controls">
                {editing && (
                  <div className="smart-list-add-product">
                    <label className="form-field">
                      Adicionar produto ativo
                      <select
                        value={productToAddId}
                        onChange={(event) => setProductToAddId(event.target.value)}
                        disabled={availableProducts.length === 0}
                      >
                        <option value="">Selecione um produto</option>
                        {availableProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={addProduct}
                      disabled={!productToAddId}
                    >
                      <Plus size={15} /> Adicionar
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditing((current) => !current)}
                >
                  {editing ? <Check size={15} /> : <Pencil size={15} />}
                  {editing ? 'Concluir edição' : 'Editar lista'}
                </button>
              </div>
            </div>

            {listItems.length === 0 ? (
              <div className="smart-list-empty">
                <div className="placeholder-icon">
                  <ListChecks size={24} />
                </div>
                <strong>A lista está vazia</strong>
                <span>
                  {editing
                    ? 'Adicione produtos ativos do estoque para incluí-los no PDF.'
                    : 'Edite a lista para adicionar produtos.'}
                </span>
              </div>
            ) : (
              <div className="smart-product-list">
                {listItems.map((item) => {
                  const product = products.find((candidate) => candidate.id === item.productId)
                  const outOfStock = !product || product.quantity === 0
                  const lowStock =
                    product !== undefined &&
                    product.quantity > 0 &&
                    product.quantity <= product.minimumQuantity

                  return (
                    <article
                      className={`smart-product-row ${item.source === 'manual' ? 'manual' : ''}`}
                      key={item.productId}
                    >
                      <div className={`smart-product-icon ${outOfStock ? 'out' : ''}`}>
                        <Package size={19} />
                      </div>

                      <div className="smart-product-info">
                        <strong>{item.name}</strong>
                        <span className="smart-product-category">
                          {item.category || 'Sem categoria'}
                        </span>
                        <span className={`shopping-list-origin ${item.source}`}>
                          {item.source === 'suggested'
                            ? 'Sugerido por estoque baixo'
                            : 'Adicionado manualmente'}
                        </span>
                      </div>

                      <div className="smart-stock-info">
                        <span>Em casa (estoque atual)</span>
                        <strong>
                          {product?.quantity.toLocaleString('pt-BR') ?? '0'} {item.unit}
                        </strong>
                      </div>

                      <div className="smart-stock-info minimum">
                        <span>{editing ? 'Quantidade para o PDF' : 'Quantidade listada'}</span>
                        {editing ? (
                          <input
                            className="shopping-list-quantity-input"
                            type="number"
                            min="0"
                            step="any"
                            value={item.quantity}
                            aria-label={`Quantidade de ${item.name} na lista`}
                            onChange={(event) =>
                              updateItemQuantity(item.productId, event.target.value)
                            }
                          />
                        ) : (
                          <strong>
                            {`${Number(item.quantity).toLocaleString('pt-BR')} ${item.unit}`}
                          </strong>
                        )}
                      </div>

                      {editing ? (
                        <button
                          type="button"
                          className="remove-line-button shopping-list-remove-button"
                          aria-label={`Remover ${item.name} da lista`}
                          onClick={() => removeItem(item.productId)}
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : (
                        <span
                          className={`stock-status ${
                            outOfStock ? 'out' : lowStock ? 'low' : 'available'
                          }`}
                        >
                          {outOfStock ? 'Esgotado' : lowStock ? 'Repor' : 'Disponível'}
                        </span>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <div className="smart-list-footer">
            <span>
              {editing
                ? 'As alterações ainda não foram exportadas.'
                : 'Revise os itens antes de exportar.'}
            </span>
            <div className="smart-list-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setError('')
                  setShowExportPreview(true)
                }}
                disabled={exporting || !canExport}
              >
                <FileDown size={16} /> Prévia e exportação
              </button>
              <button className="primary-button" onClick={onRegisterPurchase}>
                Registrar compra <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </>
      )}
      {showExportPreview && (
        <div
          className="modal-backdrop shopping-list-preview-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !exporting) setShowExportPreview(false)
          }}
        >
          <section
            className="product-modal shopping-list-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shopping-list-preview-title"
          >
            <div className="modal-heading">
              <div>
                <h2 id="shopping-list-preview-title">Prévia da lista de compras</h2>
                <p>Revise os itens e as quantidades antes de gerar o PDF.</p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Fechar prévia"
                disabled={exporting}
                onClick={() => setShowExportPreview(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="shopping-list-preview-items">
              {listItems.map((item) => (
                <div className="shopping-list-preview-item" key={item.productId}>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.category}</small>
                  </span>
                  <strong>
                    {item.quantity.trim() === ''
                      ? 'Quantidade pendente'
                      : `${Number(item.quantity).toLocaleString('pt-BR')} ${item.unit}`}
                  </strong>
                </div>
              ))}
            </div>
            {error && <div className="error-message">{error}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="cancel-button"
                disabled={exporting}
                onClick={() => {
                  setShowExportPreview(false)
                  setEditing(true)
                }}
              >
                Voltar para editar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={exporting || !canExport}
                onClick={() => void handleConfirmExportPdf()}
              >
                <FileDown size={16} />
                {exporting ? 'Gerando PDF...' : 'Confirmar exportação'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

export default ShoppingListPage
