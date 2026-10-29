import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  type NewPurchase = {
  storeName: string
  purchaseDate: string
  items: {
    productId: number
    quantity: number
    unitPrice: number
    pricingMode?: PricingMode
  }[]
}

type PurchaseSummary = {
  id: number
  storeName: string
  purchaseDate: string
  totalCents: number
  itemCount: number
}

type PricingMode = 'item_total' | 'unit_measure'

type PriceHistoryEntry = {
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
        listArchived: () => Promise<Product[]>
        restore: (productId: number) => Promise<void>
      }

      purchases: {
        list: () => Promise<PurchaseSummary[]>
        add: (purchase: NewPurchase) => Promise<PurchaseSummary>
        remove: (purchaseId: number) => Promise<void>
      }

      stockChecks: {
        record: (items: { productId: number; countedQuantity: number }[]) => Promise<void>
      }

      prices: {
        list: () => Promise<PriceHistoryEntry[]>
      }
    }
  }
}