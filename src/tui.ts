import { createInterface } from 'node:readline';
import type { AgentEvent, ApprovalRequest, Message, Provider } from './types.js';
import { symbols, theme } from './theme.js';
import { logo } from './logo.js';

export interface TuiOptions {
  workspace: string;
  provider: Provider;
  model: string;
  history: Message[];
  onSubmit: (message: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal) => Promise<Message[]>;
  onCommand?: (command: string, setYolo: (enabled: boolean) => void) => Promise<string | undefined>;
  yolo?: boolean;
  onWorkflow?: (command: string, input: string, emit: (event: AgentEvent) => void, approve: (request: ApprovalRequest) => Promise<boolean>, signal: AbortSignal, suspendUi: <T>(action: () => Promise<T>) => Promise<T>) => Promise<void>;
}

// Do not allow control sequences from a tool or provider to operate the terminal.
const safe = (text: string): string => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const write = (text: string): void => { process.stdout.write(text); };

export async function startTui(options: TuiOptions): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
  const lines: string[] = [];
  let waiting: ((line: string | undefined) => void) | undefined;
  let closed = false;
  let controller: AbortController | undefined;
  let streaming = false;
  let exiting = false;
  let yolo = options.yolo ?? false;
  const setYolo = (enabled: boolean): void => { yolo = enabled; };

  const attach = (): void => { rl.on('line', line => {
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(line); }
    else lines.push(line);
  });
  rl.on('close', () => { closed = true; if (waiting) { const resolve = waiting; waiting = undefined; resolve(undefined); } });
  rl.on('SIGINT', () => {
    if (controller) { controller.abort(); if (waiting) { const resolve = waiting; waiting = undefined; resolve(undefined); } write(`\n${theme.muted('Cancelling…')}\n`); }
    else { exiting = true; rl.close(); }
  }); };
  attach();
  const read = async (prompt: string): Promise<string | undefined> => {
    if (interactive) write(prompt);
    if (lines.length) return lines.shift();
    if (closed) return undefined;
    return new Promise(resolve => { waiting = resolve; });
  };
  const finishStream = (): void => { if (streaming) { write('\n'); streaming = false; } };
  const emit = (event: AgentEvent): void => {
    switch (event.type) {
      case 'text':
        if (!streaming) { write(`\n${theme.accent(symbols.assistant)} ${theme.bold('T Bot')}\n\n`); streaming = true; }
        write(safe(event.text));
        break;
      case 'tool_start': finishStream(); write(`\n${theme.muted(`${symbols.tool} ${safe(event.call.name)}`)}\n`); break;
      case 'tool_end': break;
      case 'status': finishStream(); write(`${theme.muted(safe(event.message))}\n`); break;
      case 'error': finishStream(); write(`${theme.error(`Error: ${safe(event.error)}`)}\n`); break;
      case 'usage': break;
    }
  };
  const approve = async (request: ApprovalRequest): Promise<boolean> => {
    finishStream();
    write(`\n${theme.warning('Approval required')} ${theme.bold(safe(request.tool))}\n${safe(request.description)}\n`);
    write(`${theme.muted(safe(JSON.stringify(request.arguments, null, 2)))}\n`);
    if (!interactive || controller?.signal.aborted) { write(`${theme.muted('Denied (interactive approval required).')}\n`); return false; }
    const answer = await read(`${theme.warning('Allow?')} [y/N] `);
    return !controller?.signal.aborted && /^(y|yes)$/i.test((answer ?? '').trim());
  };
  const suspendUi = async <T>(action: () => Promise<T>): Promise<T> => {
    if (!interactive) return action();
    rl.close();
    try { return await action(); }
    finally {
      closed = false;
      rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
      attach();
    }
  };

  if (interactive) {
    const width = Math.max(20, Math.min(process.stdout.columns || 70, 70));
    const logoWidth = process.stdout.columns || 70;
    const animateLogo = logoWidth >= 30 && process.env.TBOT_NO_ANIMATION === undefined && process.env.TERM !== 'dumb' && process.env.TBOT_ASCII !== '1';
    write(`\n${logo(logoWidth, animateLogo ? 0 : -1).join('\n')}\n`);
    if (animateLogo) {
      for (let frame = 1; frame <= 5 && !exiting; frame++) {
        await new Promise<void>(resolve => setTimeout(resolve, 120));
        if (exiting) break;
        write(`\x1b[7A\r${logo(logoWidth, frame === 5 ? -1 : frame).join('\n')}\n`);
      }
    }
    write(`${theme.muted(`  ${safe(options.provider.label)} / ${safe(options.model)}  ${symbols.bullet}  ${safe(options.workspace)}`)}\n`);
    write(`  ${yolo ? theme.warning('YOLO · otomatik onay') : theme.muted('Onaylı')}\n`);
    write(`${theme.muted(`  ${symbols.rule.repeat(width - 2)}`)}\n`);
    write(`${theme.muted('  /help for commands  ·  Ctrl+C to cancel')}\n\n`);
  }
  try {
    while (!exiting) {
      const first = await read(interactive ? `${yolo ? theme.warning('YOLO · otomatik onay') : theme.muted('Onaylı')} ${theme.accent(symbols.prompt)} ` : '');
      if (first === undefined) break;
      let input = first;
      // A trailing backslash joins the next line, allowing multi-line prompts.
      while (input.endsWith('\\')) {
        input = input.slice(0, -1);
        const next = await read(interactive ? `${theme.muted('...')} ` : '');
        if (next === undefined) break;
        input += `\n${next}`;
      }
      input = input.trim();
      if (!input) continue;
      if (input.startsWith('/')) {
        const command = input.split(/\s+/, 1)[0]?.toLowerCase();
        if (command === '/exit' || command === '/quit') break;
        if (command === '/help') {
          write('\n  /help                  Show commands\n  /clear                 Clear conversation\n  /config                Configure provider and model\n  /provider              Select provider\n  /model                 Select model\n  /auth                  Update API key\n  /mcp                   Configure MCP servers\n  /yolo [on|off]         Toggle automatic tool approval\n  /goal <goal>           Create a goal\n  /goal status|run|pause|resume|complete|cancel\n  /plan <request>        Create and review a plan\n  /plan apply            Apply the current plan\n  /subagents [task]      Configure or run subagents\n  /sessions              List sessions\n  /resume                Resume a session\n  /exit                  Exit\n\n  End a line with \\ to continue on the next line.\n\n');
          continue;
        }
        if (command === '/clear') { await options.onCommand?.(input, setYolo); if (interactive) process.stdout.write('\x1b[2J\x1b[H'); write(`${theme.muted('Conversation cleared.')}\n`); continue; }
        if ((command === '/goal' || command === '/plan' || command === '/subagents' || command === '/mcp') && options.onWorkflow) {
          controller = new AbortController();
          try { await options.onWorkflow(command, input.slice(command.length).trim(), emit, approve, controller.signal, suspendUi); }
          catch (error) { finishStream(); write(`${theme.error(controller.signal.aborted ? 'Cancelled.' : `Error: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`); }
          finally { controller = undefined; finishStream(); }
          if (interactive) write('\n');
          continue;
        }
        let result: string | undefined;
        const menu = interactive && (command === '/provider' || command === '/model' || command === '/config' || command === '/auth' || input.toLowerCase() === '/yolo');
        try { result = menu ? await suspendUi(async () => options.onCommand?.(input, setYolo)) : await options.onCommand?.(input, setYolo); }
        catch (error) { result = `Error: ${error instanceof Error ? error.message : String(error)}`; }
        write(`${safe(result ?? 'Unknown command. Type /help for commands.')}\n`);
        continue;
      }
      controller = new AbortController();
      try { await options.onSubmit(input, emit, approve, controller.signal); }
      catch (error) { finishStream(); write(`${theme.error(controller.signal.aborted ? 'Cancelled.' : `Error: ${safe(error instanceof Error ? error.message : String(error))}`)}\n`); }
      finally { controller = undefined; finishStream(); }
      if (interactive) write('\n');
    }
  } finally { rl.close(); }
}
