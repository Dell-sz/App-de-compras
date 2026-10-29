import { useEffect, useState, type FormEvent } from 'react'
import { Archive, ClipboardCheck, Package, Pencil, Plus, X } from 'lucide-react'

const emptyForm = (): NewProduct => ({
  name: '',
  category: '',
  unit: 'un',
  quantity: 0,
  minimumQuantity: 0,
  pricingMode: 'item_total'
})

function ProductsPage(): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [countedQuantities, setCountedQuantities] = useState<Record<number, string>>({})
  const [form, setForm] = useState<NewProduct>(emptyForm())
  const [showForm, setShowForm] = useState(false)
  const [editingProductId, setEditingProductId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [archivingProductId, setArchivingProductId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    window.api.products
      .list()
      .then((productList) => {
        setProducts(productList)
        setCountedQuantities(
          Object.fromEntries(productList.map((product) => [product.id, String(product.quantity)]))
        )
      })
      .catch(() => setError('Não foi possível carregar os produtos.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleStockCheck(): Promise<void> {
    setError('')
    setSuccess('')

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

    setSaving(true)
    try {
      await window.api.stockChecks.record(items)
      setProducts((current) =>
        current.map((product) => ({
          ...product,
          quantity: Number(countedQuantities[product.id])
        }))
      )
      setSuccess('Conferência registrada e estoque atualizado.')
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
    setArchivingProductId(product.id)
    try {
      await window.api.products.archive(product.id)
      setProducts((current) => current.filter((item) => item.id !== product.id))
      setCountedQuantities((current) => {
        const next = { ...current }
        delete next[product.id]
        return next
      })
      setSuccess('Produto arquivado. O histórico foi preservado.')
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível arquivar o produto.')
    } finally {
      setArchivingProductId(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError('')
    setSuccess('')
    setSaving(true)

    try {
      const savedProduct =
        editingProductId === null
          ? await window.api.products.add(form)
          : await window.api.products.update(editingProductId, form)
      setProducts((current) => {
        const next =
          editingProductId === null
            ? [...current, savedProduct]
            : current.map((product) =>
                product.id === savedProduct.id ? savedProduct : product
              )
        return next.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      })
      setCountedQuantities((current) => ({
        ...current,
        [savedProduct.id]: String(savedProduct.quantity)
      }))
      setForm(emptyForm())
      setShowForm(false)
      setEditingProductId(null)
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o produto.')
    } finally {
      setSaving(false)
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
          <p>Confira as quantidades reais para atualizar o estoque.</p>
        </div>
        <div className="products-toolbar-actions">
          <button
            className="secondary-button"
            onClick={handleStockCheck}
            disabled={loading || saving || products.length === 0}
          >
            <ClipboardCheck size={17} />
            {saving ? 'Salvando...' : 'Conferir estoque'}
          </button>
          <button className="primary-button" onClick={() => setShowForm(true)}>
            <Plus size={18} />
            Novo produto
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="panel products-panel">
        {loading ? (
          <p className="empty-state">Carregando produtos...</p>
        ) : products.length === 0 ? (
          <div className="empty-state">
            <div className="placeholder-icon"><Package size={24} /></div>
            <strong>Nenhum produto cadastrado ainda</strong>
            <span>Adicione os produtos que você costuma manter em casa.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="products-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Categoria</th>
                  <th>Estoque atual</th>
                  <th>Contagem real</th>
                  <th>Estoque mínimo</th>
                  <th>Precificação</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const lowStock = product.quantity <= product.minimumQuantity

                  return (
                    <tr key={product.id}>
                      <td className="table-product-name">{product.name}</td>
                      <td>{product.category}</td>
                      <td>{product.quantity.toLocaleString('pt-BR')} {product.unit}</td>
                      <td>
                        <label className="stock-count-field">
                          <span className="visually-hidden">
                            Quantidade conferida de {product.name}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={countedQuantities[product.id] ?? ''}
                            onChange={(event) =>
                              setCountedQuantities((current) => ({
                                ...current,
                                [product.id]: event.target.value
                              }))
                            }
                          />
                          <span>{product.unit}</span>
                        </label>
                      </td>
                      <td>{product.minimumQuantity.toLocaleString('pt-BR')} {product.unit}</td>
                      <td>
                        {product.pricingMode === 'item_total'
                          ? 'Valor total do item'
                          : 'Preço por unidade de medida'}
                      </td>
                      <td>
                        <span className={`stock-status ${lowStock ? 'low' : 'available'}`}>
                          {lowStock ? 'Repor' : 'Disponível'}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="edit-product-button"
                          aria-label={`Editar ${product.name}`}
                          title="Editar produto"
                          disabled={saving || archivingProductId !== null}
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
                          disabled={saving || archivingProductId !== null}
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
                  {saving ? 'Salvando...' : editingProductId === null ? 'Salvar produto' : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  )
}

export default ProductsPage