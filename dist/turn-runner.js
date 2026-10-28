/**
 * Shared turn dispatch. The CLI and Desktop must not implement their own
 * goal/plan/ultracode/subagent ordering; they only supply the host context.
 */
import { runAgent } from './agent.js';
import { executePlan, planTask, runGoal } from './workflows.js';
import { runUltracode } from './ultracode.js';
import { runSubagents } from './subagents.js';
export async function runTurnMode(input, options) {
    const runner = (step) => runAgent(step, { workspace: options.workspace, session: options.session, onEvent: options.onEvent });
    const mode = options.mode ?? 'agent';
    if (mode === 'goal')
        return await runGoal(input, runner);
    if (mode === 'plan')
        return await planTask(input);
    if (mode === 'plan-apply') {
        if (typeof options.plan !== 'string' || !options.plan.trim()) {
            throw new Error('Uygulanacak plan bulunamadı. Önce /plan <istek> ile plan oluşturun.');
        }
        return await executePlan({ ...input, message: input.message }, options.plan, runner);
    }
    if (mode === 'ultracode') {
        return await runUltracode({ ...input, workerProvider: options.workerProvider ?? input.provider });
    }
    if (mode === 'subagents') {
        return await runSubagents({ ...input, workerProvider: options.workerProvider ?? input.provider });
    }
    return await runner(input);
}
//# sourceMappingURL=turn-runner.js.map