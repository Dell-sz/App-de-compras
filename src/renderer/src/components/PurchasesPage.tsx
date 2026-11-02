import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArchiveRestore,
  ClipboardPaste,
  Eye,
  Plus,
  ReceiptText,
  Trash2,
  Undo2,
  X
} from 'lucide-react'

type PurchaseLine = {
  category: string
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
  category: string
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

type PurchaseUndoAction =
  { kind: 'trash'; purchase: PurchaseSummary } | { kind: 'restore'; purchase: PurchaseSummary }

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
  const parsed =
    value.includes('.') && !value.includes(',') ? Number(value) : parseReceiptNumber(value)
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
    new RegExp(`^quantidade\\s*:?\\s*(\\d+(?:[.,]\\d+)?)\\s+(${receiptUnitPattern})\\.?$`, 'i')
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

type PurchasesPageProps = {
  view: 'register' | 'history'
}

function PurchasesPage({ view }: PurchasesPageProps): React.JSX.Element {
  const [products, setProducts] = useState<Product[]>([])
  const [purchases, setPurchases] = useState<PurchaseSummary[]>([])
  const [trashedPurchases, setTrashedPurchases] = useState<TrashedPurchase[]>([])
  const [storeSuggestions, setStoreSuggestions] = useState<string[]>([])
  const [historyStartDate, setHistoryStartDate] = useState('')
  const [historyEndDate, setHistoryEndDate] = useState('')
  const [historyYear, setHistoryYear] = useState('')
  const [historyStore, setHistoryStore] = useState('')
  const [storeName, setStoreName] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(todayAsInputValue())
  const [items, setItems] = useState<PurchaseLine[]>([
    { category: '', productId: '', quantity: '1', unitPrice: '' }
  ])
  const [loading, setLoading] = useState(true)
  const [isTrashOpen, setIsTrashOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<number | null>(null)
  const [workingTrashPurchaseId, setWorkingTrashPurchaseId] = useState<number | null>(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [receiptText, setReceiptText] = useState('')
  const [importedStoreName, setImportedStoreName] = useState('')
  const [importedPaymentMethod, setImportedPaymentMethod] = useState('')
  const [importedPurchaseDate, setImportedPurchaseDate] = useState(todayAsInputValue())
  const [importedItems, setImportedItems] = useState<ImportedPurchaseLine[]>([])
  const [importError, setImportError] = useState('')
  const [isImportPreview, setIsImportPreview] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [undoAction, setUndoAction] = useState<PurchaseUndoAction | null>(null)
  const [purchaseDetails, setPurchaseDetails] = useState<PurchaseDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState('')
  const detailsRequestId = useRef(0)
  const categories = [
    ...new Set(products.map((product) => product.category.trim()).filter(Boolean))
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const purchaseCategories = categories.length > 0 ? categories : ['Outros']
  const paymentMethods = [
    'Dinheiro',
    'Pix',
    'Cartão de débito',
    'Cartão de crédito',
    'Transferência',
    'Outro'
  ]
  const historyYears = [
    ...new Set(purchases.map((purchase) => purchase.purchaseDate.slice(0, 4)))
  ].sort((a, b) => b.localeCompare(a))
  const historyStores = [
    ...new Set(purchases.map((purchase) => purchase.storeName.trim()).filter(Boolean))
  ].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const filteredPurchases = purchases
    .filter(
      (purchase) =>
        (!historyStartDate || purchase.purchaseDate >= historyStartDate) &&
        (!historyEndDate || purchase.purchaseDate <= historyEndDate) &&
        (!historyYear || purchase.purchaseDate.startsWith(historyYear)) &&
        (!historyStore || purchase.storeName === historyStore)
    )
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.id - a.id)
  useEffect(() => {
    Promise.all([
      window.api.products.list(),
      window.api.purchases.list(),
      window.api.purchases.listTrash(),
      window.api.purchases.storeSuggestions()
    ])
      .then(([productList, purchaseList, trashList, suggestions]) => {
        setProducts(productList)
        setPurchases(purchaseList)
        setTrashedPurchases(trashList)
        const recentStores = [
          ...new Set(purchaseList.map((purchase) => purchase.storeName.trim()).filter(Boolean))
        ].slice(0, 6)
        const uniqueStores = new Map<string, string>()
        for (const name of [...recentStores, ...suggestions]) {
          const normalizedName = name.trim().toLocaleLowerCase('pt-BR')
          if (normalizedName && !uniqueStores.has(normalizedName)) {
            uniqueStores.set(normalizedName, name.trim())
          }
        }
        setStoreSuggestions([...uniqueStores.values()].slice(0, 12))
      })
      .catch(() => setError('Não foi possível carregar os dados.'))
      .finally(() => setLoading(false))
  }, [])

  function updateItem(index: number, field: keyof PurchaseLine, value: string): void {
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        if (field === 'productId') {
          const product = products.find((candidate) => candidate.id === Number(value))
          return { ...item, productId: value, category: product?.category ?? item.category }
        }
        if (field === 'category') return { ...item, category: value, productId: '' }
        return { ...item, [field]: value }
      })
    )
  }

  function addItemRow(): void {
    setItems((current) => [
      ...current,
      { category: '', productId: '', quantity: '1', unitPrice: '' }
    ])
  }

  function removeItemRow(index: number): void {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
  }

  const total = items.reduce((sum, item) => {
    const product = products.find((candidate) => candidate.id === Number(item.productId))
    const enteredPrice = Number(item.unitPrice) || 0
    const quantity = Number(item.quantity) || 0
    if (!product || product.pricingMode === 'item_total') return sum + enteredPrice
    return sum + enteredPrice * getComparableQuantity(quantity, product.unit)
  }, 0)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError('')
    setSuccess('')
    setUndoAction(null)

    if (purchaseDate > todayAsInputValue()) {
      setError('A data da compra não pode ser futura.')
      return
    }
    if (!paymentMethod) {
      setError('Selecione a forma de pagamento.')
      return
    }
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
        paymentMethod,
        items: validItems.map((item) => ({
          productId: Number(item.productId),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice)
        }))
      })

      setPurchases((current) => [purchase, ...current])
      setStoreSuggestions((current) =>
        [
          storeName.trim(),
          ...current.filter(
            (name) => name.toLocaleLowerCase() !== storeName.trim().toLocaleLowerCase()
          )
        ].slice(0, 12)
      )
      setSuccess('Compra salva e estoque atualizado.')
      window.dispatchEvent(new Event('app:data-changed'))
      setStoreName('')
      setPaymentMethod('')
      setPurchaseDate(todayAsInputValue())
      setItems([{ category: '', productId: '', quantity: '1', unitPrice: '' }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a compra.')
    } finally {
      setSaving(false)
    }
  }

  function openImport(): void {
    setReceiptText('')
    setImportedStoreName('')
    setImportedPaymentMethod('')
    setImportedPurchaseDate(todayAsInputValue())
    setImportedItems([])
    setImportError('')
    setIsImportPreview(false)
    setError('')
    setSuccess('')
    setUndoAction(null)
    setIsImportOpen(true)
  }

  async function openPurchaseDetails(purchaseId: number): Promise<void> {
    const requestId = ++detailsRequestId.current
    setDetailsError('')
    setPurchaseDetails(null)
    setDetailsLoading(true)
    try {
      const details = await window.api.purchases.details(purchaseId)
      if (requestId === detailsRequestId.current) setPurchaseDetails(details)
    } catch (err) {
      if (requestId === detailsRequestId.current) {
        setDetailsError(
          err instanceof Error ? err.message : 'Não foi possível carregar os detalhes.'
        )
      }
    } finally {
      if (requestId === detailsRequestId.current) setDetailsLoading(false)
    }
  }

  function closePurchaseDetails(): void {
    detailsRequestId.current += 1
    setDetailsLoading(false)
    setPurchaseDetails(null)
    setDetailsError('')
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
          category: matchingProduct?.category ?? categories[0] ?? 'Outros',
          newProduct: {
            name: item.description,
            category: matchingProduct?.category ?? categories[0] ?? 'Outros',
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
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        if (field === 'category') {
          return {
            ...item,
            category: value,
            productId: '',
            newProduct: { ...item.newProduct, category: value }
          }
        }
        if (field === 'productId') {
          const product = products.find((candidate) => candidate.id === Number(value))
          return {
            ...item,
            productId: value,
            category: product?.category ?? item.category,
            newProduct: {
              ...item.newProduct,
              category: product?.category ?? item.category
            }
          }
        }
        return { ...item, [field]: value }
      })
    )
  }

  function updateNewProduct(index: number, field: keyof NewProduct, value: string): void {
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
    setUndoAction(null)

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
            normalizeProductName(product.name) === normalizeProductName(item.newProduct.name)
        )
    )
    if (duplicateProduct) {
      setImportError(
        `"${duplicateProduct.newProduct.name}" já existe no estoque. Selecione o produto existente para vinculá-lo sem duplicação.`
      )
      return
    }
    if (!importedStoreName.trim()) {
      setImportError('Informe o estabelecimento da compra.')
      return
    }
    if (!importedPaymentMethod) {
      setImportError('Selecione a forma de pagamento.')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(importedPurchaseDate)) {
      setImportError('Informe uma data válida.')
      return
    }
    if (importedPurchaseDate > todayAsInputValue()) {
      setImportError('A data da compra não pode ser futura.')
      return
    }

    setSaving(true)
    try {
      const { purchase, createdProducts } = await window.api.purchases.addImported({
        storeName: importedStoreName,
        purchaseDate: importedPurchaseDate,
        paymentMethod: importedPaymentMethod,
        items: importedItems.map((item) => {
          const linkedProduct = products.find((product) => product.id === Number(item.productId))
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
              : (linkedProduct?.pricingMode ?? item.newProduct.pricingMode)
          }
        })
      })

      setPurchases((current) => [purchase, ...current])
      setStoreSuggestions((current) =>
        [
          importedStoreName.trim(),
          ...current.filter(
            (name) => name.toLocaleLowerCase() !== importedStoreName.trim().toLocaleLowerCase()
          )
        ].slice(0, 12)
      )
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
      (linkedProduct
        ? linkedProduct.pricingMode === 'item_total'
        : item.newProduct.pricingMode === 'item_total')

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
          <label className="form-field import-category-field">
            {item.productId ? 'Categoria' : 'Categoria sugerida'}
            <select
              value={item.category}
              onChange={(event) => updateImportedItem(index, 'category', event.target.value)}
            >
              {purchaseCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            {!item.productId && (
              <small className="form-hint import-category-hint">
                Sugestões baseadas nas categorias existentes no estoque.
              </small>
            )}
          </label>
          <label className="form-field import-product-field">
            Produto do estoque
            <select
              value={item.productId || ''}
              onChange={(event) => updateImportedItem(index, 'productId', event.target.value)}
            >
              <option value="">Cadastrar como novo produto</option>
              {products
                .filter((product) => product.category === item.category)
                .map((product) => (
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
              setImportedItems((current) => current.filter((_, itemIndex) => itemIndex !== index))
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
                onChange={(event) => updateNewProduct(index, 'minimumQuantity', event.target.value)}
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

  async function handleTrashPurchase(purchase: PurchaseSummary): Promise<void> {
    const confirmed = window.confirm(
      'Mover esta compra para a lixeira? Ela deixará os históricos e indicadores, e o estoque será ajustado sem ficar negativo. Você poderá restaurá-la por até 30 dias.'
    )
    if (!confirmed) return

    setError('')
    setSuccess('')
    setUndoAction(null)
    setDeletingPurchaseId(purchase.id)

    try {
      const trashedPurchase = await window.api.purchases.trash(purchase.id)
      setPurchases((current) => current.filter((item) => item.id !== purchase.id))
      setTrashedPurchases((current) => [trashedPurchase, ...current])
      setSuccess('Compra movida para a lixeira. Ela poderá ser restaurada por até 30 dias.')
      setUndoAction({ kind: 'trash', purchase })
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Não foi possível mover a compra para a lixeira.'
      )
    } finally {
      setDeletingPurchaseId(null)
    }
  }

  async function handleRestorePurchase(purchase: TrashedPurchase): Promise<void> {
    setError('')
    setSuccess('')
    setUndoAction(null)
    setWorkingTrashPurchaseId(purchase.id)
    try {
      const restoredPurchase = await window.api.purchases.restore(purchase.id)
      setTrashedPurchases((current) => current.filter((item) => item.id !== purchase.id))
      setPurchases((current) =>
        [restoredPurchase, ...current].sort(
          (a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.id - a.id
        )
      )
      setSuccess('Compra restaurada e ajuste de estoque revertido.')
      setUndoAction({ kind: 'restore', purchase: restoredPurchase })
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível restaurar a compra.')
    } finally {
      setWorkingTrashPurchaseId(null)
    }
  }

  async function handlePermanentlyDeletePurchase(purchase: TrashedPurchase): Promise<void> {
    const confirmed = window.confirm(
      `Excluir permanentemente a compra de ${purchase.storeName}? Os itens e preços associados serão removidos definitivamente. O estoque já foi ajustado ao mover a compra para a lixeira. Esta ação não pode ser desfeita.`
    )
    if (!confirmed) return

    setError('')
    setSuccess('')
    setUndoAction(null)
    setWorkingTrashPurchaseId(purchase.id)
    try {
      await window.api.purchases.permanentlyDelete(purchase.id)
      setTrashedPurchases((current) => current.filter((item) => item.id !== purchase.id))
      setSuccess('Compra excluída permanentemente.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir a compra.')
    } finally {
      setWorkingTrashPurchaseId(null)
    }
  }

  async function handleUndoPurchaseAction(): Promise<void> {
    if (!undoAction) return
    setError('')
    setDeletingPurchaseId(undoAction.purchase.id)
    try {
      if (undoAction.kind === 'trash') {
        const restoredPurchase = await window.api.purchases.restore(undoAction.purchase.id)
        setTrashedPurchases((current) =>
          current.filter((item) => item.id !== undoAction.purchase.id)
        )
        setPurchases((current) =>
          [restoredPurchase, ...current].sort(
            (a, b) => b.purchaseDate.localeCompare(a.purchaseDate) || b.id - a.id
          )
        )
        setSuccess('Ação desfeita. A compra foi restaurada e o estoque atualizado.')
      } else {
        const trashedPurchase = await window.api.purchases.trash(undoAction.purchase.id)
        setPurchases((current) => current.filter((item) => item.id !== undoAction.purchase.id))
        setTrashedPurchases((current) => [trashedPurchase, ...current])
        setSuccess('Ação desfeita. A compra voltou para a lixeira.')
      }
      setUndoAction(null)
      window.dispatchEvent(new Event('app:data-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível desfazer esta ação.')
    } finally {
      setDeletingPurchaseId(null)
    }
  }

  return (
    <section className="purchase-page">
      <datalist id="purchase-establishment-suggestions">
        {storeSuggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      {view === 'register' && (
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
      )}

      {error && <div className="error-message">{error}</div>}
      {success && (
        <div className="success-message">
          {success}
          {undoAction && (
            <button
              type="button"
              className="undo-action-button"
              disabled={deletingPurchaseId !== null}
              onClick={handleUndoPurchaseAction}
            >
              <Undo2 size={14} /> Desfazer
            </button>
          )}
        </div>
      )}

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
                    Estabelecimento
                    <input
                      required
                      value={importedStoreName}
                      onChange={(event) => setImportedStoreName(event.target.value)}
                      list="purchase-establishment-suggestions"
                      placeholder="Selecione ou digite um estabelecimento"
                    />
                  </label>
                  <label className="form-field">
                    Data da compra
                    <input
                      required
                      type="date"
                      max={todayAsInputValue()}
                      value={importedPurchaseDate}
                      onChange={(event) => setImportedPurchaseDate(event.target.value)}
                    />
                  </label>
                </div>
                <label className="form-field">
                  Forma de pagamento
                  <select
                    required
                    value={importedPaymentMethod}
                    onChange={(event) => setImportedPaymentMethod(event.target.value)}
                  >
                    <option value="">Selecione</option>
                    {paymentMethods.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="import-preview-heading">
                  <strong>Prévia dos itens ({importedItems.length})</strong>
                  <span>
                    Revise os vínculos e os dados de cada linha. Novos produtos só serão cadastrados
                    ao confirmar a compra.
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
      ) : view === 'register' ? (
        <div className="purchase-layout">
          {products.length === 0 ? (
            <div className="panel empty-state">
              <div className="placeholder-icon">
                <ReceiptText size={24} />
              </div>
              <strong>Cadastre produtos no Estoque primeiro</strong>
              <span>Depois você poderá selecionar os itens comprados aqui.</span>
            </div>
          ) : (
            <form className="panel purchase-form" onSubmit={handleSubmit}>
              <div className="form-row">
                <label className="form-field">
                  Estabelecimento
                  <input
                    required
                    value={storeName}
                    onChange={(event) => setStoreName(event.target.value)}
                    list="purchase-establishment-suggestions"
                    placeholder="Selecione ou digite um estabelecimento"
                  />
                </label>
                <label className="form-field">
                  Data da compra
                  <input
                    required
                    type="date"
                    max={todayAsInputValue()}
                    value={purchaseDate}
                    onChange={(event) => setPurchaseDate(event.target.value)}
                  />
                </label>
              </div>
              <label className="form-field purchase-payment-field">
                Forma de pagamento
                <select
                  required
                  value={paymentMethod}
                  onChange={(event) => setPaymentMethod(event.target.value)}
                >
                  <option value="">Selecione</option>
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>

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
                      <label className="form-field item-category-field">
                        Categoria
                        <select
                          required
                          value={item.category}
                          onChange={(event) => updateItem(index, 'category', event.target.value)}
                        >
                          <option value="">Selecione</option>
                          {purchaseCategories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field item-product-field">
                        Produto
                        <select
                          required
                          value={item.productId}
                          onChange={(event) => updateItem(index, 'productId', event.target.value)}
                        >
                          <option value="">Selecione</option>
                          {products
                            .filter(
                              (product) => !item.category || product.category === item.category
                            )
                            .map((product) => (
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

              <button
                type="submit"
                className="primary-button save-purchase-button"
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar compra'}
              </button>
            </form>
          )}
        </div>
      ) : (
        <div className="purchase-history-stack">
          <section
            className={`panel purchase-history-panel ${isTrashOpen ? 'covered' : ''}`}
            aria-hidden={isTrashOpen}
          >
            <div className="panel-heading purchase-history-heading">
              <div>
                <h2>Compras registradas</h2>
                <p>Histórico de compras e ajustes ativos</p>
              </div>
              <button
                type="button"
                className="icon-button purchase-trash-trigger"
                aria-label="Abrir lixeira de compras"
                title="Lixeira de compras"
                onClick={() => setIsTrashOpen(true)}
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="purchase-history-filters">
              <label className="form-field">
                Data inicial
                <input
                  type="date"
                  value={historyStartDate}
                  max={historyEndDate || undefined}
                  onChange={(event) => setHistoryStartDate(event.target.value)}
                />
              </label>
              <label className="form-field">
                Data final
                <input
                  type="date"
                  value={historyEndDate}
                  min={historyStartDate || undefined}
                  onChange={(event) => setHistoryEndDate(event.target.value)}
                />
              </label>
              <label className="form-field">
                Ano
                <select
                  value={historyYear}
                  onChange={(event) => setHistoryYear(event.target.value)}
                >
                  <option value="">Todos os anos</option>
                  {historyYears.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Estabelecimento
                <select
                  value={historyStore}
                  onChange={(event) => setHistoryStore(event.target.value)}
                >
                  <option value="">Todos os estabelecimentos</option>
                  {historyStores.map((store) => (
                    <option key={store} value={store}>
                      {store}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {purchases.length === 0 ? (
              <p className="recent-empty">Suas compras salvas aparecerão aqui.</p>
            ) : filteredPurchases.length === 0 ? (
              <p className="recent-empty">Nenhuma compra corresponde aos filtros selecionados.</p>
            ) : (
              <div className="recent-purchase-list purchase-history-list">
                {filteredPurchases.map((purchase) => (
                  <div className="recent-purchase-row" key={purchase.id}>
                    <div className="recent-purchase-icon">
                      <ReceiptText size={17} />
                    </div>
                    <div className="recent-purchase-info">
                      <strong>{purchase.storeName}</strong>
                      <span>
                        {formatDate(purchase.purchaseDate)} · {purchase.itemCount} itens
                      </span>
                    </div>
                    <strong className="recent-purchase-total">
                      {formatMoney(purchase.totalCents)}
                    </strong>
                    <button
                      type="button"
                      className="details-purchase-button"
                      aria-label={`Ver detalhes da compra de ${purchase.storeName}`}
                      title="Ver detalhes"
                      onClick={() => void openPurchaseDetails(purchase.id)}
                    >
                      <Eye size={16} />
                    </button>
                    <button
                      type="button"
                      className="delete-purchase-button"
                      aria-label={`Mover compra de ${purchase.storeName} para a lixeira`}
                      title="Mover para a lixeira"
                      disabled={deletingPurchaseId !== null}
                      onClick={() => handleTrashPurchase(purchase)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          {isTrashOpen && (
            <section
              className="panel purchase-trash-overlay"
              role="dialog"
              aria-labelledby="purchase-trash-title"
              aria-label="Lixeira de compras"
              aria-modal="true"
            >
              <div className="purchase-trash-page-heading">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsTrashOpen(false)}
                >
                  <ArrowLeft size={16} /> Voltar ao histórico
                </button>
                <div>
                  <h2 id="purchase-trash-title">Lixeira de compras</h2>
                  <p>As compras são removidas definitivamente após 30 dias.</p>
                </div>
              </div>
              {trashedPurchases.length === 0 ? (
                <p className="recent-empty">A lixeira está vazia.</p>
              ) : (
                <div className="recent-purchase-list">
                  {trashedPurchases.map((purchase) => (
                    <div className="recent-purchase-row trashed-purchase-row" key={purchase.id}>
                      <div className="recent-purchase-icon">
                        <ReceiptText size={17} />
                      </div>
                      <div className="recent-purchase-info">
                        <strong>{purchase.storeName}</strong>
                        <span>
                          {formatDate(purchase.purchaseDate)} · {purchase.itemCount} itens
                        </span>
                        <small>
                          Exclusão definitiva em{' '}
                          {new Date(purchase.expiresAt).toLocaleDateString('pt-BR')}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="details-purchase-button"
                        aria-label={`Ver detalhes da compra de ${purchase.storeName}`}
                        title="Ver detalhes"
                        onClick={() => void openPurchaseDetails(purchase.id)}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        className="restore-purchase-button"
                        aria-label={`Restaurar compra de ${purchase.storeName}`}
                        disabled={workingTrashPurchaseId !== null}
                        onClick={() => handleRestorePurchase(purchase)}
                      >
                        <ArchiveRestore size={15} />
                        {workingTrashPurchaseId === purchase.id ? 'Restaurando...' : 'Restaurar'}
                      </button>
                      <button
                        type="button"
                        className="delete-purchase-button"
                        aria-label={`Excluir permanentemente compra de ${purchase.storeName}`}
                        title="Excluir permanentemente"
                        disabled={workingTrashPurchaseId !== null}
                        onClick={() => handlePermanentlyDeletePurchase(purchase)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {(detailsLoading || purchaseDetails || detailsError) && (
        <div
          className="modal-backdrop purchase-details-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePurchaseDetails()
          }}
        >
          <section
            className="product-modal purchase-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-details-title"
          >
            <div className="modal-heading">
              <div>
                <h2 id="purchase-details-title">Detalhes da compra</h2>
                <p>Dados do estabelecimento, pagamento e itens registrados.</p>
              </div>
              <button
                type="button"
                className="close-button"
                aria-label="Fechar detalhes"
                onClick={closePurchaseDetails}
              >
                <X size={17} />
              </button>
            </div>
            {detailsLoading ? (
              <p className="empty-state">Carregando detalhes...</p>
            ) : detailsError ? (
              <div className="error-message">{detailsError}</div>
            ) : purchaseDetails ? (
              <>
                <dl className="purchase-details-summary">
                  <div>
                    <dt>Estabelecimento</dt>
                    <dd>{purchaseDetails.storeName}</dd>
                  </div>
                  <div>
                    <dt>Data</dt>
                    <dd>{formatDate(purchaseDetails.purchaseDate)}</dd>
                  </div>
                  <div>
                    <dt>Forma de pagamento</dt>
                    <dd>{purchaseDetails.paymentMethod ?? 'Não informada'}</dd>
                  </div>
                </dl>
                <div className="purchase-details-items">
                  <div className="purchase-details-table-scroll">
                    <table className="products-table purchase-details-table">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th>Categoria</th>
                          <th>Quantidade</th>
                          <th>Valor por unidade</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchaseDetails.items.map((item) => (
                          <tr key={item.id}>
                            <td className="table-product-name">{item.productName}</td>
                            <td>{item.category}</td>
                            <td>
                              {item.quantity.toLocaleString('pt-BR')} {item.unit}
                            </td>
                            <td>{formatMoney(item.unitPriceCents)}</td>
                            <td>{formatMoney(item.totalCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="purchase-details-total">
                    <span>Total da compra</span>
                    <strong>{formatMoney(purchaseDetails.totalCents)}</strong>
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}
    </section>
  )
}

export default PurchasesPage
