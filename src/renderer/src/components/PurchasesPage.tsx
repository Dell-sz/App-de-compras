import { useEffect, useState, type FormEvent } from 'react'
import { Plus, ReceiptText, Trash2 } from 'lucide-react'

type PurchaseLine = {
  productId: string
  quantity: string
  unitPrice: string
}

function getComparableQuantity(quantity: number, unit: string): number {
  const normalizedUnit = unit.trim().toLocaleLowerCase('pt-BR')
  return normalizedUnit === 'g' || normalizedUnit === 'ml' ? quantity / 1000 : quantity
}

function getComparableUnit(unit: string): string {
  const normalizedUnit = unit.trim().toLocaleLowerCase('pt-BR')
  if (normalizedUnit === 'g' || normalizedUnit === 'kg') return 'kg'
  if (normalizedUnit === 'ml' || normalizedUnit === 'l') return 'L'
  return unit || 'un'
}

function todayAsInputValue(): string {
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  return `${today.getFullYear()}-${month}-${day}`
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR')
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

function PurchasesPage(): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([])
  const [storeName, setStoreName] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(todayAsInputValue())
  const [items, setItems] = useState<PurchaseLine[]>([
    { productId: '', quantity: '1', unitPrice: '' }
  ])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    Promise.all([window.api.products.list(), window.api.purchases.list()])
      .then(([productList, purchaseList]) => {
        setProducts(productList)
        setPurchases(purchaseList)
      })
      .catch(() => setError('Não foi possível carregar os dados.'))
      .finally(() => setLoading(false))
  }, [])

  function updateItem(index: number, field: keyof PurchaseLine, value: string): void {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    )
  }

  function addItemRow(): void {
    setItems((current) => [
      ...current,
      { productId: '', quantity: '1', unitPrice: '' }
    ])
  }

  function removeItemRow(index: number): void {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const total = items.reduce(
    (sum, item) => {
      const product = products.find((candidate) => candidate.id === Number(item.productId))
      const enteredPrice = Number(item.unitPrice) || 0
      const quantity = Number(item.quantity) || 0
      if (!product || product.pricingMode === 'item_total') return sum + enteredPrice
      return sum + enteredPrice * getComparableQuantity(quantity, product.unit)
    },
    0
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError('')
    setSuccess('')

    const validItems = items.filter(
      (item) =>
        item.productId &&
        Number.isFinite(Number(item.quantity)) &&
        Number(item.quantity) > 0 &&
        item.unitPrice !== '' &&
        Number.isFinite(Number(item.unitPrice)) &&
        Number(item.unitPrice) >= 0
    )

    if (validItems.length !== items.length) {
      setError('Confira o produto, a quantidade e o preço de cada linha.')
      return
    }

    setSaving(true)

    try {
      const purchase = await window.api.purchases.add({
        storeName,
        purchaseDate,
        items: validItems.map((item) => ({
          productId: Number(item.productId),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice)
        }))
      })

      setPurchases((current) => [purchase, ...current])
      setSuccess('Compra salva e estoque atualizado.')
      window.dispatchEvent(new Event('app:data-changed'))
      setStoreName('')
      setPurchaseDate(todayAsInputValue())
      setItems([{ productId: '', quantity: '1', unitPrice: '' }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a compra.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeletePurchase(purchase: PurchaseSummary): Promise<void> {
    const confirmed = window.confirm(
      'Excluir esta compra removerá permanentemente a compra do histórico, os preços associados do histórico de preços e as quantidades correspondentes do estoque. Esta ação não pode ser desfeita. Deseja continuar?'
    )
    if (!confirmed) return

    setError('')
    setSuccess('')
    setDeletingPurchaseId(purchase.id)

    try {
      await window.api.purchases.remove(purchase.id)
      setPurchases((current) => current.filter((item) => item.id !== purchase.id))
      setSuccess('Compra excluída.')
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir a compra.')
    } finally {
      setDeletingPurchaseId(null)
    }
  }

  return (
    <section className="purchase-page">
      <div className="purchase-intro">
        <div>
          <h2>Registrar compra</h2>
          <p>Adicione os produtos comprados para atualizar o estoque e os preços.</p>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {loading ? (
        <div className="panel empty-state">Carregando dados...</div>
      ) : products.length === 0 ? (
        <div className="panel empty-state">
          <div className="placeholder-icon"><ReceiptText size={24} /></div>
          <strong>Cadastre produtos no Estoque primeiro</strong>
          <span>Depois você poderá selecionar os itens comprados aqui.</span>
        </div>
      ) : (
        <div className="purchase-layout">
          <form className="panel purchase-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <label className="form-field">
                Mercado
                <input
                  required
                  value={storeName}
                  onChange={(event) => setStoreName(event.target.value)}
                  placeholder="Ex.: Supermercado BH"
                />
              </label>
              <label className="form-field">
                Data da compra
                <input
                  required
                  type="date"
                  value={purchaseDate}
                  onChange={(event) => setPurchaseDate(event.target.value)}
                />
              </label>
            </div>

            <div className="purchase-items-heading">
              <h3>Produtos</h3>
              <button type="button" className="text-button" onClick={addItemRow}>
                <Plus size={15} /> Adicionar item
              </button>
            </div>

            <div className="purchase-lines">
              {items.map((item, index) => {
                const selectedProduct = products.find(
                  (product) => product.id === Number(item.productId)
                )

                return (
                  <div className="purchase-line" key={index}>
                  <label className="form-field item-product-field">
                    Produto
                    <select
                      required
                      value={item.productId}
                      onChange={(event) => updateItem(index, 'productId', event.target.value)}
                    >
                      <option value="">Selecione</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} ({product.unit})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="form-field item-quantity-field">
                    Quantidade
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={item.quantity}
                      onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                    />
                  </label>

                  <label className="form-field item-price-field">
                    {selectedProduct?.pricingMode === 'unit_measure'
                      ? `Preço por ${getComparableUnit(selectedProduct.unit)}`
                      : 'Valor total do item'}
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(event) => updateItem(index, 'unitPrice', event.target.value)}
                      placeholder={
                        selectedProduct?.pricingMode === 'unit_measure'
                          ? `R$ / ${getComparableUnit(selectedProduct.unit)}`
                          : 'Total pago'
                      }
                    />
                  </label>

                  <button
                    type="button"
                    className="remove-line-button"
                    aria-label="Remover item"
                    disabled={items.length === 1}
                    onClick={() => removeItemRow(index)}
                  >
                    <Trash2 size={16} />
                  </button>
                  </div>
                )
              })}
            </div>

            <div className="purchase-total">
              <span>Total estimado</span>
              <strong>
                {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </strong>
            </div>

            <button type="submit" className="primary-button save-purchase-button" disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar compra'}
            </button>
          </form>

          <aside className="panel recent-purchases">
            <div className="panel-heading">
              <div>
                <h2>Histórico de compras</h2>
                <p>Compras registradas neste app</p>
              </div>
            </div>

            {purchases.length === 0 ? (
              <p className="recent-empty">Suas compras salvas aparecerão aqui.</p>
            ) : (
              <div className="recent-purchase-list">
                {purchases.map((purchase) => (
                  <div className="recent-purchase-row" key={purchase.id}>
                    <div className="recent-purchase-icon"><ReceiptText size={17} /></div>
                    <div className="recent-purchase-info">
                      <strong>{purchase.storeName}</strong>
                      <span>{formatDate(purchase.purchaseDate)} · {purchase.itemCount} itens</span>
                    </div>
                    <strong className="recent-purchase-total">
                      {formatMoney(purchase.totalCents)}
                    </strong>
                    <button
                      type="button"
                      className="delete-purchase-button"
                      aria-label={`Excluir compra de ${purchase.storeName}`}
                      title="Excluir compra"
                      disabled={deletingPurchaseId === purchase.id}
                      onClick={() => handleDeletePurchase(purchase)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}

export default PurchasesPage