import { createDriverTools } from './codex-tools.js';
// Protocol stdout belongs exclusively to the parent MCP server.
console.log = (...args) => console.error(...args);
const tools = await createDriverTools(JSON.parse(process.env.MAJIN_DRIVER_OPTIONS));
process.send({ ready: true, tools: [...tools.values()].map(({ run, ...t }) => t) });
process.on('disconnect', async () => {
  // The driver worker is owned by the host process. If that host dies, do not
  // leave a Playwright browser or worker process orphaned behind it.
  try {
    const closing = tools.get('browser_close')?.run({});
    if (closing) await Promise.race([closing, new Promise(resolve => setTimeout(resolve, 5000))]);
  } catch { /* the parent is gone; exit is the cleanup boundary */ }
  process.exit(0);
});
process.on('message', async ({ id, name, args }) => {
  try { process.send({ id, value: await tools.get(name).run(args) }); }
  catch (error) { process.send({ id, value: { ok: false, error: { code: error.code || 'TOOL_FAILURE', message: error.message, ...(error.meta ? { meta: error.meta } : {}), ...(error.details ? { details: error.details } : {}) } } }); }
});
