// V4 binding to the existing scheduler and the same foreground agent/store.
import path from 'node:path';
import {z} from 'zod';
import {Scheduler,parseWhen} from '../core/schedule.js';

const definition=z.object({
  name:z.string().trim().min(1).max(100),
  when:z.string().trim().min(1).max(500),
  task:z.string().trim().min(1).max(12000),
  maxRuns:z.number().int().min(1).max(1000),
});
export const taskAction=z.discriminatedUnion('action',[
  definition.extend({action:z.literal('create'),maxRuns:definition.shape.maxRuns.default(20)}),
  definition.partial().extend({action:z.literal('edit'),id:z.string().min(1)}),
  ...['pause','resume','cancel','run'].map(action=>z.object({action:z.literal(action),id:z.string().min(1)})),
]);

export function createBackgroundTasks({root,conversations,startTurn,ready=Promise.resolve(),now=()=>Date.now()}){
  const active=new Map();let closed=false;
  const scheduler=new Scheduler({get:()=>undefined},{file:path.join(root,'background-tasks.json'),now,
    runTask:async({jobId,runId,input})=>{
      if(closed)throw Error('background service stopped');
      await ready;
      const job=scheduler.jobs.find(j=>j.id===jobId);
      if(closed||job?.paused)return {status:'cancelled',text:''};
      if(!job?.metadata?.conversationId)throw Error('Task has no durable conversation');
      const run=startTurn({conversationId:job.metadata.conversationId,text:input,requestId:`scheduled-${runId}`,owner:`schedule:${jobId}`});
      active.set(jobId,run);
      try{
        const result=await run.finished;
        // Pause failed/held work: never blindly retry an unverified side effect.
        if(!['completed','replayed'].includes(result.status))job.paused=true;
        const conv=conversations.get(job.metadata.conversationId);
        const text=conv?.messages.filter(m=>m.role==='assistant').at(-1)?.content||'';
        return {...result,text};
      }finally{active.delete(jobId);}
    },
  });
  const validateSchedule=when=>{const spec=parseWhen(when);if(spec.kind==='every'&&spec.everyMs<30000)throw Error('Background interval must be at least 30 seconds');};
  function list(){return scheduler.list().map(j=>({...j,conversationId:j.metadata?.conversationId||null}));}
  async function manage(raw){
    const input=taskAction.parse(raw);
    if(closed)throw Error('background service stopped');
    if(input.action==='create'){
      validateSchedule(input.when);
      if(scheduler.jobs.length>=100)throw Error('Background task limit reached (100)');
      const conv=conversations.create({title:input.name,titlePolicy:'manual'});
      return scheduler.add({...input,readOnly:false,metadata:{conversationId:conv.id,schema:'majin.v4.background/v1'}});
    }
    const job=scheduler.jobs.find(j=>j.id===input.id);
    if(!job)throw Error('Unknown background task');
    if(input.action==='edit'){
      if(input.when)validateSchedule(input.when);
      const {action,id,...changes}=input;return scheduler.update(id,changes);
    }
    if(input.action==='run'){
      if(job.paused)throw Error('Resume the task before running it');
      // Return a handle immediately; long-running work belongs to the journal.
      void scheduler.runNow(job.id).catch(()=>scheduler.stop());
      return {id:job.id,status:'dispatched',conversationId:job.metadata.conversationId};
    }
    if(input.action==='cancel'){
      scheduler.setPaused(job.id,true);active.get(job.id)?.cancel();
      // Retain history and authorization records instead of deleting evidence.
      job.metadata={...job.metadata,cancelledAt:new Date(now()).toISOString()};scheduler.save();
    }else{
      if(input.action==='resume'&&job.metadata?.cancelledAt)throw Error('Cancelled tasks cannot resume; create a new task');
      scheduler.setPaused(job.id,input.action==='pause');
      if(input.action==='pause')active.get(job.id)?.cancel();
    }
    return list().find(j=>j.id===job.id);
  }
  return {scheduler,list,manage,
    start(){if(!closed)scheduler.start();},
    stop(){closed=true;scheduler.stop();for(const run of active.values())run.cancel();},
    tools:[
      {name:'task_list',description:'List durable background tasks with schedule, history, budgets and conversation links.',tier:'read',inputSchema:z.object({}),outputSchema:z.object({tasks:z.array(z.any())}),execute:async()=>({tasks:list()})},
      {name:'task_manage',description:'Create, edit, pause, resume, cancel or run an owner-approved durable scheduled task. Work continues with the same agent and approvals while the app is closed. Minimum interval 30 seconds; maxRuns bounds total dispatches.',tier:'external',inputSchema:taskAction,outputSchema:z.any(),execute:manage},
    ],
  };
}
