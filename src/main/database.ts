import Database from 'better-sqlite3'
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export type NewProduct = {
  name: string
  category: string
  unit: string
  quantity: number
  minimumQuantity: number
  pricingMode: PricingMode
}

export type PricingMode = 'item_total' | 'unit_measure'

export type Product = NewProduct & {
  id: number
  createdAt: string
}

export type NewPurchase = {
  storeName: string
  purchaseDate: string
  paymentMethod: string
  items: {
    productId: number
    quantity: number
    unitPrice: number
    pricingMode?: PricingMode
  }[]
}

export type NewImportedPurchase = {
  storeName: string
  purchaseDate: string
  paymentMethod: string
  items: {
    productId?: number
    newProduct?: NewProduct
    quantity: number
    unitPrice: number
    pricingMode?: PricingMode
  }[]
}

export type StockCheckInput = {
  productId: number
  countedQuantity: number
}

export type PurchaseSummary = {
  id: number
  storeName: string
  purchaseDate: string
  paymentMethod: string | null
  totalCents: number
  itemCount: number
}

export type PurchaseDetails = PurchaseSummary & {
  items: {
    id: number
    productName: string
    category: string
    unit: string
    quantity: number
    unitPriceCents: number
    totalCents: number
    pricingMode: PricingMode | null
  }[]
}

export type TrashedPurchase = PurchaseSummary & {
  deletedAt: string
  expiresAt: string
}

export type PriceHistoryEntry = {
  id: number
  productId: number
  productName: string
  category: string
  unit: string
  storeName: string
  purchaseDate: string
  quantity: number
  totalPaidCents: number
  comparableUnitPriceCents: number | null
  pricingMode: PricingMode | null
}

export type AppSettings = {
  saveStockCheckHistory: boolean
  autoSaveStockQuantities: boolean
}

export type StockCheckResult = {
  undoToken: string
  historySaved: boolean
  previousQuantities: StockCheckInput[]
}

type StockCheckUndo = {
  previousQuantities: StockCheckInput[]
  currentQuantities: StockCheckInput[]
  stockCheckId: number | null
}

const PURCHASE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const PAYMENT_METHODS = [
  'Dinheiro',
  'Pix',
  'Cartão de débito',
  'Cartão de crédito',
  'Transferência',
  'Outro'
]
const stockCheckUndos = new Map<string, StockCheckUndo>()
let database: Database.Database | undefined

