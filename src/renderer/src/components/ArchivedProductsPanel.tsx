import { useEffect, useState } from 'react'
import { ArchiveRestore } from 'lucide-react'

function ArchivedProductsPanel(): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringProductId, setRestoringProductId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let isCurrent = true

    window.api.products
      .listArchived()
      .then((archivedProducts) => {
        if (isCurrent) setProducts(archivedProducts)
      })
      .catch(() => {
        if (isCurrent) setError('Não foi possível carregar os itens arquivados.')
      })
      .finally(() => {
        if (isCurrent) setLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [])

  async function handleRestore(product: Product): Promise<void> {
    setError('')
    setRestoringProductId(product.id)
    try {
      await window.api.products.restore(product.id)
      setProducts((current) => current.filter((item) => item.id !== product.id))
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível restaurar o produto.')
    } finally {
      setRestoringProductId(null)
    }
  }

  return (
    <section className="panel archived-products-panel" aria-label="Itens arquivados">
      {error && <div className="error-message">{error}</div>}
      {loading ? (
        <p className="archived-products-empty">Carregando itens arquivados...</p>
      ) : products.length === 0 ? (
        <p className="archived-products-empty">Não há produtos arquivados.</p>
      ) : (
        <div className="archived-products-list">
          {products.map((product) => (
            <div className="archived-product-row" key={product.id}>
              <div>
                <strong>{product.name}</strong>
                <span>
                  {product.category} · {product.quantity.toLocaleString('pt-BR')} {product.unit}
                </span>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={restoringProductId !== null}
                onClick={() => handleRestore(product)}
              >
                <ArchiveRestore size={15} />
                {restoringProductId === product.id ? 'Restaurando...' : 'Restaurar'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default ArchivedProductsPanel
