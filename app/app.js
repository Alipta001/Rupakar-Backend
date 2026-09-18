import app from '../app.js';

export class App {
  constructor() {
    this.app = app;
  }

  async close() {
    if (this.app.locals.redis?.status === 'ready' || this.app.locals.redis?.status === 'connecting') {
      this.app.locals.redis.disconnect();
    }
  }
}

export const createApp = () => app;
export default app;
