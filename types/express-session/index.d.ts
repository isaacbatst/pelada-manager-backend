// @types/express-session/index.d.ts
import 'express-session';

declare module 'express-session' {
  interface SessionData {
    gameDayId: string;
    courtId?: string;
  }
}
