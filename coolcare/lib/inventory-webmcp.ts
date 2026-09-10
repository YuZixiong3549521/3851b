'use client';
import { useEffect } from 'react';
import { api, ROOT, type Part, type List, type User } from './inventory-client';
type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => Promise<unknown>;
};
type ModelDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: Tool,
      options: { signal: AbortSignal },
    ) => void | Promise<void>;
  };
};
export function useWebTools(
  user: User | null,
  go: (url: string) => void,
  refresh: () => void,
) {
  useEffect(() => {
    const context = (document as ModelDocument).modelContext;
    if (!user || !context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: Tool[] = [
      {
        name: 'search_inventory_parts',
        title: 'Search inventory parts',
        description:
          'Read matching MySQL parts, with current stock and price. Requires an active admin session.',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', maxLength: 120 } },
          required: ['query'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        async execute(input) {
          if (
            !input ||
            typeof input !== 'object' ||
            !('query' in input) ||
            typeof input.query !== 'string' ||
            input.query.length > 120 ||
            Object.keys(input).some((k) => k !== 'query')
          )
            throw new Error(
              'Provide a query string of at most 120 characters.',
            );
          return api<List<Part>>('/parts?q=' + encodeURIComponent(input.query));
        },
      },
      {
        name: 'start_inventory_transaction',
        title: 'Start a stock transaction',
        description:
          'Open the record-transaction form for an existing active part and type. This stages a form only; a human must review and confirm to save.',
        inputSchema: {
          type: 'object',
          properties: {
            part_id: { type: 'integer', minimum: 1 },
            type: {
              type: 'string',
              enum: ['Stock In', 'Stock Out', 'Return', 'Adjustment'],
            },
          },
          required: ['part_id', 'type'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute(input) {
          if (!input || typeof input !== 'object')
            throw new Error('Invalid input');
          const v = input as Record<string, unknown>;
          if (
            !Number.isInteger(v.part_id) ||
            Number(v.part_id) < 1 ||
            !['Stock In', 'Stock Out', 'Return', 'Adjustment'].includes(
              String(v.type),
            ) ||
            Object.keys(v).some((k) => !['part_id', 'type'].includes(k))
          )
            throw new Error('Invalid part or transaction type.');
          const part = await api<Part>('/parts/' + v.part_id);
          if (part.status !== 'Active')
            throw new Error('Activate this part first.');
          go(
            ROOT +
              '/transactions/new?part=' +
              v.part_id +
              '&type=' +
              encodeURIComponent(String(v.type)),
          );
          return { status: 'form_requested', part_id: v.part_id, saved: false };
        },
      },
    ];
    for (const tool of tools) {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Optional progressive enhancement. */
      }
    }
    return () => lifecycle.abort();
  }, [user, go, refresh]);
}
