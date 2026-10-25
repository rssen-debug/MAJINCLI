import { createDriverTools } from './codex-tools.js';
// Protocol stdout belongs exclusively to the parent MCP server.
console.log = (...args) => console.error(...args);
const tools = await createDriverTools(JSON.parse(process.env.MAJIN_DRIVER_OPTIONS));
process.send({ ready: true, tools: [...tools.values()].map(({ run, ...t }) => t) });
process.on('message', async ({ id, name, args }) => {
  try { process.send({ id, value: await tools.get(name).run(args) }); }
  catch (error) { process.send({ id, value: { ok: false, error: { code: error.code || 'TOOL_FAILURE', message: error.message, ...(error.meta ? { meta: error.meta } : {}), ...(error.details ? { details: error.details } : {}) } } }); }
});
