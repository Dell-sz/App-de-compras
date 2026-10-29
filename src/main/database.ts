import Database from 'better-sqlite3'
import { app } from 'electron'
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
  items: {
    productId: number
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
  totalCents: number
  itemCount: number
}

export type PriceHistoryEntry = {
  id: number
  productId: number
  productName: string
  unit: string
  storeName: string
  purchaseDate: string
  quantity: number
  totalPaidCents: number
  comparableUnitPriceCents: number | null
  pricingMode: PricingMode | null
}

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

  const productColumns = database
    .prepare('PRAGMA table_info(products)')
    .all() as { name: string }[]
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

  const purchaseItemColumns = database
    .prepare('PRAGMA table_info(purchase_items)')
    .all() as { name: string }[]
  if (!purchaseItemColumns.some((column) => column.name === 'pricing_mode')) {
    database.exec('ALTER TABLE purchase_items ADD COLUMN pricing_mode TEXT')
  }
  if (!purchaseItemColumns.some((column) => column.name === 'unit_snapshot')) {
    database.exec('ALTER TABLE purchase_items ADD COLUMN unit_snapshot TEXT')
  }
}

export function getProducts(): Product[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database
    .prepare(`
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
    `)
    .all() as Product[]
}

export function getArchivedProducts(): Product[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database
    .prepare(`
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
    `)
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
      .prepare(`
        UPDATE products
        SET name = ?, category = ?, unit = ?, quantity = ?,
            minimum_quantity = ?, pricing_mode = ?
        WHERE id = ? AND is_archived = 0
      `)
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
      .prepare(`
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
      `)
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

export function restoreProduct(productId: number): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const restore = database.transaction(() => {
    const result = database!
      .prepare('UPDATE products SET is_archived = 0 WHERE id = ? AND is_archived = 1')
      .run(productId)

    if (result.changes === 0) throw new Error('Esse produto não foi encontrado nos itens arquivados.')
  })

  restore()
}

export function addProduct(input: NewProduct): Product {
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
    .prepare(`
      INSERT INTO products (name, category, unit, quantity, minimum_quantity, pricing_mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      name,
      input.category.trim() || 'Outros',
      input.unit.trim() || 'un',
      input.quantity,
      input.minimumQuantity,
      input.pricingMode
    )

  return database
    .prepare(`
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
    `)
    .get(result.lastInsertRowid) as Product
  }

  export function getPurchases(): PurchaseSummary[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database
    .prepare(`
      SELECT
        purchases.id,
        purchases.store_name AS storeName,
        purchases.purchase_date AS purchaseDate,
        purchases.total_cents AS totalCents,
        COUNT(purchase_items.id) AS itemCount
      FROM purchases
      LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
      GROUP BY purchases.id
      ORDER BY purchases.purchase_date DESC, purchases.id DESC
    `)
    .all() as PurchaseSummary[]
}

export function addPurchase(input: NewPurchase): PurchaseSummary {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const storeName = input.storeName.trim()
  if (!storeName) throw new Error('Digite o nome do mercado.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) {
    throw new Error('Informe uma data válida.')
  }
  if (input.items.length === 0) throw new Error('Adicione pelo menos um produto.')

  const savePurchase = database.transaction(() => {
    const purchaseResult = database!
      .prepare('INSERT INTO purchases (store_name, purchase_date, total_cents) VALUES (?, ?, 0)')
      .run(storeName, input.purchaseDate)

    const purchaseId = Number(purchaseResult.lastInsertRowid)
    let totalCents = 0

    const findProduct = database!.prepare(`
      SELECT id, unit, pricing_mode AS pricingMode
      FROM products
      WHERE id = ? AND is_archived = 0
    `)
    const insertItem = database!.prepare(`
      INSERT INTO purchase_items
        (purchase_id, product_id, quantity, unit_price_cents, line_total_cents, pricing_mode, unit_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const updateStock = database!.prepare(
      'UPDATE products SET quantity = quantity + ? WHERE id = ?'
    )

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
        | { id: number; unit: string; pricingMode: PricingMode }
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
        product.unit
      )
      updateStock.run(item.quantity, item.productId)
    }

    database!
      .prepare('UPDATE purchases SET total_cents = ? WHERE id = ?')
      .run(totalCents, purchaseId)

    return database!
      .prepare(`
        SELECT
          purchases.id,
          purchases.store_name AS storeName,
          purchases.purchase_date AS purchaseDate,
          purchases.total_cents AS totalCents,
          COUNT(purchase_items.id) AS itemCount
        FROM purchases
        LEFT JOIN purchase_items ON purchase_items.purchase_id = purchases.id
        WHERE purchases.id = ?
        GROUP BY purchases.id
      `)
      .get(purchaseId) as PurchaseSummary
  })

  return savePurchase()
}

