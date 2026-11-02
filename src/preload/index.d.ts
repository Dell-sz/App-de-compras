import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type NewPurchase = {
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

  type ImportedPurchaseInput = {
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

  type ShoppingListExportItem = {
    name: string
    category: string
    quantity: number
    unit: string
  }

  type PurchaseSummary = {
    id: number
    storeName: string
    purchaseDate: string
    paymentMethod: string | null
    totalCents: number
    itemCount: number
  }

  type PurchaseDetails = PurchaseSummary & {
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

  type TrashedPurchase = PurchaseSummary & {
    deletedAt: string
    expiresAt: string
  }

  type AppSettings = {
    saveStockCheckHistory: boolean
    autoSaveStockQuantities: boolean
  }

  type StockCheckResult = {
    undoToken: string
    historySaved: boolean
    previousQuantities: { productId: number; countedQuantity: number }[]
  }

  type PricingMode = 'item_total' | 'unit_measure'

  type PriceHistoryEntry = {
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

  type DashboardSummary = {
    monthlySpendCents: number
    productCount: number
    lowStockCount: number
    monthlyPurchaseCount: number
  }

  type NewProduct = {
    name: string
    category: string
    unit: string
    quantity: number
    minimumQuantity: number
    pricingMode: PricingMode
  }

  type Product = NewProduct & {
    id: number
    createdAt: string
  }

  interface Window {
    electron: ElectronAPI
    api: {
      dashboard: {
        getSummary: () => Promise<DashboardSummary>
      }

      products: {
        list: () => Promise<Product[]>
        add: (product: NewProduct) => Promise<Product>
        update: (productId: number, product: NewProduct) => Promise<Product>
        archive: (productId: number) => Promise<void>
        deletePermanently: (productIds: number[]) => Promise<void>
        listArchived: () => Promise<Product[]>
        restore: (productId: number) => Promise<void>
        undoQuantityUpdate: (
          productId: number,
          expectedQuantity: number,
          previousQuantity: number
        ) => Promise<void>
      }

      purchases: {
        list: () => Promise<PurchaseSummary[]>
        details: (purchaseId: number) => Promise<PurchaseDetails>
        storeSuggestions: () => Promise<string[]>
        add: (purchase: NewPurchase) => Promise<PurchaseSummary>
        addImported: (purchase: ImportedPurchaseInput) => Promise<{
          purchase: PurchaseSummary
          createdProducts: Product[]
        }>
        trash: (purchaseId: number) => Promise<TrashedPurchase>
        listTrash: () => Promise<TrashedPurchase[]>
        restore: (purchaseId: number) => Promise<PurchaseSummary>
        permanentlyDelete: (purchaseId: number) => Promise<void>
      }

      stockChecks: {
        record: (
          items: { productId: number; countedQuantity: number }[]
        ) => Promise<StockCheckResult>
        undo: (undoToken: string) => Promise<void>
      }

      settings: {
        get: () => Promise<AppSettings>
        update: (settings: Partial<AppSettings>) => Promise<AppSettings>
      }

      shoppingList: {
        exportPdf: (items: ShoppingListExportItem[]) => Promise<boolean>
      }

      prices: {
        list: () => Promise<PriceHistoryEntry[]>
      }
    }
  }
}
