import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type NewProduct = {
  name: string
  category: string
  unit: string
  quantity: number
  minimumQuantity: number
  pricingMode: 'item_total' | 'unit_measure'
}

type PurchaseInput = {
  storeName: string
  purchaseDate: string
  paymentMethod: string
  items: {
    productId: number
    quantity: number
    unitPrice: number
    pricingMode?: 'item_total' | 'unit_measure'
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
    pricingMode?: 'item_total' | 'unit_measure'
  }[]
}

type StockCheckEntry = {
  productId: number
  countedQuantity: number
}

type ShoppingListExportItem = {
  name: string
  category: string
  quantity: number
  unit: string
}

const api = {
  dashboard: {
    getSummary: () => ipcRenderer.invoke('dashboard:get-summary')
  },
  products: {
    list: () => ipcRenderer.invoke('products:list'),
    add: (product: NewProduct) => ipcRenderer.invoke('products:add', product),
    update: (productId: number, product: NewProduct) =>
      ipcRenderer.invoke('products:update', productId, product),
    archive: (productId: number) => ipcRenderer.invoke('products:archive', productId),
    deletePermanently: (productIds: number[]) =>
      ipcRenderer.invoke('products:delete-permanently', productIds),
    listArchived: () => ipcRenderer.invoke('products:archived-list'),
    restore: (productId: number) => ipcRenderer.invoke('products:restore', productId),
    undoQuantityUpdate: (productId: number, expectedQuantity: number, previousQuantity: number) =>
      ipcRenderer.invoke(
        'products:undo-quantity-update',
        productId,
        expectedQuantity,
        previousQuantity
      )
  },
  purchases: {
    list: () => ipcRenderer.invoke('purchases:list'),
    details: (purchaseId: number) => ipcRenderer.invoke('purchases:details', purchaseId),
    storeSuggestions: () => ipcRenderer.invoke('purchases:store-suggestions'),
    add: (purchase: PurchaseInput) => ipcRenderer.invoke('purchases:add', purchase),
    addImported: (purchase: ImportedPurchaseInput) =>
      ipcRenderer.invoke('purchases:add-imported', purchase),
    trash: (purchaseId: number) => ipcRenderer.invoke('purchases:trash', purchaseId),
    listTrash: () => ipcRenderer.invoke('purchases:trash-list'),
    restore: (purchaseId: number) => ipcRenderer.invoke('purchases:restore', purchaseId),
    permanentlyDelete: (purchaseId: number) =>
      ipcRenderer.invoke('purchases:delete-permanently', purchaseId)
  },
  stockChecks: {
    record: (items: StockCheckEntry[]) => ipcRenderer.invoke('stock-checks:record', items),
    undo: (undoToken: string) => ipcRenderer.invoke('stock-checks:undo', undoToken)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: { saveStockCheckHistory?: boolean; autoSaveStockQuantities?: boolean }) =>
      ipcRenderer.invoke('settings:update', settings)
  },
  shoppingList: {
    exportPdf: (items: ShoppingListExportItem[]) =>
      ipcRenderer.invoke('shopping-list:export-pdf', items) as Promise<boolean>
  },
  prices: {
    list: () => ipcRenderer.invoke('prices:list')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define em index.d.ts)
  window.electron = electronAPI
  // @ts-ignore (define em index.d.ts)
  window.api = api
}
