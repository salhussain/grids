import type { SupportClient } from '@grids/viz';
import { api } from './api';
import { env } from './env';

/** The help window for someone signed in to the portal: their account says who they are, and the requests are theirs. */
export function accountSupport(tenantId: string): SupportClient {
  return {
    signedIn: true,
    storageKey: `grids-help:${tenantId}`,
    info: () => api.helpInfo(tenantId),
    upload: (file) => api.helpUpload(tenantId, file, file.name),
    create: (input) => api.helpCreate(tenantId, input),
    thread: (id) => api.helpThread(tenantId, id),
    typing: (id, text) => api.helpTyping(tenantId, id, text),
    reply: (id, input) => api.helpReply(tenantId, id, input),
    mine: () => api.helpMine(tenantId),
    fileUrl: async (_id, fileId) => URL.createObjectURL(await api.helpFile(tenantId, fileId)),
    openFile: async (_id, file) => {
      const url = URL.createObjectURL(await api.helpFile(tenantId, file.id));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  };
}

/** The help window for someone on a public page: they give a name and email, solve the puzzle, and follow it by a secret link. */
export function visitorSupport(orgSlug: string): SupportClient {
  return {
    signedIn: false,
    storageKey: `grids-help:${orgSlug}`,
    info: () => api.publicHelpInfo(orgSlug),
    captcha: () => api.publicCaptcha(),
    sendEmailCode: async (email) => void (await api.publicHelpEmailCode(orgSlug, email)),
    verifyEmail: (email, code) => api.publicHelpEmailVerify(orgSlug, email, code),
    typing: (token, text) => api.publicHelpTyping(token, text),
    upload: (file, thread) => (thread ? api.publicHelpUploadReply(thread, file, file.name) : api.publicHelpUpload(orgSlug, file, file.name)),
    create: (input) => api.publicHelpCreate(orgSlug, input),
    thread: (token) => api.publicHelpThread(token),
    reply: (token, input) => api.publicHelpReply(token, input),
    fileUrl: (token, id) => Promise.resolve(`${env.apiUrl}/public/help/${token}/files/${id}`),
    openFile: (token, file) => void window.open(`${env.apiUrl}/public/help/${token}/files/${file.id}`, '_blank', 'noopener'),
  };
}
