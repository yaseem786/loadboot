// Retry only explicit refusals: an ambiguous network error may follow a committed note.
export function createOnboardingSaveQueue({ send, getIdentity, onStatus = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let tail = Promise.resolve(), pending = 0, healthy = true;
  const status = value => { try { onStatus(value); } catch (_) {} };
  return {
    isHealthy: () => healthy,
    enqueue(args) {
      if (pending >= 40) {
        healthy = false; status('error');
        return Promise.reject(new Error('Too many pending saves'));
      }
      const payload = JSON.parse(JSON.stringify(args)), identity = getIdentity();
      pending++;
      const task = tail.then(async () => {
        for (let attempt = 0; ; attempt++) {
          if (getIdentity() !== identity) throw new Error('Chat changed before saving');
          status(healthy ? 'saving' : 'error');
          const result = await send(payload, identity);
          if (getIdentity() !== identity) throw new Error('Chat changed while saving');
          if (result && result.ok === true && !result.error) return result;
          if (result && result.error === 'rate_limit' && attempt < 2) {
            const seconds = Number(result.retry_after);
            if (!Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw new Error('Invalid retry delay');
            status(healthy ? 'retrying' : 'error');
            await wait(Math.ceil(seconds) * 1000);
            continue;
          }
          throw new Error('Onboarding progress could not be saved');
        }
      });
      tail = task.catch(() => {});
      return task.then(result => {
        pending--;
        if (!pending && healthy) status('saved');
        return result;
      }, error => {
        pending--; healthy = false; status('error');
        throw error;
      });
    }
  };
}