export function initializeDatabase(): void {
  const databasePath = join(app.getPath('userData'), 'compras.db')
  database = new Database(databasePath)

  database.pragma('journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Outros',
      unit TEXT NOT NULL DEFAULT 'un',
      quantity REAL NOT NULL DEFAULT 0,
      minimum_quantity REAL NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      pricing_mode TEXT NOT NULL DEFAULT 'item_total',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const productColumns = database.prepare('PRAGMA table_info(products)').all() as { name: string }[]
  if (!productColumns.some((column) => column.name === 'is_archived')) {
    database.exec('ALTER TABLE products ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0')
  }
  if (!productColumns.some((column) => column.name === 'pricing_mode')) {
    database.exec("ALTER TABLE products ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'item_total'")
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS stock_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_check_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_check_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      counted_quantity REAL NOT NULL,
      FOREIGN KEY (stock_check_id) REFERENCES stock_checks(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `)

  database.exec(`
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    payment_method TEXT,
    total_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL,
    pricing_mode TEXT,
    unit_snapshot TEXT,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`)

  const purchaseItemColumns = database.prepare('PRAGMA table_info(purchase_items)').all() as {
    name: string
  }[]
  if (!purchaseItemColumns.some((column) => column.name === 'pricing_mode')) {
    database.exec('ALTER TABLE purchase_items ADD COLUMN pricing_mode TEXT')
  }
  if (!purchaseItemColumns.some((column) => column.name === 'unit_snapshot')) {
    database.exec('ALTER TABLE purchase_items ADD COLUMN unit_snapshot TEXT')
  }
  if (!purchaseItemColumns.some((column) => column.name === 'product_name_snapshot')) {
    database.exec('ALTER TABLE purchase_items ADD COLUMN product_name_snapshot TEXT')
  }
  if (!purchaseItemColumns.some((column) => column.name === 'category_snapshot')) {
    database.exec('ALTER TABLE purchase_items ADD COLUMN category_snapshot TEXT')
  }
  database.exec(`
    UPDATE purchase_items
    SET product_name_snapshot = (
          SELECT name FROM products WHERE products.id = purchase_items.product_id
        ),
        category_snapshot = (
          SELECT category FROM products WHERE products.id = purchase_items.product_id
        )
    WHERE product_name_snapshot IS NULL OR category_snapshot IS NULL
  `)

  const purchaseColumns = database.prepare('PRAGMA table_info(purchases)').all() as {
    name: string
  }[]
  if (!purchaseColumns.some((column) => column.name === 'payment_method')) {
    database.exec('ALTER TABLE purchases ADD COLUMN payment_method TEXT')
  }
  if (!purchaseColumns.some((column) => column.name === 'deleted_at')) {
    database.exec('ALTER TABLE purchases ADD COLUMN deleted_at TEXT')
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
    INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
    VALUES ('save_stock_check_history', '1');
    INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
    VALUES ('auto_save_stock_quantities', '1');
  `)

  database.exec(`
    CREATE TABLE IF NOT EXISTS purchase_stock_adjustments (
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      removed_quantity REAL NOT NULL,
      PRIMARY KEY (purchase_id, product_id),
      FOREIGN KEY (purchase_id) REFERENCES purchases(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `)
  database.exec('CREATE INDEX IF NOT EXISTS idx_purchases_deleted_at ON purchases(deleted_at)')

  purgeExpiredPurchases()
}

export function getProducts(): Product[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database
    .prepare(
      `
      SELECT
        id,
        name,
        category,
        unit,
        quantity,
        minimum_quantity AS minimumQuantity,
        pricing_mode AS pricingMode,
        created_at AS createdAt
      FROM products
      WHERE is_archived = 0
      ORDER BY name COLLATE NOCASE
    `
    )
    .all() as Product[]
}

export function getArchivedProducts(): Product[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database
    .prepare(
      `
      SELECT
        id,
        name,
        category,
        unit,
        quantity,
        minimum_quantity AS minimumQuantity,
        pricing_mode AS pricingMode,
        created_at AS createdAt
      FROM products
      WHERE is_archived = 1
      ORDER BY name COLLATE NOCASE
    `
    )
    .all() as Product[]
}

function validatePricingMode(pricingMode: string): asserts pricingMode is PricingMode {
  if (pricingMode !== 'item_total' && pricingMode !== 'unit_measure') {
    throw new Error('Selecione uma forma de precificação válida.')
  }
}

function getComparableQuantity(quantity: number, unit: string): number {
  const normalizedUnit = unit.trim().toLocaleLowerCase('pt-BR')
  if (normalizedUnit === 'g') return quantity / 1000
  if (normalizedUnit === 'ml') return quantity / 1000
  return quantity
}

export function updateProduct(productId: number, input: NewProduct): Product {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const name = input.name.trim()
  if (!name) throw new Error('Digite o nome do produto.')
  if (
    !Number.isFinite(input.quantity) ||
    input.quantity < 0 ||
    !Number.isFinite(input.minimumQuantity) ||
    input.minimumQuantity < 0
  ) {
    throw new Error('As quantidades precisam ser números iguais ou maiores que zero.')
  }
  validatePricingMode(input.pricingMode)

  const update = database.transaction(() => {
    const result = database!
      .prepare(
        `
        UPDATE products
        SET name = ?, category = ?, unit = ?, quantity = ?,
            minimum_quantity = ?, pricing_mode = ?
        WHERE id = ? AND is_archived = 0
      `
      )
      .run(
        name,
        input.category.trim() || 'Outros',
        input.unit.trim() || 'un',
        input.quantity,
        input.minimumQuantity,
        input.pricingMode,
        productId
      )

    if (result.changes === 0) throw new Error('Esse produto não foi encontrado no estoque ativo.')

    return database!
      .prepare(
        `
        SELECT
          id,
          name,
          category,
          unit,
          quantity,
          minimum_quantity AS minimumQuantity,
          pricing_mode AS pricingMode,
          created_at AS createdAt
        FROM products
        WHERE id = ?
      `
      )
      .get(productId) as Product
  })

  return update()
}

export function archiveProduct(productId: number): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const result = database
    .prepare('UPDATE products SET is_archived = 1 WHERE id = ? AND is_archived = 0')
    .run(productId)

  if (result.changes === 0) throw new Error('Esse produto não foi encontrado no estoque ativo.')
}

export function deleteProductsPermanently(productIds: number[]): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  if (
    !Array.isArray(productIds) ||
    productIds.length === 0 ||
    productIds.some((productId) => !Number.isInteger(productId) || productId <= 0)
  ) {
    throw new Error('Selecione produtos válidos para excluir.')
  }

  const uniqueProductIds = [...new Set(productIds)]
  const placeholders = uniqueProductIds.map(() => '?').join(', ')
  const deleteProducts = database.transaction(() => {
    const activeProducts = database!
      .prepare(`SELECT id FROM products WHERE is_archived = 0 AND id IN (${placeholders})`)
      .all(...uniqueProductIds) as { id: number }[]
    if (activeProducts.length !== uniqueProductIds.length) {
      throw new Error('Um ou mais produtos não foram encontrados no estoque ativo.')
    }

    const affectedChecks = database!
      .prepare(
        `SELECT DISTINCT stock_check_id AS id
         FROM stock_check_items
         WHERE product_id IN (${placeholders})`
      )
      .all(...uniqueProductIds) as { id: number }[]

    database!
      .prepare(`DELETE FROM purchase_stock_adjustments WHERE product_id IN (${placeholders})`)
      .run(...uniqueProductIds)
    database!
      .prepare(`DELETE FROM stock_check_items WHERE product_id IN (${placeholders})`)
      .run(...uniqueProductIds)
    database!
      .prepare(`DELETE FROM purchase_items WHERE product_id IN (${placeholders})`)
      .run(...uniqueProductIds)

    const deleteEmptyCheck = database!.prepare(`
      DELETE FROM stock_checks
      WHERE id = ?
        AND NOT EXISTS (
          SELECT 1 FROM stock_check_items WHERE stock_check_id = stock_checks.id
        )
    `)
    for (const check of affectedChecks) deleteEmptyCheck.run(check.id)

    const result = database!
      .prepare(`DELETE FROM products WHERE is_archived = 0 AND id IN (${placeholders})`)
      .run(...uniqueProductIds)
    if (result.changes !== uniqueProductIds.length) {
      throw new Error('Não foi possível excluir todos os produtos selecionados.')
    }
  })

  deleteProducts()
}

