import { useEffect, useState, type FormEvent } from 'react'
import { ClipboardPaste, Plus, ReceiptText, Trash2, X } from 'lucide-react'

type PurchaseLine = {
  productId: string
  quantity: string
  unitPrice: string
}

type ImportedPurchaseLine = {
  description: string
  quantity: string
  unit: string
  value: string
  isItemTotal: boolean
  productId: string
  newProduct: NewProduct
}

type ParsedPurchaseText = {
  storeName: string
  purchaseDate: string
  items: {
    description: string
    quantity: string
    unit: string
    value: string
    isItemTotal: boolean
  }[]
}

const receiptUnitPattern = 'UNIDADE|UNID|UND|UN|KG|G|L|LT|ML|PCT|PAC|PC|PÇ|CX|FD|DZ|SC|BAND|BDJ'

function parseReceiptNumber(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .replace(/\s/g, '')
  const brazilianNumber = normalized.includes(',')
    ? normalized.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(normalized)
      ? normalized.replace(/\./g, '')
      : normalized
  const parsed = Number(brazilianNumber)
  return Number.isFinite(parsed) ? parsed : null
}

function parseReceiptQuantity(value: string): number | null {
  const parsed = value.includes('.') && !value.includes(',')
    ? Number(value)
    : parseReceiptNumber(value)
  return parsed !== null && Number.isFinite(parsed) ? parsed : null
}

function parseReceiptLine(line: string): ParsedPurchaseText['items'][number] | null {
  const numberPattern = '\\d+(?:[.,]\\d+)?'
  const pricePattern = '(?:R\\$\\s*)?\\(?\\d[\\d.,]*\\)?'
  const standardExpression = new RegExp(
    `^(.*?)\\s+(${numberPattern})\\s+(${receiptUnitPattern})\\.?\\s+(?:X\\s+)?(${pricePattern})(?:\\s+(${pricePattern}))?\\s*$`,
    'i'
  )
  const leadingQuantityExpression = new RegExp(
    `^(${numberPattern})\\s+(${receiptUnitPattern})\\.?\\s+(.+?)\\s+(?:X\\s+)?(${pricePattern})(?:\\s+(${pricePattern}))?\\s*$`,
    'i'
  )
  const text = line.trim()
  const match = text.match(standardExpression)
  const leadingMatch = match ? null : text.match(leadingQuantityExpression)
  const labeledQuantity = text.match(/\b(?:qtd|qtde|quantidade)\s*:?\s*(\d+(?:[.,]\d+)?)/i)
  const labeledTotal = text.match(
    /\b(?:valor\s+total(?:\s+do\s+item)?|vl\.?\s*total|total)\s*:?\s*(?:R\$\s*)?(\d[\d.,]*)/i
  )
  const labeledUnit = text.match(
    new RegExp(`\\b(?:unidade|unid|und|un)\\s*:?\\s*(${receiptUnitPattern})\\b`, 'i')
  )

  let description: string
  let rawQuantity: string
  let unit: string
  let rawValue: string
  let rawTotalValue: string | undefined
  let isItemTotal: boolean

  if (match) {
    description = match[1]
    rawQuantity = match[2]
    unit = match[3]
    rawValue = match[4]
    rawTotalValue = match[5]
    isItemTotal = Boolean(match[5])
  } else if (leadingMatch) {
    rawQuantity = leadingMatch[1]
    unit = leadingMatch[2]
    description = leadingMatch[3]
    rawValue = leadingMatch[4]
    rawTotalValue = leadingMatch[5]
    isItemTotal = Boolean(leadingMatch[5])
  } else if (labeledQuantity && labeledTotal && labeledUnit) {
    const descriptionEnd = Math.min(
      ...[labeledQuantity.index, labeledUnit.index, labeledTotal.index].filter(
        (index): index is number => index !== undefined
      )
    )
    description = text.slice(0, descriptionEnd)
    rawQuantity = labeledQuantity[1]
    unit = labeledUnit[1]
    rawValue = labeledTotal[1]
    isItemTotal = true
  } else {
    return null
  }

  description = description
    .replace(/^(?:\d{1,3}[.)-]\s*)+/, '')
    .replace(/^\d{1,4}\s+\d{8,14}\s+/, '')
    .replace(/^\d{8,14}\s+/, '')
    .replace(/^\d{1,8}\s+(?=[a-zà-ÿ])/i, '')
    .replace(/^(?:produto|descri[cç][aã]o)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  const quantity = parseReceiptQuantity(rawQuantity)
  const price = parseReceiptNumber(rawTotalValue ?? rawValue)
  if (!description || quantity === null || quantity <= 0 || price === null || price < 0) {
    return null
  }

  return {
    description,
    quantity: String(quantity),
    unit: unit.toLocaleUpperCase('pt-BR'),
    value: String(price),
    isItemTotal
  }
}

