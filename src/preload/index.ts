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
  items: {
    productId: number
    quantity: number
    unitPrice: number
    pricingMode?: 'item_total' | 'unit_measure'
  }[]
}

type StockCheckEntry = {
  productId: number
  countedQuantity: number
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
    listArchived: () => ipcRenderer.invoke('products:archived-list'),
    restore: (productId: number) => ipcRenderer.invoke('products:restore', productId)
  },
  purchases: {
    list: () => ipcRenderer.invoke('purchases:list'),
    add: (purchase: PurchaseInput) => ipcRenderer.invoke('purchases:add', purchase),
    remove: (purchaseId: number) => ipcRenderer.invoke('purchases:delete', purchaseId)
  },
  stockChecks: {
    record: (items: StockCheckEntry[]) => ipcRenderer.invoke('stock-checks:record', items)
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