export function restoreProduct(productId: number): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const restore = database.transaction(() => {
    const result = database!
      .prepare('UPDATE products SET is_archived = 0 WHERE id = ? AND is_archived = 1')
      .run(productId)

    if (result.changes === 0)
      throw new Error('Esse produto não foi encontrado nos itens arquivados.')
  })

  restore()
}

export function undoProductQuantityUpdate(
  productId: number,
  expectedQuantity: number,
  previousQuantity: number
): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  if (
    !Number.isFinite(expectedQuantity) ||
    expectedQuantity < 0 ||
    !Number.isFinite(previousQuantity) ||
    previousQuantity < 0
  ) {
    throw new Error('As quantidades para desfazer a alteração são inválidas.')
  }

  const undo = database.transaction(() => {
    const result = database!
      .prepare('UPDATE products SET quantity = ? WHERE id = ? AND quantity = ?')
      .run(previousQuantity, productId, expectedQuantity)
    if (result.changes === 0) {
      throw new Error('O estoque mudou depois da edição. Não é seguro desfazê-la automaticamente.')
    }
  })
  undo()
}

function insertProduct(input: NewProduct): Product {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const name = input.name.trim()
  if (!name) throw new Error('Digite o nome do produto.')

  if (
    !Number.isFinite(input.quantity) ||
    input.quantity < 0 ||
    !Number.isFinite(input.minimumQuantity) ||
    input.minimumQuantity < 0
  ) {
    throw new Error('As quantidades precisam ser números iguais ou maiores que zero.')
  }
  validatePricingMode(input.pricingMode)

  const result = database
    .prepare(
      `
      INSERT INTO products (name, category, unit, quantity, minimum_quantity, pricing_mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      name,
      input.category.trim() || 'Outros',
      input.unit.trim() || 'un',
      input.quantity,
      input.minimumQuantity,
      input.pricingMode
    )

  return database
    .prepare(
      `
      SELECT
        id,
        name,
        category,
        unit,
        quantity,
        minimum_quantity AS minimumQuantity,
        pricing_mode AS pricingMode,
        created_at AS createdAt
      FROM products
      WHERE id = ? AND is_archived = 0
    `
    )
    .get(result.lastInsertRowid) as Product
}

export function addProduct(input: NewProduct): Product {
  return insertProduct(input)
}

export function getPurchases(): PurchaseSummary[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  purgeExpiredPurchases()

  return database
    .prepare(
      `
      SELECT
        purchases.id,
        purchases.store_name AS storeName,
        purchases.purchase_date AS purchaseDate,
        purchases.payment_method AS paymentMethod,
        purchases.total_cents AS totalCents,
        COUNT(purchase_items.id) AS itemCount
      FROM purchases
      LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
      WHERE purchases.deleted_at IS NULL
      GROUP BY purchases.id
      ORDER BY purchases.purchase_date DESC, purchases.id DESC
    `
    )
    .all() as PurchaseSummary[]
}

export function getPurchaseStoreSuggestions(): string[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  return database
    .prepare(
      `
      SELECT MAX(store_name) AS storeName
      FROM purchases
      WHERE deleted_at IS NULL
      GROUP BY lower(trim(store_name))
      ORDER BY COUNT(*) DESC, MAX(purchase_date) DESC
      LIMIT 12
    `
    )
    .all()
    .map((row) => (row as { storeName: string }).storeName)
}

export function getPurchaseDetails(purchaseId: number): PurchaseDetails {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  purgeExpiredPurchases()
  const purchase = database
    .prepare(
      `
      SELECT
        id,
        store_name AS storeName,
        purchase_date AS purchaseDate,
        payment_method AS paymentMethod,
        total_cents AS totalCents,
        (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = purchases.id) AS itemCount
      FROM purchases
      WHERE id = ?
    `
    )
    .get(purchaseId) as PurchaseSummary | undefined
  if (!purchase) throw new Error('Essa compra não foi encontrada.')

  const items = database
    .prepare(
      `
      SELECT
        purchase_items.id,
        COALESCE(purchase_items.product_name_snapshot, products.name) AS productName,
        COALESCE(purchase_items.category_snapshot, products.category) AS category,
        COALESCE(purchase_items.unit_snapshot, products.unit) AS unit,
        purchase_items.quantity,
        purchase_items.unit_price_cents AS unitPriceCents,
        purchase_items.line_total_cents AS totalCents,
        purchase_items.pricing_mode AS pricingMode
      FROM purchase_items
      LEFT JOIN products ON products.id = purchase_items.product_id
      WHERE purchase_items.purchase_id = ?
      ORDER BY purchase_items.id
    `
    )
    .all(purchaseId) as PurchaseDetails['items']

  return { ...purchase, items }
}

export function getTrashedPurchases(): TrashedPurchase[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  purgeExpiredPurchases()

  return (
    database
      .prepare(
        `
      SELECT
        purchases.id,
        purchases.store_name AS storeName,
        purchases.purchase_date AS purchaseDate,
        purchases.payment_method AS paymentMethod,
        purchases.total_cents AS totalCents,
        COUNT(purchase_items.id) AS itemCount,
        purchases.deleted_at AS deletedAt
      FROM purchases
      LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
      WHERE purchases.deleted_at IS NOT NULL
      GROUP BY purchases.id
      ORDER BY purchases.deleted_at DESC, purchases.id DESC
    `
      )
      .all() as Omit<TrashedPurchase, 'expiresAt'>[]
  ).map((purchase) => ({
    ...purchase,
    expiresAt: new Date(Date.parse(purchase.deletedAt) + PURCHASE_RETENTION_MS).toISOString()
  }))
}

function localDateInputValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function validatePurchaseDate(purchaseDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    throw new Error('Informe uma data válida.')
  }
  const parsedDate = new Date(`${purchaseDate}T00:00:00.000Z`)
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== purchaseDate
  ) {
    throw new Error('Informe uma data válida.')
  }
  if (purchaseDate > localDateInputValue(new Date())) {
    throw new Error('A data da compra não pode ser futura.')
  }
}

function savePurchase(input: NewPurchase): PurchaseSummary {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const storeName = input.storeName.trim()
  if (!storeName) throw new Error('Digite o nome do estabelecimento.')
  if (typeof input.paymentMethod !== 'string' || !PAYMENT_METHODS.includes(input.paymentMethod)) {
    throw new Error('Selecione uma forma de pagamento válida.')
  }
  validatePurchaseDate(input.purchaseDate)
  if (input.items.length === 0) throw new Error('Adicione pelo menos um produto.')

  const purchaseResult = database
    .prepare(
      'INSERT INTO purchases (store_name, purchase_date, payment_method, total_cents) VALUES (?, ?, ?, 0)'
    )
    .run(storeName, input.purchaseDate, input.paymentMethod)

  const purchaseId = Number(purchaseResult.lastInsertRowid)
  let totalCents = 0

  const findProduct = database.prepare(`
      SELECT id, name, category, unit, pricing_mode AS pricingMode
      FROM products
      WHERE id = ? AND is_archived = 0
    `)
  const insertItem = database.prepare(`
      INSERT INTO purchase_items
        (purchase_id, product_id, quantity, unit_price_cents, line_total_cents, pricing_mode, unit_snapshot, product_name_snapshot, category_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
  const updateStock = database.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?')

  for (const item of input.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new Error('A quantidade de cada item precisa ser maior que zero.')
    }
    if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new Error('O preço de cada item precisa ser igual ou maior que zero.')
    }
    const enteredPriceCents = Math.round(item.unitPrice * 100)
    if (!Number.isSafeInteger(enteredPriceCents)) {
      throw new Error('O preço informado é muito alto.')
    }
    const product = findProduct.get(item.productId) as
      | {
          id: number
          name: string
          category: string
          unit: string
          pricingMode: PricingMode
        }
      | undefined
    if (!product) {
      throw new Error('Um dos produtos selecionados não existe mais no estoque.')
    }
    const pricingMode = item.pricingMode ?? product.pricingMode
    validatePricingMode(pricingMode)

    const comparableQuantity = getComparableQuantity(item.quantity, product.unit)
    if (!Number.isFinite(comparableQuantity) || comparableQuantity <= 0) {
      throw new Error('A quantidade informada não é válida para a unidade do produto.')
    }
    const lineTotalCents =
      pricingMode === 'item_total'
        ? enteredPriceCents
        : Math.round(enteredPriceCents * comparableQuantity)
    if (!Number.isSafeInteger(lineTotalCents)) {
      throw new Error('O total calculado para o item é muito alto.')
    }
    const unitPriceCents =
      pricingMode === 'item_total'
        ? Math.round(lineTotalCents / comparableQuantity)
        : enteredPriceCents
    totalCents += lineTotalCents
    if (!Number.isSafeInteger(totalCents)) {
      throw new Error('O total calculado para a compra é muito alto.')
    }

    insertItem.run(
      purchaseId,
      item.productId,
      item.quantity,
      unitPriceCents,
      lineTotalCents,
      pricingMode,
      product.unit,
      product.name,
      product.category
    )
    updateStock.run(item.quantity, item.productId)
  }

  database.prepare('UPDATE purchases SET total_cents = ? WHERE id = ?').run(totalCents, purchaseId)

  return database
    .prepare(
      `
        SELECT
          purchases.id,
          purchases.store_name AS storeName,
          purchases.purchase_date AS purchaseDate,
          purchases.payment_method AS paymentMethod,
          purchases.total_cents AS totalCents,
          COUNT(purchase_items.id) AS itemCount
        FROM purchases
        LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
        WHERE purchases.id = ?
        GROUP BY purchases.id
      `
    )
    .get(purchaseId) as PurchaseSummary
}

