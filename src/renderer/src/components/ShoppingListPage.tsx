import { useEffect, useState } from 'react'
import { ArrowRight, FileDown, ListChecks, Package } from 'lucide-react'

type Props = {
  onRegisterPurchase: () => void
}

function ShoppingListPage({ onRegisterPurchase }: Props): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  useEffect(() => {
    window.api.products
      .list()
      .then(setProducts)
      .catch(() => setError('Não foi possível carregar o estoque.'))
      .finally(() => setLoading(false))
  }, [])

  const suggestedProducts = products
    .filter((product) => product.quantity <= product.minimumQuantity)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'pt-BR'))

  async function handleExportPdf(): Promise<void> {
    setError('')
    setExportMessage('')
    setExporting(true)
    try {
      const saved = await window.api.shoppingList.exportPdf(
        suggestedProducts.map((product) => ({
          name: product.name,
          category: product.category,
          quantity: product.quantity,
          unit: product.unit
        }))
      )
      if (saved) setExportMessage('PDF exportado com sucesso.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível exportar a lista em PDF.')
    } finally {
      setExporting(false)
    }
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
          {suggestedProducts.length} {suggestedProducts.length === 1 ? 'produto' : 'produtos'}
        </span>
      </div>

      {error && <div className="error-message">{error}</div>}
      {exportMessage && <div className="success-message">{exportMessage}</div>}

      {loading ? (
        <div className="panel empty-state">Analisando o estoque...</div>
      ) : suggestedProducts.length === 0 ? (
        <div className="panel smart-list-empty">
          <div className="placeholder-icon"><ListChecks size={24} /></div>
          <strong>Está tudo em dia!</strong>
          <span>Nenhum produto chegou ao estoque mínimo.</span>
          <p>Você pode ajustar o estoque mínimo de cada item na área Estoque.</p>
        </div>
      ) : (
        <>
          <div className="panel smart-list-panel">
            <div className="smart-list-heading">
              <div>
                <h3>Precisam de atenção</h3>
                <p>Os produtos aparecem aqui quando a quantidade chega ao mínimo ou fica abaixo dele.</p>
              </div>
            </div>

            <div className="smart-product-list">
              {suggestedProducts.map((product) => {
                const outOfStock = product.quantity === 0

                return (
                  <article className="smart-product-row" key={product.id}>
                    <div className={`smart-product-icon ${outOfStock ? 'out' : ''}`}>
                      <Package size={19} />
                    </div>

                    <div className="smart-product-info">
                      <strong>{product.name}</strong>
                      <span>{product.category}</span>
                    </div>

                    <div className="smart-stock-info">
                      <span>Em casa</span>
                      <strong>
                        {product.quantity.toLocaleString('pt-BR')} {product.unit}
                      </strong>
                    </div>

                    <div className="smart-stock-info minimum">
                      <span>Estoque mínimo</span>
                      <strong>
                        {product.minimumQuantity.toLocaleString('pt-BR')} {product.unit}
                      </strong>
                    </div>

                    <span className={`stock-status ${outOfStock ? 'low' : 'available'}`}>
                      {outOfStock ? 'Esgotado' : 'Repor'}
                    </span>
                  </article>
                )
              })}
            </div>
          </div>

          <div className="smart-list-footer">
            <span>A lista será atualizada conforme o estoque mudar.</span>
            <div className="smart-list-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={handleExportPdf}
                disabled={exporting}
              >
                <FileDown size={16} /> {exporting ? 'Gerando PDF...' : 'Exportar PDF'}
              </button>
              <button className="primary-button" onClick={onRegisterPurchase}>
                Registrar compra <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export default ShoppingListPage
