/** `npm run db:migrate` — applies pending migrations and syncs roles/permissions and CMS defaults. */
import { getDb } from '../server/db.js';
import { migrate } from '../server/migrate.js';

const db = await getDb();
const ran = await migrate(db, (m) => console.log(m));
console.log(ran.length ? `Applied ${ran.length} migration(s).` : 'Database is up to date.');
await db.close();