export function addPurchase(input: NewPurchase): PurchaseSummary {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  return database.transaction(() => savePurchase(input))()
}

export function addImportedPurchase(input: NewImportedPurchase): {
  purchase: PurchaseSummary
  createdProducts: Product[]
} {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database.transaction(() => {
    const createdProducts: Product[] = []
    const items = input.items.map((item) => {
      if (item.productId !== undefined && item.newProduct) {
        throw new Error('Selecione um produto existente ou cadastre um novo, não ambos.')
      }
      if (item.productId === undefined && !item.newProduct) {
        throw new Error('Vincule cada item a um produto ou preencha os dados para cadastrá-lo.')
      }

      let productId = item.productId
      if (item.newProduct) {
        const product = insertProduct({ ...item.newProduct, quantity: 0 })
        createdProducts.push(product)
        productId = product.id
      }
      if (productId === undefined) {
        throw new Error('Vincule cada item a um produto ou preencha os dados para cadastrá-lo.')
      }

      return {
        productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        pricingMode: item.pricingMode
      }
    })

    const purchase = savePurchase({
      storeName: input.storeName,
      purchaseDate: input.purchaseDate,
      paymentMethod: input.paymentMethod,
      items
    })
    return {
      purchase,
      createdProducts: createdProducts.map((product) => ({
        ...product,
        quantity: items
          .filter((item) => item.productId === product.id)
          .reduce((quantity, item) => quantity + item.quantity, 0)
      }))
    }
  })()
}

