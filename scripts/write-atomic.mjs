import { writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Readers must see a complete prior or next artifact, even during concurrent builds. */
export async function writeAtomic(target, contents) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary,contents,'utf8');
    for (let attempt=0;;attempt++) {
      try { await rename(temporary,target); break; }
      catch(error) {
        if (!['EPERM','EBUSY','EACCES'].includes(error.code) || attempt>=9) throw error;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }
  } catch(error) {
    await unlink(temporary).catch(()=>{});
    throw error;
  }
}