function parseReceiptBlock(
  descriptionLine: string,
  quantityLine: string,
  totalLine: string
): ParsedPurchaseText['items'][number] | null {
  const quantityMatch = quantityLine.match(
    new RegExp(
      `^quantidade\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s+(${receiptUnitPattern})\\.?$`,
      'i'
    )
  )
  const totalMatch = totalLine.match(
    /^(?:valor\s+total(?:\s+do\s+item)?|vl\.?\s*total|total)\s*:?\s*(?:R\$\s*)?([\d.,]+)$/i
  )
  const description = descriptionLine
    .replace(/^(?:descri[cç][aã]o|produto)\s*:\s*/i, '')
    .replace(/^\d{8,14}\s+/, '')
    .trim()

  if (
    !quantityMatch ||
    !totalMatch ||
    !description ||
    !/[a-zà-ÿ]/i.test(description) ||
    /^(?:data|total\s+da\s+compra|valor\s+total|quantidade)\b/i.test(description)
  ) {
    return null
  }

  const quantity = parseReceiptQuantity(quantityMatch[1])
  const total = parseReceiptNumber(totalMatch[1])
  if (quantity === null || quantity <= 0 || total === null || total < 0) return null

  return {
    description,
    quantity: String(quantity),
    unit: quantityMatch[2].toLocaleUpperCase('pt-BR'),
    value: String(total),
    isItemTotal: true
  }
}

function getProductUnitFromReceipt(unit: string): string {
  const normalized = unit.trim().toLocaleUpperCase('pt-BR')
  if (['UNIDADE', 'UNID', 'UND', 'UN', 'PC', 'PÇ'].includes(normalized)) return 'un'
  if (['LT', 'L'].includes(normalized)) return 'L'
  if (['PAC', 'PCT'].includes(normalized)) return 'pct'
  return normalized.toLocaleLowerCase('pt-BR')
}

