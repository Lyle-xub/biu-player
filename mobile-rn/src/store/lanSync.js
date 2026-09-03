import { endpoint, normalize } from '../../../renderer/library-sync';

async function request(address, code, path, payload, signal) {
  const base = endpoint(address);
  if (!/^\d{8}$/.test(code)) throw new Error('请输入电脑显示的 8 位配对码');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 12000);
  try {
    const response = await fetch(base + path, {
      method: payload ? 'POST' : 'GET', signal: controller.signal, redirect: 'error',
      headers: { Authorization: `Bearer ${code}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '电脑同步失败');
    if (result.version !== 1 || !Number.isSafeInteger(result.requestId)) throw new Error('同步版本不兼容');
    return result;
  } catch (e) {
    if (timedOut) throw new Error('连接超时，请确认同一 Wi-Fi、地址正确，且电脑已开启同步');
    if (e instanceof TypeError) throw new Error('无法连接电脑，请检查 Wi-Fi、局域网权限和电脑防火墙');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function lanRequest(address, code, library, signal) {
  const result = await request(address, code, library ? '/v1/sync' : '/v1/status', library ? normalize(library) : null, signal);
  if (library) {
    result.library = normalize(result.library);
    if (typeof result.receipt !== 'string') throw new Error('同步确认信息缺失');
  }
  return result;
}
export const lanAcknowledge = (address, code, receipt, signal) => request(address, code, '/v1/ack', { receipt }, signal);