export type DashboardSummary = {
  monthlySpendCents: number
  productCount: number
  lowStockCount: number
  monthlyPurchaseCount: number
}

export function getDashboardSummary(): DashboardSummary {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  purgeExpiredPurchases()

  return database
    .prepare(
      `
    SELECT
      COALESCE((
        SELECT SUM(total_cents)
        FROM purchases
        WHERE deleted_at IS NULL
          AND substr(purchase_date, 1, 7) = strftime('%Y-%m', 'now', 'localtime')
      ), 0) AS monthlySpendCents,
      (SELECT COUNT(*) FROM products WHERE is_archived = 0) AS productCount,
      (SELECT COUNT(*) FROM products
        WHERE is_archived = 0 AND quantity <= minimum_quantity) AS lowStockCount,
      (SELECT COUNT(*) FROM purchases
        WHERE deleted_at IS NULL
          AND substr(purchase_date, 1, 7) = strftime('%Y-%m', 'now', 'localtime')
      ) AS monthlyPurchaseCount
  `
    )
    .get() as DashboardSummary
}

export function getPriceHistory(): PriceHistoryEntry[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  purgeExpiredPurchases()

  return database
    .prepare(
      `
      SELECT
        purchase_items.id,
        purchase_items.product_id AS productId,
        products.name AS productName,
        COALESCE(purchase_items.category_snapshot, products.category) AS category,
        COALESCE(purchase_items.unit_snapshot, products.unit) AS unit,
        purchases.store_name AS storeName,
        purchases.purchase_date AS purchaseDate,
        purchase_items.quantity,
        purchase_items.line_total_cents AS totalPaidCents,
        CASE
          WHEN purchase_items.pricing_mode IS NULL THEN NULL
          ELSE purchase_items.unit_price_cents
        END AS comparableUnitPriceCents,
        purchase_items.pricing_mode AS pricingMode
      FROM purchase_items
      JOIN products ON products.id = purchase_items.product_id
      JOIN purchases ON purchases.id = purchase_items.purchase_id
      WHERE purchases.deleted_at IS NULL
      ORDER BY purchases.purchase_date DESC, purchase_items.id DESC
    `
    )
    .all() as PriceHistoryEntry[]
}

