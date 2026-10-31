export declare function decodeJwtPayload(
  token: string
): { id?: string; email?: string; [k: string]: unknown } | null;