function parseReceiptDate(text: string): string | null {
  const dateMatch = text.match(/\b(\d{2})[-/.](\d{2})[-/.](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (!dateMatch) return null

  const date = dateMatch[4]
    ? `${dateMatch[4]}-${dateMatch[5]}-${dateMatch[6]}`
    : `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
  const [year, month, day] = date.split('-').map(Number)
  const parsedDate = new Date(Date.UTC(year, month - 1, day))
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

function parseReceiptStoreName(lines: string[]): string {
  const ignoredLine =
    /consulta|danfe|documento auxiliar|consumidor|protocolo|chave de acesso|emissão|emissao|data|total|pagamento|tributos|desconto|troco/i
  for (const line of lines.slice(0, 12)) {
    const storeName = line
      .replace(/\b(?:CNPJ|CPF)\b.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (
      !parseReceiptLine(line) &&
      !ignoredLine.test(storeName) &&
      storeName.length >= 3 &&
      /[a-zà-ÿ]/i.test(storeName)
    ) {
      return storeName
    }
  }
  return ''
}

function parseReceiptText(text: string): ParsedPurchaseText {
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[\t;|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)

  const items: ParsedPurchaseText['items'] = []
  for (let index = 0; index < lines.length; index += 1) {
    const inlineItem = parseReceiptLine(lines[index])
    if (inlineItem) {
      items.push(inlineItem)
      continue
    }

    const blockItem =
      index + 2 < lines.length
        ? parseReceiptBlock(lines[index], lines[index + 1], lines[index + 2])
        : null
    if (blockItem) {
      items.push(blockItem)
      index += 2
    }
  }

  return {
    storeName: parseReceiptStoreName(lines),
    purchaseDate: parseReceiptDate(text) ?? todayAsInputValue(),
    items
  }
}

function normalizeProductName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
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
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [receiptText, setReceiptText] = useState('')
  const [importedStoreName, setImportedStoreName] = useState('')
  const [importedPurchaseDate, setImportedPurchaseDate] = useState(todayAsInputValue())
  const [importedItems, setImportedItems] = useState<ImportedPurchaseLine[]>([])
  const [importError, setImportError] = useState('')
  const [isImportPreview, setIsImportPreview] = useState(false)
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

  function openImport(): void {
    setReceiptText('')
    setImportedStoreName('')
    setImportedPurchaseDate(todayAsInputValue())
    setImportedItems([])
    setImportError('')
    setIsImportPreview(false)
    setError('')
    setSuccess('')
    setIsImportOpen(true)
  }

  function handleParseReceipt(): void {
    setImportError('')
    const parsed = parseReceiptText(receiptText)
    if (parsed.items.length === 0) {
      setIsImportPreview(false)
      setImportError(
        'Não encontramos itens reconhecíveis nesse texto. Confira se copiou a consulta detalhada da nota e tente novamente.'
      )
      return
    }

    setImportedStoreName(parsed.storeName)
    setImportedPurchaseDate(parsed.purchaseDate)
    setImportedItems(
      parsed.items.map((item) => {
        const normalizedDescription = normalizeProductName(item.description)
        const matchingProduct = products.find(
          (product) => normalizeProductName(product.name) === normalizedDescription
        )
        return {
          ...item,
          productId: matchingProduct ? String(matchingProduct.id) : '',
          newProduct: {
            name: item.description,
            category: 'Outros',
            unit: getProductUnitFromReceipt(item.unit),
            quantity: 0,
            minimumQuantity: 0,
            pricingMode: 'item_total'
          }
        }
      })
    )
    setIsImportPreview(true)
  }

  function updateImportedItem(
    index: number,
    field: keyof ImportedPurchaseLine,
    value: string
  ): void {
    setImportedItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item))
    )
  }

  function updateNewProduct(
    index: number,
    field: keyof NewProduct,
    value: string
  ): void {
    setImportedItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        if (field === 'quantity' || field === 'minimumQuantity') {
          return {
            ...item,
            newProduct: { ...item.newProduct, [field]: value === '' ? 0 : Number(value) }
          }
        }
        if (field === 'pricingMode') {
          return {
            ...item,
            newProduct: {
              ...item.newProduct,
              pricingMode: value === 'unit_measure' ? 'unit_measure' : 'item_total'
            }
          }
        }
        return {
          ...item,
          newProduct: { ...item.newProduct, [field]: value }
        }
      })
    )
  }

  async function handleConfirmImport(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setImportError('')

    if (importedItems.length === 0) {
      setImportError('Adicione pelo menos um item à compra.')
      return
    }
    if (
      importedItems.some(
        (item) =>
          !Number.isFinite(Number(item.quantity)) ||
          Number(item.quantity) <= 0 ||
          item.value === '' ||
          !Number.isFinite(Number(item.value)) ||
          Number(item.value) < 0 ||
          (!item.productId &&
            (!item.newProduct.name.trim() ||
              !item.newProduct.unit.trim() ||
              !Number.isFinite(item.newProduct.minimumQuantity) ||
              item.newProduct.minimumQuantity < 0))
      )
    ) {
      setImportError('Confira o produto, nome, unidade, quantidade e valor de cada linha.')
      return
    }
    const duplicateProduct = importedItems.find(
      (item) =>
        !item.productId &&
        products.some(
          (product) =>
            normalizeProductName(product.name) ===
            normalizeProductName(item.newProduct.name)
        )
    )
    if (duplicateProduct) {
      setImportError(
        `"${duplicateProduct.newProduct.name}" já existe no estoque. Selecione o produto existente para vinculá-lo sem duplicação.`
      )
      return
    }
    if (!importedStoreName.trim()) {
      setImportError('Informe o mercado da compra.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(importedPurchaseDate)) {
      setImportError('Informe uma data válida.')
      return
    }

    setSaving(true)
    try {
      const { purchase, createdProducts } = await window.api.purchases.addImported({
        storeName: importedStoreName,
        purchaseDate: importedPurchaseDate,
        items: importedItems.map((item) => {
          const linkedProduct = products.find(
            (product) => product.id === Number(item.productId)
          )
          return {
            ...(linkedProduct
              ? { productId: linkedProduct.id }
              : {
                  newProduct: {
                    ...item.newProduct,
                    name: item.newProduct.name.trim(),
                    category: item.newProduct.category.trim() || 'Outros',
                    unit: item.newProduct.unit.trim(),
                    quantity: 0
                  }
                }),
            quantity: Number(item.quantity),
            unitPrice: Number(item.value),
            pricingMode: item.isItemTotal
              ? 'item_total'
              : linkedProduct?.pricingMode ?? item.newProduct.pricingMode
          }
        })
      })

      setPurchases((current) => [purchase, ...current])
      setProducts((current) =>
        [...current, ...createdProducts].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      )
      setError('')
      setSuccess('Compra importada, salva e estoque atualizado.')
      window.dispatchEvent(new Event('app:data-changed'))
      setIsImportOpen(false)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Não foi possível salvar a compra.')
    } finally {
      setSaving(false)
    }
  }

  function renderImportedItem(item: ImportedPurchaseLine, index: number): React.JSX.Element {
    const linkedProduct = products.find((product) => product.id === Number(item.productId))
    const usesItemTotal =
      item.isItemTotal ||
      (linkedProduct ? linkedProduct.pricingMode === 'item_total' : item.newProduct.pricingMode === 'item_total')

    return (
      <div
        className={`import-preview-item ${item.productId ? 'is-linked' : 'is-unregistered'}`}
        key={`${item.description}-${index}`}
      >
        <div className="import-preview-row">
          <div className="import-item-description">
            <strong>{item.description}</strong>
            <span>Unidade na nota: {item.unit}</span>
          </div>
          <label className="form-field import-product-field">
            Produto do estoque
            <select
              value={item.productId || ''}
              onChange={(event) => updateImportedItem(index, 'productId', event.target.value)}
            >
              <option value="">Cadastrar como novo produto</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="form-field import-quantity-field">
            Quantidade
            <input
              required
              type="number"
              min="0.01"
              step="any"
              value={item.quantity}
              onChange={(event) => updateImportedItem(index, 'quantity', event.target.value)}
            />
          </label>
          <label className="form-field import-total-field">
            {usesItemTotal
              ? 'Valor total do item'
              : `Preço por ${getComparableUnit(linkedProduct?.unit ?? item.newProduct.unit)}`}
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={item.value}
              onChange={(event) => updateImportedItem(index, 'value', event.target.value)}
            />
          </label>
          <button
            type="button"
            className="remove-line-button import-remove-button"
            aria-label={`Remover ${item.description}`}
            disabled={importedItems.length === 1}
            onClick={() =>
              setImportedItems((current) =>
                current.filter((_, itemIndex) => itemIndex !== index)
              )
            }
          >
            <Trash2 size={16} />
          </button>
        </div>

        {!item.productId && (
          <div className="import-new-product-fields">
            <label className="form-field">
              Nome do produto
              <input
                required
                value={item.newProduct.name}
                onChange={(event) => updateNewProduct(index, 'name', event.target.value)}
              />
            </label>
            <label className="form-field">
              Categoria
              <input
                required
                value={item.newProduct.category}
                onChange={(event) => updateNewProduct(index, 'category', event.target.value)}
              />
            </label>
            <label className="form-field">
              Unidade
              <input
                required
                value={item.newProduct.unit}
                onChange={(event) => updateNewProduct(index, 'unit', event.target.value)}
              />
            </label>
            <label className="form-field">
              Quantidade mínima
              <input
                required
                type="number"
                min="0"
                step="any"
                value={item.newProduct.minimumQuantity}
                onChange={(event) =>
                  updateNewProduct(index, 'minimumQuantity', event.target.value)
                }
              />
            </label>
            <label className="form-field import-pricing-mode-field">
              Forma de precificação
              <select
                value={item.newProduct.pricingMode}
                onChange={(event) => updateNewProduct(index, 'pricingMode', event.target.value)}
              >
                <option value="item_total">Valor total do item</option>
                <option value="unit_measure">Preço por unidade de medida</option>
              </select>
            </label>
            <span className="import-new-product-note">
              O produto será cadastrado e vinculado à compra somente após a confirmação.
            </span>
          </div>
        )}
      </div>
    )
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
        <button
          type="button"
          className="secondary-button purchase-import-trigger"
          onClick={openImport}
        >
          <ClipboardPaste size={15} /> Importar texto da nota
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {isImportOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setIsImportOpen(false)
          }}
        >
          <section
            className="product-modal purchase-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-import-title"
          >
            <div className="modal-heading">
              <div>
                <h2 id="purchase-import-title">Importar texto da nota</h2>
                <p>
                  Cole o texto da consulta detalhada da NFC-e. Nada será salvo antes da confirmação.
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Fechar importação"
                disabled={saving}
                onClick={() => setIsImportOpen(false)}
              >
                <X size={17} />
              </button>
            </div>

            {!isImportPreview ? (
              <>
                <label className="form-field receipt-text-field">
                  Texto da nota
                  <textarea
                    autoFocus
                    value={receiptText}
                    onChange={(event) => setReceiptText(event.target.value)}
                    placeholder="Cole aqui o texto copiado da consulta detalhada da NFC-e..."
                    rows={9}
                  />
                </label>
                {importError && <div className="error-message">{importError}</div>}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    onClick={() => setIsImportOpen(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={handleParseReceipt}
                    disabled={!receiptText.trim()}
                  >
                    Conferir itens
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleConfirmImport}>
                <div className="form-row">
                  <label className="form-field">
                    Mercado
                    <input
                      required
                      value={importedStoreName}
                      onChange={(event) => setImportedStoreName(event.target.value)}
                      placeholder="Nome do mercado"
                    />
                  </label>
                  <label className="form-field">
                    Data da compra
                    <input
                      required
                      type="date"
                      value={importedPurchaseDate}
                      onChange={(event) => setImportedPurchaseDate(event.target.value)}
                    />
                  </label>
                </div>

                <div className="import-preview-heading">
                  <strong>Prévia dos itens ({importedItems.length})</strong>
                  <span>
                    Revise os vínculos e os dados de cada linha. Novos produtos só serão
                    cadastrados ao confirmar a compra.
                  </span>
                </div>
                {importedItems.some((item) => item.productId) && (
                  <section className="import-items-section">
                    <h3>Itens vinculados</h3>
                    <div className="import-preview-list">
                      {importedItems.map((item, index) =>
                        item.productId ? renderImportedItem(item, index) : null
                      )}
                    </div>
                  </section>
                )}
                {importedItems.some((item) => !item.productId) && (
                  <section className="import-items-section">
                    <h3>
                      Itens não cadastrados (
                      {importedItems.filter((item) => !item.productId).length})
                    </h3>
                    <p className="import-unregistered-hint">
                      Cadastre cada item ou selecione um produto existente para evitar duplicações.
                    </p>
                    <div className="import-preview-list">
                      {importedItems.map((item, index) =>
                        item.productId ? null : renderImportedItem(item, index)
                      )}
                    </div>
                  </section>
                )}

                {importError && <div className="error-message">{importError}</div>}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="cancel-button"
                    disabled={saving}
                    onClick={() => setIsImportPreview(false)}
                  >
                    Voltar ao texto
                  </button>
                  <button type="submit" className="primary-button" disabled={saving}>
                    {saving ? 'Salvando...' : 'Confirmar e salvar compra'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}

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
