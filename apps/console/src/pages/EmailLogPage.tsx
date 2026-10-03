import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  ErrorNotice,
  Input,
  KeyValues,
  Loading,
  Mono,
  PageHeader,
  Pagination,
  Panel,
  RefreshControl,
  Select,
  Status,
  Table,
  Td,
  dateTime,
  relTime,
  useLiveInterval,
  usePagination,
} from '@grids/ui';
import { api } from '../api';
import { NoAccess, useCan } from '../session';

export function EmailLogPage() {
  const can = useCan();
  const live = useLiveInterval();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = usePagination([status, q]);
  const query = { status: status || undefined, q: q || undefined, ...page };
  const emails = useQuery({
    queryKey: ['emails', query],
    queryFn: () => api.emailLog(query),
    placeholderData: keepPreviousData,
    refetchInterval: live,
    enabled: can('logs.email'),
  });
  const email = useQuery({
    queryKey: ['email', openId],
    queryFn: () => api.email(openId!),
    enabled: !!openId,
  });
  if (!can('logs.email')) return <NoAccess what="the email log" />;
  const d = emails.data;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Email log"
        meta={
          <span>
            Every transactional email the platform sent or attempted, including delivery failures.
          </span>
        }
        actions={<RefreshControl queryKeys={[['emails']]} />}
      />
      <Panel
        flush
        title={`${d?.total ?? '–'} emails`}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Recipient, subject, template"
                className="w-64 pl-8"
                aria-label="Search emails"
              />
            </div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Delivery status"
              className="w-36"
            >
              <option value="">All</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </Select>
          </>
        }
      >
        <ErrorNotice error={emails.error} />
        {emails.isPending ? (
          <Loading />
        ) : (
          <>
            <Table
              head={['Sent', 'To', 'Subject', 'Template', 'Organisation', 'Status']}
              empty="No emails match."
            >
              {d?.items.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer hover:bg-zinc-50"
                  onClick={() => setOpenId(e.id)}
                >
                  <Td className="whitespace-nowrap text-zinc-500">{relTime(e.at)}</Td>
                  <Td>{e.to}</Td>
                  <Td className="max-w-md truncate font-medium">{e.subject}</Td>
                  <Td>
                    <Mono className="text-xs">{e.template}</Mono>
                  </Td>
                  <Td className="text-zinc-600">{e.tenant?.name ?? '—'}</Td>
                  <Td>
                    <Status value={e.status} />
                    {e.error && (
                      <div className="mt-1 max-w-xs truncate text-xs text-red-700" title={e.error}>
                        {e.error}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
            {d && <Pagination {...page} total={d.total} onChange={setPage} />}
          </>
        )}
      </Panel>
      <Dialog
        open={!!openId}
        onClose={() => setOpenId(null)}
        wide
        title={email.data?.subject ?? 'Email'}
        description={email.data && `To ${email.data.to}`}
      >
        {email.data ? (
          <div className="space-y-4">
            <KeyValues
              items={[
                ['Sent', dateTime(email.data.at)],
                ['Template', <Mono key="t">{email.data.template}</Mono>],
                ['Organisation', email.data.tenant?.name],
                ['Status', <Status key="s" value={email.data.status} />],
              ]}
            />
            {email.data.error && <ErrorNotice error={new Error(email.data.error)} />}
            <pre className="max-h-[50vh] overflow-auto border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {email.data.bodyText}
            </pre>
          </div>
        ) : (
          <Loading />
        )}
      </Dialog>
    </>
  );
}
