declare namespace Express {
  interface Request {
    user?: {
      id: string;
      userId: string;
      username: string;
      email?: string;
      [key: string]: any;
    };
  }
}