export function getAppSettings(): AppSettings {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  const setting = database
    .prepare(
      `SELECT setting_key, setting_value
       FROM app_settings
       WHERE setting_key IN ('save_stock_check_history', 'auto_save_stock_quantities')`
    )
    .all() as { setting_key: string; setting_value: string }[]
  const settings = new Map(
    setting.map(({ setting_key, setting_value }) => [setting_key, setting_value])
  )
  if (!settings.has('save_stock_check_history') || !settings.has('auto_save_stock_quantities')) {
    throw new Error('As configurações de estoque não foram encontradas.')
  }
  return {
    saveStockCheckHistory: settings.get('save_stock_check_history') === '1',
    autoSaveStockQuantities: settings.get('auto_save_stock_quantities') === '1'
  }
}

export function updateAppSettings(settings: Partial<AppSettings>): AppSettings {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  const entries = Object.entries(settings)
  if (
    entries.length === 0 ||
    entries.some(
      ([key, value]) =>
        !['saveStockCheckHistory', 'autoSaveStockQuantities'].includes(key) ||
        typeof value !== 'boolean'
    )
  ) {
    throw new Error('As configurações de estoque são inválidas.')
  }
  const saveSettings = database.transaction(() => {
    const updateSetting = database!.prepare(`
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value
    `)
    for (const [key, value] of entries) {
      const settingKey =
        key === 'saveStockCheckHistory' ? 'save_stock_check_history' : 'auto_save_stock_quantities'
      updateSetting.run(settingKey, value ? '1' : '0')
    }
  })
  saveSettings()
  return getAppSettings()
}

