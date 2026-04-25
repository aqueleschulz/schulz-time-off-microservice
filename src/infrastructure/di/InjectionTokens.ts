/**
 * Explicit tokens for NestJS Dependency Injection.
 * Prevents runtime coupling to concrete implementations or TypeScript interfaces.
 */
export const DI_TOKENS = {
  DB_CONNECTION: Symbol('DB_CONNECTION'),
  HCM_PORT: Symbol('IHcmPort'),
  BALANCE_REPOSITORY: Symbol('IBalanceRepository'),
  HTTP_CLIENT: Symbol('IHttpClient'),
};
