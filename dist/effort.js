/** User-facing effort levels; provider controls vary by model. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** Conservative capability table based on the providers' published model documentation. */
export function describeEffort(provider, model, level = 'medium') {
    const id = model.toLowerCase();
    let choices;
    if (provider === 'openai') {
        if (/^gpt-6(?:\.1)?-(?:astra|sol|terra|luna)(?:-|$)/.test(id))
            choices = ['low', 'medium', 'high', 'xhigh', 'max'];
        else if (/^gpt-5-pro(?:-|$)/.test(id))
            choices = ['high'];
        else if (/^gpt-5\.(?:[2-9]|[1-9][0-9])(?:[.-]|$)/.test(id))
            choices = ['low', 'medium', 'high', 'xhigh'];
        else if (/^gpt-5(?:[.-]|$)/.test(id) || /^o(?:3|4-mini)(?:[.-]|$)/.test(id))
            choices = ['low', 'medium', 'high'];
    }
    else if (provider === 'anthropic') {
        if (/^claude-(?:fable-5|mythos-5|mythos-preview|opus-(?:5|4-[78])|sonnet-5|haiku-5-5)(?:-|$)/.test(id))
            choices = ['low', 'medium', 'high', 'xhigh', 'max'];
        else if (/^claude-(?:opus-4-6|sonnet-4-6)(?:-|$)/.test(id))
            choices = ['low', 'medium', 'high', 'max'];
        else if (/^claude-opus-4-5(?:-|$)/.test(id))
            choices = ['low', 'medium', 'high'];
    }
    else if (provider === 'gemini') {
        if (/^gemini-(?:3-(?:pro-preview|1-flash-lite-image)|3\.1-flash-lite-image)(?:-|$)/.test(id))
            choices = ['low', 'high'];
        else if (/^gemini-(?:3\.(?:1|5|6|7|8)|3-flash|4-argon)(?:-|$)/.test(id) && !/(?:image|audio|live|tts)/.test(id))
            choices = ['low', 'medium', 'high'];
    }
    else if (provider === 'openrouter') {
        if (/^(?:openai\/(?:gpt-5|gpt-6|o3|o4-mini)|anthropic\/claude-(?:opus-4\.[5-9]|opus-5|sonnet-4\.6|sonnet-5|haiku-5|fable-5|mythos-5)|google\/gemini-(?:3|4))(?:[.\/-]|$)/.test(id))
            choices = ['low', 'medium', 'high', 'xhigh'];
    }
    if (!choices)
        return { supported: false, message: 'Bu model için düşünme düzeyi kontrolü doğrulanmadı; sağlayıcının varsayılanı kullanılacak.' };
    const order = EFFORT_LEVELS.indexOf(level);
    const effective = choices.reduce((best, candidate) => {
        const distance = Math.abs(EFFORT_LEVELS.indexOf(candidate) - order);
        const bestDistance = Math.abs(EFFORT_LEVELS.indexOf(best) - order);
        return distance < bestDistance || (distance === bestDistance && EFFORT_LEVELS.indexOf(candidate) < EFFORT_LEVELS.indexOf(best)) ? candidate : best;
    });
    return { supported: true, effective, message: effective === level ? `Düşünme düzeyi: ${effective}.` : `${level} bu modelde kullanılamıyor; ${effective} uygulanacak.` };
}
//# sourceMappingURL=effort.js.map