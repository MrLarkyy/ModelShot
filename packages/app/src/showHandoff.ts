import { describeHandoff, type HandoffSummary } from './handoff/describeHandoff';
import { takeHandoffFiles } from './handoff/fileHandoff';

function render(status: HTMLElement, summary: HandoffSummary): void {
  const message = document.createElement('p');
  message.textContent = summary.message;
  status.replaceChildren(message);
  if (summary.items.length === 0) return;
  const list = document.createElement('ul');
  for (const item of summary.items) {
    const entry = document.createElement('li');
    entry.textContent = item;
    list.append(entry);
  }
  status.append(list);
}

// Takes the files the landing page handed over (?open=handoff) and lists them; parsing them is the editor's job.
export async function showHandoff(status: HTMLElement): Promise<void> {
  try {
    render(status, describeHandoff(await takeHandoffFiles()));
  } catch (error) {
    render(status, { message: error instanceof Error ? error.message : String(error), items: [] });
  }
}
