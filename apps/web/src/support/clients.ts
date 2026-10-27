import type { SupportClient } from '@grids/viz';
import { api } from '../api';
import { env } from '../env';

/** The help window for someone who is not signed in: they give a name and email, solve the puzzle, and follow it by a secret link. */
export function visitorSupport(orgSlug: string, embed?: string, identity?: { name?: string; email?: string } | null): SupportClient {
  return {
    signedIn: false,
    identity: identity ?? null,
    storageKey: `grids-help:${orgSlug}`,
    info: () => api.publicHelpInfo(orgSlug),
    captcha: () => api.publicCaptcha(),
    sendEmailCode: async (email) => void (await api.publicHelpEmailCode(orgSlug, email)),
    verifyEmail: (email, code) => api.publicHelpEmailVerify(orgSlug, email, code),
    typing: (token, text) => api.publicHelpTyping(token, text),
    upload: (file, thread) => (thread ? api.publicHelpUploadReply(thread, file, file.name) : api.publicHelpUpload(orgSlug, file, file.name)),
    create: (input) => api.publicHelpCreate(orgSlug, embed ? { ...input, embed } : input),
    thread: (token) => api.publicHelpThread(token),
    reply: (token, input) => api.publicHelpReply(token, input),
    fileUrl: (token, id) => Promise.resolve(`${env.apiUrl}/public/help/${token}/files/${id}`),
    openFile: (token, file) => void window.open(`${env.apiUrl}/public/help/${token}/files/${file.id}`, '_blank', 'noopener'),
  };
}
