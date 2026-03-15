export {
  listDatabases,
  createDatabase,
  deleteDatabase,
  getActiveDatabase,
  setActiveDatabase,
  ensureDefaultDatabase,
  getIdbPath,
  type DatabaseEntry,
} from './db-manager';

export {
  initPGliteInstance,
  closePGliteInstance,
  closeAllPGlite,
  getInstanceNames,
  getInstance,
  handleDatabaseRequest,
  loadPGliteAssets,
} from './pglite-database';

export { createPGliteMiddleware } from './bridge-middleware';
