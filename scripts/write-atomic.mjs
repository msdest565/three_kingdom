import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Readers must see a complete prior or next artifact, even during concurrent builds. */
export async function writeAtomic(target, contents) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary,contents,'utf8');
    const retryUntil = Date.now() + 2000;
    for (let attempt=0;;attempt++) {
      try { await rename(temporary,target); break; }
      catch(error) {
        if (!['EPERM','EBUSY','EACCES'].includes(error.code) || Date.now() >= retryUntil) throw error;
        // Windows readers/scanners can hold a complete target beyond 100ms under
        // concurrent builds. Keep atomic replacement and bounded, backed-off retries.
        const delay = Math.min(100, 10 * 2 ** Math.min(attempt, 4), Math.max(1, retryUntil - Date.now()));
        await new Promise(resolve=>setTimeout(resolve,delay));
      }
    }
  } catch(error) {
    await unlink(temporary).catch(()=>{});
    throw error;
  }
}
