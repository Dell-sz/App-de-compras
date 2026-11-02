export type SpendingBucket = {
  key: string
  label: string
  valueCents: number
  highlighted?: boolean
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

export function SpendingBarChart({
  title,
  description,
  buckets,
  loading = false
}: {
  title: string
  description: string
  buckets: SpendingBucket[]
  loading?: boolean
}): React.JSX.Element {
  const maxValue = Math.max(0, ...buckets.map((bucket) => bucket.valueCents))

  return (
    <section className="panel data-chart-card">
      <div className="data-chart-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {loading ? (
        <p className="data-chart-empty">Carregando dados do gráfico...</p>
      ) : buckets.length === 0 ? (
        <p className="data-chart-empty">Não há compras no período para exibir.</p>
      ) : (
        <div className="spending-chart-scroll">
          <div
            className="spending-chart"
            style={{ minWidth: `${Math.max(100, buckets.length * 72)}px` }}
            role="list"
            aria-label={title}
          >
            {buckets.map((bucket) => {
              const height = maxValue > 0 ? (bucket.valueCents / maxValue) * 100 : 0
              return (
                <div
                  className={`spending-chart-column ${bucket.highlighted ? 'highlighted' : ''}`}
                  key={bucket.key}
                  role="listitem"
                  aria-label={`${bucket.label}: ${formatMoney(bucket.valueCents)}`}
                  title={`${bucket.label}: ${formatMoney(bucket.valueCents)}`}
                >
                  <span className="spending-chart-value">{formatMoney(bucket.valueCents)}</span>
                  <div className="spending-chart-bar-area">
                    <span
                      className="spending-chart-bar"
                      style={{ height: `${height}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <span className="spending-chart-label">{bucket.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
