export function planTurnBudget(budget, fixedTokens) {
    const fixed = Math.max(0, Math.floor(Number.isFinite(fixedTokens) ? fixedTokens : 0));
    const target = Math.max(0, Math.floor(budget.historyTokens));
    const historyTokens = Math.max(0, target - fixed);
    const overBudget = fixed >= target;
    return {
        historyTokens,
        fixedTokens: fixed,
        reservedOutputTokens: budget.reserveOutputTokens,
        overBudget,
        note: overBudget
            ? `System and tool schemas use ${fixed.toLocaleString('en-US')} estimated tokens, meeting the local ${target.toLocaleString('en-US')} history target. Only required anchors will be retained.`
            : `${historyTokens.toLocaleString('en-US')} estimated tokens remain for history after ${fixed.toLocaleString('en-US')} fixed tokens.`,
    };
}
//# sourceMappingURL=context-planner.js.map