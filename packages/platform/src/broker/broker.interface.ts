export interface IBroker {
  connect(): Promise<void>;
  close(): Promise<void>;
  publish<T>(routingKey: string, payload: T): Promise<void>;
  subscribe<T>(
    queue: string,
    routingKey: string,
    handler: (payload: T) => Promise<void>,
  ): Promise<void>;
}