export function recordStockCheck(items: StockCheckInput[]): StockCheckResult {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  if (items.length === 0) throw new Error('Não há produtos para conferir.')

  const checkedAt = new Date().toISOString()
  const { saveStockCheckHistory } = getAppSettings()
  const undoToken = randomUUID()

  const result = database.transaction(() => {
    const checkId = saveStockCheckHistory
      ? Number(
          database!.prepare('INSERT INTO stock_checks (checked_at) VALUES (?)').run(checkedAt)
            .lastInsertRowid
        )
      : null
    const findProduct = database!.prepare(
      'SELECT id, quantity FROM products WHERE id = ? AND is_archived = 0'
    )
    const updateProduct = database!.prepare('UPDATE products SET quantity = ? WHERE id = ?')
    const insertItem = saveStockCheckHistory
      ? database!.prepare(`
          INSERT INTO stock_check_items (stock_check_id, product_id, counted_quantity)
          VALUES (?, ?, ?)
        `)
      : null

    const seenProducts = new Set<number>()
    const previousQuantities: StockCheckInput[] = []
    const currentQuantities: StockCheckInput[] = []

    for (const item of items) {
      if (seenProducts.has(item.productId)) {
        throw new Error('Um produto apareceu mais de uma vez na conferência.')
      }
      seenProducts.add(item.productId)

      if (!Number.isFinite(item.countedQuantity) || item.countedQuantity < 0) {
        throw new Error('As quantidades conferidas devem ser iguais ou maiores que zero.')
      }
      const product = findProduct.get(item.productId) as
        { id: number; quantity: number } | undefined
      if (!product) {
        throw new Error('Um dos produtos selecionados não existe mais no estoque.')
      }

      previousQuantities.push({ productId: item.productId, countedQuantity: product.quantity })
      currentQuantities.push(item)
      updateProduct.run(item.countedQuantity, item.productId)
      insertItem?.run(checkId, item.productId, item.countedQuantity)
    }
    return { previousQuantities, currentQuantities, stockCheckId: checkId }
  })

  const undo = result()
  stockCheckUndos.clear()
  stockCheckUndos.set(undoToken, undo)
  return {
    undoToken,
    historySaved: saveStockCheckHistory,
    previousQuantities: undo.previousQuantities
  }
}

export function undoStockCheck(undoToken: string): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  const undo = stockCheckUndos.get(undoToken)
  if (!undo)
    throw new Error(
      'Não é possível desfazer esta conferência. Ela pode já ter sido desfeita ou o app foi reiniciado.'
    )

  database.transaction(() => {
    const getQuantity = database!.prepare('SELECT quantity FROM products WHERE id = ?')
    for (const item of undo.currentQuantities) {
      const product = getQuantity.get(item.productId) as { quantity: number } | undefined
      if (!product || product.quantity !== item.countedQuantity) {
        throw new Error(
          'O estoque mudou depois da conferência. Não é seguro desfazê-la automaticamente.'
        )
      }
    }

    const restoreQuantity = database!.prepare('UPDATE products SET quantity = ? WHERE id = ?')
    for (const item of undo.previousQuantities) {
      restoreQuantity.run(item.countedQuantity, item.productId)
    }

    if (undo.stockCheckId !== null) {
      database!
        .prepare('DELETE FROM stock_check_items WHERE stock_check_id = ?')
        .run(undo.stockCheckId)
      database!.prepare('DELETE FROM stock_checks WHERE id = ?').run(undo.stockCheckId)
    }
  })()
  stockCheckUndos.delete(undoToken)
}

