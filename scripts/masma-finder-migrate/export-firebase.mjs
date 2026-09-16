/**
 * Firebase Auth·Firestore·Storage 스냅샷을 남긴다.
 *
 * 필요 환경변수:
 *   FIREBASE_SERVICE_ACCOUNT_JSON  서비스 계정 JSON 문자열
 *   또는 GOOGLE_APPLICATION_CREDENTIALS  파일 경로
 *   FIREBASE_STORAGE_BUCKET        비우면 서비스 계정의 project_id.appspot.com
 *
 * 사용:
 *   node scripts/masma-finder-migrate/export-firebase.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  FIRESTORE_ROOTS,
  sha256,
  stampNow,
  writeJson,
} from './lib.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outRoot = path.join(root, 'outputs', 'masma-finder-snapshots')

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return require(path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS))
  }
  const local = path.join(root, 'scripts', 'masma-finder-migrate', 'service-account.json')
  if (existsSync(local)) return require(local)
  return null
}

async function exportAuth(auth) {
  const users = []
  let nextPageToken
  do {
    const page = await auth.listUsers(1000, nextPageToken)
    for (const user of page.users) {
      users.push({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        disabled: user.disabled === true,
        providerIds: (user.providerData || []).map((item) => item.providerId),
        createdAt: user.metadata?.creationTime || null,
        lastSignInAt: user.metadata?.lastSignInTime || null,
      })
    }
    nextPageToken = page.pageToken
  } while (nextPageToken)
  return users
}

async function exportCollectionTree(db, collectionPath, depth = 0) {
  if (depth > 6) return []
  const snap = await db.collection(collectionPath).get()
  const docs = []
  for (const doc of snap.docs) {
    const data = doc.data()
    const children = {}
    const subsnaps = await doc.ref.listCollections()
    for (const sub of subsnaps) {
      children[sub.id] = await exportCollectionTree(
        db,
        `${collectionPath}/${doc.id}/${sub.id}`,
        depth + 1,
      )
    }
    docs.push({
      id: doc.id,
      path: doc.ref.path,
      data,
      children,
    })
  }
  return docs
}

async function exportStorage(bucket, destDir) {
  const [files] = await bucket.getFiles({ prefix: 'works_attachments/' })
  const manifest = []
  for (const file of files) {
    const [buffer] = await file.download()
    const relative = file.name
    const localPath = path.join(destDir, relative)
    mkdirSync(path.dirname(localPath), { recursive: true })
    writeFileSync(localPath, buffer)
    const [metadata] = await file.getMetadata()
    manifest.push({
      path: relative,
      size: buffer.length,
      sha256: sha256(buffer),
      contentType: metadata.contentType || '',
      updated: metadata.updated || null,
    })
  }
  return {
    objectCount: manifest.length,
    byteTotal: manifest.reduce((sum, item) => sum + item.size, 0),
    objects: manifest,
  }
}

async function main() {
  const serviceAccount = loadServiceAccount()
  if (!serviceAccount) {
    console.error(
      '[masma-finder-export] Firebase 서비스 계정이 없습니다. FIREBASE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_APPLICATION_CREDENTIALS를 설정하세요.',
    )
    process.exit(2)
  }

  let adminApp
  let getAuth
  let getFirestore
  let getStorage
  try {
    adminApp = require('firebase-admin/app')
    getAuth = require('firebase-admin/auth').getAuth
    getFirestore = require('firebase-admin/firestore').getFirestore
    getStorage = require('firebase-admin/storage').getStorage
  } catch {
    console.error(
      '[masma-finder-export] firebase-admin이 필요합니다. `npm i firebase-admin --no-save` 후 다시 실행하세요.',
    )
    process.exit(2)
  }

  if (adminApp.getApps().length === 0) {
    adminApp.initializeApp({
      credential: adminApp.cert(serviceAccount),
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET ||
        `${serviceAccount.project_id}.appspot.com`,
    })
  }

  const stamp = stampNow()
  const dest = path.join(outRoot, stamp)
  mkdirSync(dest, { recursive: true })

  const authUsers = await exportAuth(getAuth())
  writeJson(path.join(dest, 'auth-users.json'), {
    exportedAt: new Date().toISOString(),
    count: authUsers.length,
    users: authUsers,
  })

  const firestoreDir = path.join(dest, 'firestore')
  const db = getFirestore()
  const collectionCounts = {}
  for (const name of FIRESTORE_ROOTS) {
    const docs = await exportCollectionTree(db, name)
    collectionCounts[name] = docs.length
    writeJson(path.join(firestoreDir, `${name}.json`), {
      collection: name,
      count: docs.length,
      docs,
    })
  }

  const storageDir = path.join(dest, 'storage')
  const storageManifest = await exportStorage(getStorage().bucket(), storageDir)
  writeJson(path.join(storageDir, 'manifest.json'), {
    exportedAt: new Date().toISOString(),
    ...storageManifest,
  })

  writeJson(path.join(dest, 'export-summary.json'), {
    exportedAt: new Date().toISOString(),
    projectId: serviceAccount.project_id,
    authUserCount: authUsers.length,
    firestore: collectionCounts,
    storage: {
      objectCount: storageManifest.objectCount,
      byteTotal: storageManifest.byteTotal,
    },
  })

  console.log(`[masma-finder-export] ${dest}`)
  console.log(JSON.stringify({
    authUserCount: authUsers.length,
    firestore: collectionCounts,
    storageObjects: storageManifest.objectCount,
  }, null, 2))
}

main().catch((error) => {
  console.error('[masma-finder-export] 실패', error)
  process.exit(1)
})
