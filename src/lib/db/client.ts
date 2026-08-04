/**
 * 브라우저 IndexedDB 클라이언트.
 * 이후 Supabase 교체 시 이 모듈 사용처만 어댑터로 바꾸면 된다.
 */

const DB_NAME = 'atelier'
const DB_VERSION = 5

export const BRANDS_STORE = 'brands'
export const META_STORE = 'meta'
export const BRAND_FIELDS_STORE = 'brandFields'
export const PRODUCT_CODES_STORE = 'productCodes'
export const CODE_USAGE_TARGETS_STORE = 'codeUsageTargets'
export const CODE_USAGE_ASSIGNMENTS_STORE = 'codeUsageAssignments'

let dbPromise: Promise<IDBDatabase> | null = null

function upgrade(db: IDBDatabase) {
  if (!db.objectStoreNames.contains(BRANDS_STORE)) {
    const brands = db.createObjectStore(BRANDS_STORE, { keyPath: 'id' })
    brands.createIndex('slug', 'slug', { unique: true })
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE, { keyPath: 'key' })
  }
  if (!db.objectStoreNames.contains(BRAND_FIELDS_STORE)) {
    const fields = db.createObjectStore(BRAND_FIELDS_STORE, { keyPath: 'id' })
    fields.createIndex('brandId', 'brandId', { unique: false })
  }
  if (!db.objectStoreNames.contains(PRODUCT_CODES_STORE)) {
    const codes = db.createObjectStore(PRODUCT_CODES_STORE, { keyPath: 'id' })
    codes.createIndex('brandId', 'brandId', { unique: false })
    // 거래처 코드는 업체별로 같은 값이 나올 수 있어 중복 검사는 저장 로직에서 한다.
    codes.createIndex('code', 'code', { unique: false })
  }
  if (!db.objectStoreNames.contains(CODE_USAGE_TARGETS_STORE)) {
    const targets = db.createObjectStore(CODE_USAGE_TARGETS_STORE, {
      keyPath: 'id',
    })
    targets.createIndex('brandId', 'brandId', { unique: false })
  }
  if (!db.objectStoreNames.contains(CODE_USAGE_ASSIGNMENTS_STORE)) {
    const assignments = db.createObjectStore(CODE_USAGE_ASSIGNMENTS_STORE, {
      keyPath: 'id',
    })
    assignments.createIndex('brandId', 'brandId', { unique: false })
    assignments.createIndex('productCodeId', 'productCodeId', { unique: false })
    assignments.createIndex('usageTargetId', 'usageTargetId', { unique: false })
    // brandId + productCodeId + usageTargetId 유일성은 저장 로직에서 검사한다.
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      upgrade(request.result)
    }

    request.onsuccess = () => {
      resolve(request.result)
    }

    request.onerror = () => {
      dbPromise = null
      reject(request.error ?? new Error('IndexedDB open failed'))
    }
  })

  return dbPromise
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result: T
    let settled = false

    Promise.resolve(run(store))
      .then((value) => {
        result = value
        settled = true
      })
      .catch((error) => {
        reject(error)
        try {
          tx.abort()
        } catch {
          /* ignore */
        }
      })

    tx.oncomplete = () => {
      if (settled) resolve(result!)
      else reject(new Error('IndexedDB transaction completed without result'))
    }
    tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}
