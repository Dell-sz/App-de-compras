import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  addProduct,
  addImportedPurchase,
  addPurchase,
  archiveProduct,
  deletePurchase,
  getDashboardSummary,
  getArchivedProducts,
  getPriceHistory,
  getProducts,
  getPurchases,
  initializeDatabase,
  recordStockCheck,
  restoreProduct,
  updateProduct,
  type NewProduct,
  type NewImportedPurchase,
  type NewPurchase,
  type StockCheckInput
} from './database'

initializeDatabase()

type ShoppingListExportItem = {
  name: string
  category: string
  quantity: number
  unit: string
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character]
  })
}

function createShoppingListHtml(items: ShoppingListExportItem[], exportDate: string): string {
  const groupedItems = new Map<string, ShoppingListExportItem[]>()
  for (const item of items) {
    const category = item.category.trim() || 'Outros'
    const categoryItems = groupedItems.get(category) ?? []
    categoryItems.push(item)
    groupedItems.set(category, categoryItems)
  }

  const categories = [...groupedItems.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const categorySections = categories
    .map((category) => {
      const rows = groupedItems
        .get(category)!
        .map(
          (item) => `
            <li class="item">
              <span class="checkbox" aria-hidden="true"></span>
              <span class="item-copy">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="quantity">${item.quantity.toLocaleString('pt-BR')} ${escapeHtml(item.unit)}</span>
              </span>
            </li>
          `
        )
        .join('')
      return `
        <section class="category">
          <h2>${escapeHtml(category)}</h2>
          <ul>${rows}</ul>
        </section>
      `
    })
    .join('')

  return `<!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Lista de compras</title>
        <style>
          @page { size: 80mm 160mm; margin: 4mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; }
          body {
            color: #26372c;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 11pt;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          header {
            padding: 0 0 4mm;
            border-bottom: 1.2mm solid #347657;
          }
          h1 {
            margin: 0;
            color: #286648;
            font-size: 18pt;
            line-height: 1.15;
          }
          .export-date {
            margin: 2mm 0 0;
            color: #68756b;
            font-size: 9.5pt;
          }
          .category {
            margin-top: 5mm;
            break-inside: avoid;
          }
          .category h2 {
            margin: 0 0 1.5mm;
            padding: 0 0 1.3mm;
            color: #347657;
            border-bottom: 0.3mm solid #d5e8d8;
            font-size: 11pt;
          }
          ul {
            display: grid;
            gap: 2mm;
            margin: 0;
            padding: 0;
            list-style: none;
          }
          .item {
            display: flex;
            align-items: center;
            gap: 3mm;
            min-height: 14mm;
            padding: 2mm;
            border: 0.25mm solid #e1e9e1;
            border-radius: 2mm;
            break-inside: avoid;
          }
          .checkbox {
            width: 7mm;
            height: 7mm;
            flex: 0 0 7mm;
            border: 0.55mm solid #347657;
            border-radius: 1mm;
          }
          .item-copy { min-width: 0; }
          .item-copy strong {
            display: block;
            color: #26372c;
            font-size: 11pt;
            line-height: 1.25;
            overflow-wrap: anywhere;
          }
          .quantity {
            display: block;
            margin-top: 1mm;
            color: #68756b;
            font-size: 9.5pt;
          }
          @media print {
            body { width: auto; }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>Lista de compras</h1>
          <p class="export-date">Exportada em ${escapeHtml(exportDate)}</p>
        </header>
        ${categorySections}
      </body>
    </html>`
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')
  initializeDatabase()

  ipcMain.handle('dashboard:get-summary', () => getDashboardSummary())
  ipcMain.handle('products:list', () => getProducts())
  ipcMain.handle('products:archived-list', () => getArchivedProducts())
  ipcMain.handle('products:restore', (_event, productId: number) => restoreProduct(productId))
  ipcMain.handle('purchases:list', () => getPurchases())
  ipcMain.handle('purchases:add', (_event, input: NewPurchase) => addPurchase(input))
  ipcMain.handle('purchases:add-imported', (_event, input: NewImportedPurchase) =>
    addImportedPurchase(input)
  )
  ipcMain.handle(
    'shopping-list:export-pdf',
    async (_event, items: ShoppingListExportItem[]): Promise<boolean> => {
      const now = new Date()
      const dateLabel = now.toLocaleDateString('pt-BR')
      const dateFilePart = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0')
      ].join('-')
      const options = {
        title: 'Exportar lista de compras',
        defaultPath: `lista-de-compras-${dateFilePart}.pdf`,
        filters: [{ name: 'Arquivo PDF', extensions: ['pdf'] }]
      }
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const { canceled, filePath } = focusedWindow
        ? await dialog.showSaveDialog(focusedWindow, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return false

      const printWindow = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true }
      })
      try {
        await printWindow.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(createShoppingListHtml(items, dateLabel))}`
        )
        const pdf = await printWindow.webContents.printToPDF({
          pageSize: { width: 80 / 25.4, height: 160 / 25.4 },
          printBackground: true,
          margins: {
            top: 4 / 25.4,
            right: 4 / 25.4,
            bottom: 4 / 25.4,
            left: 4 / 25.4
          },
          preferCSSPageSize: true
        })
        await writeFile(filePath, pdf)
        return true
      } finally {
        printWindow.close()
      }
    }
  )
  ipcMain.handle('purchases:delete', (_event, purchaseId: number) => {
    deletePurchase(purchaseId)
  })
  ipcMain.handle('stock-checks:record', (_event, items: StockCheckInput[]) => {
    recordStockCheck(items)
  })
  ipcMain.handle('products:add', (_event, input: NewProduct) => addProduct(input))
  ipcMain.handle('products:update', (_event, productId: number, input: NewProduct) =>
    updateProduct(productId, input)
  )
  ipcMain.handle('products:archive', (_event, productId: number) => archiveProduct(productId))
  ipcMain.handle('prices:list', () => getPriceHistory())
  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