export function trashPurchase(purchaseId: number): TrashedPurchase {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const moveToTrash = database.transaction(() => {
    const purchase = database!
      .prepare('SELECT id FROM purchases WHERE id = ? AND deleted_at IS NULL')
      .get(purchaseId)

    if (!purchase) throw new Error('Essa compra não foi encontrada.')

    const items = database!
      .prepare(
        `
        SELECT product_id AS productId, SUM(quantity) AS quantity
        FROM purchase_items
        WHERE purchase_id = ?
        GROUP BY product_id
      `
      )
      .all(purchaseId) as { productId: number; quantity: number }[]

    const deletedAt = new Date().toISOString()
    const trashed = database!
      .prepare('UPDATE purchases SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(deletedAt, purchaseId)
    if (trashed.changes !== 1) throw new Error('Essa compra já foi movida para a lixeira.')

    const getStock = database!.prepare('SELECT quantity FROM products WHERE id = ?')
    const subtractStock = database!.prepare(
      'UPDATE products SET quantity = MAX(quantity - ?, 0) WHERE id = ?'
    )
    const saveAdjustment = database!.prepare(`
      INSERT INTO purchase_stock_adjustments (purchase_id, product_id, removed_quantity)
      VALUES (?, ?, ?)
    `)

    for (const item of items) {
      const product = getStock.get(item.productId) as { quantity: number } | undefined
      if (!product) throw new Error('Um dos produtos desta compra não existe mais no estoque.')
      const removedQuantity = Math.min(product.quantity, item.quantity)
      subtractStock.run(item.quantity, item.productId)
      saveAdjustment.run(purchaseId, item.productId, removedQuantity)
    }
    return {
      ...(database!
        .prepare(
          `
          SELECT
            purchases.id,
            purchases.store_name AS storeName,
            purchases.purchase_date AS purchaseDate,
            purchases.payment_method AS paymentMethod,
            purchases.total_cents AS totalCents,
            COUNT(purchase_items.id) AS itemCount
          FROM purchases
          LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
          WHERE purchases.id = ?
          GROUP BY purchases.id
        `
        )
        .get(purchaseId) as PurchaseSummary),
      deletedAt
    }
  })

  const purchase = moveToTrash()
  return {
    ...purchase,
    expiresAt: new Date(Date.parse(purchase.deletedAt) + PURCHASE_RETENTION_MS).toISOString()
  }
}

export function restorePurchase(purchaseId: number): PurchaseSummary {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  purgeExpiredPurchases()

  return database.transaction(() => {
    const result = database!
      .prepare('UPDATE purchases SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
      .run(purchaseId)
    if (result.changes === 0) throw new Error('Essa compra não foi encontrada na lixeira.')

    const items = database!
      .prepare(
        `
        SELECT product_id AS productId, removed_quantity AS quantity
        FROM purchase_stock_adjustments
        WHERE purchase_id = ?
      `
      )
      .all(purchaseId) as { productId: number; quantity: number }[]
    const addStock = database!.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?')
    for (const item of items) addStock.run(item.quantity, item.productId)
    database!
      .prepare('DELETE FROM purchase_stock_adjustments WHERE purchase_id = ?')
      .run(purchaseId)

    return database!
      .prepare(
        `
        SELECT
          purchases.id,
          purchases.store_name AS storeName,
          purchases.purchase_date AS purchaseDate,
          purchases.payment_method AS paymentMethod,
          purchases.total_cents AS totalCents,
          COUNT(purchase_items.id) AS itemCount
        FROM purchases
        LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
        WHERE purchases.id = ?
        GROUP BY purchases.id
      `
      )
      .get(purchaseId) as PurchaseSummary
  })()
}

export function permanentlyDeletePurchase(purchaseId: number): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  purgeExpiredPurchases()

  database.transaction(() => {
    const purchase = database!
      .prepare('SELECT id FROM purchases WHERE id = ? AND deleted_at IS NOT NULL')
      .get(purchaseId)
    if (!purchase) throw new Error('Essa compra não foi encontrada na lixeira.')

    database!
      .prepare('DELETE FROM purchase_stock_adjustments WHERE purchase_id = ?')
      .run(purchaseId)
    database!.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(purchaseId)
    database!.prepare('DELETE FROM purchases WHERE id = ?').run(purchaseId)
  })()
}

export function purgeExpiredPurchases(): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  const expirationCutoff = new Date(Date.now() - PURCHASE_RETENTION_MS).toISOString()

  database.transaction(() => {
    const expiredPurchases = database!
      .prepare('SELECT id FROM purchases WHERE deleted_at IS NOT NULL AND deleted_at <= ?')
      .all(expirationCutoff) as { id: number }[]
    const deleteItems = database!.prepare('DELETE FROM purchase_items WHERE purchase_id = ?')
    const deleteAdjustments = database!.prepare(
      'DELETE FROM purchase_stock_adjustments WHERE purchase_id = ?'
    )
    const deletePurchase = database!.prepare('DELETE FROM purchases WHERE id = ?')
    for (const purchase of expiredPurchases) {
      deleteAdjustments.run(purchase.id)
      deleteItems.run(purchase.id)
      deletePurchase.run(purchase.id)
    }
  })()
}
