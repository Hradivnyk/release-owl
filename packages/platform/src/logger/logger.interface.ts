export interface ILogger {
  info(objOrMsg: object | string, msg?: string): void;
  warn(objOrMsg: object | string, msg?: string): void;
  debug(objOrMsg: object | string, msg?: string): void;
  error(objOrMsg: object | string, msg?: string): void;
}
