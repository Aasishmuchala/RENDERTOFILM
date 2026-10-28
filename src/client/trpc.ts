import { createTRPCReact } from '@trpc/react-query';

import type { AppRouterType } from '../api.ts';

export const trpc = createTRPCReact<AppRouterType>();