export type DashboardSummary = {
  monthlySpendCents: number
  productCount: number
  lowStockCount: number
  monthlyPurchaseCount: number
}

export function getDashboardSummary(): DashboardSummary {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database.prepare(`
    SELECT
      COALESCE((
        SELECT SUM(total_cents)
        FROM purchases
        WHERE substr(purchase_date, 1, 7) = strftime('%Y-%m', 'now', 'localtime')
      ), 0) AS monthlySpendCents,
      (SELECT COUNT(*) FROM products WHERE is_archived = 0) AS productCount,
      (SELECT COUNT(*) FROM products
        WHERE is_archived = 0 AND quantity <= minimum_quantity) AS lowStockCount,
      (SELECT COUNT(*) FROM purchases
        WHERE substr(purchase_date, 1, 7) = strftime('%Y-%m', 'now', 'localtime')
      ) AS monthlyPurchaseCount
  `).get() as DashboardSummary
}

export function getPriceHistory(): PriceHistoryEntry[] {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  return database
    .prepare(`
      SELECT
        purchase_items.id,
        purchase_items.product_id AS productId,
        products.name AS productName,
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
      ORDER BY purchases.purchase_date DESC, purchase_items.id DESC
    `)
    .all() as PriceHistoryEntry[]
}

export function recordStockCheck(items: StockCheckInput[]): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')
  if (items.length === 0) throw new Error('Não há produtos para conferir.')

  const checkedAt = new Date().toISOString()

  const saveCheck = database.transaction(() => {
    const check = database!
      .prepare('INSERT INTO stock_checks (checked_at) VALUES (?)')
      .run(checkedAt)

    const checkId = Number(check.lastInsertRowid)
    const findProduct = database!.prepare(
      'SELECT id FROM products WHERE id = ? AND is_archived = 0'
    )
    const updateProduct = database!.prepare('UPDATE products SET quantity = ? WHERE id = ?')
    const insertItem = database!.prepare(`
      INSERT INTO stock_check_items (stock_check_id, product_id, counted_quantity)
      VALUES (?, ?, ?)
    `)

    const seenProducts = new Set<number>()

    for (const item of items) {
      if (seenProducts.has(item.productId)) {
        throw new Error('Um produto apareceu mais de uma vez na conferência.')
      }
      seenProducts.add(item.productId)

      if (!Number.isFinite(item.countedQuantity) || item.countedQuantity < 0) {
        throw new Error('As quantidades conferidas devem ser iguais ou maiores que zero.')
      }
      if (!findProduct.get(item.productId)) {
        throw new Error('Um dos produtos selecionados não existe mais no estoque.')
      }

      updateProduct.run(item.countedQuantity, item.productId)
      insertItem.run(checkId, item.productId, item.countedQuantity)
    }
  })

  saveCheck()
}

export function deletePurchase(purchaseId: number): void {
  if (!database) throw new Error('O banco de dados ainda não foi iniciado.')

  const removePurchase = database.transaction(() => {
    const purchase = database!.prepare('SELECT id FROM purchases WHERE id = ?').get(purchaseId)

    if (!purchase) throw new Error('Essa compra não foi encontrada.')

    const items = database!
      .prepare('SELECT product_id AS productId, quantity FROM purchase_items WHERE purchase_id = ?')
      .all(purchaseId) as { productId: number; quantity: number }[]

    const subtractStock = database!.prepare(`
      UPDATE products
      SET quantity = MAX(quantity - ?, 0)
      WHERE id = ?
    `)

    for (const item of items) {
      subtractStock.run(item.quantity, item.productId)
    }

    database!
      .prepare('DELETE FROM purchase_items WHERE purchase_id = ?')
      .run(purchaseId)

    database!
      .prepare('DELETE FROM purchases WHERE id = ?')
      .run(purchaseId)
  })

  removePurchase()
}
