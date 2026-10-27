/**
 * Who is typing in a conversation right now. It lives in memory and fades after a few seconds: it is only a hint
 * for the other side, so it needs no table and nothing to clean up.
 */
const AGENT_MS = 6_000;
const VISITOR_MS = 8_000;
interface Entry {
  agent?: { name: string; at: number };
  visitor?: { name: string; text: string; at: number };
}
const state = new Map<string, Entry>();

const now = () => Date.now();
const trim = () => {
  if (state.size < 500) return;
  for (const [k, e] of state) if ((!e.agent || e.agent.at + AGENT_MS < now()) && (!e.visitor || e.visitor.at + VISITOR_MS < now())) state.delete(k);
};

export function setAgentTyping(ticketId: string, name: string | null) {
  const e = state.get(ticketId) ?? {};
  if (name) e.agent = { name, at: now() };
  else delete e.agent;
  state.set(ticketId, e);
  trim();
}
export function setVisitorTyping(ticketId: string, name: string, text: string) {
  const e = state.get(ticketId) ?? {};
  if (text.trim()) e.visitor = { name, text: text.slice(0, 500), at: now() };
  else delete e.visitor;
  state.set(ticketId, e);
  trim();
}
export const agentTyping = (ticketId: string): string | null => {
  const a = state.get(ticketId)?.agent;
  return a && a.at + AGENT_MS > now() ? a.name : null;
};
export const visitorTyping = (ticketId: string): { name: string; text: string } | null => {
  const v = state.get(ticketId)?.visitor;
  return v && v.at + VISITOR_MS > now() ? { name: v.name, text: v.text } : null;
};
